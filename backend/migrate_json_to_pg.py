from __future__ import annotations

import argparse
import glob
import json
import os
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List

from dotenv import load_dotenv

load_dotenv()

from db import (  # noqa: E402
    ApprovalRecord,
    AwsConnectionRecord,
    ClusterStateRecord,
    DatabaseManager,
    GuardrailRuleRecord,
    IntegrationRecord,
    PendingResourceRecord,
    PipelineRecord,
    SettingRecord,
    UserRecord,
    get_db,
    normalize_email,
)


def _safe_user_key(email: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", (email or "guest@tesserak.dev").lower())


def migrate_all(base_dir: Path, cleanup: bool = False) -> Dict[str, int]:
    db: DatabaseManager = get_db()
    db.init_schema()
    counts: Dict[str, int] = {
        "settings": 0,
        "users": 0,
        "connections": 0,
        "integrations": 0,
        "guardrail_rules": 0,
        "approvals": 0,
        "pending_resources": 0,
        "pipelines": 0,
        "cluster_states": 0,
        "files_removed": 0,
    }

    platform_dir = base_dir / "tesserak_data"
    conn_dir = base_dir / "connections"
    states_dir = base_dir / "cluster_states"

    # 1. Session secret first so encryption uses the existing secret
    secret_file = platform_dir / ".session_secret"
    if secret_file.exists():
        raw_secret = secret_file.read_text().strip()
        if raw_secret:
            with db.session_scope() as session:
                if not session.get(SettingRecord, "session_secret"):
                    session.add(SettingRecord(key="session_secret", value=raw_secret))
                    db._cached_secret = None
                    counts["settings"] += 1

    known_emails: List[str] = []

    # 2. Registered email users
    email_users_file = platform_dir / "_email_users.json"
    if email_users_file.exists():
        raw_users = json.loads(email_users_file.read_text() or "{}")
        with db.session_scope() as session:
            for email_key, u in raw_users.items():
                clean_email = normalize_email(u.get("email") or email_key)
                known_emails.append(clean_email)
                existing = session.get(UserRecord, clean_email)
                if not existing:
                    session.add(
                        UserRecord(
                            email=clean_email,
                            password_hash=u.get("passwordHash"),
                            first_name=u.get("firstName", ""),
                            last_name=u.get("lastName", ""),
                            account_type=u.get("accountType", "individual"),
                            organization=u.get("organization", "Individual Workspace"),
                            auth_provider="email",
                            mobile_country_code="+1",
                            mobile_number="",
                            avatar_url="",
                            created_at=int(u.get("createdAt") or time.time()),
                        )
                    )
                    counts["users"] += 1

    # 3. AWS IAM connections
    if conn_dir.exists():
        for p in sorted(conn_dir.glob("*.json")):
            data = json.loads(p.read_text())
            clean_email = normalize_email(data.get("createdBy"))
            known_emails.append(clean_email)
            access_key = (data.get("accessKey") or "").strip()
            conn_type = data.get("type", "aws")
            with db.session_scope() as session:
                exists = (
                    session.query(AwsConnectionRecord)
                    .filter(
                        AwsConnectionRecord.user_email == clean_email,
                        AwsConnectionRecord.type == conn_type,
                        AwsConnectionRecord.access_key == access_key,
                    )
                    .first()
                )
                if not exists:
                    session.add(
                        AwsConnectionRecord(
                            id=data["id"],
                            user_email=clean_email,
                            account_name=data.get("accountName") or "AWS Account",
                            access_key=access_key,
                            secret_key_enc=db.encrypt_str(data.get("secretKey", "")),
                            region=data.get("region"),
                            type=conn_type,
                            status=data.get("status", "connected"),
                            created_at=data.get("createdAt") or datetime.utcnow().isoformat(),
                            last_updated=data.get("lastUpdated") or datetime.utcnow().isoformat(),
                        )
                    )
                    counts["connections"] += 1

    # 4. Cluster states
    if states_dir.exists():
        for p in sorted(states_dir.glob("*/*.json")):
            data = json.loads(p.read_text())
            clean_email = normalize_email(data.get("user_email"))
            known_emails.append(clean_email)
            cname = data.get("cluster_name") or p.stem
            with db.session_scope() as session:
                exists = (
                    session.query(ClusterStateRecord)
                    .filter(
                        ClusterStateRecord.user_email == clean_email,
                        ClusterStateRecord.cluster_name == cname,
                    )
                    .first()
                )
                if not exists:
                    session.add(
                        ClusterStateRecord(
                            user_email=clean_email,
                            cluster_name=cname,
                            last_updated=data.get("last_updated") or datetime.utcnow().isoformat(),
                            state_json=data.get("state") or {},
                        )
                    )
                    counts["cluster_states"] += 1

    key_to_email = {_safe_user_key(e): e for e in known_emails}

    # 5. Per-user Tesserak platform JSON state
    if platform_dir.exists():
        for p in sorted(platform_dir.glob("*.json")):
            if p.name == "_email_users.json":
                continue
            stem = p.stem
            data = json.loads(p.read_text() or "{}")
            has_user_activity = bool(
                data.get("integrations")
                or data.get("approvals")
                or data.get("pendingResources")
                or data.get("pipelines")
            )
            if not has_user_activity and stem not in key_to_email:
                continue

            if stem in key_to_email:
                clean_email = key_to_email[stem]
            elif "_" in stem:
                local_part, domain_part = stem.rsplit("_", 1)
                clean_email = normalize_email(f"{local_part}@{domain_part}")
            else:
                clean_email = normalize_email(stem)

            with db.session_scope() as session:
                for idx, r in enumerate(data.get("guardrailRules", [])):
                    if not session.get(GuardrailRuleRecord, (clean_email, r["id"])):
                        session.add(
                            GuardrailRuleRecord(
                                user_email=clean_email,
                                id=r["id"],
                                name=r.get("name", ""),
                                description=r.get("description", ""),
                                category=r.get("category", "Security"),
                                severity=r.get("severity", "warn"),
                                enabled=bool(r.get("enabled", True)),
                                threshold=r.get("threshold"),
                                violations=int(r.get("violations", 0)),
                                updated_at=r.get("updatedAt") or datetime.utcnow().isoformat(),
                                sort_order=idx,
                            )
                        )
                        counts["guardrail_rules"] += 1

                for item in data.get("integrations", []):
                    if not session.get(IntegrationRecord, item["id"]):
                        session.add(
                            IntegrationRecord(
                                id=item["id"],
                                user_email=clean_email,
                                name=item.get("name", ""),
                                provider=item.get("provider", ""),
                                category=item.get("category", "cloud"),
                                scope=item.get("scope", ""),
                                endpoint=item.get("endpoint"),
                                credential_hint=item.get("credentialHint", ""),
                                status=item.get("status", "connected"),
                                last_checked_at=item.get("lastCheckedAt") or datetime.utcnow().isoformat(),
                                latency_ms=int(item.get("latencyMs", 0)),
                                managed_by=item.get("managedBy", "tesserak"),
                                metadata_json=item.get("metadata", {}),
                                secret_payload_enc=db.encrypt_json(item.get("secretPayload", {})),
                            )
                        )
                        counts["integrations"] += 1

                for apr in data.get("approvals", []):
                    if not session.get(ApprovalRecord, apr["id"]):
                        session.add(
                            ApprovalRecord(
                                id=apr["id"],
                                user_email=clean_email,
                                resource_id=apr.get("resourceId", ""),
                                resource_name=apr.get("resourceName", ""),
                                resource_kind=apr.get("resourceKind", ""),
                                environment=apr.get("environment", "staging"),
                                requested_by=apr.get("requestedBy", clean_email),
                                estimated_monthly_cost=float(apr.get("estimatedMonthlyCost", 0.0)),
                                triggered_rule=apr.get("triggeredRule", ""),
                                reason=apr.get("reason", ""),
                                status=apr.get("status", "pending"),
                                created_at=apr.get("createdAt") or datetime.utcnow().isoformat(),
                                decided_at=apr.get("decidedAt"),
                                comment=apr.get("comment"),
                                provision_spec_json=apr.get("provisionSpec"),
                            )
                        )
                        counts["approvals"] += 1

                for pr in data.get("pendingResources", []):
                    if not session.get(PendingResourceRecord, pr["id"]):
                        session.add(
                            PendingResourceRecord(
                                id=pr["id"],
                                user_email=clean_email,
                                payload_json=pr,
                                created_at=pr.get("createdAt") or datetime.utcnow().isoformat(),
                            )
                        )
                        counts["pending_resources"] += 1

                for pip in data.get("pipelines", []):
                    if not session.get(PipelineRecord, pip["id"]):
                        session.add(
                            PipelineRecord(
                                id=pip["id"],
                                user_email=clean_email,
                                name=pip.get("name", ""),
                                repository_url=pip.get("repositoryUrl", ""),
                                branch=pip.get("branch", "main"),
                                target_cluster=pip.get("targetCluster", ""),
                                namespace=pip.get("namespace", "default"),
                                manifest_path=pip.get("manifestPath", "."),
                                dockerfile_path=pip.get("dockerfilePath") or "",
                                image_tag=pip.get("imageTag") or "",
                                git_integration_id=pip.get("gitIntegrationId"),
                                verified_remote_sha=pip.get("verifiedRemoteSha"),
                                last_run_number=int(pip.get("lastRunNumber", 0)),
                                status=pip.get("status", "Ready"),
                                duration_sec=float(pip.get("durationSec", 0.0)),
                                triggered_by=pip.get("triggeredBy", clean_email),
                                last_run_at=pip.get("lastRunAt") or datetime.utcnow().isoformat(),
                                stages_json=pip.get("stages", []),
                                recent_runs_json=pip.get("recentRuns", []),
                            )
                        )
                        counts["pipelines"] += 1

    if cleanup:
        for pattern in (
            str(platform_dir / "*.json"),
            str(platform_dir / ".session_secret"),
            str(conn_dir / "*.json"),
            str(states_dir / "*" / "*.json"),
        ):
            for fp in glob.glob(pattern):
                os.remove(fp)
                counts["files_removed"] += 1

    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate legacy Tesserak JSON files to PostgreSQL.")
    parser.add_argument("--cleanup", action="store_true", help="Remove migrated legacy JSON files after import.")
    args = parser.parse_args()
    summary = migrate_all(Path(__file__).resolve().parent, cleanup=args.cleanup)
    print("Migration summary:", json.dumps(summary, indent=2))
