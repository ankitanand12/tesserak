from fastapi import Depends, FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
import asyncio
import boto3
from botocore.config import Config
from concurrent.futures import ThreadPoolExecutor
import ipaddress
import json
import os
import logging
import time
import urllib.request
from dotenv import load_dotenv
from auth import require_auth_if_configured
from state_manager import StateManager
from state_management import StateData
from connections import ConnectionManager, Connection, ConnectionBase
from db import get_db
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

load_dotenv()

app = FastAPI(
    title="Tesserak | EKS Cluster Manager",
    description="Multi-dimensional Kubernetes & cloud infrastructure control API",
)

# Initialize PostgreSQL schema and managers
get_db().init_schema()
state_manager = StateManager(base_path="cluster_states")
state_data = StateData()
connection_manager = ConnectionManager(storage_path="connections")

AWS_FAST_CFG = Config(connect_timeout=4, read_timeout=10, retries={"max_attempts": 1})
_EKS_META_CACHE: Dict[str, tuple[float, Any]] = {}
_CLUSTER_LIST_CACHE: Dict[str, tuple[float, List[Any]]] = {}
_COMMUNITY_ADDON_REPOS = {
    "external-dns": {
        "repo": "kubernetes-sigs/external-dns",
        "fallback": ["0.20.0", "0.19.0", "0.18.0", "0.17.0", "0.16.0"],
    },
    "cert-manager": {
        "repo": "cert-manager/cert-manager",
        "fallback": ["1.19.1", "1.18.2", "1.17.2", "1.16.3", "1.15.3"],
    },
    "metrics-server": {
        "repo": "kubernetes-sigs/metrics-server",
        "fallback": ["0.8.0", "0.7.2", "0.7.1", "0.7.0", "0.6.4"],
    },
}


def invalidate_cluster_list_cache(user_email: Optional[str] = None) -> None:
    if not user_email:
        _CLUSTER_LIST_CACHE.clear()
        return
    _CLUSTER_LIST_CACHE.pop(user_email.strip().lower(), None)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# AWS client will be created per-request based on the user's credentials


class AddonModel(BaseModel):
    id: str
    name: str
    type: str
    version: str
    configuration: Optional[dict] = None

async def get_compatible_aws_addon_version(eks_client, addon_name: str, eks_version: str, requested_version: str = None) -> str:
    """Return a compatible addon version for the given EKS version, or None if not found."""
    try:
        resp = eks_client.describe_addon_versions(
            addonName=addon_name,
            kubernetesVersion=eks_version
        )
        versions = resp.get('addons', [{}])[0].get('addonVersions', [])
        compatible_versions = [v['addonVersion'] for v in versions if v.get('compatibilities')]
        
        if requested_version and requested_version in compatible_versions:
            return requested_version
        if compatible_versions:
            # Return the latest compatible version
            return compatible_versions[0]
        return None
    except Exception as e:
        return None

def parse_version(version_str: str) -> list:
    """Parse version string into numeric components for sorting"""
    # Remove 'v' prefix if present
    version_str = version_str.lower().replace('v', '')
    
    # Handle eksbuild versions
    if 'eksbuild.' in version_str:
        version_str = version_str.split('eksbuild.')[0]
    
    try:
        # Split into numeric components
        parts = version_str.split('.')
        # Convert to integers and pad with zeros
        nums = [int(p) for p in parts] + [0] * (4 - len(parts))
        return nums
    except ValueError:
        return [0, 0, 0, 0]

def _fetch_community_addon_versions(addon_id: str) -> List[Dict[str, Any]]:
    cache_key = f"community:{addon_id}"
    cached = _EKS_META_CACHE.get(cache_key)
    if cached and cached[0] > time.monotonic():
        return cached[1]

    cfg = _COMMUNITY_ADDON_REPOS.get(addon_id, {})
    versions_list: List[str] = []
    repo = cfg.get("repo")
    if repo:
        try:
            req = urllib.request.Request(
                f"https://api.github.com/repos/{repo}/releases?per_page=8",
                headers={"Accept": "application/vnd.github+json", "User-Agent": "Tesserak-EKS-Manager"},
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                releases = json.loads(resp.read().decode())
            for rel in releases:
                if rel.get("draft") or rel.get("prerelease"):
                    continue
                tag = (rel.get("tag_name") or "").strip().lstrip("v")
                # cert-manager / metrics-server tags sometimes carry prefix like "metrics-server-helm-chart-3.12.2"
                if "-v" in tag:
                    tag = tag.rsplit("-v", 1)[-1]
                elif "-" in tag and any(c.isdigit() for c in tag.rsplit("-", 1)[-1]):
                    tail = tag.rsplit("-", 1)[-1]
                    if "." in tail:
                        tag = tail
                if tag and tag not in versions_list and any(ch.isdigit() for ch in tag):
                    versions_list.append(tag)
        except Exception:
            pass

    if not versions_list:
        versions_list = list(cfg.get("fallback", ["1.0.0"]))

    versions_list.sort(key=parse_version, reverse=True)
    formatted = [
        {
            "version": ver,
            "defaultVersion": idx == 0,
            "isLatest": idx == 0,
            "compatibleWithCurrentK8s": True,
        }
        for idx, ver in enumerate(versions_list[:10])
    ]
    _EKS_META_CACHE[cache_key] = (time.monotonic() + 900.0, formatted)
    return formatted


def _get_eks_supported_versions_sync(conn: Any, region: Optional[str] = None) -> Dict[str, Any]:
    target_region = region or conn.region or "us-east-1"
    cache_key = f"eks_versions:{target_region}"
    cached = _EKS_META_CACHE.get(cache_key)
    if cached and cached[0] > time.monotonic():
        return cached[1]

    eks = boto3.client(
        "eks",
        aws_access_key_id=conn.accessKey,
        aws_secret_access_key=conn.secretKey,
        region_name=target_region,
        config=AWS_FAST_CFG,
    )

    items: List[Dict[str, Any]] = []
    if hasattr(eks, "describe_cluster_versions"):
        try:
            paginator = eks.get_paginator("describe_cluster_versions")
            for page in paginator.paginate(clusterType="eks"):
                for cv in page.get("clusterVersions", []):
                    status = cv.get("status") or cv.get("versionStatus") or ""
                    if status and status not in {"STANDARD_SUPPORT", "EXTENDED_SUPPORT"}:
                        continue
                    ver = cv.get("clusterVersion")
                    if ver:
                        items.append(
                            {
                                "version": ver,
                                "status": status or "STANDARD_SUPPORT",
                                "awsDefault": bool(cv.get("defaultVersion", False)),
                            }
                        )
        except Exception as exc:
            logger.warning(f"describe_cluster_versions fallback triggered: {exc}")

    if not items:
        av = eks.describe_addon_versions(addonName="vpc-cni")
        seen = set()
        for addon in av.get("addons", []):
            for v in addon.get("addonVersions", []):
                for compat in v.get("compatibilities", []):
                    cv = compat.get("clusterVersion")
                    if cv and cv not in seen:
                        seen.add(cv)
                        items.append({"version": cv, "status": "STANDARD_SUPPORT", "awsDefault": False})

    # Deduplicate and sort newest version first
    dedup: Dict[str, Dict[str, Any]] = {}
    for item in items:
        dedup[item["version"]] = item
    sorted_items = sorted(dedup.values(), key=lambda x: parse_version(x["version"]), reverse=True)
    for idx, item in enumerate(sorted_items):
        item["isLatest"] = idx == 0

    latest_ver = sorted_items[0]["version"] if sorted_items else ""
    payload = {
        "versions": sorted_items,
        "latest": latest_ver,
        "default": latest_ver,
        "region": target_region,
    }
    _EKS_META_CACHE[cache_key] = (time.monotonic() + 300.0, payload)
    return payload


@app.get("/api/aws/eks-versions", dependencies=[Depends(require_auth_if_configured)])
async def get_eks_versions(
    region: Optional[str] = None,
    x_user_email: str = Header(...),
):
    conn = await connection_manager.get_valid_connection(x_user_email)
    if not conn:
        raise HTTPException(status_code=400, detail="No valid AWS connection found")
    try:
        return await asyncio.to_thread(_get_eks_supported_versions_sync, conn, region)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch AWS EKS versions: {str(e)}")


def _fetch_all_addon_versions_sync(conn: Any, eks_version: str, region: Optional[str] = None) -> Dict[str, List[Dict[str, Any]]]:
    target_region = region or conn.region or "us-east-1"
    cache_key = f"addons:{target_region}:{eks_version}"
    cached = _EKS_META_CACHE.get(cache_key)
    if cached and cached[0] > time.monotonic():
        return cached[1]

    aws_addons = {
        'vpc-cni': {'name': 'vpc-cni', 'default': 'v1.15.0-eksbuild.2'},
        'coredns': {'name': 'coredns', 'default': 'v1.10.1-eksbuild.1'},
        'kube-proxy': {'name': 'kube-proxy', 'default': f'v{eks_version}-minimal-eksbuild.1'},
        'aws-ebs-csi-driver': {'name': 'aws-ebs-csi-driver', 'default': 'v1.25.0-eksbuild.1'},
        'aws-efs-csi-driver': {'name': 'aws-efs-csi-driver', 'default': 'v1.7.0-eksbuild.1'},
        'aws-fsx-csi-driver': {'name': 'aws-fsx-csi-driver', 'default': 'v1.7.0-eksbuild.1'},
        'eks-pod-identity-agent': {'name': 'eks-pod-identity-agent', 'default': 'v1.0.0-eksbuild.1'}
    }

    def _fetch_one(frontend_id: str, addon_info: Dict[str, str]):
        aws_name = addon_info['name']
        eks_client = boto3.client(
            'eks',
            aws_access_key_id=conn.accessKey,
            aws_secret_access_key=conn.secretKey,
            region_name=target_region,
            config=AWS_FAST_CFG,
        )
        paginator = eks_client.get_paginator('describe_addon_versions')
        all_versions = []
        try:
            for page in paginator.paginate(addonName=aws_name, kubernetesVersion=eks_version):
                if page.get('addons'):
                    all_versions.extend(page['addons'][0].get('addonVersions', []))
            if not all_versions:
                for page in paginator.paginate(addonName=aws_name):
                    if page.get('addons'):
                        all_versions.extend(page['addons'][0].get('addonVersions', []))

            compatible_versions = []
            for version in all_versions:
                for compat in version.get('compatibilities', []):
                    cluster_version = compat.get('clusterVersion', '')
                    if cluster_version == eks_version or eks_version.startswith(cluster_version.split('.')[0] + '.'):
                        compatible_versions.append({
                            'version': version['addonVersion'],
                            'defaultVersion': compat.get('defaultVersion', False),
                            'isLatest': compat.get('isLatest', False),
                            'compatibleWithCurrentK8s': True,
                        })
                        break

            if not compatible_versions:
                compatible_versions.append({
                    'version': addon_info['default'],
                    'defaultVersion': True,
                    'isLatest': True,
                    'compatibleWithCurrentK8s': True,
                })
            else:
                compatible_versions.sort(key=lambda v: parse_version(v['version']), reverse=True)
                compatible_versions[0]['isLatest'] = True

            return frontend_id, compatible_versions
        except Exception as e:
            logger.error(f"Error fetching versions for {aws_name}: {str(e)}")
            return frontend_id, [{
                'version': addon_info['default'],
                'defaultVersion': True,
                'isLatest': True,
                'compatibleWithCurrentK8s': True,
            }]

    addon_versions: Dict[str, List[Dict[str, Any]]] = {}
    with ThreadPoolExecutor(max_workers=len(aws_addons)) as pool:
        for fid, vers in pool.map(lambda kv: _fetch_one(kv[0], kv[1]), aws_addons.items()):
            addon_versions[fid] = vers

    # Also include live Community Add-on versions
    for comm_id in _COMMUNITY_ADDON_REPOS:
        addon_versions[comm_id] = _fetch_community_addon_versions(comm_id)

    _EKS_META_CACHE[cache_key] = (time.monotonic() + 300.0, addon_versions)
    return addon_versions


@app.get("/api/aws/addon-versions/{eks_version}", dependencies=[Depends(require_auth_if_configured)])
async def get_addon_versions(
    eks_version: str,
    region: Optional[str] = None,
    x_user_email: str = Header(...),
) -> Dict[str, List[Dict[str, Any]]]:
    """Get available versions for AWS & Community EKS addons in parallel."""
    try:
        conn = await connection_manager.get_valid_connection(x_user_email)
        if not conn:
            raise HTTPException(status_code=400, detail="No active AWS connection found")
        return await asyncio.to_thread(_fetch_all_addon_versions_sync, conn, eks_version, region)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_addon_versions: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

async def install_aws_addon(eks_client, cluster_name: str, addon: AddonModel, eks_version: str) -> dict:
    """Install an AWS addon in the cluster, checking compatibility first."""
    compatible_version = await get_compatible_aws_addon_version(eks_client, addon.id, eks_version, addon.version)
    if not compatible_version:
        return {"status": "error", "details": f"No compatible version found for {addon.id} with EKS {eks_version}"}
    try:
        response = eks_client.create_addon(
            clusterName=cluster_name,
            addonName=addon.id,
            addonVersion=compatible_version,
            resolveConflicts='OVERWRITE'
        )
        return {"status": "success", "details": response["addon"], "usedVersion": compatible_version}
    except Exception as e:
        return {"status": "error", "details": str(e), "usedVersion": compatible_version}

async def install_community_addon(cluster_name: str, addon: AddonModel) -> dict:
    """Install a community addon using Helm."""
    # TODO: Implement Helm-based installation
    # For now, return success without actual installation
    return {"status": "success", "details": "Community add-on installation not yet implemented"}

class VpcSelection(BaseModel):
    id: Optional[str] = ""
    isNew: bool = False
    cidr: Optional[str] = None


class EnvironmentConfigModel(BaseModel):
    type: Optional[str] = "Non-Prod"
    endpoint: str = "public-private"
    availabilityZones: List[str] = []
    kubernetesVersion: Optional[str] = None


class TagModel(BaseModel):
    key: str
    value: str


class VpcCreateRequest(BaseModel):
    name: str
    cidr: str = "10.0.0.0/16"
    region: str
    accountId: Optional[str] = None
    availabilityZones: List[str] = []


class ClusterRequest(BaseModel):
    name: str
    accountId: Optional[str] = None
    region: str
    vpc: Optional[VpcSelection] = None
    environment: Optional[EnvironmentConfigModel] = None
    tags: Optional[List[TagModel]] = []
    addons: Optional[List[AddonModel]] = []
    nodeGroupName: Optional[str] = None
    instanceType: str = "t3.medium"
    desiredNodes: int = 2
    minNodes: int = 1
    maxNodes: int = 3
    roleArn: Optional[str] = None

class ClusterResponse(BaseModel):
    name: str
    status: str
    accountId: str
    region: str
    version: str
    endpoint: Optional[str] = None
    stateStatus: str
    createdAt: datetime
    deletedAt: Optional[datetime] = None
    deletedBy: Optional[str] = None  # 'aws-console' or 'tool'

@app.get("/")
async def root():
    return {"message": "Tesserak | EKS Cluster Management API"}

def _create_vpc_sync(conn: Any, payload: VpcCreateRequest) -> Dict[str, Any]:
    ec2 = boto3.client(
        "ec2",
        aws_access_key_id=conn.accessKey,
        aws_secret_access_key=conn.secretKey,
        region_name=payload.region or conn.region or "us-east-1",
        config=AWS_FAST_CFG,
    )
    vpc_cidr = (payload.cidr or "10.0.0.0/16").strip()
    network = ipaddress.ip_network(vpc_cidr, strict=False)
    subnets_iter = list(network.subnets(new_prefix=min(24, network.prefixlen + 8)))
    if len(subnets_iter) < 2:
        subnets_iter = list(network.subnets(prefixlen_diff=1))

    vpc_resp = ec2.create_vpc(CidrBlock=str(network))
    vpc_id = vpc_resp["Vpc"]["VpcId"]
    ec2.modify_vpc_attribute(VpcId=vpc_id, EnableDnsSupport={"Value": True})
    ec2.modify_vpc_attribute(VpcId=vpc_id, EnableDnsHostnames={"Value": True})
    ec2.create_tags(Resources=[vpc_id], Tags=[{"Key": "Name", "Value": payload.name}])

    igw = ec2.create_internet_gateway()["InternetGateway"]["InternetGatewayId"]
    ec2.attach_internet_gateway(InternetGatewayId=igw, VpcId=vpc_id)
    rt = ec2.create_route_table(VpcId=vpc_id)["RouteTable"]["RouteTableId"]
    ec2.create_route(RouteTableId=rt, DestinationCidrBlock="0.0.0.0/0", GatewayId=igw)

    azs = [z for z in payload.availabilityZones if z]
    if len(azs) < 2:
        avail = [z["ZoneName"] for z in ec2.describe_availability_zones(Filters=[{"Name": "state", "Values": ["available"]}])["AvailabilityZones"]]
        for z in avail:
            if z not in azs:
                azs.append(z)
            if len(azs) >= 2:
                break

    created_subnets = []
    for idx, az in enumerate(azs[:3]):
        sub = ec2.create_subnet(
            VpcId=vpc_id,
            CidrBlock=str(subnets_iter[idx]),
            AvailabilityZone=az,
        )["Subnet"]["SubnetId"]
        ec2.modify_subnet_attribute(SubnetId=sub, MapPublicIpOnLaunch={"Value": True})
        ec2.associate_route_table(SubnetId=sub, RouteTableId=rt)
        ec2.create_tags(Resources=[sub], Tags=[{"Key": "Name", "Value": f"{payload.name}-{az}"}])
        created_subnets.append(sub)

    return {"vpcId": vpc_id, "subnetIds": created_subnets}


@app.post("/api/vpc", dependencies=[Depends(require_auth_if_configured)])
async def create_vpc(payload: VpcCreateRequest, x_user_email: str = Header(...)):
    conn = await connection_manager.get_valid_connection(x_user_email)
    if not conn:
        raise HTTPException(status_code=400, detail="No valid AWS connection found.")
    try:
        return await asyncio.to_thread(_create_vpc_sync, conn, payload)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"VPC creation failed: {str(e)}")


def _resolve_eks_role_arn(iam_client, explicit_role: Optional[str] = None) -> str:
    if explicit_role and explicit_role.strip():
        return explicit_role.strip()
    env_role = os.getenv("EKS_CLUSTER_ROLE_ARN", "").strip()
    if env_role:
        return env_role

    candidates = []
    for role in iam_client.list_roles(MaxItems=200).get("Roles", []):
        arn = role.get("Arn", "")
        if "/aws-service-role/" in arn:
            continue
        doc = json.dumps(role.get("AssumeRolePolicyDocument", {}))
        if "eks.amazonaws.com" in doc:
            candidates.append((role.get("RoleName", ""), arn))

    for preferred in ("eks-cluster-role", "amazoneksclusterrole", "amazoneksautoclusterrole"):
        for rname, rarn in candidates:
            if rname.lower() == preferred:
                return rarn
    for rname, rarn in candidates:
        if "cluster" in rname.lower():
            return rarn
    if candidates:
        return candidates[0][1]

    # Auto-provision standard EKS cluster role when none exists
    role_name = "TesserakEKSClusterRole"
    trust_policy = json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "eks.amazonaws.com"},
            "Action": "sts:AssumeRole",
        }],
    })
    created = iam_client.create_role(
        RoleName=role_name,
        AssumeRolePolicyDocument=trust_policy,
        Description="EKS Cluster Service Role managed by Tesserak",
    )
    iam_client.attach_role_policy(
        RoleName=role_name,
        PolicyArn="arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
    )
    return created["Role"]["Arn"]


def _resolve_cluster_subnets(ec2_client, vpc_id: Optional[str], availability_zones: List[str]) -> List[str]:
    env_subnets = [s.strip() for s in os.getenv("SUBNET_IDS", "").split(",") if s.strip()]
    if not vpc_id and env_subnets:
        return env_subnets

    filters = [{"Name": "vpc-id", "Values": [vpc_id]}] if vpc_id else [{"Name": "default-for-az", "Values": ["true"]}]
    all_subnets = ec2_client.describe_subnets(Filters=filters).get("Subnets", [])
    if not all_subnets:
        raise ValueError(f"No subnets found for VPC '{vpc_id or 'default'}'. Choose a VPC with at least 2 subnets in different availability zones.")

    selected: List[str] = []
    seen_az: set[str] = set()
    preferred_azs = set(availability_zones or [])

    if preferred_azs:
        for sub in all_subnets:
            if sub["AvailabilityZone"] in preferred_azs and sub["AvailabilityZone"] not in seen_az:
                selected.append(sub["SubnetId"])
                seen_az.add(sub["AvailabilityZone"])
    for sub in all_subnets:
        if len(seen_az) >= 2 and selected:
            break
        if sub["AvailabilityZone"] not in seen_az:
            selected.append(sub["SubnetId"])
            seen_az.add(sub["AvailabilityZone"])

    if len(selected) < 2:
        for sub in all_subnets:
            if sub["SubnetId"] not in selected:
                selected.append(sub["SubnetId"])
            if len(selected) >= 2:
                break

    if len(seen_az) < 2:
        raise ValueError("AWS EKS requires subnets in at least 2 distinct Availability Zones.")
    return selected


def _create_eks_cluster_sync(conn: Any, cluster: ClusterRequest, user_email: str):
    region = cluster.region or conn.region or "us-east-1"
    sess = boto3.Session(
        aws_access_key_id=conn.accessKey,
        aws_secret_access_key=conn.secretKey,
        region_name=region,
    )
    sts_client = sess.client("sts", config=AWS_FAST_CFG)
    eks_client = sess.client("eks", config=AWS_FAST_CFG)
    ec2_client = sess.client("ec2", config=AWS_FAST_CFG)
    iam_client = sess.client("iam", config=AWS_FAST_CFG)

    account_id = cluster.accountId or sts_client.get_caller_identity()["Account"]

    env_cfg = cluster.environment
    k8s_version = (env_cfg.kubernetesVersion if env_cfg else None) or ""
    if not k8s_version:
        supported = _get_eks_supported_versions_sync(conn, region)
        k8s_version = supported.get("latest") or "1.33"

    endpoint_mode = (env_cfg.endpoint if env_cfg else "public-private").lower()
    if endpoint_mode == "public":
        pub_access, priv_access = True, False
    elif endpoint_mode == "private":
        pub_access, priv_access = False, True
    else:
        pub_access, priv_access = True, True

    vpc_id = cluster.vpc.id if cluster.vpc and cluster.vpc.id else None
    azs = env_cfg.availabilityZones if env_cfg else []
    subnet_ids = _resolve_cluster_subnets(ec2_client, vpc_id, azs)
    role_arn = _resolve_eks_role_arn(iam_client, cluster.roleArn)

    tags_dict = {
        t.key.strip(): t.value.strip()
        for t in (cluster.tags or [])
        if t.key and t.key.strip()
    }
    tags_dict.setdefault("ManagedBy", "Tesserak")
    if env_cfg and env_cfg.type:
        tags_dict.setdefault("Environment", env_cfg.type)

    create_payload = cluster.dict()
    create_payload["nodeGroupName"] = cluster.nodeGroupName or f"{cluster.name}-ng"
    initial_state = state_data.create_initial_state(create_payload, user_email)
    state_manager.save_cluster_state(user_email, cluster.name, initial_state)

    response = eks_client.create_cluster(
        name=cluster.name,
        version=k8s_version,
        roleArn=role_arn,
        resourcesVpcConfig={
            "subnetIds": subnet_ids,
            "endpointPublicAccess": pub_access,
            "endpointPrivateAccess": priv_access,
        },
        tags=tags_dict,
    )
    aws_cluster = response["cluster"]
    aws_details = {
        "status": aws_cluster["status"],
        "version": aws_cluster["version"],
        "endpoint": aws_cluster.get("endpoint"),
        "region": region,
        "aws_response": aws_cluster,
    }
    updated_state = state_data.record_state_change(initial_state, "create", aws_details)
    state_manager.save_cluster_state(user_email, cluster.name, updated_state)
    return account_id, region, aws_cluster


async def _finalize_cluster_addons(
    conn: Any,
    region: str,
    cluster_name: str,
    addons: List[AddonModel],
    eks_version: str,
) -> None:
    if not addons:
        return
    try:
        eks_client = boto3.client(
            "eks",
            aws_access_key_id=conn.accessKey,
            aws_secret_access_key=conn.secretKey,
            region_name=region,
            config=AWS_FAST_CFG,
        )
        await asyncio.to_thread(
            lambda: eks_client.get_waiter("cluster_active").wait(
                name=cluster_name,
                WaiterConfig={"Delay": 30, "MaxAttempts": 40},
            )
        )
        for addon in addons:
            if addon.type == "aws":
                await install_aws_addon(eks_client, cluster_name, addon, eks_version)
            else:
                await install_community_addon(cluster_name, addon)
    except Exception as exc:
        logger.warning(f"Background addon installation skipped/failed for {cluster_name}: {exc}")


@app.post("/clusters", response_model=ClusterResponse, dependencies=[Depends(require_auth_if_configured)])
async def create_cluster(cluster: ClusterRequest, x_user_email: str = Header(...)):
    try:
        conn = await connection_manager.get_valid_connection(x_user_email)
        if not conn:
            raise HTTPException(
                status_code=400,
                detail="No valid AWS connection found. Please add AWS credentials in Integrations.",
            )

        account_id, region, aws_cluster = await asyncio.to_thread(
            _create_eks_cluster_sync,
            conn,
            cluster,
            x_user_email,
        )
        invalidate_cluster_list_cache(x_user_email)

        if cluster.addons:
            asyncio.create_task(
                _finalize_cluster_addons(
                    conn,
                    region,
                    cluster.name,
                    cluster.addons,
                    aws_cluster.get("version", "1.33"),
                )
            )

        return ClusterResponse(
            name=aws_cluster["name"],
            status=aws_cluster["status"],
            accountId=account_id,
            region=region,
            version=aws_cluster.get("version", "1.33"),
            endpoint=aws_cluster.get("endpoint"),
            stateStatus="synced",
            createdAt=datetime.utcnow(),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

def _list_clusters_sync(connection: Any, x_user_email: str, account_id: Optional[str] = None) -> List[ClusterResponse]:
    region = connection.region or "us-east-1"
    eks_client = boto3.client(
        "eks",
        aws_access_key_id=connection.accessKey,
        aws_secret_access_key=connection.secretKey,
        region_name=region,
        config=AWS_FAST_CFG,
    )
    if not account_id:
        sts_client = boto3.client(
            "sts",
            aws_access_key_id=connection.accessKey,
            aws_secret_access_key=connection.secretKey,
            region_name=region,
            config=AWS_FAST_CFG,
        )
        account_id = sts_client.get_caller_identity()["Account"]

    response = eks_client.list_clusters()
    local_cluster_names = state_manager.list_user_clusters(x_user_email)
    aws_cluster_names = response.get("clusters", [])
    all_cluster_names = sorted(set(local_cluster_names) | set(aws_cluster_names))
    if not all_cluster_names:
        return []

    current_time = datetime.utcnow()

    def _describe_one(cname: str) -> Optional[ClusterResponse]:
        cstate = state_manager.get_cluster_state(x_user_email, cname)
        if cstate:
            state = dict(cstate.get("state", cstate))
            if "name" not in state:
                state["name"] = cname
        else:
            state = {"name": cname, "_aws_only": True}

        if state.get("deletedAt"):
            deleted_at = datetime.fromisoformat(state["deletedAt"])
            if (current_time - deleted_at).days > 7:
                return None

        local_eks = boto3.client(
            "eks",
            aws_access_key_id=connection.accessKey,
            aws_secret_access_key=connection.secretKey,
            region_name=region,
            config=AWS_FAST_CFG,
        )
        try:
            cluster_info = local_eks.describe_cluster(name=cname)["cluster"]
            aws_state = {
                "status": cluster_info["status"],
                "endpoint": cluster_info.get("endpoint"),
                "version": cluster_info.get("version"),
                "aws_response": cluster_info,
            }
            if state.get("_aws_only"):
                state_status = "missing_local"
            else:
                try:
                    comparison = state_manager.compare_with_aws_state(x_user_email, cname, aws_state)
                    state_status = comparison["status"]
                    if state_status == "in_sync":
                        state_status = "synced"
                except Exception:
                    state_status = "unknown"

            raw_created = state.get("createdAt") or cluster_info.get("createdAt") or datetime.utcnow()
            if isinstance(raw_created, str):
                created_at_val = datetime.fromisoformat(raw_created.replace("Z", "+00:00"))
            else:
                created_at_val = raw_created

            return ClusterResponse(
                name=cluster_info["name"],
                status=cluster_info["status"],
                accountId=account_id,
                region=cluster_info["arn"].split(":")[3],
                version=cluster_info["version"],
                endpoint=cluster_info.get("endpoint"),
                stateStatus=state_status,
                createdAt=created_at_val,
                deletedAt=state.get("deletedAt"),
                deletedBy=state.get("deletedBy"),
            )
        except local_eks.exceptions.ResourceNotFoundException:
            if not state.get("deletedAt"):
                state["deletedAt"] = current_time.isoformat()
                state["deletedBy"] = "aws-console"
                state_manager.save_cluster_state(x_user_email, cname, state)
            return ClusterResponse(
                name=cname,
                status="NOT_AVAILABLE",
                accountId=account_id,
                region=state.get("region", "unknown"),
                version=state.get("version", "unknown"),
                endpoint=None,
                stateStatus="deleted",
                createdAt=datetime.fromisoformat(state["createdAt"]) if state.get("createdAt") else datetime.utcnow(),
                deletedAt=datetime.fromisoformat(state["deletedAt"]) if state.get("deletedAt") else None,
                deletedBy=state.get("deletedBy"),
            )

    results: List[ClusterResponse] = []
    with ThreadPoolExecutor(max_workers=min(6, len(all_cluster_names))) as pool:
        for item in pool.map(_describe_one, all_cluster_names):
            if item is not None:
                results.append(item)
    return results


@app.get("/clusters", response_model=List[ClusterResponse], dependencies=[Depends(require_auth_if_configured)])
async def list_clusters(refresh: bool = False, x_user_email: str = Header(...)):
    try:
        cache_key = x_user_email.strip().lower()
        if not refresh:
            cached = _CLUSTER_LIST_CACHE.get(cache_key)
            if cached and cached[0] > time.monotonic():
                return cached[1]

        connection = await connection_manager.get_valid_connection(x_user_email)
        if not connection:
            raise HTTPException(
                status_code=400,
                detail="No valid AWS connection found. Please add AWS credentials in the Connectors section.",
            )

        _, _, account_id = await connection_manager.test_connection(connection, use_cache=True)
        clusters = await asyncio.to_thread(_list_clusters_sync, connection, x_user_email, account_id)
        _CLUSTER_LIST_CACHE[cache_key] = (time.monotonic() + 20.0, clusters)
        return clusters
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def _get_cluster_details_sync(connection: Any, x_user_email: str, cluster_name: str, account_id: Optional[str] = None) -> Dict[str, Any]:
    region = connection.region or "us-east-1"
    sess = boto3.Session(
        aws_access_key_id=connection.accessKey,
        aws_secret_access_key=connection.secretKey,
        region_name=region,
    )
    eks = sess.client("eks", config=AWS_FAST_CFG)
    ec2 = sess.client("ec2", config=AWS_FAST_CFG)

    if not account_id:
        account_id = sess.client("sts", config=AWS_FAST_CFG).get_caller_identity()["Account"]

    local_wrapper = state_manager.get_cluster_state(x_user_email, cluster_name)
    local_state = dict(local_wrapper.get("state", local_wrapper)) if local_wrapper else None

    try:
        cluster_info = eks.describe_cluster(name=cluster_name)["cluster"]
    except eks.exceptions.ResourceNotFoundException:
        if not local_state:
            raise HTTPException(status_code=404, detail=f"Cluster '{cluster_name}' not found in AWS or local state")
        return json.loads(
            json.dumps(
                {
                    "name": cluster_name,
                    "accountId": account_id,
                    "region": local_state.get("region", region),
                    "status": "NOT_AVAILABLE",
                    "stateStatus": "deleted",
                    "awsMissing": True,
                    "cluster": None,
                    "networking": {},
                    "nodegroups": [],
                    "fargateProfiles": [],
                    "addons": [],
                    "updateHistory": [],
                    "localState": {
                        "lastUpdated": local_wrapper.get("last_updated") if local_wrapper else None,
                        "history": local_state.get("history", []),
                        "desiredState": local_state.get("desiredState"),
                        "differences": [],
                    },
                    "tags": {},
                },
                default=str,
            )
        )

    aws_region = cluster_info["arn"].split(":")[3]
    vpc_cfg = cluster_info.get("resourcesVpcConfig", {})
    vpc_id = vpc_cfg.get("vpcId")
    subnet_ids = vpc_cfg.get("subnetIds") or []
    sg_ids = list({*(vpc_cfg.get("securityGroupIds") or []), *([vpc_cfg["clusterSecurityGroupId"]] if vpc_cfg.get("clusterSecurityGroupId") else [])})

    def _fetch_nodegroups():
        ng_names = eks.list_nodegroups(clusterName=cluster_name).get("nodegroups", [])
        if not ng_names:
            return []
        local_eks = boto3.client("eks", aws_access_key_id=connection.accessKey, aws_secret_access_key=connection.secretKey, region_name=region, config=AWS_FAST_CFG)
        return [local_eks.describe_nodegroup(clusterName=cluster_name, nodegroupName=n)["nodegroup"] for n in ng_names[:20]]

    def _fetch_addons():
        addon_names = eks.list_addons(clusterName=cluster_name).get("addons", [])
        if not addon_names:
            return []
        local_eks = boto3.client("eks", aws_access_key_id=connection.accessKey, aws_secret_access_key=connection.secretKey, region_name=region, config=AWS_FAST_CFG)
        return [local_eks.describe_addon(clusterName=cluster_name, addonName=a)["addon"] for a in addon_names[:25]]

    def _fetch_fargate():
        fp_names = eks.list_fargate_profiles(clusterName=cluster_name).get("fargateProfileNames", [])
        if not fp_names:
            return []
        local_eks = boto3.client("eks", aws_access_key_id=connection.accessKey, aws_secret_access_key=connection.secretKey, region_name=region, config=AWS_FAST_CFG)
        return [local_eks.describe_fargate_profile(clusterName=cluster_name, fargateProfileName=f)["fargateProfile"] for f in fp_names[:10]]

    def _fetch_updates():
        upd_ids = eks.list_updates(name=cluster_name).get("updateIds", [])
        if not upd_ids:
            return []
        local_eks = boto3.client("eks", aws_access_key_id=connection.accessKey, aws_secret_access_key=connection.secretKey, region_name=region, config=AWS_FAST_CFG)
        updates = [local_eks.describe_update(name=cluster_name, updateId=uid)["update"] for uid in upd_ids[:15]]
        updates.sort(key=lambda u: str(u.get("createdAt", "")), reverse=True)
        return updates

    def _fetch_networking():
        vpc_details = {}
        subnets_details = []
        sgs_details = []
        if vpc_id:
            try:
                vpcs = ec2.describe_vpcs(VpcIds=[vpc_id]).get("Vpcs", [])
                if vpcs:
                    v = vpcs[0]
                    vname = next((t["Value"] for t in v.get("Tags", []) if t["Key"] == "Name"), "")
                    vpc_details = {
                        "vpcId": vpc_id,
                        "name": vname or vpc_id,
                        "cidrBlock": v.get("CidrBlock"),
                        "isDefault": v.get("IsDefault", False),
                    }
            except Exception:
                vpc_details = {"vpcId": vpc_id}
        if subnet_ids:
            try:
                for sub in ec2.describe_subnets(SubnetIds=subnet_ids).get("Subnets", []):
                    sname = next((t["Value"] for t in sub.get("Tags", []) if t["Key"] == "Name"), "")
                    subnets_details.append({
                        "subnetId": sub["SubnetId"],
                        "name": sname or sub["SubnetId"],
                        "cidrBlock": sub.get("CidrBlock"),
                        "availabilityZone": sub.get("AvailabilityZone"),
                        "mapPublicIpOnLaunch": sub.get("MapPublicIpOnLaunch", False),
                        "availableIpAddressCount": sub.get("AvailableIpAddressCount"),
                    })
            except Exception:
                subnets_details = [{"subnetId": s} for s in subnet_ids]
        if sg_ids:
            try:
                for sg in ec2.describe_security_groups(GroupIds=sg_ids).get("SecurityGroups", []):
                    sgs_details.append({
                        "groupId": sg["GroupId"],
                        "groupName": sg.get("GroupName", ""),
                        "description": sg.get("Description", ""),
                        "isClusterSecurityGroup": sg["GroupId"] == vpc_cfg.get("clusterSecurityGroupId"),
                    })
            except Exception:
                sgs_details = [{"groupId": g, "isClusterSecurityGroup": g == vpc_cfg.get("clusterSecurityGroupId")} for g in sg_ids]

        return {
            "vpc": vpc_details,
            "subnets": subnets_details,
            "securityGroups": sgs_details,
            "clusterSecurityGroupId": vpc_cfg.get("clusterSecurityGroupId"),
            "endpointPublicAccess": vpc_cfg.get("endpointPublicAccess"),
            "endpointPrivateAccess": vpc_cfg.get("endpointPrivateAccess"),
            "publicAccessCidrs": vpc_cfg.get("publicAccessCidrs", []),
            "kubernetesNetworkConfig": cluster_info.get("kubernetesNetworkConfig", {}),
        }

    with ThreadPoolExecutor(max_workers=5) as pool:
        f_ng = pool.submit(_fetch_nodegroups)
        f_ad = pool.submit(_fetch_addons)
        f_fg = pool.submit(_fetch_fargate)
        f_up = pool.submit(_fetch_updates)
        f_net = pool.submit(_fetch_networking)

        nodegroups = f_ng.result()
        addons = f_ad.result()
        fargate_profiles = f_fg.result()
        updates = f_up.result()
        networking = f_net.result()

    aws_state = {
        "status": cluster_info["status"],
        "endpoint": cluster_info.get("endpoint"),
        "version": cluster_info.get("version"),
        "nodeGroups": nodegroups,
    }
    if not local_state:
        state_status = "missing_local"
        differences = ["missing_local_state"]
    else:
        comparison = state_manager.compare_with_aws_state(x_user_email, cluster_name, aws_state)
        state_status = "synced" if comparison.get("status") == "in_sync" else comparison.get("status", "unknown")
        differences = comparison.get("differences", [])

    payload = {
        "name": cluster_info["name"],
        "accountId": account_id,
        "region": aws_region,
        "status": cluster_info["status"],
        "stateStatus": state_status,
        "awsMissing": False,
        "cluster": {
            "name": cluster_info["name"],
            "arn": cluster_info.get("arn"),
            "createdAt": cluster_info.get("createdAt"),
            "version": cluster_info.get("version"),
            "platformVersion": cluster_info.get("platformVersion"),
            "endpoint": cluster_info.get("endpoint"),
            "roleArn": cluster_info.get("roleArn"),
            "status": cluster_info.get("status"),
            "certificateAuthority": cluster_info.get("certificateAuthority", {}).get("data"),
            "oidcIssuer": cluster_info.get("identity", {}).get("oidc", {}).get("issuer"),
            "logging": cluster_info.get("logging", {}).get("clusterLogging", []),
            "encryptionConfig": cluster_info.get("encryptionConfig", []),
            "accessConfig": cluster_info.get("accessConfig", {}),
            "upgradePolicy": cluster_info.get("upgradePolicy", {}),
            "health": cluster_info.get("health", {}),
        },
        "networking": networking,
        "nodegroups": nodegroups,
        "fargateProfiles": fargate_profiles,
        "addons": addons,
        "updateHistory": updates,
        "localState": {
            "lastUpdated": local_wrapper.get("last_updated") if local_wrapper else None,
            "history": local_state.get("history", []) if local_state else [],
            "desiredState": local_state.get("desiredState") if local_state else None,
            "differences": differences,
        },
        "tags": cluster_info.get("tags", {}),
    }
    return json.loads(json.dumps(payload, default=str))


@app.get("/clusters/{cluster_name}", dependencies=[Depends(require_auth_if_configured)])
async def get_cluster_details(cluster_name: str, x_user_email: str = Header(...)):
    try:
        connection = await connection_manager.get_valid_connection(x_user_email)
        if not connection:
            raise HTTPException(
                status_code=400,
                detail="No valid AWS connection found. Please add AWS credentials in Integrations.",
            )
        _, _, account_id = await connection_manager.test_connection(connection, use_cache=True)
        return await asyncio.to_thread(
            _get_cluster_details_sync,
            connection,
            x_user_email,
            cluster_name,
            account_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/clusters/{cluster_name}", dependencies=[Depends(require_auth_if_configured)])
async def delete_cluster(cluster_name: str, x_user_email: str = Header(...)):
    try:
        # Get AWS client with user's credentials
        eks_client = await connection_manager.get_aws_client(x_user_email)
        if not eks_client:
            raise HTTPException(
                status_code=400,
                detail="No valid AWS connection found. Please add AWS credentials in the Connectors section."
            )

        # Get current state before deletion
        current_state = state_manager.get_cluster_state(x_user_email, cluster_name)
        updated_state = None
        if current_state:
            updated_state = state_data.record_state_change(
                current_state,
                "delete_initiated",
                {"timestamp": datetime.utcnow().isoformat()}
            )
            state_manager.save_cluster_state(x_user_email, cluster_name, updated_state)
        
        # Delete from AWS
        await asyncio.to_thread(eks_client.delete_cluster, name=cluster_name)
        invalidate_cluster_list_cache(x_user_email)
        
        if current_state and updated_state:
            final_state = state_data.record_state_change(
                updated_state,
                "deleted",
                {"timestamp": datetime.utcnow().isoformat(), "status": "DELETING"}
            )
            state_manager.save_cluster_state(x_user_email, cluster_name, final_state)
        
        return {"message": f"Cluster {cluster_name} deletion initiated"}
    except Exception as e:
        if 'current_state' in locals() and current_state and 'updated_state' in locals() and updated_state:
            failed_state = state_data.record_state_change(
                updated_state,
                "delete_failed",
                {"error": str(e)}
            )
            state_manager.save_cluster_state(x_user_email, cluster_name, failed_state)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/clusters/{cluster_name}/sync", dependencies=[Depends(require_auth_if_configured)])
async def sync_cluster_state(cluster_name: str, x_user_email: str = Header(...)):
    try:
        eks_client = await connection_manager.get_aws_client(x_user_email)
        if not eks_client:
            raise HTTPException(
                status_code=400,
                detail="No valid AWS connection found. Please add AWS credentials in the Connectors section."
            )

        cluster_info = await asyncio.to_thread(lambda: eks_client.describe_cluster(name=cluster_name)['cluster'])
        aws_state = json.loads(
            json.dumps(
                {
                    "status": cluster_info['status'],
                    "endpoint": cluster_info.get('endpoint'),
                    "version": cluster_info.get('version'),
                    "aws_response": cluster_info,
                },
                default=str,
            )
        )
        
        current_state = state_manager.get_cluster_state(x_user_email, cluster_name)
        if current_state:
            updated_state = state_data.record_state_change(
                current_state,
                "sync",
                {"aws_state": aws_state}
            )
        else:
            updated_state = state_data.record_state_change(
                {"name": cluster_name, "region": cluster_info["arn"].split(":")[3]},
                "initial_sync",
                {"aws_state": aws_state}
            )
        
        state_manager.save_cluster_state(x_user_email, cluster_name, updated_state)
        invalidate_cluster_list_cache(x_user_email)
        
        return {"message": "State synchronized successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/connections/test", dependencies=[Depends(require_auth_if_configured)])
async def test_connection(connection: ConnectionBase):
    try:
        is_valid, message, account_id = await connection_manager.test_connection(connection)
        if is_valid:
            return {"status": "success", "message": message, "accountId": account_id}
        raise HTTPException(status_code=400, detail=message)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/connections", response_model=Connection, dependencies=[Depends(require_auth_if_configured)])
async def create_connection(connection: ConnectionBase, x_user_email: str = Header(...)):
    try:
        created = await connection_manager.create_connection(connection, x_user_email)
        from resources_service import invalidate_resource_cache
        invalidate_resource_cache(x_user_email)
        invalidate_cluster_list_cache(x_user_email)
        return created
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/connections", response_model=List[Connection], dependencies=[Depends(require_auth_if_configured)])
async def list_connections(x_user_email: str = Header(...)):
    try:
        return await connection_manager.list_connections(x_user_email)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/connections/{connection_id}", dependencies=[Depends(require_auth_if_configured)])
async def delete_connection(connection_id: str):
    try:
        if await connection_manager.delete_connection(connection_id):
            from resources_service import invalidate_resource_cache
            invalidate_resource_cache()
            invalidate_cluster_list_cache()
            return {"status": "success"}
        raise HTTPException(status_code=404, detail="Connection not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/connections/status", response_model=List[Dict], dependencies=[Depends(require_auth_if_configured)])
async def check_connections_status(x_user_email: str = Header(...)):
    try:
        connections = await connection_manager.list_connections(x_user_email)
        if not connections:
            return []

        results = await asyncio.gather(
            *(connection_manager.test_connection(conn, use_cache=True) for conn in connections)
        )
        return [
            {
                "id": conn.id,
                "name": conn.accountName,
                "accountName": conn.accountName,
                "region": conn.region,
                "status": "connected" if is_valid else "disconnected",
                "message": message,
                "accountId": account_id if is_valid else None,
            }
            for conn, (is_valid, message, account_id) in zip(connections, results)
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/aws/regions/{account_id}", dependencies=[Depends(require_auth_if_configured)])
async def get_aws_regions(account_id: str, x_user_email: str = Header(...)):
    try:
        cache_key = f"regions:{account_id}"
        cached = _EKS_META_CACHE.get(cache_key)
        if cached and cached[0] > time.monotonic():
            return cached[1]

        connection = await connection_manager.get_valid_connection(x_user_email)
        if not connection:
            raise HTTPException(status_code=400, detail="No active connection found")

        def _fetch_regions_sync():
            client = boto3.client(
                'ec2',
                aws_access_key_id=connection.accessKey,
                aws_secret_access_key=connection.secretKey,
                region_name='us-east-1',
                config=AWS_FAST_CFG,
            )
            return [r['RegionName'] for r in client.describe_regions()['Regions']]

        regions = await asyncio.to_thread(_fetch_regions_sync)
        _EKS_META_CACHE[cache_key] = (time.monotonic() + 300.0, regions)
        return regions
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/aws/vpcs/{account_id}/{region}", dependencies=[Depends(require_auth_if_configured)])
async def get_aws_vpcs(account_id: str, region: str, x_user_email: str = Header(...)):
    try:
        cache_key = f"vpcs:{account_id}:{region}"
        cached = _EKS_META_CACHE.get(cache_key)
        if cached and cached[0] > time.monotonic():
            return cached[1]

        connection = await connection_manager.get_valid_connection(x_user_email)
        if not connection:
            raise HTTPException(status_code=400, detail="No active connection found")

        def _fetch_vpcs_sync():
            client = boto3.client(
                'ec2',
                aws_access_key_id=connection.accessKey,
                aws_secret_access_key=connection.secretKey,
                region_name=region,
                config=AWS_FAST_CFG,
            )
            vpcs = []
            for vpc in client.describe_vpcs().get('Vpcs', []):
                name = ''
                for tag in vpc.get('Tags', []):
                    if tag.get('Key') == 'Name':
                        name = tag.get('Value', '')
                        break
                vpcs.append({
                    'id': vpc['VpcId'],
                    'cidr': vpc['CidrBlock'],
                    'name': name or vpc['VpcId'],
                    'isDefault': vpc.get('IsDefault', False),
                })
            return vpcs

        vpcs = await asyncio.to_thread(_fetch_vpcs_sync)
        _EKS_META_CACHE[cache_key] = (time.monotonic() + 30.0, vpcs)
        return vpcs
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/aws/zones/{account_id}/{region}", dependencies=[Depends(require_auth_if_configured)])
async def get_aws_availability_zones(account_id: str, region: str, x_user_email: str = Header(...)):
    try:
        cache_key = f"zones:{account_id}:{region}"
        cached = _EKS_META_CACHE.get(cache_key)
        if cached and cached[0] > time.monotonic():
            return cached[1]

        connection = await connection_manager.get_valid_connection(x_user_email)
        if not connection:
            raise HTTPException(status_code=400, detail="No active connection found")

        def _fetch_zones_sync():
            client = boto3.client(
                'ec2',
                aws_access_key_id=connection.accessKey,
                aws_secret_access_key=connection.secretKey,
                region_name=region,
                config=AWS_FAST_CFG,
            )
            response = client.describe_availability_zones(
                Filters=[
                    {'Name': 'region-name', 'Values': [region]},
                    {'Name': 'state', 'Values': ['available']},
                ]
            )
            return [
                {
                    'id': zone['ZoneId'],
                    'name': zone['ZoneName'],
                    'state': zone['State'],
                    'region': zone['RegionName'],
                }
                for zone in response.get('AvailabilityZones', [])
            ]

        zones = await asyncio.to_thread(_fetch_zones_sync)
        _EKS_META_CACHE[cache_key] = (time.monotonic() + 300.0, zones)
        return zones
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

from tesserak_router import public_router as tesserak_public_router, router as tesserak_router
app.include_router(tesserak_public_router)
app.include_router(tesserak_router)
