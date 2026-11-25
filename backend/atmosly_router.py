from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
import asyncio
import json
import os
import re
import uuid

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from connections import ConnectionManager
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
    run_live_guardrail_audit,
)

router = APIRouter(tags=["Tesserak Platform"])

DATA_DIR = Path("atmosly_data")
DATA_DIR.mkdir(exist_ok=True)
connection_manager = ConnectionManager("connections")


def _safe_user_key(email: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", (email or "guest@tesserak.dev").lower())


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


def _empty_platform_state() -> Dict[str, Any]:
    """Initialize cleanly with ZERO dummy/fake integrations, resources, approvals, or pipelines."""
    return {
        "integrations": [],
        "guardrailRules": _default_guardrail_rules(),
        "approvals": [],
        "pendingResources": [],
        "pipelines": [],
    }


def _load_state(user_email: str) -> Dict[str, Any]:
    path = DATA_DIR / f"{_safe_user_key(user_email)}.json"
    if not path.exists():
        state = _empty_platform_state()
        _save_state(user_email, state)
        return state
    with open(path, "r") as f:
        data = json.load(f)
    if "pendingResources" not in data:
        data["pendingResources"] = []
    return data


def _save_state(user_email: str, state: Dict[str, Any]) -> None:
    path = DATA_DIR / f"{_safe_user_key(user_email)}.json"
    with open(path, "w") as f:
        json.dump(state, f, indent=2)


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


@router.get("/api/auth/status")
async def get_auth_config_status():
    domain = os.getenv("AUTH0_DOMAIN", "").strip()
    audience = os.getenv("AUTH0_AUDIENCE", "").strip()
    return {
        "auth0Configured": bool(domain),
        "domainConfigured": bool(domain),
        "audienceConfigured": bool(audience),
        "mode": "auth0" if domain else "local-fallback",
    }


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


@router.get("/api/atmosly/overview")
async def get_platform_overview(x_user_email: str = Header(default="demo@tesserak.dev")):
    state = _load_state(x_user_email)
    aws_conns = await _load_aws_connectors_as_integrations(x_user_email)
    integrations = aws_conns + [_sanitize_integration(i) for i in state["integrations"]]
    res_data = await discover_live_aws_resources(x_user_email, connection_manager, state["pendingResources"])
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


@router.get("/api/atmosly/integrations")
async def list_integrations(x_user_email: str = Header(default="demo@tesserak.dev")):
    state = _load_state(x_user_email)
    aws_conns = await _load_aws_connectors_as_integrations(x_user_email)
    return aws_conns + [_sanitize_integration(i) for i in state["integrations"]]


@router.post("/api/atmosly/integrations")
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

    state = _load_state(x_user_email)
    new_item = {
        "id": f"int-{uuid.uuid4().hex[:8]}",
        "name": payload.name.strip(),
        "provider": payload.provider,
        "category": payload.category,
        "scope": verified["scope"],
        "endpoint": payload.endpoint,
        "credentialHint": verified["credentialHint"],
        "status": "connected",
        "lastCheckedAt": utc_now_iso(),
        "latencyMs": verified["latencyMs"],
        "managedBy": "atmosly",
        "metadata": verified.get("metadata", {}),
        "secretPayload": verified.get("secretPayload", {}),
    }
    state["integrations"].insert(0, new_item)
    _save_state(x_user_email, state)
    return _sanitize_integration(new_item)


@router.post("/api/atmosly/integrations/{integration_id}/test")
async def test_integration(integration_id: str, x_user_email: str = Header(default="demo@tesserak.dev")):
    state = _load_state(x_user_email)
    item = next((i for i in state["integrations"] if i["id"] == integration_id), None)
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
        item["status"] = "connected"
        item["lastCheckedAt"] = utc_now_iso()
        item["latencyMs"] = verified["latencyMs"]
        item["metadata"] = verified.get("metadata", {})
        _save_state(x_user_email, state)
        return _sanitize_integration(item)
    except ValueError as exc:
        item["status"] = "error"
        item["lastCheckedAt"] = utc_now_iso()
        _save_state(x_user_email, state)
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/api/atmosly/integrations/{integration_id}")
async def delete_integration(integration_id: str, x_user_email: str = Header(default="demo@tesserak.dev")):
    state = _load_state(x_user_email)
    before = len(state["integrations"])
    state["integrations"] = [i for i in state["integrations"] if i["id"] != integration_id]
    if len(state["integrations"]) == before:
        raise HTTPException(status_code=404, detail="Integration not found or managed by AWS Connectors")
    _save_state(x_user_email, state)
    return {"status": "deleted", "id": integration_id}


@router.get("/api/atmosly/guardrails")
async def get_guardrails(x_user_email: str = Header(default="demo@tesserak.dev")):
    state = _load_state(x_user_email)
    audit = await run_live_guardrail_audit(x_user_email, connection_manager, state["guardrailRules"])
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


@router.post("/api/atmosly/guardrails/rules")
async def create_guardrail_rule(payload: GuardrailRuleCreate, x_user_email: str = Header(default="demo@tesserak.dev")):
    state = _load_state(x_user_email)
    new_rule = {
        "id": f"gr-{uuid.uuid4().hex[:6]}",
        "name": payload.name.strip(),
        "description": payload.description.strip(),
        "category": payload.category.strip(),
        "severity": payload.severity,
        "enabled": True,
        "threshold": payload.threshold,
        "violations": 0,
        "updatedAt": utc_now_iso(),
    }
    state["guardrailRules"].append(new_rule)
    _save_state(x_user_email, state)
    return new_rule


@router.patch("/api/atmosly/guardrails/rules/{rule_id}")
async def update_guardrail_rule(rule_id: str, patch: GuardrailRulePatch, x_user_email: str = Header(default="demo@tesserak.dev")):
    state = _load_state(x_user_email)
    for rule in state["guardrailRules"]:
        if rule["id"] == rule_id:
            if patch.enabled is not None:
                rule["enabled"] = patch.enabled
            if patch.severity is not None:
                rule["severity"] = patch.severity
            if patch.threshold is not None:
                rule["threshold"] = patch.threshold
            rule["updatedAt"] = utc_now_iso()
            _save_state(x_user_email, state)
            return rule
    raise HTTPException(status_code=404, detail="Guardrail rule not found")


@router.post("/api/atmosly/approvals/{approval_id}/decision")
async def decide_approval(approval_id: str, body: ApprovalDecisionRequest, x_user_email: str = Header(default="demo@tesserak.dev")):
    state = _load_state(x_user_email)
    target = next((a for a in state["approvals"] if a["id"] == approval_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Approval request not found")

    if body.decision == "reject":
        target["status"] = "rejected"
        target["decidedAt"] = utc_now_iso()
        target["comment"] = body.comment or "Rejected by guardrail reviewer"
        state["pendingResources"] = [r for r in state["pendingResources"] if r["id"] != target["resourceId"]]
        _save_state(x_user_email, state)
        return target

    conn = await connection_manager.get_valid_connection(x_user_email)
    if not conn:
        raise HTTPException(status_code=400, detail="No valid AWS IAM connection found to provision approved resource.")

    spec = target.get("provisionSpec")
    if not spec:
        raise HTTPException(status_code=400, detail="Missing stored AWS provisioning specification.")

    try:
        created = execute_aws_provision(conn, spec)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"AWS provisioning failed after approval: {exc}")

    target["status"] = "approved"
    target["decidedAt"] = utc_now_iso()
    target["comment"] = body.comment or "Approved and created in AWS"
    state["pendingResources"] = [r for r in state["pendingResources"] if r["id"] != target["resourceId"]]
    _save_state(x_user_email, state)
    return {"approval": target, "provisioned": created}


@router.get("/api/atmosly/resources")
async def list_cloud_resources(x_user_email: str = Header(default="demo@tesserak.dev")):
    state = _load_state(x_user_email)
    return await discover_live_aws_resources(x_user_email, connection_manager, state["pendingResources"])


@router.post("/api/atmosly/resources")
async def create_cloud_resource(payload: CloudResourceCreate, x_user_email: str = Header(default="demo@tesserak.dev")):
    state = _load_state(x_user_email)
    conn = await connection_manager.get_valid_connection(x_user_email)
    if not conn:
        raise HTTPException(
            status_code=400,
            detail="No valid AWS IAM connection found. Add AWS credentials in Integrations before provisioning.",
        )

    rules_by_id = {r["id"]: r for r in state["guardrailRules"]}

    enc_rule = rules_by_id.get("gr-encryption")
    if enc_rule and enc_rule["enabled"] and not payload.encrypted:
        enc_rule["violations"] += 1
        _save_state(x_user_email, state)
        raise HTTPException(status_code=422, detail="Blocked by Guardrail [Enforce KMS / SSE Encryption at Rest].")

    pub_rule = rules_by_id.get("gr-public-access")
    if pub_rule and pub_rule["enabled"] and payload.publicAccess:
        pub_rule["violations"] += 1
        _save_state(x_user_email, state)
        raise HTTPException(status_code=422, detail="Blocked by Guardrail [Block Public Access & Privileged Pods].")

    allowed_regions = {"us-east-1", "us-west-2", "eu-west-1"}
    region_rule = rules_by_id.get("gr-region-allowlist")
    if region_rule and region_rule["enabled"] and payload.region not in allowed_regions and region_rule["severity"] == "block":
        raise HTTPException(status_code=422, detail=f"Blocked by Guardrail [Approved Sovereignty Regions]: {payload.region}.")

    cost_rule = rules_by_id.get("gr-cost-ceiling")
    threshold = (cost_rule.get("threshold") or 250) if cost_rule else 250
    if cost_rule and cost_rule["enabled"] and payload.estimatedMonthlyCost > threshold:
        res_id = f"pending-{uuid.uuid4().hex[:8]}"
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
        state["pendingResources"].insert(0, pending_res)
        state["approvals"].insert(
            0,
            {
                "id": f"apr-{uuid.uuid4().hex[:6]}",
                "resourceId": res_id,
                "resourceName": payload.name.strip(),
                "resourceKind": payload.serviceType,
                "environment": payload.environment,
                "requestedBy": x_user_email,
                "estimatedMonthlyCost": payload.estimatedMonthlyCost,
                "triggeredRule": cost_rule["name"],
                "reason": f"Estimated spend (${payload.estimatedMonthlyCost:.0f}/mo) exceeds guardrail ceiling (${threshold:.0f}/mo).",
                "status": "pending",
                "createdAt": now,
                "provisionSpec": payload.dict(),
            },
        )
        _save_state(x_user_email, state)
        return pending_res

    try:
        return execute_aws_provision(conn, payload.dict())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"AWS provisioning failed: {exc}")


@router.post("/api/atmosly/resources/{resource_id}/drift-check")
async def reconcile_resource_drift(resource_id: str, x_user_email: str = Header(default="demo@tesserak.dev")):
    conn = await connection_manager.get_valid_connection(x_user_email)
    if not conn:
        raise HTTPException(status_code=400, detail="No valid AWS IAM connection found.")
    try:
        message = execute_aws_reconcile(conn, resource_id)
        return {"status": "reconciled", "message": message}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AWS drift remediation failed: {exc}")


@router.delete("/api/atmosly/resources/{resource_id}")
async def delete_cloud_resource(
    resource_id: str,
    environment: str = "staging",
    x_user_email: str = Header(default="demo@tesserak.dev"),
):
    state = _load_state(x_user_email)
    delete_rule = next((r for r in state["guardrailRules"] if r["id"] == "gr-prod-delete-lock"), None)
    if delete_rule and delete_rule["enabled"] and environment == "prod":
        raise HTTPException(
            status_code=409,
            detail="Blocked by Guardrail [Production Resource Deletion Lock]: Disable lock in Guardrails to delete prod resources.",
        )

    pending_match = next((r for r in state["pendingResources"] if r["id"] == resource_id), None)
    if pending_match:
        state["pendingResources"] = [r for r in state["pendingResources"] if r["id"] != resource_id]
        state["approvals"] = [a for a in state["approvals"] if a["resourceId"] != resource_id]
        _save_state(x_user_email, state)
        return {"status": "deleted", "message": "Removed pending request."}

    conn = await connection_manager.get_valid_connection(x_user_email)
    if not conn:
        raise HTTPException(status_code=400, detail="No valid AWS IAM connection found.")
    try:
        msg = execute_aws_delete(conn, resource_id)
        return {"status": "deleted", "message": msg}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"AWS deletion failed: {exc}")


@router.get("/api/atmosly/cluster-targets")
async def get_pipeline_cluster_targets(x_user_email: str = Header(default="demo@tesserak.dev")):
    return await list_deployable_clusters(x_user_email, connection_manager)


@router.get("/api/atmosly/pipelines")
async def list_pipelines(x_user_email: str = Header(default="demo@tesserak.dev")):
    state = _load_state(x_user_email)
    return state["pipelines"]


@router.post("/api/atmosly/pipelines")
async def create_pipeline(payload: PipelineCreate, x_user_email: str = Header(default="demo@tesserak.dev")):
    state = _load_state(x_user_email)

    git_token: Optional[str] = None
    if payload.gitIntegrationId:
        integ = next((i for i in state["integrations"] if i["id"] == payload.gitIntegrationId), None)
        if integ:
            git_token = integ.get("secretPayload", {}).get("token")

    branch = (payload.branch or "main").strip()
    try:
        head_sha = verify_git_remote(payload.repositoryUrl, branch, git_token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    now = utc_now_iso()
    pipeline = {
        "id": f"pip-{uuid.uuid4().hex[:8]}",
        "name": payload.name.strip(),
        "repositoryUrl": payload.repositoryUrl.strip(),
        "branch": branch,
        "targetCluster": payload.targetCluster.strip(),
        "namespace": (payload.namespace or "default").strip(),
        "manifestPath": (payload.manifestPath or ".").strip(),
        "dockerfilePath": (payload.dockerfilePath or "").strip(),
        "imageTag": (payload.imageTag or "").strip(),
        "gitIntegrationId": payload.gitIntegrationId,
        "verifiedRemoteSha": head_sha,
        "lastRunNumber": 0,
        "status": "Ready",
        "durationSec": 0,
        "triggeredBy": x_user_email,
        "lastRunAt": now,
        "stages": [],
        "recentRuns": [],
    }
    state["pipelines"].insert(0, pipeline)
    _save_state(x_user_email, state)
    return pipeline


@router.post("/api/atmosly/pipelines/{pipeline_id}/trigger")
async def trigger_pipeline(pipeline_id: str, payload: PipelineTriggerRequest, x_user_email: str = Header(default="demo@tesserak.dev")):
    state = _load_state(x_user_email)
    target = next((p for p in state["pipelines"] if p["id"] == pipeline_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    git_token: Optional[str] = None
    if target.get("gitIntegrationId"):
        integ = next((i for i in state["integrations"] if i["id"] == target["gitIntegrationId"]), None)
        if integ:
            git_token = integ.get("secretPayload", {}).get("token")

    branch = (payload.branch or target["branch"]).strip()
    target["status"] = "Running"
    target["lastRunAt"] = utc_now_iso()
    target["stages"] = [
        {"name": "Git Checkout", "status": "Running", "durationSec": 0, "log": f"Cloning {target['repositoryUrl']}@{branch}..."},
    ]
    _save_state(x_user_email, state)

    asyncio.create_task(
        run_pipeline_async(
            pipeline_id=pipeline_id,
            user_email=x_user_email,
            branch=branch,
            git_token=git_token,
            connection_manager=connection_manager,
            load_state_fn=_load_state,
            save_state_fn=_save_state,
        )
    )
    return target


@router.delete("/api/atmosly/pipelines/{pipeline_id}")
async def delete_pipeline(pipeline_id: str, x_user_email: str = Header(default="demo@tesserak.dev")):
    state = _load_state(x_user_email)
    before = len(state["pipelines"])
    state["pipelines"] = [p for p in state["pipelines"] if p["id"] != pipeline_id]
    if len(state["pipelines"]) == before:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    _save_state(x_user_email, state)
    return {"status": "deleted", "id": pipeline_id}
