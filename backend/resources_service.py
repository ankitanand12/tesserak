from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
import asyncio
import secrets
import string
import threading
import time

import boto3
from botocore.config import Config

BOTO_CFG = Config(connect_timeout=4, read_timeout=6, retries={"max_attempts": 1})
DISCOVERY_CACHE_TTL_SECONDS = 30.0
GUARDRAIL_CACHE_TTL_SECONDS = 20.0
_DISCOVERY_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_GUARDRAIL_AUDIT_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_thread_local = threading.local()


def _utc_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _aws_session(conn: Any, region: Optional[str] = None) -> boto3.Session:
    return boto3.Session(
        aws_access_key_id=conn.accessKey,
        aws_secret_access_key=conn.secretKey,
        region_name=region or conn.region or "us-east-1",
    )


def _thread_client(conn: Any, service: str, region: Optional[str] = None):
    cache = getattr(_thread_local, "clients", None)
    if cache is None:
        cache = {}
        _thread_local.clients = cache
    resolved_region = region or conn.region or "us-east-1"
    key = (conn.accessKey, resolved_region, service)
    client = cache.get(key)
    if client is None:
        client = boto3.client(
            service,
            aws_access_key_id=conn.accessKey,
            aws_secret_access_key=conn.secretKey,
            region_name=resolved_region,
            config=BOTO_CFG,
        )
        cache[key] = client
    return client


def invalidate_resource_cache(user_email: Optional[str] = None) -> None:
    if not user_email:
        _DISCOVERY_CACHE.clear()
        _GUARDRAIL_AUDIT_CACHE.clear()
        return
    clean = user_email.strip().lower()
    _DISCOVERY_CACHE.pop(clean, None)
    _GUARDRAIL_AUDIT_CACHE.pop(clean, None)


def _scan_rds_sync(conn: Any, region: str, now: str) -> Tuple[List[Dict[str, Any]], List[str]]:
    items: List[Dict[str, Any]] = []
    warnings: List[str] = []
    try:
        rds = _thread_client(conn, "rds", region)
        for db in rds.describe_db_instances().get("DBInstances", []):
            enc = bool(db.get("StorageEncrypted", False))
            pub = bool(db.get("PubliclyAccessible", False))
            notes = []
            if not enc:
                notes.append("Unencrypted storage detected on AWS")
            if pub:
                notes.append("PubliclyAccessible=True violates network guardrail")
            items.append(
                {
                    "id": f"aws-rds-{db['DBInstanceIdentifier']}",
                    "name": db["DBInstanceIdentifier"],
                    "provider": "aws",
                    "serviceType": f"RDS {db.get('Engine', 'postgres')}",
                    "region": region,
                    "environment": "prod" if "prod" in db["DBInstanceIdentifier"].lower() else "staging",
                    "spec": f"{db.get('DBInstanceClass')} · {db.get('AllocatedStorage', 20)}GB",
                    "encrypted": enc,
                    "publicAccess": pub,
                    "status": db.get("DBInstanceStatus", "available").title(),
                    "driftStatus": "Drifted" if (not enc or pub) else "In Sync",
                    "guardrailNotes": notes or ["Live AWS RDS verified"],
                    "createdAt": db.get("InstanceCreateTime").isoformat() if db.get("InstanceCreateTime") else now,
                    "lastSyncAt": now,
                    "arn": db.get("DBInstanceArn"),
                    "source": "aws-live",
                }
            )
    except Exception as exc:
        warnings.append(f"RDS describe skipped: {exc}")
    return items, warnings


def _scan_elasticache_sync(conn: Any, region: str, now: str) -> Tuple[List[Dict[str, Any]], List[str]]:
    items: List[Dict[str, Any]] = []
    warnings: List[str] = []
    try:
        ec = _thread_client(conn, "elasticache", region)
        for cc in ec.describe_cache_clusters().get("CacheClusters", []):
            enc = bool(cc.get("AtRestEncryptionEnabled", False))
            items.append(
                {
                    "id": f"aws-ec-{cc['CacheClusterId']}",
                    "name": cc["CacheClusterId"],
                    "provider": "aws",
                    "serviceType": f"ElastiCache {cc.get('Engine', 'redis').title()}",
                    "region": region,
                    "environment": "prod" if "prod" in cc["CacheClusterId"].lower() else "staging",
                    "spec": f"{cc.get('CacheNodeType')} · {cc.get('NumCacheNodes', 1)} node(s)",
                    "encrypted": enc,
                    "publicAccess": False,
                    "status": cc.get("CacheClusterStatus", "available").title(),
                    "driftStatus": "In Sync" if enc else "Drifted",
                    "guardrailNotes": ["At-rest encryption off"] if not enc else ["Live AWS ElastiCache verified"],
                    "createdAt": now,
                    "lastSyncAt": now,
                    "arn": cc.get("ARN"),
                    "source": "aws-live",
                }
            )
    except Exception as exc:
        warnings.append(f"ElastiCache describe skipped: {exc}")
    return items, warnings


def _inspect_s3_bucket_sync(conn: Any, b: Dict[str, Any], region: str, now: str) -> Dict[str, Any]:
    s3 = _thread_client(conn, "s3", region)
    b_name = b["Name"]
    enc = False
    pub = True
    notes: List[str] = []
    try:
        s3.get_bucket_encryption(Bucket=b_name)
        enc = True
    except Exception:
        notes.append("Bucket default encryption not set")
    try:
        pab = s3.get_public_access_block(Bucket=b_name).get("PublicAccessBlockConfiguration", {})
        if all(
            [
                pab.get("BlockPublicAcls"),
                pab.get("IgnorePublicAcls"),
                pab.get("BlockPublicPolicy"),
                pab.get("RestrictPublicBuckets"),
            ]
        ):
            pub = False
        else:
            notes.append("PublicAccessBlock incomplete")
    except Exception:
        notes.append("PublicAccessBlock not configured")

    return {
        "id": f"aws-s3-{b_name}",
        "name": b_name,
        "provider": "aws",
        "serviceType": "S3 Bucket",
        "region": region,
        "environment": "prod" if "prod" in b_name.lower() else "staging",
        "spec": "S3 Standard Object Store",
        "encrypted": enc,
        "publicAccess": pub,
        "status": "Active",
        "driftStatus": "Drifted" if (not enc or pub) else "In Sync",
        "guardrailNotes": notes or ["SSE encrypted · Public Access Blocked"],
        "createdAt": b.get("CreationDate").isoformat() if b.get("CreationDate") else now,
        "lastSyncAt": now,
        "arn": f"arn:aws:s3:::{b_name}",
        "source": "aws-live",
    }


def _scan_s3_sync(conn: Any, region: str, now: str) -> Tuple[List[Dict[str, Any]], List[str]]:
    try:
        s3 = _thread_client(conn, "s3", region)
        buckets = s3.list_buckets().get("Buckets", [])[:15]
        if not buckets:
            return [], []
        with ThreadPoolExecutor(max_workers=min(8, len(buckets))) as pool:
            items = list(pool.map(lambda b: _inspect_s3_bucket_sync(conn, b, region, now), buckets))
        return items, []
    except Exception as exc:
        return [], [f"S3 list skipped: {exc}"]


def _inspect_sqs_queue_sync(conn: Any, q_url: str, region: str, now: str) -> Dict[str, Any]:
    sqs = _thread_client(conn, "sqs", region)
    q_name = q_url.rsplit("/", 1)[-1]
    attrs = sqs.get_queue_attributes(
        QueueUrl=q_url,
        AttributeNames=["KmsMasterKeyId", "SqsManagedSseEnabled", "CreatedTimestamp"],
    ).get("Attributes", {})
    enc = bool(attrs.get("KmsMasterKeyId") or attrs.get("SqsManagedSseEnabled") == "true")
    return {
        "id": f"aws-sqs-{q_name}",
        "name": q_name,
        "provider": "aws",
        "serviceType": "SQS Standard Queue",
        "region": region,
        "environment": "prod" if "prod" in q_name.lower() else "staging",
        "spec": "AWS SQS Managed Queue",
        "encrypted": enc,
        "publicAccess": False,
        "status": "Active",
        "driftStatus": "In Sync" if enc else "Drifted",
        "guardrailNotes": ["SSE enabled"] if enc else ["Queue encryption disabled"],
        "createdAt": now,
        "lastSyncAt": now,
        "arn": q_url,
        "source": "aws-live",
    }


def _scan_sqs_sync(conn: Any, region: str, now: str) -> Tuple[List[Dict[str, Any]], List[str]]:
    try:
        sqs = _thread_client(conn, "sqs", region)
        queue_urls = sqs.list_queues().get("QueueUrls", [])[:20]
        if not queue_urls:
            return [], []
        with ThreadPoolExecutor(max_workers=min(8, len(queue_urls))) as pool:
            items = list(pool.map(lambda q_url: _inspect_sqs_queue_sync(conn, q_url, region, now), queue_urls))
        return items, []
    except Exception as exc:
        return [], [f"SQS list skipped: {exc}"]


def _discover_live_aws_resources_sync(conn: Any) -> Dict[str, Any]:
    region = conn.region or "us-east-1"
    now = _utc_now()
    discovered: List[Dict[str, Any]] = []
    scan_warnings: List[str] = []

    try:
        sts = _thread_client(conn, "sts", region)
        account_id = sts.get_caller_identity()["Account"]
    except Exception as exc:
        return {
            "awsConnected": False,
            "accountId": None,
            "region": region,
            "discovered": [],
            "warnings": [],
            "error": f"AWS STS verification failed: {exc}",
        }

    with ThreadPoolExecutor(max_workers=4) as pool:
        f_rds = pool.submit(_scan_rds_sync, conn, region, now)
        f_ec = pool.submit(_scan_elasticache_sync, conn, region, now)
        f_s3 = pool.submit(_scan_s3_sync, conn, region, now)
        f_sqs = pool.submit(_scan_sqs_sync, conn, region, now)
        for fut in (f_rds, f_ec, f_s3, f_sqs):
            items, warnings = fut.result()
            discovered.extend(items)
            scan_warnings.extend(warnings)

    return {
        "awsConnected": True,
        "accountId": account_id,
        "region": region,
        "discovered": discovered,
        "warnings": scan_warnings,
    }


async def discover_live_aws_resources(
    user_email: str,
    connection_manager: Any,
    pending_resources: List[Dict[str, Any]],
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """Discover real RDS, ElastiCache, S3, and SQS resources from the user's connected AWS IAM account."""
    conn = await connection_manager.get_valid_connection(user_email)
    if not conn:
        return {
            "awsConnected": False,
            "accountId": None,
            "region": None,
            "resources": pending_resources,
            "error": "No valid AWS IAM connection found. Add an AWS IAM connector in Integrations to discover & provision real resources.",
        }

    cache_key = (user_email or "").strip().lower()
    now_mono = time.monotonic()
    cached_payload: Optional[Dict[str, Any]] = None
    if not force_refresh:
        cached_entry = _DISCOVERY_CACHE.get(cache_key)
        if cached_entry and cached_entry[0] > now_mono:
            cached_payload = cached_entry[1]

    if cached_payload is None:
        cached_payload = await asyncio.to_thread(_discover_live_aws_resources_sync, conn)
        if cached_payload.get("awsConnected"):
            _DISCOVERY_CACHE[cache_key] = (time.monotonic() + DISCOVERY_CACHE_TTL_SECONDS, cached_payload)

    if not cached_payload.get("awsConnected"):
        return {
            "awsConnected": False,
            "accountId": None,
            "region": cached_payload.get("region"),
            "resources": pending_resources,
            "error": cached_payload.get("error", "AWS STS verification failed."),
        }

    return {
        "awsConnected": True,
        "accountId": cached_payload.get("accountId"),
        "region": cached_payload.get("region"),
        "resources": pending_resources + list(cached_payload.get("discovered", [])),
        "warnings": list(cached_payload.get("warnings", [])),
    }


def execute_aws_provision(conn: Any, spec: Dict[str, Any]) -> Dict[str, Any]:
    """Execute real AWS Boto3 resource creation for S3, SQS, ElastiCache, or RDS."""
    region = spec.get("region") or conn.region or "us-east-1"
    session = _aws_session(conn, region)
    service_type = spec["serviceType"]
    name = spec["name"].strip()
    encrypted = bool(spec.get("encrypted", True))
    public_access = bool(spec.get("publicAccess", False))
    now = _utc_now()

    if service_type == "S3 Bucket":
        s3 = session.client("s3")
        create_kwargs: Dict[str, Any] = {"Bucket": name}
        if region != "us-east-1":
            create_kwargs["CreateBucketConfiguration"] = {"LocationConstraint": region}
        s3.create_bucket(**create_kwargs)
        if encrypted:
            s3.put_bucket_encryption(
                Bucket=name,
                ServerSideEncryptionConfiguration={
                    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
                },
            )
        if not public_access:
            s3.put_public_access_block(
                Bucket=name,
                PublicAccessBlockConfiguration={
                    "BlockPublicAcls": True,
                    "IgnorePublicAcls": True,
                    "BlockPublicPolicy": True,
                    "RestrictPublicBuckets": True,
                },
            )
        return {
            "id": f"aws-s3-{name}",
            "name": name,
            "provider": "aws",
            "serviceType": "S3 Bucket",
            "region": region,
            "environment": spec.get("environment", "staging"),
            "spec": "AWS S3 · Real Bucket Created",
            "encrypted": encrypted,
            "publicAccess": public_access,
            "status": "Active",
            "driftStatus": "In Sync",
            "guardrailNotes": ["Created live via Boto3 S3"],
            "createdAt": now,
            "lastSyncAt": now,
            "arn": f"arn:aws:s3:::{name}",
            "source": "aws-live",
        }

    if service_type == "SQS Standard Queue":
        sqs = session.client("sqs")
        attrs = {"SqsManagedSseEnabled": "true"} if encrypted else {}
        resp = sqs.create_queue(QueueName=name, Attributes=attrs)
        return {
            "id": f"aws-sqs-{name}",
            "name": name,
            "provider": "aws",
            "serviceType": "SQS Standard Queue",
            "region": region,
            "environment": spec.get("environment", "staging"),
            "spec": "AWS SQS · Real Queue Created",
            "encrypted": encrypted,
            "publicAccess": False,
            "status": "Active",
            "driftStatus": "In Sync",
            "guardrailNotes": ["Created live via Boto3 SQS"],
            "createdAt": now,
            "lastSyncAt": now,
            "arn": resp.get("QueueUrl"),
            "source": "aws-live",
        }

    if service_type == "ElastiCache Redis":
        ec = session.client("elasticache")
        resp = ec.create_cache_cluster(
            CacheClusterId=name,
            Engine="redis",
            CacheNodeType=spec.get("nodeType") or "cache.t4g.micro",
            NumCacheNodes=1,
        )
        cluster = resp["CacheCluster"]
        return {
            "id": f"aws-ec-{name}",
            "name": name,
            "provider": "aws",
            "serviceType": "ElastiCache Redis",
            "region": region,
            "environment": spec.get("environment", "staging"),
            "spec": f"{cluster.get('CacheNodeType')} · Redis",
            "encrypted": encrypted,
            "publicAccess": False,
            "status": cluster.get("CacheClusterStatus", "creating").title(),
            "driftStatus": "In Sync",
            "guardrailNotes": ["Provisioning live via Boto3 ElastiCache"],
            "createdAt": now,
            "lastSyncAt": now,
            "arn": cluster.get("ARN"),
            "source": "aws-live",
        }

    if service_type == "RDS PostgreSQL":
        rds = session.client("rds")
        pw = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(18))
        resp = rds.create_db_instance(
            DBInstanceIdentifier=name,
            DBInstanceClass=spec.get("nodeType") or "db.t3.micro",
            Engine="postgres",
            MasterUsername="tesserakadmin",
            MasterUserPassword=pw,
            AllocatedStorage=20,
            StorageEncrypted=encrypted,
            PubliclyAccessible=public_access,
        )
        db = resp["DBInstance"]
        return {
            "id": f"aws-rds-{name}",
            "name": name,
            "provider": "aws",
            "serviceType": "RDS PostgreSQL",
            "region": region,
            "environment": spec.get("environment", "staging"),
            "spec": f"{db.get('DBInstanceClass')} · 20GB PostgreSQL",
            "encrypted": encrypted,
            "publicAccess": public_access,
            "status": db.get("DBInstanceStatus", "creating").title(),
            "driftStatus": "In Sync",
            "guardrailNotes": ["Provisioning live via Boto3 RDS"],
            "createdAt": now,
            "lastSyncAt": now,
            "arn": db.get("DBInstanceArn"),
            "source": "aws-live",
        }

    raise ValueError(f"Unsupported AWS provisioning service '{service_type}'.")


def execute_aws_reconcile(conn: Any, resource_id: str) -> str:
    """Re-verify or remediate S3 public access / encryption drift via Boto3."""
    session = _aws_session(conn)
    if resource_id.startswith("aws-s3-"):
        bucket = resource_id[len("aws-s3-") :]
        s3 = session.client("s3")
        s3.put_bucket_encryption(
            Bucket=bucket,
            ServerSideEncryptionConfiguration={
                "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
            },
        )
        s3.put_public_access_block(
            Bucket=bucket,
            PublicAccessBlockConfiguration={
                "BlockPublicAcls": True,
                "IgnorePublicAcls": True,
                "BlockPublicPolicy": True,
                "RestrictPublicBuckets": True,
            },
        )
        return f"Applied S3 AES256 encryption + BlockPublicAccess on bucket '{bucket}' in AWS."
    if resource_id.startswith("aws-sqs-"):
        q_name = resource_id[len("aws-sqs-") :]
        sqs = session.client("sqs")
        url = sqs.get_queue_url(QueueName=q_name)["QueueUrl"]
        sqs.set_queue_attributes(QueueUrl=url, Attributes={"SqsManagedSseEnabled": "true"})
        return f"Enabled SQS SSE encryption on queue '{q_name}' in AWS."
    raise ValueError("Live AWS inspection verified. RDS/ElastiCache drift requires console/Terraform parameter modification.")


def execute_aws_delete(conn: Any, resource_id: str) -> str:
    session = _aws_session(conn)
    if resource_id.startswith("aws-s3-"):
        bucket = resource_id[len("aws-s3-") :]
        session.client("s3").delete_bucket(Bucket=bucket)
        return f"Deleted S3 bucket '{bucket}' from AWS."
    if resource_id.startswith("aws-sqs-"):
        q_name = resource_id[len("aws-sqs-") :]
        sqs = session.client("sqs")
        url = sqs.get_queue_url(QueueName=q_name)["QueueUrl"]
        sqs.delete_queue(QueueUrl=url)
        return f"Deleted SQS queue '{q_name}' from AWS."
    if resource_id.startswith("aws-rds-"):
        db_id = resource_id[len("aws-rds-") :]
        session.client("rds").delete_db_instance(
            DBInstanceIdentifier=db_id, SkipFinalSnapshot=True, DeleteAutomatedBackups=True
        )
        return f"Deletion initiated for RDS instance '{db_id}' in AWS."
    if resource_id.startswith("aws-ec-"):
        cid = resource_id[len("aws-ec-") :]
        session.client("elasticache").delete_cache_cluster(CacheClusterId=cid)
        return f"Deletion initiated for ElastiCache cluster '{cid}' in AWS."
    raise ValueError(f"Unknown AWS resource identifier '{resource_id}'.")


def _scan_eks_guardrails_sync(conn: Any, enabled_ids: set[str]) -> List[Dict[str, Any]]:
    findings: List[Dict[str, Any]] = []
    if "gr-public-access" not in enabled_ids:
        return findings
    try:
        eks = _thread_client(conn, "eks")
        for cname in eks.list_clusters().get("clusters", []):
            cluster = eks.describe_cluster(name=cname).get("cluster", {})
            vpc_cfg = cluster.get("resourcesVpcConfig", {})
            pub_access = bool(vpc_cfg.get("endpointPublicAccess", True))
            findings.append(
                {
                    "resourceName": cname,
                    "resourceType": "AWS EKS",
                    "ruleId": "gr-public-access",
                    "ruleName": "Block Public API Endpoints",
                    "status": "FAIL" if pub_access else "PASS",
                    "detail": "EKS API server endpointPublicAccess=True" if pub_access else "Private API endpoint enforced",
                }
            )
    except Exception:
        pass
    return findings


async def run_live_guardrail_audit(
    user_email: str,
    connection_manager: Any,
    rules: List[Dict[str, Any]],
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """Audit real AWS EKS clusters, RDS instances, and S3 buckets against active Guardrail rules."""
    conn = await connection_manager.get_valid_connection(user_email)
    if not conn:
        return {
            "awsConnected": False,
            "findings": [],
            "complianceScore": None,
            "checkedCount": 0,
            "passedCount": 0,
            "message": "Connect an AWS IAM account in Integrations to run live compliance scans across EKS, RDS, and S3.",
        }

    cache_key = (user_email or "").strip().lower()
    enabled_ids = {r["id"] for r in rules if r.get("enabled")}
    rule_sig = ",".join(sorted(enabled_ids))
    now_mono = time.monotonic()
    if not force_refresh:
        cached = _GUARDRAIL_AUDIT_CACHE.get(cache_key)
        if cached and cached[0] > now_mono and cached[1].get("_ruleSig") == rule_sig:
            out = dict(cached[1])
            out.pop("_ruleSig", None)
            return out

    eks_findings, discovered = await asyncio.gather(
        asyncio.to_thread(_scan_eks_guardrails_sync, conn, enabled_ids),
        discover_live_aws_resources(user_email, connection_manager, [], force_refresh=force_refresh),
    )
    findings: List[Dict[str, Any]] = list(eks_findings)

    # Scan RDS + S3
    for res in discovered.get("resources", []):
        if "gr-encryption" in enabled_ids:
            findings.append(
                {
                    "resourceName": res["name"],
                    "resourceType": res["serviceType"],
                    "ruleId": "gr-encryption",
                    "ruleName": "Enforce Encryption at Rest",
                    "status": "PASS" if res.get("encrypted") else "FAIL",
                    "detail": "Encrypted at rest" if res.get("encrypted") else "At-rest encryption disabled on AWS",
                }
            )
        if "gr-public-access" in enabled_ids and (res["serviceType"] == "S3 Bucket" or "RDS" in res["serviceType"]):
            findings.append(
                {
                    "resourceName": res["name"],
                    "resourceType": res["serviceType"],
                    "ruleId": "gr-public-access",
                    "ruleName": "Block Public Ingress & Open Buckets",
                    "status": "FAIL" if res.get("publicAccess") else "PASS",
                    "detail": "Public access enabled" if res.get("publicAccess") else "Public access blocked",
                }
            )

    total = len(findings)
    passed = sum(1 for f in findings if f["status"] == "PASS")
    score = round((passed / total) * 100) if total > 0 else 100

    result = {
        "awsConnected": True,
        "accountId": discovered.get("accountId"),
        "region": discovered.get("region"),
        "findings": findings,
        "complianceScore": score,
        "checkedCount": total,
        "passedCount": passed,
        "message": f"Scanned {total} live AWS checks across account {discovered.get('accountId')}.",
    }
    _GUARDRAIL_AUDIT_CACHE[cache_key] = (
        time.monotonic() + GUARDRAIL_CACHE_TTL_SECONDS,
        {**result, "_ruleSig": rule_sig},
    )
    return result
