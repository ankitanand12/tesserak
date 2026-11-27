from fastapi import Depends, FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional, Dict, Any, Tuple
from pydantic import BaseModel
import asyncio
import boto3
from botocore.config import Config
from concurrent.futures import ThreadPoolExecutor
import ipaddress
import json
import os
import logging
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from dotenv import load_dotenv
from auth import require_auth_if_configured
from state_manager import StateManager
from state_management import StateData
from connections import ConnectionManager, Connection, ConnectionBase
from db import AwsCatalogCacheRecord, get_db
from pipelines_service import (
    _cli_env as _pip_cli_env,
    build_eks_cli_env,
    build_eks_kubeconfig_yaml,
)
from datetime import datetime, timedelta, timezone

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
    "ingress-nginx": {
        "repo": "kubernetes/ingress-nginx",
        "helm_repo_name": "ingress-nginx",
        "helm_repo_url": "https://kubernetes.github.io/ingress-nginx",
        "chart": "ingress-nginx",
        "release": "ingress-nginx",
        "namespace": "ingress-nginx",
        "fallback": ["4.12.1", "4.11.5", "4.11.3", "4.10.6"],
    },
    "external-dns": {
        "repo": "kubernetes-sigs/external-dns",
        "helm_repo_name": "external-dns",
        "helm_repo_url": "https://kubernetes-sigs.github.io/external-dns",
        "chart": "external-dns",
        "release": "external-dns",
        "namespace": "external-dns",
        "fallback": ["0.20.0", "0.19.0", "0.18.0", "0.17.0", "0.16.0"],
    },
    "cert-manager": {
        "repo": "cert-manager/cert-manager",
        "helm_repo_name": "jetstack",
        "helm_repo_url": "https://charts.jetstack.io",
        "chart": "cert-manager",
        "release": "cert-manager",
        "namespace": "cert-manager",
        "set_args": ["crds.enabled=true"],
        "fallback": ["1.19.1", "1.18.2", "1.17.2", "1.16.3", "1.15.3"],
    },
    "metrics-server": {
        "repo": "kubernetes-sigs/metrics-server",
        "helm_repo_name": "metrics-server",
        "helm_repo_url": "https://kubernetes-sigs.github.io/metrics-server",
        "chart": "metrics-server",
        "release": "metrics-server",
        "namespace": "kube-system",
        "fallback": ["3.12.2", "3.12.1", "3.12.0"],
    },
    "argo-cd": {
        "repo": "argoproj/argo-cd",
        "helm_repo_name": "argo",
        "helm_repo_url": "https://argoproj.github.io/argo-helm",
        "chart": "argo-cd",
        "release": "argo-cd",
        "namespace": "argocd",
        "fallback": ["7.8.23", "7.8.13", "7.7.16"],
    },
    "argo-workflow": {
        "repo": "argoproj/argo-workflows",
        "helm_repo_name": "argo",
        "helm_repo_url": "https://argoproj.github.io/argo-helm",
        "chart": "argo-workflows",
        "release": "argo-workflows",
        "namespace": "argo",
        "fallback": ["0.45.10", "0.45.4", "0.42.10"],
    },
    "reloader": {
        "repo": "stakater/Reloader",
        "helm_repo_name": "stakater",
        "helm_repo_url": "https://stakater.github.io/stakater-charts",
        "chart": "reloader",
        "release": "reloader",
        "namespace": "reloader",
        "fallback": ["2.2.21", "1.4.1", "1.3.0", "1.2.1"],
    },
    "cluster-proportional-autoscaler": {
        "repo": "kubernetes-sigs/cluster-proportional-autoscaler",
        "helm_repo_name": "cpa",
        "helm_repo_url": "https://kubernetes-sigs.github.io/cluster-proportional-autoscaler",
        "chart": "cluster-proportional-autoscaler",
        "release": "cluster-proportional-autoscaler",
        "namespace": "kube-system",
        "fallback": ["1.9.0", "1.8.8", "1.8.6"],
    },
    "cluster-autoscaler": {
        "repo": "kubernetes/autoscaler",
        "helm_repo_name": "autoscaler",
        "helm_repo_url": "https://kubernetes.github.io/autoscaler",
        "chart": "cluster-autoscaler",
        "release": "cluster-autoscaler",
        "namespace": "kube-system",
        "needs_cluster_region": True,
        "fallback": ["9.60.1", "9.46.6", "9.43.2"],
    },
    "karpenter": {
        "repo": "aws/karpenter-provider-aws",
        "oci_chart": "oci://public.ecr.aws/karpenter/karpenter",
        "chart": "karpenter",
        "release": "karpenter",
        "namespace": "karpenter",
        "needs_cluster_name": True,
        "fallback": ["1.3.3", "1.2.4", "1.1.5", "1.0.9"],
    },
    "aws-load-balancer-controller": {
        "repo": "kubernetes-sigs/aws-load-balancer-controller",
        "helm_repo_name": "eks",
        "helm_repo_url": "https://aws.github.io/eks-charts",
        "chart": "aws-load-balancer-controller",
        "release": "aws-load-balancer-controller",
        "namespace": "kube-system",
        "needs_cluster_name": True,
        "fallback": ["1.12.0", "1.11.0", "1.10.1"],
    },
    "grafana-stack": {
        "repo": "prometheus-community/helm-charts",
        "helm_repo_name": "prometheus-community",
        "helm_repo_url": "https://prometheus-community.github.io/helm-charts",
        "chart": "kube-prometheus-stack",
        "release": "grafana-stack",
        "namespace": "monitoring",
        "fallback": ["70.4.2", "69.8.2", "68.4.4"],
    },
    "ops-agent": {
        "repo": None,
        "fallback": ["1.4.2", "1.3.0", "1.2.0"],
    },
    "debug-agent": {
        "repo": None,
        "fallback": ["1.2.0", "1.1.0", "1.0.0"],
    },
}

_ALLOWED_EKS_AMI_TYPES = {
    "amazon-linux-2023/x86_64/standard": "Standard x86_64",
    "amazon-linux-2023/arm64/standard": "Standard ARM64 (Graviton)",
    "amazon-linux-2023/x86_64/nvidia": "NVIDIA GPU (x86_64)",
    "amazon-linux-2023/arm64/nvidia": "NVIDIA GPU (ARM64)",
    "amazon-linux-2023/x86_64/neuron": "AWS Neuron / Inferentia / Trainium (x86_64)",
}

_SSM_AMI_TO_EKS_ENUM = {
    "amazon-linux-2023/x86_64/standard": "AL2023_x86_64_STANDARD",
    "amazon-linux-2023/arm64/standard": "AL2023_ARM_64_STANDARD",
    "amazon-linux-2023/x86_64/nvidia": "AL2023_x86_64_NVIDIA",
    "amazon-linux-2023/arm64/nvidia": "AL2023_ARM_64_NVIDIA",
    "amazon-linux-2023/x86_64/neuron": "AL2023_x86_64_NEURON",
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
                        std_end = cv.get("endOfStandardSupportDate")
                        ext_end = cv.get("endOfExtendedSupportDate")
                        items.append(
                            {
                                "version": ver,
                                "status": status or "STANDARD_SUPPORT",
                                "awsDefault": bool(cv.get("defaultVersion", False)),
                                "endOfStandardSupport": std_end.isoformat() if hasattr(std_end, "isoformat") else std_end,
                                "endOfExtendedSupport": ext_end.isoformat() if hasattr(ext_end, "isoformat") else ext_end,
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


async def _resolve_account_connection(user_email: str, account_id: Optional[str] = None) -> Any:
    """Resolve connector strictly scoped to `account_id` when supplied, raising HTTP 400 on miss."""
    conn = await connection_manager.get_connection_for_account(user_email, account_id)
    if not conn:
        detail = (
            f"No valid AWS IAM connector found matching AWS account {account_id}."
            if account_id
            else "No valid AWS connection found. Please add AWS credentials in Integrations."
        )
        raise HTTPException(status_code=400, detail=detail)
    return conn


@app.get("/api/aws/eks-versions", dependencies=[Depends(require_auth_if_configured)])
async def get_eks_versions(
    region: Optional[str] = None,
    account_id: Optional[str] = None,
    x_user_email: str = Header(...),
):
    conn = await connection_manager.get_catalog_connection(x_user_email, account_id)
    if not conn:
        raise HTTPException(status_code=400, detail="No valid AWS connection or platform catalog credentials found")
    try:
        result = await asyncio.to_thread(_get_eks_supported_versions_sync, conn, region)
        target_region = region or conn.region or "us-east-1"
        asyncio.create_task(_warm_ec2_instance_catalog(conn, target_region))
        return result
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
        'eks-pod-identity-agent': {'name': 'eks-pod-identity-agent', 'default': 'v1.0.0-eksbuild.1'},
        'snapshot-controller': {'name': 'snapshot-controller', 'default': 'v8.1.1-eksbuild.1'},
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
    account_id: Optional[str] = None,
    x_user_email: str = Header(...),
) -> Dict[str, List[Dict[str, Any]]]:
    """Get available versions for AWS & Community EKS addons in parallel."""
    try:
        conn = await connection_manager.get_catalog_connection(x_user_email, account_id)
        if not conn:
            raise HTTPException(status_code=400, detail="No active AWS connection or catalog credentials found")
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

def _resolve_helm_binary() -> Optional[str]:
    found = shutil.which("helm")
    if found:
        return found
    for candidate in ("/opt/homebrew/bin/helm", "/usr/local/bin/helm"):
        if Path(candidate).exists():
            return candidate
    return None


def _isolated_helm_env(conn: Any, kc_path: Path, region: str, base_dir: Path) -> Dict[str, str]:
    docker_dir = base_dir / "docker"
    cache_dir = base_dir / "helm_cache"
    cfg_dir = base_dir / "helm_config"
    data_dir = base_dir / "helm_data"
    for d in (docker_dir, cache_dir, cfg_dir, data_dir):
        d.mkdir(parents=True, exist_ok=True)
    docker_cfg = docker_dir / "config.json"
    if not docker_cfg.exists():
        docker_cfg.write_text("{}")
    return _pip_cli_env({
        **build_eks_cli_env(conn, kc_path, region),
        "DOCKER_CONFIG": str(docker_dir),
        "HELM_CACHE_HOME": str(cache_dir),
        "HELM_CONFIG_HOME": str(cfg_dir),
        "HELM_DATA_HOME": str(data_dir),
    })


def _install_community_addon_sync(
    conn: Any,
    region: str,
    cluster_name: str,
    addon: AddonModel,
    cluster_info: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Install or upgrade a Kubernetes community add-on via Helm CLI."""
    cfg = _COMMUNITY_ADDON_REPOS.get(addon.id)
    if not cfg or (not cfg.get("helm_repo_url") and not cfg.get("oci_chart")):
        return {
            "id": addon.id,
            "name": addon.name or addon.id,
            "status": "unsupported",
            "version": addon.version,
            "details": f'"{addon.id}" does not have an official Helm chart repository mapping.',
        }

    helm_bin = _resolve_helm_binary()
    if not helm_bin:
        return {
            "id": addon.id,
            "name": addon.name or cfg.get("release", addon.id),
            "status": "failed",
            "version": addon.version,
            "details": "Helm CLI is not installed on the backend host.",
        }

    if not cluster_info:
        eks_client = boto3.client(
            "eks",
            aws_access_key_id=conn.accessKey,
            aws_secret_access_key=conn.secretKey,
            region_name=region,
            config=AWS_FAST_CFG,
        )
        cluster_info = eks_client.describe_cluster(name=cluster_name).get("cluster", {})

    endpoint = cluster_info.get("endpoint")
    ca_data = (cluster_info.get("certificateAuthority") or {}).get("data")
    if not endpoint or not ca_data:
        return {
            "id": addon.id,
            "name": addon.name or addon.id,
            "status": "failed",
            "version": addon.version,
            "details": f"Cluster '{cluster_name}' API endpoint is not ready yet.",
        }

    release = cfg.get("release") or addon.id
    namespace = cfg.get("namespace") or "kube-system"
    chart = cfg.get("chart") or addon.id
    tmpdir = tempfile.mkdtemp(prefix="tesserak_helm_")
    try:
        tmp_path = Path(tmpdir)
        kc_path = tmp_path / "kubeconfig"
        kc_path.write_text(build_eks_kubeconfig_yaml(cluster_name, endpoint, ca_data, region))
        env = _isolated_helm_env(conn, kc_path, region, tmp_path)

        if cfg.get("oci_chart"):
            chart_ref = str(cfg["oci_chart"])
        else:
            repo_name = str(cfg["helm_repo_name"])
            repo_url = str(cfg["helm_repo_url"])
            add_proc = subprocess.run(
                [helm_bin, "repo", "add", repo_name, repo_url, "--force-update"],
                capture_output=True,
                text=True,
                timeout=30,
                env=env,
                check=False,
            )
            if add_proc.returncode != 0:
                return {
                    "id": addon.id,
                    "name": addon.name or release,
                    "namespace": namespace,
                    "status": "failed",
                    "version": addon.version,
                    "details": (add_proc.stderr or add_proc.stdout or "helm repo add failed").strip(),
                }
            subprocess.run(
                [helm_bin, "repo", "update", repo_name],
                capture_output=True,
                text=True,
                timeout=45,
                env=env,
                check=False,
            )
            chart_ref = f"{repo_name}/{chart}"

        base_cmd = [
            helm_bin,
            "upgrade",
            "--install",
            release,
            chart_ref,
            "--kubeconfig",
            str(kc_path),
            "--namespace",
            namespace,
            "--create-namespace",
            "--timeout",
            "5m",
        ]
        for s_arg in cfg.get("set_args", []):
            base_cmd.extend(["--set", s_arg])
        if cfg.get("needs_cluster_name"):
            flag = "settings.clusterName" if addon.id == "karpenter" else "clusterName"
            base_cmd.extend(["--set", f"{flag}={cluster_name}"])
        if cfg.get("needs_cluster_region"):
            base_cmd.extend([
                "--set", f"autoDiscovery.clusterName={cluster_name}",
                "--set", f"awsRegion={region}",
            ])

        req_ver = (addon.version or "").strip().lstrip("v")
        cmd = list(base_cmd) + (["--version", req_ver] if req_ver else [])
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180, env=env, check=False)

        # Retry without pinned --version if GitHub release app tag didn't match Helm chart semver
        if proc.returncode != 0 and req_ver:
            err_l = (proc.stderr or proc.stdout or "").lower()
            if "not found" in err_l or "chart" in err_l:
                proc = subprocess.run(base_cmd, capture_output=True, text=True, timeout=180, env=env, check=False)

        if proc.returncode != 0:
            err_msg = (proc.stderr or proc.stdout or "Helm install failed").strip().splitlines()
            return {
                "id": addon.id,
                "name": addon.name or release,
                "releaseName": release,
                "namespace": namespace,
                "chart": chart,
                "status": "failed",
                "version": addon.version,
                "details": err_msg[-1] if err_msg else "Helm install failed",
            }

        return {
            "id": addon.id,
            "name": addon.name or release,
            "releaseName": release,
            "namespace": namespace,
            "chart": chart,
            "status": "installed",
            "version": addon.version or "latest",
            "details": (proc.stdout or "Helm release installed").strip().splitlines()[0] if proc.stdout else "Installed",
        }
    except subprocess.TimeoutExpired:
        return {
            "id": addon.id,
            "name": addon.name or release,
            "namespace": namespace,
            "status": "failed",
            "version": addon.version,
            "details": f"Timed out installing {release} via Helm.",
        }
    except Exception as exc:
        return {
            "id": addon.id,
            "name": addon.name or release,
            "namespace": namespace,
            "status": "failed",
            "version": addon.version,
            "details": str(exc),
        }
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


async def install_community_addon(
    conn: Any,
    region: str,
    cluster_name: str,
    addon: AddonModel,
    cluster_info: Optional[Dict[str, Any]] = None,
) -> dict:
    """Install a community addon using Helm."""
    return await asyncio.to_thread(_install_community_addon_sync, conn, region, cluster_name, addon, cluster_info)

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
    amiType: Optional[str] = "amazon-linux-2023/x86_64/standard"
    amiId: Optional[str] = None
    amiManual: bool = False
    createNodeGroup: bool = True
    capacityType: str = "ON_DEMAND"
    diskSize: int = 20
    publicSubnets: Optional[List[str]] = []
    privateSubnets: Optional[List[str]] = []
    enableClusterLogs: bool = False
    authenticationMode: str = "API_AND_CONFIG_MAP"
    bootstrapClusterAdmin: bool = True
    deletionProtection: bool = False
    ipFamily: str = "ipv4"
    serviceIpv4Cidr: Optional[str] = None
    environment: Optional[EnvironmentConfigModel] = None
    tags: Optional[List[TagModel]] = []
    addons: Optional[List[AddonModel]] = []
    nodeGroupName: Optional[str] = None
    instanceType: str = "t3.medium"
    desiredNodes: int = 2
    minNodes: int = 1
    maxNodes: int = 3
    roleArn: Optional[str] = None


class NodeGroupCreateRequest(BaseModel):
    nodegroupName: str
    amiType: str = "amazon-linux-2023/x86_64/standard"
    amiId: Optional[str] = None
    amiManual: bool = False
    instanceTypes: List[str] = ["t3.medium"]
    capacityType: str = "ON_DEMAND"
    minSize: int = 1
    desiredSize: int = 2
    maxSize: int = 4
    diskSize: int = 20
    subnets: Optional[List[str]] = []
    nodeRoleArn: Optional[str] = None


class NodeGroupScaleRequest(BaseModel):
    minSize: int = 1
    desiredSize: int = 2
    maxSize: int = 4

class CommunityAddonInstallRequest(BaseModel):
    addonId: str
    name: Optional[str] = None
    version: Optional[str] = None


class ClusterResponse(BaseModel):
    name: str
    status: str
    accountId: str
    region: str
    version: str
    endpoint: Optional[str] = None
    stateStatus: str
    stateDifferences: List[str] = []
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
    conn = await _resolve_account_connection(x_user_email, payload.accountId)
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
    explicit_subnets = list(dict.fromkeys([s for s in ([*(cluster.publicSubnets or []), *(cluster.privateSubnets or [])]) if s]))
    subnet_ids = explicit_subnets if len(explicit_subnets) >= 2 else _resolve_cluster_subnets(ec2_client, vpc_id, azs)
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

    auth_mode = (cluster.authenticationMode or "API_AND_CONFIG_MAP").strip().upper()
    if auth_mode not in {"API", "API_AND_CONFIG_MAP", "CONFIG_MAP"}:
        auth_mode = "API_AND_CONFIG_MAP"

    ip_family = (cluster.ipFamily or "ipv4").strip().lower()
    if ip_family not in {"ipv4", "ipv6"}:
        ip_family = "ipv4"

    net_cfg: Dict[str, Any] = {"ipFamily": ip_family}
    if ip_family == "ipv4" and cluster.serviceIpv4Cidr and cluster.serviceIpv4Cidr.strip():
        net_cfg["serviceIpv4Cidr"] = cluster.serviceIpv4Cidr.strip()

    create_kwargs: Dict[str, Any] = {
        "name": cluster.name,
        "version": k8s_version,
        "roleArn": role_arn,
        "resourcesVpcConfig": {
            "subnetIds": subnet_ids,
            "endpointPublicAccess": pub_access,
            "endpointPrivateAccess": priv_access,
        },
        "accessConfig": {
            "bootstrapClusterCreatorAdminPermissions": bool(cluster.bootstrapClusterAdmin),
            "authenticationMode": auth_mode,
        },
        "kubernetesNetworkConfig": net_cfg,
        "deletionProtection": bool(cluster.deletionProtection),
        "tags": tags_dict,
    }
    if cluster.enableClusterLogs:
        create_kwargs["logging"] = {
            "clusterLogging": [
                {
                    "types": ["api", "audit", "authenticator", "controllerManager", "scheduler"],
                    "enabled": True,
                }
            ]
        }

    response = eks_client.create_cluster(**create_kwargs)
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
    nodegroup_req: Optional[NodeGroupCreateRequest] = None,
    user_email: str = "",
) -> None:
    if not addons and not nodegroup_req:
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
        cluster_info = await asyncio.to_thread(
            lambda: eks_client.describe_cluster(name=cluster_name)["cluster"]
        )
        if nodegroup_req:
            try:
                await asyncio.to_thread(
                    _create_nodegroup_sync,
                    conn,
                    cluster_name,
                    nodegroup_req,
                    user_email,
                    region,
                )
                has_community = any(a.type != "aws" for a in addons)
                if has_community:
                    try:
                        await asyncio.to_thread(
                            lambda: eks_client.get_waiter("nodegroup_active").wait(
                                clusterName=cluster_name,
                                nodegroupName=nodegroup_req.nodegroupName,
                                WaiterConfig={"Delay": 20, "MaxAttempts": 30},
                            )
                        )
                    except Exception as wait_exc:
                        logger.warning(f"Nodegroup waiter ended early for {cluster_name}: {wait_exc}")
            except Exception as ng_exc:
                logger.warning(f"Initial nodegroup creation skipped/failed for {cluster_name}: {ng_exc}")

        community_results: List[Dict[str, Any]] = []
        for addon in addons:
            if addon.type == "aws":
                await install_aws_addon(eks_client, cluster_name, addon, eks_version)
            else:
                res = await install_community_addon(conn, region, cluster_name, addon, cluster_info)
                community_results.append(res)

        if user_email:
            try:
                ng_names = await asyncio.to_thread(
                    lambda: eks_client.list_nodegroups(clusterName=cluster_name).get("nodegroups", [])
                )
                live_ngs = await asyncio.to_thread(
                    lambda: [eks_client.describe_nodegroup(clusterName=cluster_name, nodegroupName=n)["nodegroup"] for n in ng_names[:20]]
                )
                curr = state_manager.get_cluster_state(user_email, cluster_name)
                base_state = dict(curr.get("state", curr)) if curr else {"name": cluster_name, "region": region}
                updated = state_data.record_state_change(
                    base_state,
                    "finalize_addons",
                    {
                        "status": cluster_info.get("status", "ACTIVE"),
                        "version": cluster_info.get("version", eks_version),
                        "endpoint": cluster_info.get("endpoint"),
                        "nodeGroups": live_ngs,
                        "communityAddons": community_results,
                    },
                )
                state_manager.save_cluster_state(user_email, cluster_name, updated)
                invalidate_cluster_list_cache(user_email)
            except Exception as sync_exc:
                logger.warning(f"Post-finalize local state sync skipped for {cluster_name}: {sync_exc}")
    except Exception as exc:
        logger.warning(f"Background addon/nodegroup finalization skipped/failed for {cluster_name}: {exc}")


@app.post("/clusters", response_model=ClusterResponse, dependencies=[Depends(require_auth_if_configured)])
async def create_cluster(cluster: ClusterRequest, x_user_email: str = Header(...)):
    try:
        conn = await _resolve_account_connection(x_user_email, cluster.accountId)

        account_id, region, aws_cluster = await asyncio.to_thread(
            _create_eks_cluster_sync,
            conn,
            cluster,
            x_user_email,
        )
        invalidate_cluster_list_cache(x_user_email)

        initial_ng_req = None
        if cluster.createNodeGroup:
            initial_ng_req = NodeGroupCreateRequest(
                nodegroupName=cluster.nodeGroupName or f"{cluster.name}-ng",
                amiType=cluster.amiType or "amazon-linux-2023/x86_64/standard",
                amiId=cluster.amiId,
                amiManual=bool(cluster.amiManual),
                instanceTypes=[cluster.instanceType or "t3.medium"],
                capacityType=(cluster.capacityType or "ON_DEMAND").upper(),
                minSize=max(0, int(cluster.minNodes)),
                desiredSize=max(1, int(cluster.desiredNodes)),
                maxSize=max(1, int(cluster.maxNodes)),
                diskSize=max(20, int(cluster.diskSize)),
            )

        if cluster.addons or initial_ng_req:
            asyncio.create_task(
                _finalize_cluster_addons(
                    conn,
                    region,
                    cluster.name,
                    cluster.addons or [],
                    aws_cluster.get("version", "1.37"),
                    nodegroup_req=initial_ng_req,
                    user_email=x_user_email,
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

DELETED_CLUSTER_RETENTION_DAYS = 7


def _parse_utc_naive(val: Any) -> Optional[datetime]:
    """Normalize an ISO string or datetime object into a naive UTC datetime."""
    if not val:
        return None
    try:
        if isinstance(val, datetime):
            dt = val
        elif isinstance(val, str):
            dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
        else:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


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

        if state.get("deletedAt") and cname not in aws_cluster_names:
            deleted_at = _parse_utc_naive(state["deletedAt"])
            if deleted_at and (current_time - deleted_at) >= timedelta(days=DELETED_CLUSTER_RETENTION_DAYS):
                try:
                    state_manager.delete_cluster_state(x_user_email, cname)
                except Exception:
                    pass
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
            try:
                ng_names = local_eks.list_nodegroups(clusterName=cname).get("nodegroups", [])
            except Exception:
                ng_names = []
            aws_state = {
                "status": cluster_info["status"],
                "endpoint": cluster_info.get("endpoint"),
                "version": cluster_info.get("version"),
                "nodeGroups": [{"nodegroupName": n} for n in ng_names],
                "aws_response": cluster_info,
            }
            differences: List[str] = []
            if state.get("_aws_only"):
                state_status = "missing_local"
                differences = ["Cluster exists on AWS EKS; click Sync to import into local state"]
            else:
                try:
                    comparison = state_manager.compare_with_aws_state(x_user_email, cname, aws_state)
                    state_status = comparison["status"]
                    differences = comparison.get("differences", [])
                    if state_status == "in_sync":
                        state_status = "synced"
                except Exception:
                    state_status = "unknown"

            created_at_val = (
                _parse_utc_naive(state.get("createdAt"))
                or _parse_utc_naive(cluster_info.get("createdAt"))
                or current_time
            )

            return ClusterResponse(
                name=cluster_info["name"],
                status=cluster_info["status"],
                accountId=account_id,
                region=cluster_info["arn"].split(":")[3],
                version=cluster_info["version"],
                endpoint=cluster_info.get("endpoint"),
                stateStatus=state_status,
                stateDifferences=differences,
                createdAt=created_at_val,
                deletedAt=None,
                deletedBy=None,
            )
        except local_eks.exceptions.ResourceNotFoundException:
            deleted_at = _parse_utc_naive(state.get("deletedAt"))
            if not deleted_at:
                deleted_at = current_time
                state["deletedAt"] = current_time.isoformat()
                state["deletedBy"] = (
                    state.get("deletedBy")
                    or state.get("deleteInitiatedBy")
                    or "aws-console"
                )
                state_manager.save_cluster_state(x_user_email, cname, state)
            elif (current_time - deleted_at) >= timedelta(days=DELETED_CLUSTER_RETENTION_DAYS):
                try:
                    state_manager.delete_cluster_state(x_user_email, cname)
                except Exception:
                    pass
                return None
            return ClusterResponse(
                name=cname,
                status="NOT_AVAILABLE",
                accountId=account_id,
                region=state.get("region", "unknown"),
                version=state.get("version", "unknown"),
                endpoint=None,
                stateStatus="deleted",
                createdAt=_parse_utc_naive(state.get("createdAt")) or current_time,
                deletedAt=deleted_at,
                deletedBy=state.get("deletedBy"),
            )

    results: List[ClusterResponse] = []
    with ThreadPoolExecutor(max_workers=min(6, len(all_cluster_names))) as pool:
        for item in pool.map(_describe_one, all_cluster_names):
            if item is not None:
                results.append(item)
    return results


@app.get("/clusters", response_model=List[ClusterResponse], dependencies=[Depends(require_auth_if_configured)])
async def list_clusters(
    refresh: bool = False,
    account_id: Optional[str] = None,
    x_user_email: str = Header(...),
):
    try:
        cache_key = f"{x_user_email.strip().lower()}::{(account_id or 'default').strip()}"
        if not refresh:
            cached = _CLUSTER_LIST_CACHE.get(cache_key)
            if cached and cached[0] > time.monotonic():
                return cached[1]

        connection = await _resolve_account_connection(x_user_email, account_id)

        _, _, resolved_account_id = await connection_manager.test_connection(connection, use_cache=True)
        clusters = await asyncio.to_thread(_list_clusters_sync, connection, x_user_email, resolved_account_id)
        _CLUSTER_LIST_CACHE[cache_key] = (time.monotonic() + 20.0, clusters)
        return clusters
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

_MEM_UNITS = {
    "Ki": 1024,
    "Mi": 1024 ** 2,
    "Gi": 1024 ** 3,
    "Ti": 1024 ** 4,
    "Pi": 1024 ** 5,
    "Ei": 1024 ** 6,
    "K": 1000,
    "k": 1000,
    "M": 1000 ** 2,
    "G": 1000 ** 3,
    "T": 1000 ** 4,
    "P": 1000 ** 5,
    "E": 1000 ** 6,
}


def _parse_k8s_cpu_millicores(raw: Any) -> float:
    if raw is None:
        return 0.0
    s = str(raw).strip()
    if not s:
        return 0.0
    try:
        if s.endswith("m"):
            return float(s[:-1])
        if s.endswith("n"):
            return float(s[:-1]) / 1_000_000.0
        return float(s) * 1000.0
    except ValueError:
        return 0.0


def _parse_k8s_memory_bytes(raw: Any) -> int:
    if raw is None:
        return 0
    s = str(raw).strip()
    if not s:
        return 0
    for suffix, mult in _MEM_UNITS.items():
        if s.endswith(suffix):
            try:
                return int(float(s[: -len(suffix)]) * mult)
            except ValueError:
                return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def _derive_pod_display_status(pod: Dict[str, Any]) -> str:
    meta = pod.get("metadata", {}) or {}
    if meta.get("deletionTimestamp"):
        return "Terminating"
    status = pod.get("status", {}) or {}
    for cs in (status.get("initContainerStatuses") or []) + (status.get("containerStatuses") or []):
        waiting = (cs.get("state") or {}).get("waiting") or {}
        if waiting.get("reason"):
            return str(waiting["reason"])
        terminated = (cs.get("state") or {}).get("terminated") or {}
        if terminated.get("reason") and terminated.get("exitCode", 0) != 0:
            return str(terminated["reason"])
    return str(status.get("phase") or "Unknown")


def _parse_container_state(raw_state: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not raw_state:
        return None
    if "running" in raw_state:
        r = raw_state["running"] or {}
        return {"status": "Running", "startedAt": r.get("startedAt")}
    if "waiting" in raw_state:
        w = raw_state["waiting"] or {}
        return {"status": "Waiting", "reason": w.get("reason"), "message": w.get("message")}
    if "terminated" in raw_state:
        t = raw_state["terminated"] or {}
        return {
            "status": "Terminated",
            "reason": t.get("reason"),
            "message": t.get("message"),
            "exitCode": t.get("exitCode"),
            "startedAt": t.get("startedAt"),
            "finishedAt": t.get("finishedAt"),
        }
    return None


def _build_container_details(
    specs: List[Dict[str, Any]],
    statuses: List[Dict[str, Any]],
    *,
    is_init: bool = False,
) -> List[Dict[str, Any]]:
    status_by_name = {s.get("name"): s for s in (statuses or []) if s.get("name")}
    out: List[Dict[str, Any]] = []
    for c in specs or []:
        cname = c.get("name") or ""
        cs = status_by_name.get(cname, {})
        res = c.get("resources") or {}
        out.append({
            "name": cname,
            "isInit": is_init,
            "image": cs.get("image") or c.get("image"),
            "imagePullPolicy": c.get("imagePullPolicy"),
            "imageId": cs.get("imageID"),
            "containerId": cs.get("containerID"),
            "ready": bool(cs.get("ready", False)),
            "started": bool(cs.get("started", False)),
            "restartCount": int(cs.get("restartCount") or 0),
            "state": _parse_container_state(cs.get("state")),
            "lastState": _parse_container_state(cs.get("lastState")),
            "ports": c.get("ports") or [],
            "requests": res.get("requests") or {},
            "limits": res.get("limits") or {},
            "volumeMounts": c.get("volumeMounts") or [],
            "envNames": [e.get("name") for e in (c.get("env") or []) if e.get("name")],
            "command": c.get("command") or [],
            "args": c.get("args") or [],
        })
    return out


def _extract_pod_summary(pod: Dict[str, Any]) -> Dict[str, Any]:
    meta = pod.get("metadata", {}) or {}
    spec = pod.get("spec", {}) or {}
    status = pod.get("status", {}) or {}
    c_statuses = status.get("containerStatuses") or []
    init_statuses = status.get("initContainerStatuses") or []
    total_containers = len(spec.get("containers") or [])
    ready_containers = sum(1 for c in c_statuses if c.get("ready"))
    restarts = sum(int(c.get("restartCount") or 0) for c in c_statuses)

    conditions = status.get("conditions") or []
    ready_cond = next((cond for cond in conditions if cond.get("type") == "Ready"), None)
    last_transition = (ready_cond or {}).get("lastTransitionTime") or max(
        (str(cond.get("lastTransitionTime") or "") for cond in conditions),
        default="",
    ) or None

    controlled_by = [
        {"kind": ref.get("kind"), "name": ref.get("name"), "uid": ref.get("uid")}
        for ref in (meta.get("ownerReferences") or [])
        if ref.get("kind") or ref.get("name")
    ]
    volumes = [
        {
            "name": v.get("name"),
            "source": next((k for k in v.keys() if k != "name"), "volume"),
        }
        for v in (spec.get("volumes") or [])
    ]

    raw_meta = {k: v for k, v in meta.items() if k != "managedFields"}
    raw_clean = {"kind": pod.get("kind") or "Pod", "apiVersion": pod.get("apiVersion") or "v1", "metadata": raw_meta, "spec": spec, "status": status}

    return {
        "name": meta.get("name") or "",
        "namespace": meta.get("namespace") or "default",
        "uid": meta.get("uid"),
        "status": _derive_pod_display_status(pod),
        "phase": status.get("phase") or "Unknown",
        "ready": f"{ready_containers}/{total_containers}" if total_containers else "0/0",
        "restarts": restarts,
        "podIp": status.get("podIP"),
        "hostIp": status.get("hostIP"),
        "nodeName": spec.get("nodeName"),
        "createdAt": meta.get("creationTimestamp"),
        "lastTransitionTime": last_transition,
        "controlledBy": controlled_by,
        "qosClass": status.get("qosClass"),
        "serviceAccountName": spec.get("serviceAccountName") or spec.get("serviceAccount"),
        "restartPolicy": spec.get("restartPolicy"),
        "terminationGracePeriodSeconds": spec.get("terminationGracePeriodSeconds"),
        "labels": meta.get("labels") or {},
        "annotations": meta.get("annotations") or {},
        "conditions": conditions,
        "volumes": volumes,
        "containers": _build_container_details(spec.get("containers") or [], c_statuses, is_init=False),
        "initContainers": _build_container_details(spec.get("initContainers") or [], init_statuses, is_init=True),
        "raw": raw_clean,
    }


def _fetch_k8s_runtime_sync(
    conn: Any,
    cluster_name: str,
    cluster_info: Dict[str, Any],
    region: str,
) -> tuple[Dict[str, Dict[str, Any]], List[Dict[str, Any]], Optional[str]]:
    """Query live Kubernetes Nodes and Pods via scoped EKS IAM kubeconfig."""
    if cluster_info.get("status") != "ACTIVE":
        return {}, [], None
    endpoint = cluster_info.get("endpoint")
    ca_data = (cluster_info.get("certificateAuthority") or {}).get("data")
    if not endpoint or not ca_data:
        return {}, [], None

    tmpdir = tempfile.mkdtemp(prefix="tesserak_k8s_")
    try:
        kc_path = Path(tmpdir) / "kubeconfig"
        kc_path.write_text(build_eks_kubeconfig_yaml(cluster_name, endpoint, ca_data, region))
        env = _pip_cli_env(build_eks_cli_env(conn, kc_path, region))
        proc = subprocess.run(
            ["kubectl", "--kubeconfig", str(kc_path), "get", "nodes,pods", "-A", "-o", "json"],
            capture_output=True,
            text=True,
            timeout=15,
            env=env,
            check=False,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip().splitlines()
            msg = err[-1] if err else "Unable to query Kubernetes API"
            return {}, [], msg
        data = json.loads(proc.stdout or "{}")
        nodes_by_key: Dict[str, Dict[str, Any]] = {}
        pods: List[Dict[str, Any]] = []
        for item in data.get("items") or []:
            kind = item.get("kind")
            if kind == "Node":
                kname = (item.get("metadata") or {}).get("name")
                if kname:
                    nodes_by_key[kname] = item
            elif kind == "Pod":
                pods.append(_extract_pod_summary(item))
        pods.sort(key=lambda p: str(p.get("createdAt") or ""), reverse=True)
        return nodes_by_key, pods, None
    except FileNotFoundError:
        return {}, [], "kubectl CLI not installed on backend host"
    except subprocess.TimeoutExpired:
        return {}, [], "Timed out querying Kubernetes API for nodes and pods"
    except Exception as exc:
        return {}, [], f"Kubernetes API query skipped: {exc}"
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _merge_nodes_and_compute_allocations(
    ec2_nodes: List[Dict[str, Any]],
    k8s_nodes_map: Dict[str, Dict[str, Any]],
    pods: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Combine AWS EC2 instance data with Kubernetes node status, capacity allocation, conditions, labels & raw JSON."""
    pods_by_node: Dict[str, List[Dict[str, Any]]] = {}
    for p in pods:
        nname = p.get("nodeName")
        if nname:
            pods_by_node.setdefault(nname, []).append(p)

    # Index Kubernetes nodes by EC2 instanceId and private IP for exact matching
    k8s_by_instance: Dict[str, Dict[str, Any]] = {}
    k8s_by_ip: Dict[str, Dict[str, Any]] = {}
    matched_k8s_names: set[str] = set()
    for kname, knode in k8s_nodes_map.items():
        prov_id = str((knode.get("spec") or {}).get("providerID") or "")
        if "/" in prov_id:
            inst_id = prov_id.rsplit("/", 1)[-1]
            if inst_id.startswith("i-"):
                k8s_by_instance[inst_id] = knode
        for addr in (knode.get("status") or {}).get("addresses") or []:
            if addr.get("type") == "InternalIP" and addr.get("address"):
                k8s_by_ip[str(addr["address"])] = knode

    def _enrich_one(ec2_item: Dict[str, Any], knode: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        node = dict(ec2_item)
        if not knode:
            return node
        meta = dict(knode.get("metadata") or {})
        meta.pop("managedFields", None)
        spec = knode.get("spec") or {}
        status = knode.get("status") or {}
        node_info = status.get("nodeInfo") or {}
        conditions = status.get("conditions") or []
        ready_cond = next((c for c in conditions if c.get("type") == "Ready"), {})
        kname = meta.get("name") or ""
        if kname:
            matched_k8s_names.add(kname)

        cap = status.get("capacity") or {}
        alloc = status.get("allocatable") or {}
        node_pods = pods_by_node.get(kname, [])
        active_node_pods = [p for p in node_pods if p.get("phase") not in ("Succeeded", "Failed")]

        req_cpu_mc = 0.0
        req_mem_bytes = 0
        for p in active_node_pods:
            for c in p.get("containers") or []:
                reqs = c.get("requests") or {}
                req_cpu_mc += _parse_k8s_cpu_millicores(reqs.get("cpu"))
                req_mem_bytes += _parse_k8s_memory_bytes(reqs.get("memory"))

        cap_cpu_mc = _parse_k8s_cpu_millicores(cap.get("cpu"))
        alloc_cpu_mc = _parse_k8s_cpu_millicores(alloc.get("cpu"))
        cap_mem_bytes = _parse_k8s_memory_bytes(cap.get("memory"))
        alloc_mem_bytes = _parse_k8s_memory_bytes(alloc.get("memory"))
        cap_ephem_bytes = _parse_k8s_memory_bytes(cap.get("ephemeral-storage"))
        alloc_ephem_bytes = _parse_k8s_memory_bytes(alloc.get("ephemeral-storage"))
        max_pods = int(float(alloc.get("pods") or cap.get("pods") or 0))
        used_pods = len(active_node_pods)

        labels = meta.get("labels") or {}
        if not node.get("nodegroupName") or node.get("nodegroupName") == "—":
            node["nodegroupName"] = labels.get("eks.amazonaws.com/nodegroup", "—")
        if not node.get("capacityType"):
            node["capacityType"] = labels.get("eks.amazonaws.com/capacityType", "ON_DEMAND")
        if not node.get("instanceType") and labels.get("node.kubernetes.io/instance-type"):
            node["instanceType"] = labels["node.kubernetes.io/instance-type"]

        raw_clean = {
            "apiVersion": knode.get("apiVersion", "v1"),
            "kind": knode.get("kind", "Node"),
            "metadata": meta,
            "spec": spec,
            "status": status,
        }

        node.update({
            "nodeName": kname,
            "k8sStatus": "Ready" if ready_cond.get("status") == "True" else ("NotReady" if ready_cond else "Unknown"),
            "createdAt": meta.get("creationTimestamp") or node.get("launchTime"),
            "lastTransitionTime": ready_cond.get("lastTransitionTime"),
            "kernelVersion": node_info.get("kernelVersion"),
            "osImage": node_info.get("osImage"),
            "operatingSystem": node_info.get("operatingSystem"),
            "architecture": node_info.get("architecture") or node.get("architecture"),
            "containerRuntimeVersion": node_info.get("containerRuntimeVersion"),
            "kubeletVersion": node_info.get("kubeletVersion"),
            "kubeProxyVersion": node_info.get("kubeProxyVersion"),
            "providerID": spec.get("providerID"),
            "podCIDRs": spec.get("podCIDRs") or [],
            "capacity": cap,
            "allocatable": alloc,
            "allocation": {
                "cpu": {
                    "capacityMillicores": round(cap_cpu_mc),
                    "allocatableMillicores": round(alloc_cpu_mc),
                    "systemReservedMillicores": max(0, round(cap_cpu_mc - alloc_cpu_mc)),
                    "workloadReservedMillicores": round(req_cpu_mc),
                    "availableMillicores": max(0, round(alloc_cpu_mc - req_cpu_mc)),
                },
                "memory": {
                    "capacityBytes": cap_mem_bytes,
                    "allocatableBytes": alloc_mem_bytes,
                    "systemReservedBytes": max(0, cap_mem_bytes - alloc_mem_bytes),
                    "workloadReservedBytes": req_mem_bytes,
                    "availableBytes": max(0, alloc_mem_bytes - req_mem_bytes),
                },
                "pods": {
                    "max": max_pods,
                    "used": used_pods,
                    "available": max(0, max_pods - used_pods),
                },
                "ephemeralStorage": {
                    "capacityBytes": cap_ephem_bytes,
                    "allocatableBytes": alloc_ephem_bytes,
                    "systemReservedBytes": max(0, cap_ephem_bytes - alloc_ephem_bytes),
                    "availableBytes": alloc_ephem_bytes,
                },
            },
            "conditions": conditions,
            "taints": spec.get("taints") or [],
            "labels": labels,
            "annotations": meta.get("annotations") or {},
            "addresses": status.get("addresses") or [],
            "podCount": len(node_pods),
            "rawNode": raw_clean,
        })
        return node

    merged: List[Dict[str, Any]] = []
    for ec2_item in ec2_nodes:
        knode = k8s_by_instance.get(str(ec2_item.get("instanceId") or "")) or k8s_by_ip.get(
            str(ec2_item.get("privateIpAddress") or "")
        )
        merged.append(_enrich_one(ec2_item, knode))

    # Append Kubernetes nodes that don't match an EC2 instance (e.g., EKS Auto Mode / Karpenter / Fargate)
    for kname, knode in k8s_nodes_map.items():
        if kname not in matched_k8s_names:
            prov_id = str((knode.get("spec") or {}).get("providerID") or "")
            inst_id = prov_id.rsplit("/", 1)[-1] if "/" in prov_id else kname
            labels = (knode.get("metadata") or {}).get("labels") or {}
            addrs = (knode.get("status") or {}).get("addresses") or []
            priv_ip = next((a.get("address") for a in addrs if a.get("type") == "InternalIP"), None)
            pub_ip = next((a.get("address") for a in addrs if a.get("type") == "ExternalIP"), None)
            stub = {
                "instanceId": inst_id,
                "name": kname,
                "nodegroupName": labels.get("eks.amazonaws.com/nodegroup", "—"),
                "instanceType": labels.get("node.kubernetes.io/instance-type"),
                "availabilityZone": labels.get("topology.kubernetes.io/zone"),
                "privateIpAddress": priv_ip,
                "publicIpAddress": pub_ip,
                "state": "running",
            }
            merged.append(_enrich_one(stub, knode))

    return merged


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
                    "workerNodes": [],
                    "pods": [],
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
        results = []
        for n in ng_names[:20]:
            ng = local_eks.describe_nodegroup(clusterName=cluster_name, nodegroupName=n)["nodegroup"]
            ng_updates = []
            try:
                upd_ids = local_eks.list_updates(name=cluster_name, nodegroupName=n).get("updateIds", [])
                for uid in upd_ids[:10]:
                    ng_updates.append(
                        local_eks.describe_update(name=cluster_name, nodegroupName=n, updateId=uid)["update"]
                    )
                ng_updates.sort(key=lambda u: str(u.get("createdAt", "")), reverse=True)
            except Exception:
                ng_updates = []
            ng["updateHistory"] = ng_updates
            results.append(ng)
        return results

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

    def _fetch_worker_nodes():
        try:
            local_ec2 = boto3.client(
                "ec2",
                aws_access_key_id=connection.accessKey,
                aws_secret_access_key=connection.secretKey,
                region_name=region,
                config=AWS_FAST_CFG,
            )
            resp = local_ec2.describe_instances(
                Filters=[
                    {"Name": "tag:eks:cluster-name", "Values": [cluster_name]},
                    {"Name": "instance-state-name", "Values": ["pending", "running", "stopping", "stopped"]},
                ]
            )
            nodes = []
            for res in resp.get("Reservations", []):
                for inst in res.get("Instances", []):
                    tags = {t.get("Key", ""): t.get("Value", "") for t in inst.get("Tags", [])}
                    nodes.append({
                        "instanceId": inst.get("InstanceId"),
                        "name": tags.get("Name") or inst.get("InstanceId"),
                        "nodegroupName": tags.get("eks:nodegroup-name", "—"),
                        "instanceType": inst.get("InstanceType"),
                        "capacityType": "SPOT" if inst.get("InstanceLifecycle") == "spot" else "ON_DEMAND",
                        "availabilityZone": inst.get("Placement", {}).get("AvailabilityZone"),
                        "subnetId": inst.get("SubnetId"),
                        "vpcId": inst.get("VpcId"),
                        "amiId": inst.get("ImageId"),
                        "architecture": inst.get("Architecture"),
                        "privateDnsName": inst.get("PrivateDnsName"),
                        "privateIpAddress": inst.get("PrivateIpAddress"),
                        "publicIpAddress": inst.get("PublicIpAddress"),
                        "state": inst.get("State", {}).get("Name", "unknown"),
                        "launchTime": inst.get("LaunchTime"),
                    })
            return nodes
        except Exception:
            return []

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
                        "isPublic": bool(sub.get("MapPublicIpOnLaunch", False)) or ("public" in sname.lower()),
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

    def _fetch_k8s():
        return _fetch_k8s_runtime_sync(connection, cluster_name, cluster_info, aws_region)

    def _fetch_helm_releases():
        if cluster_info.get("status") != "ACTIVE":
            return []
        helm_bin = _resolve_helm_binary()
        endpoint = cluster_info.get("endpoint")
        ca_data = (cluster_info.get("certificateAuthority") or {}).get("data")
        if not helm_bin or not endpoint or not ca_data:
            return []
        tmpdir = tempfile.mkdtemp(prefix="tesserak_hl_")
        try:
            tmp_path = Path(tmpdir)
            kc_path = tmp_path / "kubeconfig"
            kc_path.write_text(build_eks_kubeconfig_yaml(cluster_name, endpoint, ca_data, aws_region))
            env = _isolated_helm_env(connection, kc_path, aws_region, tmp_path)
            proc = subprocess.run(
                [helm_bin, "list", "-A", "-o", "json", "--kubeconfig", str(kc_path)],
                capture_output=True,
                text=True,
                timeout=15,
                env=env,
                check=False,
            )
            if proc.returncode != 0:
                return []
            items = json.loads(proc.stdout or "[]")
            return items if isinstance(items, list) else []
        except Exception:
            return []
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    with ThreadPoolExecutor(max_workers=8) as pool:
        f_ng = pool.submit(_fetch_nodegroups)
        f_ad = pool.submit(_fetch_addons)
        f_fg = pool.submit(_fetch_fargate)
        f_up = pool.submit(_fetch_updates)
        f_net = pool.submit(_fetch_networking)
        f_nodes = pool.submit(_fetch_worker_nodes)
        f_k8s = pool.submit(_fetch_k8s)
        f_helm = pool.submit(_fetch_helm_releases)

        nodegroups = f_ng.result()
        addons = f_ad.result()
        fargate_profiles = f_fg.result()
        updates = f_up.result()
        networking = f_net.result()
        ec2_nodes = f_nodes.result()
        k8s_nodes_map, pods, k8s_warning = f_k8s.result()
        helm_releases = f_helm.result()

    # Build unified Community / Helm add-ons view combining live Helm releases + tracked/requested add-ons
    live_by_name = {str(rel.get("name") or "").lower(): rel for rel in helm_releases}
    tracked_results = {str(r.get("id") or "").lower(): r for r in (local_state or {}).get("communityAddons", []) if isinstance(r, dict)}
    requested_comm = [
        a for a in (((local_state or {}).get("desiredState") or {}).get("addons") or [])
        if isinstance(a, dict) and a.get("type") == "community"
    ]
    community_addons: List[Dict[str, Any]] = []
    seen_comm_ids: set = set()
    for a in requested_comm:
        aid = str(a.get("id") or "")
        cfg = _COMMUNITY_ADDON_REPOS.get(aid, {})
        rel_name = str(cfg.get("release") or aid).lower()
        live = live_by_name.get(rel_name) or live_by_name.get(aid.lower())
        tracked = tracked_results.get(aid.lower())
        seen_comm_ids.add(rel_name)
        if live:
            community_addons.append({
                "id": aid,
                "name": a.get("name") or aid,
                "releaseName": live.get("name"),
                "namespace": live.get("namespace"),
                "chart": live.get("chart"),
                "version": live.get("app_version") or live.get("chart") or a.get("version"),
                "requestedVersion": a.get("version"),
                "status": str(live.get("status") or "deployed").upper(),
                "source": "helm-live",
                "details": live.get("updated") or "",
            })
        else:
            community_addons.append({
                "id": aid,
                "name": a.get("name") or aid,
                "releaseName": cfg.get("release") or aid,
                "namespace": cfg.get("namespace") or "kube-system",
                "chart": cfg.get("chart") or aid,
                "version": a.get("version"),
                "requestedVersion": a.get("version"),
                "status": str((tracked or {}).get("status") or "NOT_INSTALLED").upper(),
                "source": "requested",
                "details": (tracked or {}).get("details") or "Selected during setup; click Install via Helm to deploy onto cluster.",
            })
    for rel in helm_releases:
        rname = str(rel.get("name") or "").lower()
        if rname and rname not in seen_comm_ids:
            matched_id = next(
                (k for k, v in _COMMUNITY_ADDON_REPOS.items() if str(v.get("release") or k).lower() == rname),
                rname,
            )
            community_addons.append({
                "id": matched_id,
                "name": rel.get("name"),
                "releaseName": rel.get("name"),
                "namespace": rel.get("namespace"),
                "chart": rel.get("chart"),
                "version": rel.get("app_version") or rel.get("chart"),
                "status": str(rel.get("status") or "deployed").upper(),
                "source": "helm-live",
                "details": rel.get("updated") or "",
            })

    worker_nodes = _merge_nodes_and_compute_allocations(ec2_nodes, k8s_nodes_map, pods)

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
        "workerNodes": worker_nodes,
        "pods": pods,
        "k8sRuntimeWarning": k8s_warning,
        "fargateProfiles": fargate_profiles,
        "addons": addons,
        "communityAddons": community_addons,
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
async def get_cluster_details(
    cluster_name: str,
    account_id: Optional[str] = None,
    x_user_email: str = Header(...),
):
    try:
        connection = await _resolve_account_connection(x_user_email, account_id)
        _, _, resolved_account_id = await connection_manager.test_connection(connection, use_cache=True)
        return await asyncio.to_thread(
            _get_cluster_details_sync,
            connection,
            x_user_email,
            cluster_name,
            resolved_account_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _resolve_eks_node_role_arn(iam_client: Any, explicit_role: Optional[str] = None) -> str:
    if explicit_role and explicit_role.strip():
        return explicit_role.strip()
    env_role = os.getenv("EKS_NODE_ROLE_ARN", "").strip()
    if env_role:
        return env_role

    candidates = []
    for role in iam_client.list_roles(MaxItems=200).get("Roles", []):
        arn = role.get("Arn", "")
        if "/aws-service-role/" in arn:
            continue
        doc = json.dumps(role.get("AssumeRolePolicyDocument", {}))
        if "ec2.amazonaws.com" in doc:
            candidates.append((role.get("RoleName", ""), arn))

    for preferred in ("tesserakeksnodegrouprole", "amazoneksnoderole", "eks-node-role", "eksworkernoderole"):
        for rname, rarn in candidates:
            if rname.lower() == preferred:
                return rarn
    for rname, rarn in candidates:
        if "node" in rname.lower() or "worker" in rname.lower() or "eks" in rname.lower():
            try:
                attached = [p["PolicyArn"] for p in iam_client.list_attached_role_policies(RoleName=rname).get("AttachedPolicies", [])]
                if "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy" in attached:
                    return rarn
            except Exception:
                pass

    role_name = "TesserakEKSNodeGroupRole"
    try:
        existing = iam_client.get_role(RoleName=role_name)
        return existing["Role"]["Arn"]
    except iam_client.exceptions.NoSuchEntityException:
        pass

    trust_policy = json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "ec2.amazonaws.com"},
            "Action": "sts:AssumeRole",
        }],
    })
    created = iam_client.create_role(
        RoleName=role_name,
        AssumeRolePolicyDocument=trust_policy,
        Description="EKS Worker Node Group Role managed by Tesserak",
    )
    for policy_arn in (
        "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
        "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
        "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
    ):
        iam_client.attach_role_policy(RoleName=role_name, PolicyArn=policy_arn)
    time.sleep(6)
    return created["Role"]["Arn"]


def _create_nodegroup_sync(
    connection: Any,
    cluster_name: str,
    req: NodeGroupCreateRequest,
    user_email: str,
    region_override: Optional[str] = None,
) -> Dict[str, Any]:
    if req.minSize > req.desiredSize or req.desiredSize > req.maxSize:
        raise HTTPException(
            status_code=400,
            detail="Scaling config must satisfy minSize <= desiredSize <= maxSize.",
        )

    region = region_override or connection.region or "us-east-1"
    sess = boto3.Session(
        aws_access_key_id=connection.accessKey,
        aws_secret_access_key=connection.secretKey,
        region_name=region,
    )
    eks = sess.client("eks", config=AWS_FAST_CFG)
    iam = sess.client("iam", config=AWS_FAST_CFG)
    ec2 = sess.client("ec2", config=AWS_FAST_CFG)

    cluster_info = eks.describe_cluster(name=cluster_name)["cluster"]
    subnets = [s for s in (req.subnets or []) if s] or (cluster_info.get("resourcesVpcConfig", {}).get("subnetIds") or [])
    if not subnets:
        raise HTTPException(status_code=400, detail="No subnets available on cluster for node group creation.")

    node_role_arn = _resolve_eks_node_role_arn(iam, req.nodeRoleArn)
    instance_types = [i.strip() for i in (req.instanceTypes or ["t3.medium"]) if i.strip()] or ["t3.medium"]
    capacity_type = (req.capacityType or "ON_DEMAND").upper()

    ng_kwargs: Dict[str, Any] = {
        "clusterName": cluster_name,
        "nodegroupName": req.nodegroupName.strip(),
        "scalingConfig": {
            "minSize": req.minSize,
            "desiredSize": req.desiredSize,
            "maxSize": req.maxSize,
        },
        "subnets": subnets,
        "nodeRole": node_role_arn,
        "instanceTypes": instance_types,
        "capacityType": capacity_type,
        "tags": {"ManagedBy": "Tesserak"},
    }

    if req.amiManual and req.amiId and req.amiId.strip():
        lt_name = f"tesserak-{cluster_name}-{req.nodegroupName.strip()}-{int(time.time())}"[:128]
        lt_resp = ec2.create_launch_template(
            LaunchTemplateName=lt_name,
            LaunchTemplateData={
                "ImageId": req.amiId.strip(),
                "BlockDeviceMappings": [
                    {
                        "DeviceName": "/dev/xvda",
                        "Ebs": {"VolumeSize": max(20, int(req.diskSize)), "VolumeType": "gp3"},
                    }
                ],
            },
        )
        ng_kwargs["launchTemplate"] = {
            "id": lt_resp["LaunchTemplate"]["LaunchTemplateId"],
            "version": "$Latest",
        }
        ng_kwargs["amiType"] = "CUSTOM"
    else:
        eks_ami_enum = _SSM_AMI_TO_EKS_ENUM.get(req.amiType) or (
            req.amiType if req.amiType in set(_SSM_AMI_TO_EKS_ENUM.values()) else "AL2023_x86_64_STANDARD"
        )
        ng_kwargs["amiType"] = eks_ami_enum
        ng_kwargs["diskSize"] = max(20, int(req.diskSize))

    resp = eks.create_nodegroup(**ng_kwargs)
    ng = resp.get("nodegroup", {})
    if user_email:
        try:
            current_state = state_manager.get_cluster_state(user_email, cluster_name) or {
                "name": cluster_name,
                "region": region,
            }
            updated = state_data.record_state_change(
                current_state,
                "nodegroup_created",
                {"nodegroupName": req.nodegroupName.strip(), "instanceTypes": instance_types, "amiType": ng_kwargs.get("amiType"), "amiId": req.amiId},
            )
            state_manager.save_cluster_state(user_email, cluster_name, updated)
        except Exception:
            pass
    invalidate_cluster_list_cache(user_email)
    return json.loads(json.dumps(ng, default=str))


@app.post("/clusters/{cluster_name}/nodegroups", dependencies=[Depends(require_auth_if_configured)])
async def create_cluster_nodegroup(
    cluster_name: str,
    payload: NodeGroupCreateRequest,
    account_id: Optional[str] = None,
    x_user_email: str = Header(...),
):
    try:
        connection = await _resolve_account_connection(x_user_email, account_id)
        return await asyncio.to_thread(_create_nodegroup_sync, connection, cluster_name, payload, x_user_email)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Node group creation failed: {str(e)}")


@app.patch("/clusters/{cluster_name}/nodegroups/{nodegroup_name}", dependencies=[Depends(require_auth_if_configured)])
async def scale_cluster_nodegroup(
    cluster_name: str,
    nodegroup_name: str,
    payload: NodeGroupScaleRequest,
    account_id: Optional[str] = None,
    x_user_email: str = Header(...),
):
    if payload.minSize > payload.desiredSize or payload.desiredSize > payload.maxSize:
        raise HTTPException(status_code=400, detail="Scaling config must satisfy minSize <= desiredSize <= maxSize.")
    try:
        connection = await _resolve_account_connection(x_user_email, account_id)

        def _scale_sync():
            eks = boto3.client(
                "eks",
                aws_access_key_id=connection.accessKey,
                aws_secret_access_key=connection.secretKey,
                region_name=connection.region or "us-east-1",
                config=AWS_FAST_CFG,
            )
            resp = eks.update_nodegroup_config(
                clusterName=cluster_name,
                nodegroupName=nodegroup_name,
                scalingConfig={
                    "minSize": payload.minSize,
                    "desiredSize": payload.desiredSize,
                    "maxSize": payload.maxSize,
                },
            )
            return json.loads(json.dumps(resp.get("update", {}), default=str))

        invalidate_cluster_list_cache(x_user_email)
        return await asyncio.to_thread(_scale_sync)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Node group scaling failed: {str(e)}")


@app.delete("/clusters/{cluster_name}/nodegroups/{nodegroup_name}", dependencies=[Depends(require_auth_if_configured)])
async def delete_cluster_nodegroup(
    cluster_name: str,
    nodegroup_name: str,
    account_id: Optional[str] = None,
    x_user_email: str = Header(...),
):
    try:
        connection = await _resolve_account_connection(x_user_email, account_id)

        def _delete_ng_sync():
            eks = boto3.client(
                "eks",
                aws_access_key_id=connection.accessKey,
                aws_secret_access_key=connection.secretKey,
                region_name=connection.region or "us-east-1",
                config=AWS_FAST_CFG,
            )
            resp = eks.delete_nodegroup(clusterName=cluster_name, nodegroupName=nodegroup_name)
            return json.loads(json.dumps(resp.get("nodegroup", {}), default=str))

        invalidate_cluster_list_cache(x_user_email)
        return await asyncio.to_thread(_delete_ng_sync)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Node group deletion failed: {str(e)}")


_K8S_RESOURCE_NAME_RE = re.compile(r"^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$")


def _validate_k8s_name(value: str, label: str) -> str:
    clean = (value or "").strip()
    if not clean or len(clean) > 253 or not _K8S_RESOURCE_NAME_RE.match(clean):
        raise HTTPException(status_code=400, detail=f"Invalid Kubernetes {label}: '{value}'")
    return clean


def _kubectl_pod_action_sync(
    connection: Any,
    cluster_name: str,
    namespace: str,
    pod_name: str,
    action: str,
    force: bool = False,
) -> Dict[str, Any]:
    region = connection.region or "us-east-1"
    eks = boto3.client(
        "eks",
        aws_access_key_id=connection.accessKey,
        aws_secret_access_key=connection.secretKey,
        region_name=region,
        config=AWS_FAST_CFG,
    )
    cluster_info = eks.describe_cluster(name=cluster_name).get("cluster", {})
    endpoint = cluster_info.get("endpoint")
    ca_data = (cluster_info.get("certificateAuthority") or {}).get("data")
    if not endpoint or not ca_data:
        raise HTTPException(status_code=400, detail=f"Cluster '{cluster_name}' endpoint is not available.")

    tmpdir = tempfile.mkdtemp(prefix="tesserak_pod_")
    try:
        kc_path = Path(tmpdir) / "kubeconfig"
        kc_path.write_text(build_eks_kubeconfig_yaml(cluster_name, endpoint, ca_data, region))
        env = _pip_cli_env(build_eks_cli_env(connection, kc_path, region))
        cmd = [
            "kubectl",
            "--kubeconfig",
            str(kc_path),
            "delete",
            "pod",
            pod_name,
            "-n",
            namespace,
            "--wait=false",
        ]
        if force and action == "delete":
            cmd.extend(["--grace-period=0", "--force"])
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20, env=env, check=False)
        out = (proc.stdout or proc.stderr or "").strip()
        if proc.returncode != 0:
            if "NotFound" in out or "not found" in out.lower():
                raise HTTPException(status_code=404, detail=f"Pod '{namespace}/{pod_name}' not found.")
            raise HTTPException(status_code=400, detail=out or f"kubectl failed while trying to {action} pod.")
        if action == "restart":
            return {
                "status": "restarting",
                "clusterName": cluster_name,
                "namespace": namespace,
                "podName": pod_name,
                "message": f'Pod "{pod_name}" in namespace "{namespace}" restart triggered (controller will recreate a fresh pod).',
            }
        return {
            "status": "deleting",
            "clusterName": cluster_name,
            "namespace": namespace,
            "podName": pod_name,
            "message": f'Pod "{pod_name}" in namespace "{namespace}" deletion requested.',
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail=f"Timed out waiting for kubectl to {action} pod '{namespace}/{pod_name}'.")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="kubectl CLI is not installed on the backend host.")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.post("/clusters/{cluster_name}/pods/{namespace}/{pod_name}/restart", dependencies=[Depends(require_auth_if_configured)])
async def restart_cluster_pod(
    cluster_name: str,
    namespace: str,
    pod_name: str,
    account_id: Optional[str] = None,
    x_user_email: str = Header(...),
):
    clean_ns = _validate_k8s_name(namespace, "namespace")
    clean_pod = _validate_k8s_name(pod_name, "pod name")
    connection = await _resolve_account_connection(x_user_email, account_id)
    return await asyncio.to_thread(_kubectl_pod_action_sync, connection, cluster_name, clean_ns, clean_pod, "restart", False)


@app.delete("/clusters/{cluster_name}/pods/{namespace}/{pod_name}", dependencies=[Depends(require_auth_if_configured)])
async def delete_cluster_pod(
    cluster_name: str,
    namespace: str,
    pod_name: str,
    force: bool = False,
    account_id: Optional[str] = None,
    x_user_email: str = Header(...),
):
    clean_ns = _validate_k8s_name(namespace, "namespace")
    clean_pod = _validate_k8s_name(pod_name, "pod name")
    connection = await _resolve_account_connection(x_user_email, account_id)
    return await asyncio.to_thread(_kubectl_pod_action_sync, connection, cluster_name, clean_ns, clean_pod, "delete", force)


@app.delete("/clusters/{cluster_name}", dependencies=[Depends(require_auth_if_configured)])
async def delete_cluster(
    cluster_name: str,
    account_id: Optional[str] = None,
    x_user_email: str = Header(...),
):
    try:
        eks_client = await connection_manager.get_aws_client(x_user_email, account_id=account_id)
        if not eks_client:
            raise HTTPException(
                status_code=400,
                detail=f"No valid AWS connection found{' for account ' + account_id if account_id else ''}. Please add AWS credentials in Integrations.",
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
            final_state["deleteInitiatedBy"] = "tesserak"
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
async def sync_cluster_state(
    cluster_name: str,
    account_id: Optional[str] = None,
    x_user_email: str = Header(...),
):
    try:
        connection = await _resolve_account_connection(x_user_email, account_id)
        region = connection.region or "us-east-1"

        def _sync_pull():
            eks_client = boto3.client(
                "eks",
                aws_access_key_id=connection.accessKey,
                aws_secret_access_key=connection.secretKey,
                region_name=region,
                config=AWS_FAST_CFG,
            )
            cluster_info = eks_client.describe_cluster(name=cluster_name)["cluster"]
            try:
                ng_names = eks_client.list_nodegroups(clusterName=cluster_name).get("nodegroups", [])
                nodegroups = [
                    eks_client.describe_nodegroup(clusterName=cluster_name, nodegroupName=n)["nodegroup"]
                    for n in ng_names[:20]
                ]
            except Exception:
                nodegroups = []
            aws_state = json.loads(
                json.dumps(
                    {
                        "status": cluster_info["status"],
                        "endpoint": cluster_info.get("endpoint"),
                        "version": cluster_info.get("version"),
                        "nodeGroups": nodegroups,
                        "aws_response": cluster_info,
                    },
                    default=str,
                )
            )
            current_wrapper = state_manager.get_cluster_state(x_user_email, cluster_name)
            base_state = (
                dict(current_wrapper.get("state", current_wrapper))
                if current_wrapper
                else {"name": cluster_name, "region": cluster_info["arn"].split(":")[3]}
            )
            change_type = "sync" if current_wrapper else "initial_sync"
            updated_state = state_data.record_state_change(
                base_state,
                change_type,
                {"aws_state": aws_state},
            )
            state_manager.save_cluster_state(x_user_email, cluster_name, updated_state)
            return {
                "message": "State synchronized successfully",
                "status": aws_state["status"],
                "version": aws_state["version"],
                "nodeGroupsCount": len(nodegroups),
            }

        res = await asyncio.to_thread(_sync_pull)
        invalidate_cluster_list_cache(x_user_email)
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/clusters/{cluster_name}/community-addons", dependencies=[Depends(require_auth_if_configured)])
async def install_cluster_community_addon(
    cluster_name: str,
    payload: CommunityAddonInstallRequest,
    account_id: Optional[str] = None,
    x_user_email: str = Header(...),
):
    connection = await _resolve_account_connection(x_user_email, account_id)
    region = connection.region or "us-east-1"
    addon = AddonModel(
        id=payload.addonId.strip(),
        name=payload.name or payload.addonId.strip(),
        type="community",
        version=payload.version,
    )
    res = await install_community_addon(connection, region, cluster_name, addon)

    def _record_result():
        wrapper = state_manager.get_cluster_state(x_user_email, cluster_name)
        if not wrapper:
            return
        base = dict(wrapper.get("state", wrapper))
        existing = [r for r in (base.get("communityAddons") or []) if isinstance(r, dict) and r.get("id") != res.get("id")]
        existing.append(res)
        updated = state_data.record_state_change(
            base,
            "community_addon_install",
            {"communityAddons": existing, "addon": res},
        )
        state_manager.save_cluster_state(x_user_email, cluster_name, updated)

    await asyncio.to_thread(_record_result)
    if res.get("status") in ("failed", "unsupported"):
        raise HTTPException(status_code=400, detail=res.get("details") or f"Failed to install {addon.id}")
    return res

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

        connection = await _resolve_account_connection(x_user_email, account_id)

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

        connection = await _resolve_account_connection(x_user_email, account_id)

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

        connection = await _resolve_account_connection(x_user_email, account_id)

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


@app.get("/api/aws/subnets/{account_id}/{region}/{vpc_id}", dependencies=[Depends(require_auth_if_configured)])
async def get_aws_vpc_subnets(account_id: str, region: str, vpc_id: str, x_user_email: str = Header(...)):
    try:
        cache_key = f"subnets:{account_id}:{region}:{vpc_id}"
        cached = _EKS_META_CACHE.get(cache_key)
        if cached and cached[0] > time.monotonic():
            return cached[1]

        connection = await _resolve_account_connection(x_user_email, account_id)

        def _fetch_subnets_sync():
            client = boto3.client(
                "ec2",
                aws_access_key_id=connection.accessKey,
                aws_secret_access_key=connection.secretKey,
                region_name=region,
                config=AWS_FAST_CFG,
            )
            subnets = []
            for sub in client.describe_subnets(Filters=[{"Name": "vpc-id", "Values": [vpc_id]}]).get("Subnets", []):
                name = next((t.get("Value", "") for t in sub.get("Tags", []) if t.get("Key") == "Name"), "")
                map_public = bool(sub.get("MapPublicIpOnLaunch", False))
                is_public = map_public or ("public" in name.lower())
                subnets.append({
                    "id": sub["SubnetId"],
                    "name": name or sub["SubnetId"],
                    "cidr": sub.get("CidrBlock", ""),
                    "availabilityZone": sub.get("AvailabilityZone", ""),
                    "isPublic": is_public,
                    "availableIpAddressCount": sub.get("AvailableIpAddressCount"),
                })
            subnets.sort(key=lambda s: (not s["isPublic"], s["availabilityZone"], s["name"]))
            return subnets

        subnets = await asyncio.to_thread(_fetch_subnets_sync)
        _EKS_META_CACHE[cache_key] = (time.monotonic() + 60.0, subnets)
        return subnets
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _get_eks_ami_sync(
    connection: Any,
    region: str,
    ami_type: str,
    kubernetes_version: Optional[str] = None,
) -> Dict[str, Any]:
    clean_ami_type = (ami_type or "amazon-linux-2023/x86_64/standard").strip().lstrip("/")
    if clean_ami_type not in _ALLOWED_EKS_AMI_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported AMI type '{clean_ami_type}'. Allowed values: {', '.join(_ALLOWED_EKS_AMI_TYPES.keys())}",
        )

    target_k8s = (kubernetes_version or "").strip()
    if not target_k8s:
        supported = _get_eks_supported_versions_sync(connection, region)
        target_k8s = supported.get("latest") or "1.35"

    cache_key = f"eks_ami:{region}:{target_k8s}:{clean_ami_type}"
    cached = _EKS_META_CACHE.get(cache_key)
    if cached and cached[0] > time.monotonic():
        return cached[1]

    ssm = boto3.client(
        "ssm",
        aws_access_key_id=connection.accessKey,
        aws_secret_access_key=connection.secretKey,
        region_name=region,
        config=AWS_FAST_CFG,
    )

    candidate_versions = [target_k8s]
    if not kubernetes_version:
        supported = _get_eks_supported_versions_sync(connection, region)
        for v in supported.get("versions", []):
            ver = v.get("version")
            if ver and ver not in candidate_versions:
                candidate_versions.append(ver)

    last_err = None
    for ver in candidate_versions[:4]:
        param_name = f"/aws/service/eks/optimized-ami/{ver}/{clean_ami_type}/recommended/image_id"
        try:
            resp = ssm.get_parameter(Name=param_name)
            param = resp.get("Parameter", {})
            last_mod = param.get("LastModifiedDate")
            result = {
                "amiId": param.get("Value", ""),
                "amiType": clean_ami_type,
                "amiLabel": _ALLOWED_EKS_AMI_TYPES[clean_ami_type],
                "kubernetesVersion": ver,
                "region": region,
                "parameterName": param_name,
                "lastModified": last_mod.isoformat() if hasattr(last_mod, "isoformat") else last_mod,
            }
            _EKS_META_CACHE[cache_key] = (time.monotonic() + 300.0, result)
            return result
        except ssm.exceptions.ParameterNotFound as exc:
            last_err = exc
            if kubernetes_version:
                break

    raise HTTPException(
        status_code=404,
        detail=f"No recommended AWS EKS AMI found in {region} for Kubernetes {target_k8s} ({clean_ami_type}): {last_err}",
    )


@app.get("/api/aws/eks-ami/{account_id}/{region}", dependencies=[Depends(require_auth_if_configured)])
async def get_eks_recommended_ami(
    account_id: str,
    region: str,
    ami_type: str = "amazon-linux-2023/x86_64/standard",
    kubernetes_version: Optional[str] = None,
    x_user_email: str = Header(...),
):
    try:
        connection = await connection_manager.get_catalog_connection(x_user_email, account_id)
        if not connection:
            raise HTTPException(
                status_code=400,
                detail="No active connection or platform catalog credentials found",
            )
        return await asyncio.to_thread(_get_eks_ami_sync, connection, region, ami_type, kubernetes_version)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch recommended EKS AMI: {str(e)}")


_EC2_CATALOG_TTL_SECONDS = 86400  # 24 hours persistent DB cache per AWS region
_EC2_WARMING_REGIONS: set[str] = set()
_PREFERRED_FAMILY_ORDER = {
    "t3": 0,
    "t3a": 1,
    "t4g": 2,
    "t2": 3,
    "m6i": 4,
    "m7i": 5,
    "m6a": 6,
    "m5": 7,
    "m6g": 8,
    "m7g": 9,
    "c6i": 10,
    "c7i": 11,
    "c5": 12,
    "c6g": 13,
    "c7g": 14,
    "r6i": 15,
    "r7i": 16,
    "r5": 17,
    "r6g": 18,
    "r7g": 19,
    "g5": 20,
    "g4dn": 21,
    "g6": 22,
    "g5g": 23,
    "p4d": 24,
    "p5": 25,
    "inf2": 26,
    "inf1": 27,
    "trn1": 28,
}
_SIZE_ORDER = {
    "nano": 0,
    "micro": 1,
    "small": 2,
    "medium": 3,
    "large": 4,
    "xlarge": 5,
    "2xlarge": 6,
    "3xlarge": 7,
    "4xlarge": 8,
    "6xlarge": 9,
    "8xlarge": 10,
    "9xlarge": 11,
    "12xlarge": 12,
    "16xlarge": 13,
    "18xlarge": 14,
    "24xlarge": 15,
    "32xlarge": 16,
    "48xlarge": 17,
}


def _serialize_ec2_instance_type(item: Dict[str, Any]) -> Dict[str, Any]:
    itype = str(item.get("InstanceType") or "")
    parts = itype.split(".", 1)
    family = parts[0] if parts else itype
    size_label = parts[1] if len(parts) > 1 else ""
    vcpus = int((item.get("VCpuInfo") or {}).get("DefaultVCpus") or 0)
    mem_mib = int((item.get("MemoryInfo") or {}).get("SizeInMiB") or 0)
    memory_gib = round(mem_mib / 1024.0, 2)
    if memory_gib.is_integer():
        memory_gib = int(memory_gib)
    archs = list((item.get("ProcessorInfo") or {}).get("SupportedArchitectures") or [])
    gpus = list((item.get("GpuInfo") or {}).get("Gpus") or [])
    neurons = list((item.get("NeuronInfo") or {}).get("NeuronDevices") or [])

    if any(g.get("Manufacturer") == "NVIDIA" for g in gpus):
        category = "nvidia"
    elif neurons or item.get("NeuronInfo"):
        category = "neuron"
    elif gpus:
        category = "other-gpu"
    else:
        category = "standard"

    gpu_summary = ""
    if gpus:
        g0 = gpus[0]
        gcount = sum(int(g.get("Count") or 1) for g in gpus)
        gpu_summary = f"{gcount}x {g0.get('Manufacturer', '')} {g0.get('Name', '')}".strip()
    elif neurons:
        n0 = neurons[0]
        ncount = sum(int(n.get("Count") or 1) for n in neurons)
        gpu_summary = f"{ncount}x AWS {n0.get('Name', 'Neuron')}".strip()

    return {
        "instanceType": itype,
        "family": family,
        "size": size_label,
        "vcpus": vcpus,
        "memoryGiB": memory_gib,
        "architectures": archs,
        "category": category,
        "accelerator": gpu_summary or None,
        "currentGeneration": bool(item.get("CurrentGeneration", True)),
        "freeTierEligible": bool(item.get("FreeTierEligible", False)),
        "bareMetal": bool(item.get("BareMetal", False)),
    }


def _sort_instance_types(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        items,
        key=lambda t: (
            bool(t.get("bareMetal")),
            not bool(t.get("currentGeneration")),
            _PREFERRED_FAMILY_ORDER.get(str(t.get("family")), 999),
            str(t.get("family")),
            _SIZE_ORDER.get(str(t.get("size")), 99),
            t.get("vcpus", 0),
            str(t.get("instanceType")),
        ),
    )


def _filter_instance_types_for_ami(catalog: List[Dict[str, Any]], ami_type: str) -> List[Dict[str, Any]]:
    clean_ami = (ami_type or "amazon-linux-2023/x86_64/standard").strip().lower()
    want_arm = "/arm64/" in clean_ami
    want_arch = "arm64" if want_arm else "x86_64"
    if clean_ami.endswith("/nvidia"):
        want_cat = "nvidia"
    elif clean_ami.endswith("/neuron"):
        want_cat = "neuron"
    else:
        want_cat = "standard"

    return [
        t
        for t in catalog
        if want_arch in (t.get("architectures") or []) and t.get("category") == want_cat
    ]


def _get_cached_ec2_catalog_only(region: str) -> Optional[Tuple[List[Dict[str, Any]], str]]:
    clean_region = (region or "us-east-1").strip()
    mem_key = f"ec2_instance_types:{clean_region}"
    db_key = f"ec2_instance_types:{clean_region}"

    cached = _EKS_META_CACHE.get(mem_key)
    if cached and cached[0] > time.monotonic():
        return cached[1], "memory-cache"

    try:
        db = get_db()
        with db.session_scope() as session:
            row = (
                session.query(AwsCatalogCacheRecord)
                .filter(AwsCatalogCacheRecord.cache_key == db_key)
                .first()
            )
            if row and row.updated_at:
                age_sec = (datetime.utcnow() - row.updated_at).total_seconds()
                if age_sec < _EC2_CATALOG_TTL_SECONDS and isinstance(row.payload_json, list):
                    _EKS_META_CACHE[mem_key] = (time.monotonic() + 3600.0, row.payload_json)
                    return row.payload_json, "db-cache"
    except Exception as db_exc:
        logger.warning(f"EC2 catalog DB cache read skipped: {db_exc}")
    return None


def _load_ec2_catalog_sync(connection: Any, region: str, refresh: bool = False) -> Tuple[List[Dict[str, Any]], str]:
    clean_region = (region or getattr(connection, "region", None) or "us-east-1").strip()
    mem_key = f"ec2_instance_types:{clean_region}"
    db_key = f"ec2_instance_types:{clean_region}"

    if not refresh:
        cached_hit = _get_cached_ec2_catalog_only(clean_region)
        if cached_hit:
            return cached_hit

    ec2 = boto3.client(
        "ec2",
        aws_access_key_id=connection.accessKey,
        aws_secret_access_key=connection.secretKey,
        region_name=clean_region,
        config=Config(connect_timeout=5, read_timeout=30, retries={"max_attempts": 2}),
    )
    paginator = ec2.get_paginator("describe_instance_types")
    serialized: List[Dict[str, Any]] = []
    for page in paginator.paginate(PaginationConfig={"PageSize": 100}):
        for raw in page.get("InstanceTypes", []):
            serialized.append(_serialize_ec2_instance_type(raw))

    catalog = _sort_instance_types(serialized)
    _EKS_META_CACHE[mem_key] = (time.monotonic() + 3600.0, catalog)

    try:
        db = get_db()
        with db.session_scope() as session:
            existing = (
                session.query(AwsCatalogCacheRecord)
                .filter(AwsCatalogCacheRecord.cache_key == db_key)
                .first()
            )
            if existing:
                existing.payload_json = catalog
                existing.updated_at = datetime.utcnow()
            else:
                session.add(
                    AwsCatalogCacheRecord(
                        cache_key=db_key,
                        payload_json=catalog,
                        updated_at=datetime.utcnow(),
                    )
                )
    except Exception as db_exc:
        logger.warning(f"EC2 catalog DB cache write skipped: {db_exc}")

    return catalog, "aws-live"


async def _warm_ec2_instance_catalog(connection: Any, region: str) -> None:
    clean_region = (region or "us-east-1").strip()
    mem_key = f"ec2_instance_types:{clean_region}"
    cached = _EKS_META_CACHE.get(mem_key)
    if (cached and cached[0] > time.monotonic()) or clean_region in _EC2_WARMING_REGIONS:
        return
    _EC2_WARMING_REGIONS.add(clean_region)
    try:
        await asyncio.to_thread(_load_ec2_catalog_sync, connection, clean_region, False)
    except Exception as exc:
        logger.debug(f"Background EC2 catalog warm skipped for {clean_region}: {exc}")
    finally:
        _EC2_WARMING_REGIONS.discard(clean_region)


@app.get("/api/aws/eks-instance-types/{account_id}/{region}", dependencies=[Depends(require_auth_if_configured)])
async def get_eks_compatible_instance_types(
    account_id: str,
    region: str,
    ami_type: str = "amazon-linux-2023/x86_64/standard",
    refresh: bool = False,
    x_user_email: str = Header(...),
):
    try:
        if not refresh:
            cached_hit = await asyncio.to_thread(_get_cached_ec2_catalog_only, region)
            if cached_hit:
                catalog, source = cached_hit
                compatible = _filter_instance_types_for_ami(catalog, ami_type)
                return {
                    "region": region,
                    "amiType": ami_type,
                    "source": source,
                    "totalCatalogCount": len(catalog),
                    "count": len(compatible),
                    "instanceTypes": compatible,
                }

        connection = await connection_manager.get_catalog_connection(x_user_email, account_id)
        if not connection:
            raise HTTPException(
                status_code=400,
                detail="No active connection or platform catalog credentials found",
            )
        catalog, source = await asyncio.to_thread(_load_ec2_catalog_sync, connection, region, refresh)
        compatible = _filter_instance_types_for_ami(catalog, ami_type)
        return {
            "region": region,
            "amiType": ami_type,
            "source": source,
            "totalCatalogCount": len(catalog),
            "count": len(compatible),
            "instanceTypes": compatible,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch EC2 instance types: {str(e)}")


from tesserak_router import public_router as tesserak_public_router, router as tesserak_router
app.include_router(tesserak_public_router)
app.include_router(tesserak_router)
