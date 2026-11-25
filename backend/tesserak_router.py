from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
import asyncio
import os
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from auth import (
    authenticate_email_user,
    get_user_profile,
    register_email_user,
    require_auth_if_configured,
    upsert_user_profile,
)
from connections import ConnectionManager
from db import (
    ApprovalRecord,
    GuardrailRuleRecord,
    IntegrationRecord,
    PendingResourceRecord,
    PipelineRecord,
    get_db,
    normalize_email,
)
from integrations_service import utc_now_iso, verify_integration_credentials
from pipelines_service import (
    list_deployable_clusters,
    run_pipeline_async,
    verify_git_remote,
)
from resources_service import (
    discover_live_aws_resources,
    execute_aws_delete,
    execute_aws_provision,
    execute_aws_reconcile,
    invalidate_resource_cache,
    run_live_guardrail_audit,
)

public_router = APIRouter(tags=["Auth Status"])
router = APIRouter(
    tags=["Tesserak Platform"],
    dependencies=[Depends(require_auth_if_configured)],
)

connection_manager = ConnectionManager("connections")


def _default_guardrail_rules() -> List[Dict[str, Any]]:
    now = utc_now_iso()
    return [
        {
            "id": "gr-cost-ceiling",
            "name": "Monthly FinOps Spend Ceiling",
            "description": "Cloud resources estimated above threshold require approval before calling AWS creation APIs.",
            "category": "FinOps",
            "severity": "approval",
            "enabled": True,
            "threshold": 250,
            "violations": 0,
            "updatedAt": now,
        },
        {
            "id": "gr-encryption",
            "name": "Enforce KMS / SSE Encryption at Rest",
            "description": "Blocks creating unencrypted S3, SQS, RDS, or ElastiCache resources and flags unencrypted AWS resources in live scans.",
            "category": "Security",
            "severity": "block",
            "enabled": True,
            "threshold": None,
            "violations": 0,
            "updatedAt": now,
        },
        {
            "id": "gr-public-access",
            "name": "Block Public Access & Privileged Pods",
            "description": "Blocks public RDS/S3 provisioning and blocks `privileged: true` pods during real pipeline manifest scans.",
            "category": "Network",
            "severity": "block",
            "enabled": True,
            "threshold": None,
            "violations": 0,
            "updatedAt": now,
        },
        {
            "id": "gr-prod-delete-lock",
            "name": "Production Resource Deletion Lock",
            "description": "Prevents deleting production cloud resources until unlocked.",
            "category": "Governance",
            "severity": "block",
            "enabled": True,
            "threshold": None,
            "violations": 0,
            "updatedAt": now,
        },
        {
            "id": "gr-region-allowlist",
            "name": "Approved Sovereignty Regions",
            "description": "Flags or blocks deployments outside approved regions (us-east-1, us-west-2, eu-west-1).",
            "category": "Compliance",
            "severity": "warn",
            "enabled": True,
            "threshold": None,
            "violations": 0,
            "updatedAt": now,
        },
    ]


def _ensure_user_guardrails(session: Any, clean_email: str) -> List[GuardrailRuleRecord]:
    rows = (
        session.query(GuardrailRuleRecord)
        .filter(GuardrailRuleRecord.user_email == clean_email)
        .order_by(GuardrailRuleRecord.sort_order.asc(), GuardrailRuleRecord.id.asc())
        .all()
    )
    if rows:
        return rows
    created: List[GuardrailRuleRecord] = []
    for idx, rule in enumerate(_default_guardrail_rules()):
        rec = GuardrailRuleRecord(
            user_email=clean_email,
            id=rule["id"],
            name=rule["name"],
            description=rule["description"],
            category=rule["category"],
            severity=rule["severity"],
            enabled=bool(rule["enabled"]),
            threshold=rule.get("threshold"),
            violations=int(rule.get("violations", 0)),
            updated_at=rule["updatedAt"],
            sort_order=idx,
        )
        session.add(rec)
        created.append(rec)
    session.flush()
    return created


def _integration_to_dict(row: IntegrationRecord, include_secret: bool = False) -> Dict[str, Any]:
    db = get_db()
    out: Dict[str, Any] = {
        "id": row.id,
        "name": row.name,
        "provider": row.provider,
        "category": row.category,
        "scope": row.scope or "",
        "endpoint": row.endpoint,
        "credentialHint": row.credential_hint or "",
        "status": row.status,
        "lastCheckedAt": row.last_checked_at,
        "latencyMs": row.latency_ms,
        "managedBy": row.managed_by,
        "metadata": row.metadata_json or {},
    }
    if include_secret:
        out["secretPayload"] = db.decrypt_json(row.secret_payload_enc)
    return out


def _rule_to_dict(row: GuardrailRuleRecord) -> Dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "category": row.category,
        "severity": row.severity,
        "enabled": bool(row.enabled),
        "threshold": row.threshold,
        "violations": int(row.violations or 0),
        "updatedAt": row.updated_at,
    }


def _approval_to_dict(row: ApprovalRecord) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "id": row.id,
        "resourceId": row.resource_id,
        "resourceName": row.resource_name,
        "resourceKind": row.resource_kind,
        "environment": row.environment,
        "requestedBy": row.requested_by,
        "estimatedMonthlyCost": row.estimated_monthly_cost,
        "triggeredRule": row.triggered_rule,
        "reason": row.reason,
        "status": row.status,
        "createdAt": row.created_at,
        "provisionSpec": row.provision_spec_json,
    }
    if row.decided_at:
        out["decidedAt"] = row.decided_at
    if row.comment:
        out["comment"] = row.comment
    return out


def _pipeline_to_dict(row: PipelineRecord) -> Dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "repositoryUrl": row.repository_url,
        "branch": row.branch,
        "targetCluster": row.target_cluster,
        "namespace": row.namespace,
        "manifestPath": row.manifest_path,
        "dockerfilePath": row.dockerfile_path or "",
        "imageTag": row.image_tag or "",
        "gitIntegrationId": row.git_integration_id,
        "verifiedRemoteSha": row.verified_remote_sha,
        "lastRunNumber": int(row.last_run_number or 0),
        "status": row.status,
        "durationSec": float(row.duration_sec or 0.0),
        "triggeredBy": row.triggered_by,
        "lastRunAt": row.last_run_at,
        "stages": row.stages_json or [],
        "recentRuns": row.recent_runs_json or [],
    }


def _load_state(user_email: str) -> Dict[str, Any]:
    clean_email = normalize_email(user_email)
    db = get_db()
    with db.session_scope() as session:
        rule_rows = _ensure_user_guardrails(session, clean_email)
        int_rows = (
            session.query(IntegrationRecord)
            .filter(IntegrationRecord.user_email == clean_email)
            .order_by(IntegrationRecord.created_at.desc())
            .all()
        )
        apr_rows = (
            session.query(ApprovalRecord)
            .filter(ApprovalRecord.user_email == clean_email)
            .order_by(ApprovalRecord.created_at.desc())
            .all()
        )
        pend_rows = (
            session.query(PendingResourceRecord)
            .filter(PendingResourceRecord.user_email == clean_email)
            .order_by(PendingResourceRecord.created_at.desc())
            .all()
        )
        pip_rows = (
            session.query(PipelineRecord)
            .filter(PipelineRecord.user_email == clean_email)
            .order_by(PipelineRecord.created_at.desc())
            .all()
        )
        return {
            "integrations": [_integration_to_dict(r, include_secret=True) for r in int_rows],
            "guardrailRules": [_rule_to_dict(r) for r in rule_rows],
            "approvals": [_approval_to_dict(r) for r in apr_rows],
            "pendingResources": [dict(r.payload_json) for r in pend_rows],
            "pipelines": [_pipeline_to_dict(r) for r in pip_rows],
        }


def _save_pipeline_state(user_email: str, state: Dict[str, Any]) -> None:
    """Persist pipeline execution updates atomically back to PostgreSQL."""
    clean_email = normalize_email(user_email)
    db = get_db()
    with db.session_scope() as session:
        for p in state.get("pipelines", []):
            row = (
                session.query(PipelineRecord)
                .filter(
                    PipelineRecord.id == p["id"],
                    PipelineRecord.user_email == clean_email,
                )
                .first()
            )
            if row:
                row.last_run_number = int(p.get("lastRunNumber", 0))
                row.status = p.get("status", row.status)
                row.duration_sec = float(p.get("durationSec", 0.0))
                row.last_run_at = p.get("lastRunAt") or row.last_run_at
                row.triggered_by = p.get("triggeredBy") or row.triggered_by
                row.stages_json = list(p.get("stages", []))
                row.recent_runs_json = list(p.get("recentRuns", []))


def _sanitize_integration(item: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in item.items() if k != "secretPayload"}


async def _load_aws_connectors_as_integrations(user_email: str) -> List[Dict[str, Any]]:
    conns = await connection_manager.list_connections(user_email)
    out: List[Dict[str, Any]] = []
    for c in conns:
        ak = c.accessKey or ""
        masked = f"{ak[:4]}••••••••{ak[-4:]}" if len(ak) >= 8 else "Configured"
        out.append(
            {
                "id": c.id,
                "name": c.accountName,
                "provider": "aws",
                "category": "cloud",
                "scope": f"Region: {c.region or 'us-east-1'} · AWS IAM STS",
                "credentialHint": masked,
                "status": c.status,
                "lastCheckedAt": c.lastUpdated,
                "latencyMs": 0,
                "managedBy": "connector",
                "metadata": {"region": c.region or "us-east-1"},
            }
        )
    return out


class IntegrationCreate(BaseModel):
    name: str
    provider: Literal["github", "gitlab", "aws-ecr", "aws-secrets", "dockerhub", "cloudflare", "gcp"]
    category: Literal["cloud", "scm", "registry", "secrets", "dns"]
    scope: str = ""
    secret: str = ""
    endpoint: Optional[str] = None
    username: Optional[str] = None
    accessKey: Optional[str] = None
    secretKey: Optional[str] = None
    region: Optional[str] = None


class GuardrailRuleCreate(BaseModel):
    name: str
    description: str
    category: str = "Security"
    severity: Literal["block", "warn", "approval"] = "warn"
    threshold: Optional[float] = None


class GuardrailRulePatch(BaseModel):
    enabled: Optional[bool] = None
    severity: Optional[Literal["block", "warn", "approval"]] = None
    threshold: Optional[float] = None


class ApprovalDecisionRequest(BaseModel):
    decision: Literal["approve", "reject"]
    comment: Optional[str] = None


class CloudResourceCreate(BaseModel):
    name: str
    provider: Literal["aws"] = "aws"
    serviceType: Literal["S3 Bucket", "SQS Standard Queue", "ElastiCache Redis", "RDS PostgreSQL"]
    region: str = "us-east-1"
    environment: Literal["dev", "staging", "prod"] = "staging"
    nodeType: Optional[str] = None
    encrypted: bool = True
    publicAccess: bool = False
    estimatedMonthlyCost: float = Field(default=15.0, ge=0.0)


class PipelineCreate(BaseModel):
    name: str
    repositoryUrl: str
    branch: str = "main"
    targetCluster: str
    namespace: str = "default"
    manifestPath: str = "."
    dockerfilePath: Optional[str] = None
    imageTag: Optional[str] = None
    gitIntegrationId: Optional[str] = None


class PipelineTriggerRequest(BaseModel):
    branch: Optional[str] = None


class EmailLoginRequest(BaseModel):
    email: str
    password: str


class EmailRegisterRequest(BaseModel):
    email: str
    password: str
    firstName: str
    lastName: str
    accountType: Literal["individual", "organization"] = "individual"
    organization: Optional[str] = None


class ProfileUpdateRequest(BaseModel):
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    accountType: Optional[Literal["individual", "organization"]] = None
    organization: Optional[str] = None
    authProvider: Optional[str] = None
    mobile: Optional[Dict[str, str]] = None
    avatarUrl: Optional[str] = None


@public_router.get("/api/auth/status")
async def get_auth_config_status():
    domain = os.getenv("AUTH0_DOMAIN", "").strip()
    audience = os.getenv("AUTH0_AUDIENCE", "").strip()
    return {
        "auth0Configured": bool(domain),
        "domainConfigured": bool(domain),
        "audienceConfigured": bool(audience),
        "emailAuthEnabled": True,
        "database": "postgresql",
        "mode": "auth0" if domain else "local-fallback",
    }


@router.get("/api/profile")
async def read_user_profile(x_user_email: str = Header(default="demo@tesserak.dev")):
    profile = await asyncio.to_thread(get_user_profile, x_user_email)
    if not profile:
        return {
            "email": normalize_email(x_user_email),
            "firstName": "",
            "lastName": "",
            "accountType": "individual",
            "organization": "Individual Workspace",
            "authProvider": "local",
            "mobile": {"countryCode": "+1", "number": ""},
            "avatarUrl": "",
        }
    return profile


@router.put("/api/profile")
async def save_user_profile(
    payload: ProfileUpdateRequest,
    x_user_email: str = Header(default="demo@tesserak.dev"),
):
    return await asyncio.to_thread(
        upsert_user_profile,
        email=x_user_email,
        first_name=payload.firstName,
        last_name=payload.lastName,
        account_type=payload.accountType,
        organization=payload.organization,
        auth_provider=payload.authProvider,
        mobile=payload.mobile,
        avatar_url=payload.avatarUrl,
    )


@public_router.post("/api/auth/email/register")
async def email_register(payload: EmailRegisterRequest):
    return register_email_user(
        email=payload.email,
        password=payload.password,
        first_name=payload.firstName,
        last_name=payload.lastName,
        account_type=payload.accountType,
        organization=payload.organization,
    )


@public_router.post("/api/auth/email/login")
async def email_login(payload: EmailLoginRequest):
    return authenticate_email_user(email=payload.email, password=payload.password)


def _build_overview_alerts(
    integrations: List[Dict[str, Any]],
    res_data: Dict[str, Any],
    rules: List[Dict[str, Any]],
    approvals: List[Dict[str, Any]],
    pipelines: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Aggregate real platform alerts from AWS connections, drifted resources, approvals, and pipelines."""
    alerts: List[Dict[str, Any]] = []
    now = utc_now_iso()

    if not res_data.get("awsConnected", False):
        alerts.append(
            {
                "id": "alert-aws-disconnected",
                "severity": "warning",
                "category": "AWS Connection",
                "title": "AWS IAM Connector Required",
                "detail": res_data.get("error")
                or "No active AWS IAM connector found. Connect AWS credentials in Integrations to unlock live EKS and cloud resource discovery.",
                "timestamp": now,
                "actionPath": "/integrations",
                "actionLabel": "Connect AWS IAM",
            }
        )

    for integ in integrations:
        if integ.get("status") != "connected":
            alerts.append(
                {
                    "id": f"alert-int-{integ.get('id', integ.get('name'))}",
                    "severity": "error",
                    "category": "Integration",
                    "title": f"Integration Unhealthy: {integ.get('name', 'Connector')}",
                    "detail": f"{integ.get('provider', '').upper()} connector status is '{integ.get('status', 'error')}'. Re-verify credentials.",
                    "timestamp": integ.get("lastCheckedAt") or now,
                    "actionPath": "/integrations",
                    "actionLabel": "Verify Integration",
                }
            )

    for pip in pipelines:
        if pip.get("status") == "Failed":
            failed_stage = next((s for s in pip.get("stages", []) if s.get("status") == "Failed"), None)
            stage_note = f" at stage '{failed_stage['name']}'" if failed_stage else ""
            alerts.append(
                {
                    "id": f"alert-pip-{pip.get('id')}",
                    "severity": "error",
                    "category": "CI/CD Failure",
                    "title": f"Pipeline Failed: {pip.get('name')}",
                    "detail": f"Run #{pip.get('lastRunNumber', 0)} failed{stage_note} ({pip.get('branch', 'main')} → {pip.get('targetCluster', 'cluster')}).",
                    "timestamp": pip.get("lastRunAt") or now,
                    "actionPath": f"/pipelines?pipelineId={pip.get('id')}",
                    "actionLabel": "Inspect Trace",
                }
            )

    for apr in approvals:
        if apr.get("status") == "pending":
            alerts.append(
                {
                    "id": f"alert-apr-{apr.get('id')}",
                    "severity": "warning",
                    "category": "Guardrail Approval",
                    "title": f"Approval Pending: {apr.get('resourceName')}",
                    "detail": f"{apr.get('resourceKind')} (${apr.get('estimatedMonthlyCost', 0):.0f}/mo) — {apr.get('reason', 'Requires reviewer decision')}",
                    "timestamp": apr.get("createdAt") or now,
                    "actionPath": "/guardrails",
                    "actionLabel": "Review Queue",
                }
            )

    for res in res_data.get("resources", []):
        if res.get("driftStatus") == "Drifted":
            notes = "; ".join(res.get("guardrailNotes") or ["Configuration drift detected"])
            alerts.append(
                {
                    "id": f"alert-drift-{res.get('id')}",
                    "severity": "warning",
                    "category": "Cloud Drift",
                    "title": f"Drift Detected: {res.get('name')} ({res.get('serviceType')})",
                    "detail": notes,
                    "timestamp": res.get("lastSyncAt") or now,
                    "actionPath": "/resources",
                    "actionLabel": "Remediate",
                }
            )

    for idx, warn in enumerate(res_data.get("warnings") or []):
        alerts.append(
            {
                "id": f"alert-scan-warn-{idx}",
                "severity": "info",
                "category": "AWS Scan",
                "title": "Partial AWS Resource Discovery",
                "detail": warn,
                "timestamp": now,
                "actionPath": "/resources",
                "actionLabel": "View Resources",
            }
        )

    blocked_violations = sum(int(r.get("violations", 0)) for r in rules if r.get("enabled"))
    if blocked_violations > 0:
        alerts.append(
            {
                "id": "alert-guardrail-blocks",
                "severity": "info",
                "category": "Policy Enforcement",
                "title": f"{blocked_violations} Guardrail Policy Block Event(s)",
                "detail": "Non-compliant provisioning or manifest operations were intercepted by active Guardrails.",
                "timestamp": now,
                "actionPath": "/guardrails",
                "actionLabel": "View Policies",
            }
        )

    severity_order = {"error": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: (severity_order.get(a.get("severity", "info"), 3), a.get("timestamp", "")))
    return alerts


def _build_recent_deployments(pipelines: List[Dict[str, Any]], fallback_user: str) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Return flattened recent deployment runs plus recent pipeline summaries sorted newest-first."""
    deployments: List[Dict[str, Any]] = []
    pipeline_summaries: List[Dict[str, Any]] = []

    for pip in pipelines:
        stages_summary = [
            {
                "name": s.get("name", ""),
                "status": s.get("status", "Ready"),
                "durationSec": s.get("durationSec", 0),
            }
            for s in pip.get("stages", [])
        ]
        pipeline_summaries.append(
            {
                "id": pip.get("id"),
                "name": pip.get("name"),
                "repositoryUrl": pip.get("repositoryUrl"),
                "branch": pip.get("branch", "main"),
                "targetCluster": pip.get("targetCluster", ""),
                "namespace": pip.get("namespace", "default"),
                "verifiedRemoteSha": pip.get("verifiedRemoteSha"),
                "lastRunNumber": pip.get("lastRunNumber", 0),
                "status": pip.get("status", "Ready"),
                "durationSec": pip.get("durationSec", 0),
                "triggeredBy": pip.get("triggeredBy", fallback_user),
                "lastRunAt": pip.get("lastRunAt"),
                "stagesSummary": stages_summary,
                "recentRuns": pip.get("recentRuns", [])[:5],
            }
        )

        if pip.get("status") == "Running":
            deployments.append(
                {
                    "id": f"{pip.get('id')}-running",
                    "pipelineId": pip.get("id"),
                    "pipelineName": pip.get("name"),
                    "repositoryUrl": pip.get("repositoryUrl"),
                    "branch": pip.get("branch", "main"),
                    "commitSha": pip.get("verifiedRemoteSha") or "HEAD",
                    "targetCluster": pip.get("targetCluster", ""),
                    "namespace": pip.get("namespace", "default"),
                    "runNumber": pip.get("lastRunNumber", 0) + 1,
                    "status": "Running",
                    "durationSec": pip.get("durationSec", 0),
                    "triggeredAt": pip.get("lastRunAt") or utc_now_iso(),
                    "triggeredBy": pip.get("triggeredBy", fallback_user),
                    "stagesSummary": stages_summary,
                }
            )

        recent_runs = pip.get("recentRuns", [])
        for run in recent_runs:
            run_num = run.get("runNumber", 0)
            deployments.append(
                {
                    "id": f"{pip.get('id')}-r{run_num}",
                    "pipelineId": pip.get("id"),
                    "pipelineName": pip.get("name"),
                    "repositoryUrl": pip.get("repositoryUrl"),
                    "branch": run.get("branch") or pip.get("branch", "main"),
                    "commitSha": run.get("commitSha") or pip.get("verifiedRemoteSha") or "HEAD",
                    "targetCluster": pip.get("targetCluster", ""),
                    "namespace": pip.get("namespace", "default"),
                    "runNumber": run_num,
                    "status": run.get("status", pip.get("status", "Ready")),
                    "durationSec": run.get("durationSec", 0),
                    "triggeredAt": run.get("triggeredAt") or pip.get("lastRunAt") or "",
                    "triggeredBy": pip.get("triggeredBy", fallback_user),
                    "stagesSummary": stages_summary if run_num == pip.get("lastRunNumber") else [],
                }
            )

        if pip.get("status") == "Ready" and not recent_runs:
            deployments.append(
                {
                    "id": f"{pip.get('id')}-ready",
                    "pipelineId": pip.get("id"),
                    "pipelineName": pip.get("name"),
                    "repositoryUrl": pip.get("repositoryUrl"),
                    "branch": pip.get("branch", "main"),
                    "commitSha": pip.get("verifiedRemoteSha") or "HEAD",
                    "targetCluster": pip.get("targetCluster", ""),
                    "namespace": pip.get("namespace", "default"),
                    "runNumber": 0,
                    "status": "Ready",
                    "durationSec": 0,
                    "triggeredAt": pip.get("lastRunAt") or "",
                    "triggeredBy": pip.get("triggeredBy", fallback_user),
                    "stagesSummary": [],
                }
            )

    deployments.sort(
        key=lambda d: (0 if d.get("status") == "Running" else 1, d.get("triggeredAt", "")),
        reverse=False,
    )
    # Sort non-running items newest-first while keeping Running deployments pinned at top
    running_deps = [d for d in deployments if d.get("status") == "Running"]
    other_deps = sorted(
        [d for d in deployments if d.get("status") != "Running"],
        key=lambda d: d.get("triggeredAt", ""),
        reverse=True,
    )
    pipeline_summaries.sort(key=lambda p: p.get("lastRunAt") or "", reverse=True)
    return (running_deps + other_deps)[:10], pipeline_summaries[:6]


@router.get("/api/overview")
async def get_platform_overview(
    refresh: bool = False,
    x_user_email: str = Header(default="demo@tesserak.dev"),
):
    state = await asyncio.to_thread(_load_state, x_user_email)
    aws_conns = await _load_aws_connectors_as_integrations(x_user_email)
    integrations = aws_conns + [_sanitize_integration(i) for i in state["integrations"]]
    res_data = await discover_live_aws_resources(
        x_user_email,
        connection_manager,
        state["pendingResources"],
        force_refresh=refresh,
    )
    rules = state["guardrailRules"]
    approvals = state["approvals"]
    pipelines = state["pipelines"]

    enabled_rules = sum(1 for r in rules if r.get("enabled"))
    pending_approvals = sum(1 for a in approvals if a.get("status") == "pending")
    resources = res_data.get("resources", [])
    drifted = sum(1 for r in resources if r.get("driftStatus") == "Drifted")

    alerts = _build_overview_alerts(integrations, res_data, rules, approvals, pipelines)
    recent_deployments, recent_pipelines = _build_recent_deployments(pipelines, x_user_email)

    return {
        "integrationsCount": len(integrations),
        "connectedIntegrations": sum(1 for i in integrations if i.get("status") == "connected"),
        "resourcesCount": len(resources),
        "driftedResources": drifted,
        "awsConnected": res_data.get("awsConnected", False),
        "enabledGuardrails": enabled_rules,
        "totalGuardrails": len(rules),
        "pendingApprovals": pending_approvals,
        "pipelinesCount": len(pipelines),
        "healthyPipelines": sum(1 for p in pipelines if p.get("status") == "Succeeded"),
        "activeRunningPipelines": sum(1 for p in pipelines if p.get("status") == "Running"),
        "complianceScore": round((enabled_rules / max(len(rules), 1)) * 100),
        "alerts": alerts,
        "recentDeployments": recent_deployments,
        "recentPipelines": recent_pipelines,
    }


@router.get("/api/integrations")
async def list_integrations(x_user_email: str = Header(default="demo@tesserak.dev")):
    state = await asyncio.to_thread(_load_state, x_user_email)
    aws_conns = await _load_aws_connectors_as_integrations(x_user_email)
    return aws_conns + [_sanitize_integration(i) for i in state["integrations"]]


@router.post("/api/integrations")
async def create_integration(payload: IntegrationCreate, x_user_email: str = Header(default="demo@tesserak.dev")):
    try:
        verified = await verify_integration_credentials(
            provider=payload.provider,
            category=payload.category,
            scope=payload.scope,
            secret=payload.secret,
            endpoint=payload.endpoint,
            username=payload.username,
            access_key=payload.accessKey,
            secret_key=payload.secretKey,
            region=payload.region,
            connection_manager=connection_manager,
            user_email=x_user_email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    db = get_db()
    clean_email = normalize_email(x_user_email)
    new_id = f"int-{uuid.uuid4().hex[:8]}"
    now = utc_now_iso()
    secret_enc = db.encrypt_json(verified.get("secretPayload", {}))

    def _insert():
        with db.session_scope() as session:
            rec = IntegrationRecord(
                id=new_id,
                user_email=clean_email,
                name=payload.name.strip(),
                provider=payload.provider,
                category=payload.category,
                scope=verified["scope"],
                endpoint=payload.endpoint,
                credential_hint=verified["credentialHint"],
                status="connected",
                last_checked_at=now,
                latency_ms=int(verified["latencyMs"]),
                managed_by="tesserak",
                metadata_json=verified.get("metadata", {}),
                secret_payload_enc=secret_enc,
            )
            session.add(rec)
            session.flush()
            return _integration_to_dict(rec, include_secret=False)

    return await asyncio.to_thread(_insert)


@router.post("/api/integrations/{integration_id}/test")
async def test_integration(integration_id: str, x_user_email: str = Header(default="demo@tesserak.dev")):
    db = get_db()
    clean_email = normalize_email(x_user_email)

    def _get_item():
        with db.session_scope() as session:
            row = (
                session.query(IntegrationRecord)
                .filter(
                    IntegrationRecord.id == integration_id,
                    IntegrationRecord.user_email == clean_email,
                )
                .first()
            )
            return _integration_to_dict(row, include_secret=True) if row else None

    item = await asyncio.to_thread(_get_item)
    if not item:
        raise HTTPException(status_code=404, detail="Integration not found")

    sp = item.get("secretPayload", {})
    try:
        verified = await verify_integration_credentials(
            provider=item["provider"],
            category=item["category"],
            scope=item.get("scope", ""),
            secret=sp.get("token") or sp.get("serviceAccountJson") or "",
            endpoint=sp.get("baseUrl") or item.get("endpoint"),
            username=sp.get("username"),
            access_key=sp.get("accessKey"),
            secret_key=sp.get("secretKey"),
            region=sp.get("region"),
            connection_manager=connection_manager,
            user_email=x_user_email,
        )

        def _mark_ok():
            with db.session_scope() as session:
                row = (
                    session.query(IntegrationRecord)
                    .filter(
                        IntegrationRecord.id == integration_id,
                        IntegrationRecord.user_email == clean_email,
                    )
                    .first()
                )
                if not row:
                    return None
                row.status = "connected"
                row.last_checked_at = utc_now_iso()
                row.latency_ms = int(verified["latencyMs"])
                row.metadata_json = verified.get("metadata", {})
                session.flush()
                return _integration_to_dict(row, include_secret=False)

        return await asyncio.to_thread(_mark_ok)
    except ValueError as exc:
        def _mark_err():
            with db.session_scope() as session:
                row = (
                    session.query(IntegrationRecord)
                    .filter(
                        IntegrationRecord.id == integration_id,
                        IntegrationRecord.user_email == clean_email,
                    )
                    .first()
                )
                if row:
                    row.status = "error"
                    row.last_checked_at = utc_now_iso()

        await asyncio.to_thread(_mark_err)
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/api/integrations/{integration_id}")
async def delete_integration(integration_id: str, x_user_email: str = Header(default="demo@tesserak.dev")):
    db = get_db()
    clean_email = normalize_email(x_user_email)

    def _delete():
        with db.session_scope() as session:
            row = (
                session.query(IntegrationRecord)
                .filter(
                    IntegrationRecord.id == integration_id,
                    IntegrationRecord.user_email == clean_email,
                )
                .first()
            )
            if not row:
                return False
            session.delete(row)
            return True

    deleted = await asyncio.to_thread(_delete)
    if not deleted:
        raise HTTPException(status_code=404, detail="Integration not found or managed by AWS Connectors")
    return {"status": "deleted", "id": integration_id}


@router.get("/api/guardrails")
async def get_guardrails(
    refresh: bool = False,
    x_user_email: str = Header(default="demo@tesserak.dev"),
):
    state = await asyncio.to_thread(_load_state, x_user_email)
    audit = await run_live_guardrail_audit(
        x_user_email,
        connection_manager,
        state["guardrailRules"],
        force_refresh=refresh,
    )
    rules = state["guardrailRules"]
    approvals = state["approvals"]
    enabled = sum(1 for r in rules if r["enabled"])
    return {
        "rules": rules,
        "approvals": approvals,
        "audit": audit,
        "summary": {
            "enabledRules": enabled,
            "totalRules": len(rules),
            "pendingApprovals": sum(1 for a in approvals if a["status"] == "pending"),
            "complianceScore": audit.get("complianceScore"),
            "awsConnected": audit.get("awsConnected", False),
        },
    }


@router.post("/api/guardrails/rules")
async def create_guardrail_rule(payload: GuardrailRuleCreate, x_user_email: str = Header(default="demo@tesserak.dev")):
    db = get_db()
    clean_email = normalize_email(x_user_email)
    new_id = f"gr-{uuid.uuid4().hex[:6]}"
    now = utc_now_iso()

    def _create_rule():
        with db.session_scope() as session:
            existing = _ensure_user_guardrails(session, clean_email)
            next_order = max((r.sort_order for r in existing), default=-1) + 1
            rec = GuardrailRuleRecord(
                user_email=clean_email,
                id=new_id,
                name=payload.name.strip(),
                description=payload.description.strip(),
                category=payload.category.strip(),
                severity=payload.severity,
                enabled=True,
                threshold=payload.threshold,
                violations=0,
                updated_at=now,
                sort_order=next_order,
            )
            session.add(rec)
            session.flush()
            return _rule_to_dict(rec)

    return await asyncio.to_thread(_create_rule)


@router.patch("/api/guardrails/rules/{rule_id}")
async def update_guardrail_rule(rule_id: str, patch: GuardrailRulePatch, x_user_email: str = Header(default="demo@tesserak.dev")):
    db = get_db()
    clean_email = normalize_email(x_user_email)

    def _patch_rule():
        with db.session_scope() as session:
            _ensure_user_guardrails(session, clean_email)
            rule = (
                session.query(GuardrailRuleRecord)
                .filter(
                    GuardrailRuleRecord.user_email == clean_email,
                    GuardrailRuleRecord.id == rule_id,
                )
                .first()
            )
            if not rule:
                return None
            if patch.enabled is not None:
                rule.enabled = patch.enabled
            if patch.severity is not None:
                rule.severity = patch.severity
            if patch.threshold is not None:
                rule.threshold = patch.threshold
            rule.updated_at = utc_now_iso()
            session.flush()
            return _rule_to_dict(rule)

    updated = await asyncio.to_thread(_patch_rule)
    if not updated:
        raise HTTPException(status_code=404, detail="Guardrail rule not found")
    return updated


@router.post("/api/approvals/{approval_id}/decision")
async def decide_approval(approval_id: str, body: ApprovalDecisionRequest, x_user_email: str = Header(default="demo@tesserak.dev")):
    db = get_db()
    clean_email = normalize_email(x_user_email)

    def _get_approval():
        with db.session_scope() as session:
            row = (
                session.query(ApprovalRecord)
                .filter(
                    ApprovalRecord.id == approval_id,
                    ApprovalRecord.user_email == clean_email,
                )
                .first()
            )
            return _approval_to_dict(row) if row else None

    target = await asyncio.to_thread(_get_approval)
    if not target:
        raise HTTPException(status_code=404, detail="Approval request not found")

    if body.decision == "reject":
        def _reject():
            with db.session_scope() as session:
                row = session.get(ApprovalRecord, approval_id)
                if not row:
                    return None
                row.status = "rejected"
                row.decided_at = utc_now_iso()
                row.comment = body.comment or "Rejected by guardrail reviewer"
                session.query(PendingResourceRecord).filter(
                    PendingResourceRecord.id == row.resource_id,
                    PendingResourceRecord.user_email == clean_email,
                ).delete()
                session.flush()
                return _approval_to_dict(row)

        return await asyncio.to_thread(_reject)

    conn = await connection_manager.get_valid_connection(x_user_email)
    if not conn:
        raise HTTPException(status_code=400, detail="No valid AWS IAM connection found to provision approved resource.")

    spec = target.get("provisionSpec")
    if not spec:
        raise HTTPException(status_code=400, detail="Missing stored AWS provisioning specification.")

    try:
        created = await asyncio.to_thread(execute_aws_provision, conn, spec)
        invalidate_resource_cache(x_user_email)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"AWS provisioning failed after approval: {exc}")

    def _approve():
        with db.session_scope() as session:
            row = session.get(ApprovalRecord, approval_id)
            row.status = "approved"
            row.decided_at = utc_now_iso()
            row.comment = body.comment or "Approved and created in AWS"
            session.query(PendingResourceRecord).filter(
                PendingResourceRecord.id == row.resource_id,
                PendingResourceRecord.user_email == clean_email,
            ).delete()
            session.flush()
            return _approval_to_dict(row)

    approved_target = await asyncio.to_thread(_approve)
    return {"approval": approved_target, "provisioned": created}


@router.get("/api/resources")
async def list_cloud_resources(
    refresh: bool = False,
    x_user_email: str = Header(default="demo@tesserak.dev"),
):
    state = await asyncio.to_thread(_load_state, x_user_email)
    return await discover_live_aws_resources(
        x_user_email,
        connection_manager,
        state["pendingResources"],
        force_refresh=refresh,
    )


@router.post("/api/resources")
async def create_cloud_resource(payload: CloudResourceCreate, x_user_email: str = Header(default="demo@tesserak.dev")):
    db = get_db()
    clean_email = normalize_email(x_user_email)
    state = await asyncio.to_thread(_load_state, x_user_email)
    conn = await connection_manager.get_valid_connection(x_user_email)
    if not conn:
        raise HTTPException(
            status_code=400,
            detail="No valid AWS IAM connection found. Add AWS credentials in Integrations before provisioning.",
        )

    rules_by_id = {r["id"]: r for r in state["guardrailRules"]}

    def _bump_violation(rule_id: str) -> None:
        with db.session_scope() as session:
            rec = (
                session.query(GuardrailRuleRecord)
                .filter(
                    GuardrailRuleRecord.user_email == clean_email,
                    GuardrailRuleRecord.id == rule_id,
                )
                .first()
            )
            if rec:
                rec.violations = int(rec.violations or 0) + 1
                rec.updated_at = utc_now_iso()

    enc_rule = rules_by_id.get("gr-encryption")
    if enc_rule and enc_rule["enabled"] and not payload.encrypted:
        await asyncio.to_thread(_bump_violation, "gr-encryption")
        raise HTTPException(status_code=422, detail="Blocked by Guardrail [Enforce KMS / SSE Encryption at Rest].")

    pub_rule = rules_by_id.get("gr-public-access")
    if pub_rule and pub_rule["enabled"] and payload.publicAccess:
        await asyncio.to_thread(_bump_violation, "gr-public-access")
        raise HTTPException(status_code=422, detail="Blocked by Guardrail [Block Public Access & Privileged Pods].")

    allowed_regions = {"us-east-1", "us-west-2", "eu-west-1"}
    region_rule = rules_by_id.get("gr-region-allowlist")
    if region_rule and region_rule["enabled"] and payload.region not in allowed_regions and region_rule["severity"] == "block":
        raise HTTPException(status_code=422, detail=f"Blocked by Guardrail [Approved Sovereignty Regions]: {payload.region}.")

    cost_rule = rules_by_id.get("gr-cost-ceiling")
    threshold = (cost_rule.get("threshold") or 250) if cost_rule else 250
    if cost_rule and cost_rule["enabled"] and payload.estimatedMonthlyCost > threshold:
        res_id = f"pending-{uuid.uuid4().hex[:8]}"
        apr_id = f"apr-{uuid.uuid4().hex[:6]}"
        now = utc_now_iso()
        pending_res = {
            "id": res_id,
            "name": payload.name.strip(),
            "provider": "aws",
            "serviceType": payload.serviceType,
            "region": payload.region,
            "environment": payload.environment,
            "spec": payload.nodeType or "Queued for FinOps Approval",
            "encrypted": payload.encrypted,
            "publicAccess": payload.publicAccess,
            "status": "Pending Approval",
            "driftStatus": "In Sync",
            "guardrailNotes": [f"Queued: estimated ${payload.estimatedMonthlyCost:.0f}/mo > ${threshold:.0f}/mo ceiling"],
            "createdAt": now,
            "lastSyncAt": now,
            "source": "pending-approval",
        }

        def _queue_approval():
            with db.session_scope() as session:
                session.add(
                    PendingResourceRecord(
                        id=res_id,
                        user_email=clean_email,
                        payload_json=pending_res,
                        created_at=now,
                    )
                )
                session.add(
                    ApprovalRecord(
                        id=apr_id,
                        user_email=clean_email,
                        resource_id=res_id,
                        resource_name=payload.name.strip(),
                        resource_kind=payload.serviceType,
                        environment=payload.environment,
                        requested_by=x_user_email,
                        estimated_monthly_cost=float(payload.estimatedMonthlyCost),
                        triggered_rule=cost_rule["name"],
                        reason=f"Estimated spend (${payload.estimatedMonthlyCost:.0f}/mo) exceeds guardrail ceiling (${threshold:.0f}/mo).",
                        status="pending",
                        created_at=now,
                        provision_spec_json=payload.dict(),
                    )
                )

        await asyncio.to_thread(_queue_approval)
        return pending_res

    try:
        created = await asyncio.to_thread(execute_aws_provision, conn, payload.dict())
        invalidate_resource_cache(x_user_email)
        return created
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"AWS provisioning failed: {exc}")


@router.post("/api/resources/{resource_id}/drift-check")
async def reconcile_resource_drift(resource_id: str, x_user_email: str = Header(default="demo@tesserak.dev")):
    conn = await connection_manager.get_valid_connection(x_user_email)
    if not conn:
        raise HTTPException(status_code=400, detail="No valid AWS IAM connection found.")
    try:
        message = await asyncio.to_thread(execute_aws_reconcile, conn, resource_id)
        invalidate_resource_cache(x_user_email)
        return {"status": "reconciled", "message": message}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AWS drift remediation failed: {exc}")


@router.delete("/api/resources/{resource_id}")
async def delete_cloud_resource(
    resource_id: str,
    environment: str = "staging",
    x_user_email: str = Header(default="demo@tesserak.dev"),
):
    state = await asyncio.to_thread(_load_state, x_user_email)
    delete_rule = next((r for r in state["guardrailRules"] if r["id"] == "gr-prod-delete-lock"), None)
    if delete_rule and delete_rule["enabled"] and environment == "prod":
        raise HTTPException(
            status_code=409,
            detail="Blocked by Guardrail [Production Resource Deletion Lock]: Disable lock in Guardrails to delete prod resources.",
        )

    pending_match = next((r for r in state["pendingResources"] if r["id"] == resource_id), None)
    if pending_match:
        db = get_db()
        clean_email = normalize_email(x_user_email)

        def _delete_pending():
            with db.session_scope() as session:
                session.query(PendingResourceRecord).filter(
                    PendingResourceRecord.id == resource_id,
                    PendingResourceRecord.user_email == clean_email,
                ).delete()
                session.query(ApprovalRecord).filter(
                    ApprovalRecord.resource_id == resource_id,
                    ApprovalRecord.user_email == clean_email,
                ).delete()

        await asyncio.to_thread(_delete_pending)
        return {"status": "deleted", "message": "Removed pending request."}

    conn = await connection_manager.get_valid_connection(x_user_email)
    if not conn:
        raise HTTPException(status_code=400, detail="No valid AWS IAM connection found.")
    try:
        msg = await asyncio.to_thread(execute_aws_delete, conn, resource_id)
        invalidate_resource_cache(x_user_email)
        return {"status": "deleted", "message": msg}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"AWS deletion failed: {exc}")


@router.get("/api/cluster-targets")
async def get_pipeline_cluster_targets(x_user_email: str = Header(default="demo@tesserak.dev")):
    return await list_deployable_clusters(x_user_email, connection_manager)


@router.get("/api/pipelines")
async def list_pipelines(x_user_email: str = Header(default="demo@tesserak.dev")):
    state = await asyncio.to_thread(_load_state, x_user_email)
    return state["pipelines"]


@router.post("/api/pipelines")
async def create_pipeline(payload: PipelineCreate, x_user_email: str = Header(default="demo@tesserak.dev")):
    db = get_db()
    clean_email = normalize_email(x_user_email)
    git_token: Optional[str] = None
    if payload.gitIntegrationId:
        def _get_git_token():
            with db.session_scope() as session:
                row = (
                    session.query(IntegrationRecord)
                    .filter(
                        IntegrationRecord.id == payload.gitIntegrationId,
                        IntegrationRecord.user_email == clean_email,
                    )
                    .first()
                )
                return db.decrypt_json(row.secret_payload_enc).get("token") if row else None

        git_token = await asyncio.to_thread(_get_git_token)

    branch = (payload.branch or "main").strip()
    try:
        head_sha = verify_git_remote(payload.repositoryUrl, branch, git_token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    now = utc_now_iso()
    pip_id = f"pip-{uuid.uuid4().hex[:8]}"

    def _insert_pipeline():
        with db.session_scope() as session:
            rec = PipelineRecord(
                id=pip_id,
                user_email=clean_email,
                name=payload.name.strip(),
                repository_url=payload.repositoryUrl.strip(),
                branch=branch,
                target_cluster=payload.targetCluster.strip(),
                namespace=(payload.namespace or "default").strip(),
                manifest_path=(payload.manifestPath or ".").strip(),
                dockerfile_path=(payload.dockerfilePath or "").strip(),
                image_tag=(payload.imageTag or "").strip(),
                git_integration_id=payload.gitIntegrationId,
                verified_remote_sha=head_sha,
                last_run_number=0,
                status="Ready",
                duration_sec=0.0,
                triggered_by=x_user_email,
                last_run_at=now,
                stages_json=[],
                recent_runs_json=[],
            )
            session.add(rec)
            session.flush()
            return _pipeline_to_dict(rec)

    return await asyncio.to_thread(_insert_pipeline)


@router.post("/api/pipelines/{pipeline_id}/trigger")
async def trigger_pipeline(pipeline_id: str, payload: PipelineTriggerRequest, x_user_email: str = Header(default="demo@tesserak.dev")):
    db = get_db()
    clean_email = normalize_email(x_user_email)

    def _prep_trigger():
        with db.session_scope() as session:
            row = (
                session.query(PipelineRecord)
                .filter(
                    PipelineRecord.id == pipeline_id,
                    PipelineRecord.user_email == clean_email,
                )
                .first()
            )
            if not row:
                return None, None, None
            git_token: Optional[str] = None
            if row.git_integration_id:
                integ = (
                    session.query(IntegrationRecord)
                    .filter(
                        IntegrationRecord.id == row.git_integration_id,
                        IntegrationRecord.user_email == clean_email,
                    )
                    .first()
                )
                if integ:
                    git_token = db.decrypt_json(integ.secret_payload_enc).get("token")
            branch = (payload.branch or row.branch).strip()
            row.status = "Running"
            row.last_run_at = utc_now_iso()
            row.stages_json = [
                {"name": "Git Checkout", "status": "Running", "durationSec": 0, "log": f"Cloning {row.repository_url}@{branch}..."},
            ]
            session.flush()
            return _pipeline_to_dict(row), branch, git_token

    target, branch, git_token = await asyncio.to_thread(_prep_trigger)
    if not target:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    asyncio.create_task(
        run_pipeline_async(
            pipeline_id=pipeline_id,
            user_email=x_user_email,
            branch=branch,
            git_token=git_token,
            connection_manager=connection_manager,
            load_state_fn=_load_state,
            save_state_fn=_save_pipeline_state,
        )
    )
    return target


@router.delete("/api/pipelines/{pipeline_id}")
async def delete_pipeline(pipeline_id: str, x_user_email: str = Header(default="demo@tesserak.dev")):
    db = get_db()
    clean_email = normalize_email(x_user_email)

    def _delete_pipeline():
        with db.session_scope() as session:
            row = (
                session.query(PipelineRecord)
                .filter(
                    PipelineRecord.id == pipeline_id,
                    PipelineRecord.user_email == clean_email,
                )
                .first()
            )
            if not row:
                return False
            session.delete(row)
            return True

    deleted = await asyncio.to_thread(_delete_pipeline)
    if not deleted:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return {"status": "deleted", "id": pipeline_id}
