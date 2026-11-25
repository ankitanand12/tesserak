from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
import secrets
import string

import boto3


def _utc_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _aws_session(conn: Any, region: Optional[str] = None) -> boto3.Session:
    return boto3.Session(
        aws_access_key_id=conn.accessKey,
        aws_secret_access_key=conn.secretKey,
        region_name=region or conn.region or "us-east-1",
    )


async def discover_live_aws_resources(
    user_email: str,
    connection_manager: Any,
    pending_resources: List[Dict[str, Any]],
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

    session = _aws_session(conn)
    region = conn.region or "us-east-1"
    now = _utc_now()
    discovered: List[Dict[str, Any]] = []
    scan_warnings: List[str] = []

    try:
        account_id = session.client("sts").get_caller_identity()["Account"]
    except Exception as exc:
        return {
            "awsConnected": False,
            "accountId": None,
            "region": region,
            "resources": pending_resources,
            "error": f"AWS STS verification failed: {exc}",
        }

    # 1. RDS Instances
    try:
        rds = session.client("rds")
        for db in rds.describe_db_instances().get("DBInstances", []):
            enc = bool(db.get("StorageEncrypted", False))
            pub = bool(db.get("PubliclyAccessible", False))
            notes = []
            if not enc:
                notes.append("Unencrypted storage detected on AWS")
            if pub:
                notes.append("PubliclyAccessible=True violates network guardrail")
            discovered.append(
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
        scan_warnings.append(f"RDS describe skipped: {exc}")

    # 2. ElastiCache Clusters
    try:
        ec = session.client("elasticache")
        for cc in ec.describe_cache_clusters().get("CacheClusters", []):
            enc = bool(cc.get("AtRestEncryptionEnabled", False))
            discovered.append(
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
        scan_warnings.append(f"ElastiCache describe skipped: {exc}")

    # 3. S3 Buckets (first 15 in account)
    try:
        s3 = session.client("s3")
        for b in s3.list_buckets().get("Buckets", [])[:15]:
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

            discovered.append(
                {
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
            )
    except Exception as exc:
        scan_warnings.append(f"S3 list skipped: {exc}")

    # 4. SQS Queues
    try:
        sqs = session.client("sqs")
        for q_url in sqs.list_queues().get("QueueUrls", [])[:20]:
            q_name = q_url.rsplit("/", 1)[-1]
            attrs = sqs.get_queue_attributes(
                QueueUrl=q_url,
                AttributeNames=["KmsMasterKeyId", "SqsManagedSseEnabled", "CreatedTimestamp"],
            ).get("Attributes", {})
            enc = bool(attrs.get("KmsMasterKeyId") or attrs.get("SqsManagedSseEnabled") == "true")
            discovered.append(
                {
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
            )
    except Exception as exc:
        scan_warnings.append(f"SQS list skipped: {exc}")

    return {
        "awsConnected": True,
        "accountId": account_id,
        "region": region,
        "resources": pending_resources + discovered,
        "warnings": scan_warnings,
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


async def run_live_guardrail_audit(
    user_email: str,
    connection_manager: Any,
    rules: List[Dict[str, Any]],
    prediscovered: Optional[Dict[str, Any]] = None,
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

    session = _aws_session(conn)
    findings: List[Dict[str, Any]] = []
    enabled_ids = {r["id"] for r in rules if r.get("enabled")}

    # Scan EKS clusters
    try:
        eks = session.client("eks")
        for cname in eks.list_clusters().get("clusters", []):
            cluster = eks.describe_cluster(name=cname).get("cluster", {})
            vpc_cfg = cluster.get("resourcesVpcConfig", {})
            pub_access = bool(vpc_cfg.get("endpointPublicAccess", True))
            if "gr-public-access" in enabled_ids:
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

    # Scan RDS + S3
    discovered = (
        prediscovered
        if prediscovered is not None
        else await discover_live_aws_resources(user_email, connection_manager, [])
    )
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

    return {
        "awsConnected": True,
        "accountId": discovered.get("accountId"),
        "region": discovered.get("region"),
        "findings": findings,
        "complianceScore": score,
        "checkedCount": total,
        "passedCount": passed,
        "message": f"Scanned {total} live AWS checks across account {discovered.get('accountId')}.",
    }
