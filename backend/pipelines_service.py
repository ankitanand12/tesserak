from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
import asyncio
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.parse

import boto3


def _utc_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _cli_env(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    env = dict(os.environ)
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + env.get("PATH", "")
    env["GIT_TERMINAL_PROMPT"] = "0"
    if extra:
        env.update(extra)
    return env


def _inject_git_token(repo_url: str, token: Optional[str]) -> str:
    clean = repo_url.strip()
    if not token:
        return clean
    if clean.startswith("https://"):
        parsed = urllib.parse.urlparse(clean)
        netloc = f"oauth2:{urllib.parse.quote(token, safe='')}@{parsed.hostname}"
        if parsed.port:
            netloc += f":{parsed.port}"
        return urllib.parse.urlunparse(parsed._replace(netloc=netloc))
    return clean


def _sanitize_logs(text: str, token: Optional[str]) -> str:
    if not text:
        return ""
    out = text
    if token:
        out = out.replace(token, "***TOKEN***")
        out = out.replace(urllib.parse.quote(token, safe=""), "***TOKEN***")
    return out


def verify_git_remote(repo_url: str, branch: str, token: Optional[str] = None) -> str:
    """Verify repository reachability and branch existence via real `git ls-remote`."""
    url = (repo_url or "").strip()
    if not url:
        raise ValueError("Repository URL is required.")
    if not (url.startswith("https://") or url.startswith("http://") or url.startswith("git@") or Path(url).exists()):
        raise ValueError("Enter a valid Git remote URL (https://...) or local repository path.")

    auth_url = _inject_git_token(url, token)
    proc = subprocess.run(
        ["git", "ls-remote", "--heads", auth_url, branch],
        capture_output=True,
        text=True,
        timeout=20,
        env=_cli_env(),
        check=False,
    )
    if proc.returncode != 0:
        err = _sanitize_logs(proc.stderr.strip() or proc.stdout.strip(), token)
        raise ValueError(f"Git verification failed for '{url}': {err}")
    if not proc.stdout.strip():
        raise ValueError(f"Branch '{branch}' was not found on remote repository '{url}'.")
    first_sha = proc.stdout.strip().split()[0][:12]
    return first_sha


async def list_deployable_clusters(user_email: str, connection_manager: Any) -> List[Dict[str, str]]:
    """Return real AWS EKS clusters and local kubectl contexts configured on the machine."""
    targets: List[Dict[str, str]] = []

    conn = await connection_manager.get_valid_connection(user_email)
    if conn:
        try:
            region = conn.region or "us-east-1"
            eks = boto3.client(
                "eks",
                aws_access_key_id=conn.accessKey,
                aws_secret_access_key=conn.secretKey,
                region_name=region,
            )
            for name in eks.list_clusters().get("clusters", []):
                targets.append({"id": f"eks:{name}", "name": name, "type": "aws-eks", "region": region})
        except Exception:
            pass

    proc = subprocess.run(
        ["kubectl", "config", "get-contexts", "-o", "name"],
        capture_output=True,
        text=True,
        timeout=5,
        env=_cli_env(),
        check=False,
    )
    if proc.returncode == 0:
        for line in proc.stdout.splitlines():
            ctx = line.strip()
            if ctx:
                targets.append({"id": f"ctx:{ctx}", "name": ctx, "type": "kubectl-context", "region": "local-kubeconfig"})

    return targets


def _run_cmd(cmd: List[str], cwd: Optional[str] = None, env: Optional[Dict[str, str]] = None, timeout: int = 120) -> Tuple[int, str, float]:
    start = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd,
            env=_cli_env(env),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        duration = round(time.perf_counter() - start, 2)
        combined = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        return proc.returncode, combined.strip() or "(no output)", duration
    except FileNotFoundError:
        return 127, f"CLI tool not installed: {cmd[0]}", round(time.perf_counter() - start, 2)
    except subprocess.TimeoutExpired:
        return 124, f"Command timed out after {timeout}s: {' '.join(cmd)}", round(time.perf_counter() - start, 2)


def _scan_k8s_manifests(manifest_target: Path, guardrails: List[Dict[str, Any]]) -> Tuple[bool, List[str]]:
    """Inspect real Kubernetes YAML files against active Tesserak Guardrail rules."""
    files = list(manifest_target.rglob("*.yml")) + list(manifest_target.rglob("*.yaml")) if manifest_target.is_dir() else [manifest_target]
    if not files:
        return False, [f"No .yaml/.yml manifests found at '{manifest_target}'"]

    enabled = {r["id"] for r in guardrails if r.get("enabled")}
    findings: List[str] = []
    blocked = False

    for f in files:
        text = f.read_text(errors="replace")
        rel = f.name
        if "gr-public-access" in enabled and re.search(r"privileged\s*:\s*true", text, re.IGNORECASE):
            findings.append(f"[BLOCK] {rel}: privileged: true container prohibited by Guardrails")
            blocked = True
        if ":latest" in text:
            findings.append(f"[WARN] {rel}: unpinned ':latest' container tag detected")
        if not findings:
            findings.append(f"[PASS] {rel}: manifest policy check clean")

    return (not blocked), findings


def _write_eks_kubeconfig(conn: Any, cluster_name: str, dest: Path) -> Dict[str, str]:
    region = conn.region or "us-east-1"
    eks = boto3.client(
        "eks",
        aws_access_key_id=conn.accessKey,
        aws_secret_access_key=conn.secretKey,
        region_name=region,
    )
    cluster = eks.describe_cluster(name=cluster_name)["cluster"]
    endpoint = cluster["endpoint"]
    ca_data = cluster["certificateAuthority"]["data"]

    kubeconfig_yaml = f"""apiVersion: v1
kind: Config
clusters:
- cluster:
    server: {endpoint}
    certificate-authority-data: {ca_data}
  name: tesserak-eks
contexts:
- context:
    cluster: tesserak-eks
    user: tesserak-eks-user
  name: tesserak-eks
current-context: tesserak-eks
users:
- name: tesserak-eks-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: aws
      args:
        - eks
        - get-token
        - --cluster-name
        - {cluster_name}
        - --region
        - {region}
"""
    dest.write_text(kubeconfig_yaml)
    return {
        "KUBECONFIG": str(dest),
        "AWS_ACCESS_KEY_ID": conn.accessKey,
        "AWS_SECRET_ACCESS_KEY": conn.secretKey,
        "AWS_DEFAULT_REGION": region,
    }


def _execute_pipeline_sync(
    pipeline: Dict[str, Any],
    branch: str,
    git_token: Optional[str],
    aws_conn: Optional[Any],
    guardrail_rules: List[Dict[str, Any]],
) -> Dict[str, Any]:
    run_num = pipeline.get("lastRunNumber", 0) + 1
    workdir = Path(tempfile.mkdtemp(prefix=f"tesserak_{pipeline['id']}_r{run_num}_"))
    repo_dir = workdir / "repo"
    stages: List[Dict[str, Any]] = []
    commit_sha = "unknown"
    overall_status = "Succeeded"
    total_duration = 0.0

    try:
        # Stage 1: Real Git Clone
        auth_url = _inject_git_token(pipeline["repositoryUrl"], git_token)
        rc, out, dur = _run_cmd(
            ["git", "clone", "--depth", "1", "--branch", branch, auth_url, str(repo_dir)],
            timeout=60,
        )
        out = _sanitize_logs(out, git_token)
        total_duration += dur
        if rc != 0:
            stages.append({"name": "Git Checkout", "status": "Failed", "durationSec": dur, "log": out})
            return {
                "runNumber": run_num,
                "commitSha": "none",
                "status": "Failed",
                "durationSec": total_duration,
                "stages": stages,
                "branch": branch,
                "triggeredAt": _utc_now(),
            }

        sha_rc, sha_out, _ = _run_cmd(["git", "log", "-1", "--format=%h | %an | %s"], cwd=str(repo_dir), timeout=10)
        if sha_rc == 0 and sha_out:
            commit_sha = sha_out.split("|")[0].strip()
        stages.append(
            {
                "name": "Git Checkout",
                "status": "Succeeded",
                "durationSec": dur,
                "log": f"Cloned {pipeline['repositoryUrl']}@{branch}\nHEAD: {sha_out}\n{out}",
            }
        )

        # Stage 2: Docker Build (when Dockerfile & imageTag configured, else inspect workspace)
        dockerfile_rel = (pipeline.get("dockerfilePath") or "").strip()
        image_tag = (pipeline.get("imageTag") or "").strip()
        if dockerfile_rel or image_tag:
            df_path = repo_dir / (dockerfile_rel or "Dockerfile")
            if not df_path.exists():
                stages.append(
                    {
                        "name": "Docker Build",
                        "status": "Failed",
                        "durationSec": 0.1,
                        "log": f"Dockerfile not found at '{dockerfile_rel or 'Dockerfile'}' in repository.",
                    }
                )
                return {
                    "runNumber": run_num,
                    "commitSha": commit_sha,
                    "status": "Failed",
                    "durationSec": total_duration,
                    "stages": stages,
                    "branch": branch,
                    "triggeredAt": _utc_now(),
                }
            tag = f"{image_tag}:{commit_sha}" if ":" not in image_tag else image_tag
            b_rc, b_out, b_dur = _run_cmd(
                ["docker", "build", "-t", tag, "-f", str(df_path), str(repo_dir)],
                cwd=str(repo_dir),
                timeout=180,
            )
            total_duration += b_dur
            if b_rc != 0:
                stages.append({"name": "Docker Build", "status": "Failed", "durationSec": b_dur, "log": b_out})
                return {
                    "runNumber": run_num,
                    "commitSha": commit_sha,
                    "status": "Failed",
                    "durationSec": total_duration,
                    "stages": stages,
                    "branch": branch,
                    "triggeredAt": _utc_now(),
                }
            stages.append({"name": "Docker Build", "status": "Succeeded", "durationSec": b_dur, "log": b_out})
        else:
            stages.append(
                {
                    "name": "Docker Build",
                    "status": "Skipped",
                    "durationSec": 0.0,
                    "log": "Manifest-only GitOps deployment (no Dockerfile build requested).",
                }
            )

        # Stage 3: Guardrail Manifest Security Scan
        manifest_rel = (pipeline.get("manifestPath") or ".").strip()
        manifest_target = repo_dir / manifest_rel
        if not manifest_target.exists():
            stages.append(
                {
                    "name": "Guardrail Manifest Scan",
                    "status": "Failed",
                    "durationSec": 0.1,
                    "log": f"Kubernetes manifest path '{manifest_rel}' does not exist in cloned repo.",
                }
            )
            return {
                "runNumber": run_num,
                "commitSha": commit_sha,
                "status": "Failed",
                "durationSec": total_duration,
                "stages": stages,
                "branch": branch,
                "triggeredAt": _utc_now(),
            }

        scan_ok, scan_logs = _scan_k8s_manifests(manifest_target, guardrail_rules)
        stages.append(
            {
                "name": "Guardrail Manifest Scan",
                "status": "Succeeded" if scan_ok else "Failed",
                "durationSec": 0.1,
                "log": "\n".join(scan_logs),
            }
        )
        if not scan_ok:
            return {
                "runNumber": run_num,
                "commitSha": commit_sha,
                "status": "Failed",
                "durationSec": total_duration,
                "stages": stages,
                "branch": branch,
                "triggeredAt": _utc_now(),
            }

        # Stage 4: Real Kubernetes / EKS Deployment (`kubectl apply`)
        target_cluster = pipeline["targetCluster"].strip()
        namespace = (pipeline.get("namespace") or "default").strip()
        kubectl_env: Dict[str, str] = {}
        base_kubectl = ["kubectl"]

        if target_cluster.startswith("eks:"):
            eks_name = target_cluster[len("eks:") :]
            if not aws_conn:
                stages.append(
                    {
                        "name": "Deploy to Cluster",
                        "status": "Failed",
                        "durationSec": 0.1,
                        "log": "No active AWS IAM connector found to authenticate against EKS cluster.",
                    }
                )
                return {
                    "runNumber": run_num,
                    "commitSha": commit_sha,
                    "status": "Failed",
                    "durationSec": total_duration,
                    "stages": stages,
                    "branch": branch,
                    "triggeredAt": _utc_now(),
                }
            try:
                kubectl_env = _write_eks_kubeconfig(aws_conn, eks_name, workdir / "kubeconfig")
            except Exception as exc:
                stages.append(
                    {
                        "name": "Deploy to Cluster",
                        "status": "Failed",
                        "durationSec": 0.1,
                        "log": f"AWS EKS describe_cluster failed for '{eks_name}': {exc}",
                    }
                )
                return {
                    "runNumber": run_num,
                    "commitSha": commit_sha,
                    "status": "Failed",
                    "durationSec": total_duration,
                    "stages": stages,
                    "branch": branch,
                    "triggeredAt": _utc_now(),
                }
        elif target_cluster.startswith("ctx:"):
            base_kubectl.extend(["--context", target_cluster[len("ctx:") :]])
        else:
            base_kubectl.extend(["--context", target_cluster])

        apply_rc, apply_out, apply_dur = _run_cmd(
            base_kubectl + ["apply", "-n", namespace, "-f", str(manifest_target)],
            env=kubectl_env,
            timeout=60,
        )
        total_duration += apply_dur
        if apply_rc != 0:
            stages.append({"name": "Deploy to Cluster", "status": "Failed", "durationSec": apply_dur, "log": apply_out})
            return {
                "runNumber": run_num,
                "commitSha": commit_sha,
                "status": "Failed",
                "durationSec": total_duration,
                "stages": stages,
                "branch": branch,
                "triggeredAt": _utc_now(),
            }
        stages.append({"name": "Deploy to Cluster", "status": "Succeeded", "durationSec": apply_dur, "log": apply_out})

        # Stage 5: Live Cluster Verification (`kubectl get pods,deployments`)
        ver_rc, ver_out, ver_dur = _run_cmd(
            base_kubectl + ["get", "deployments,pods,svc", "-n", namespace, "-o", "wide"],
            env=kubectl_env,
            timeout=30,
        )
        total_duration += ver_dur
        stages.append(
            {
                "name": "Cluster Pod Verification",
                "status": "Succeeded" if ver_rc == 0 else "Failed",
                "durationSec": ver_dur,
                "log": ver_out,
            }
        )
        if ver_rc != 0:
            overall_status = "Failed"

        return {
            "runNumber": run_num,
            "commitSha": commit_sha,
            "status": overall_status,
            "durationSec": round(total_duration, 2),
            "stages": stages,
            "branch": branch,
            "triggeredAt": _utc_now(),
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


async def run_pipeline_async(
    pipeline_id: str,
    user_email: str,
    branch: str,
    git_token: Optional[str],
    connection_manager: Any,
    load_state_fn: Callable[[str], Dict[str, Any]],
    save_state_fn: Callable[[str, Dict[str, Any]], None],
) -> None:
    """Execute the real CI/CD pipeline in a worker thread and persist final real logs/status."""
    state = load_state_fn(user_email)
    pipeline = next((p for p in state["pipelines"] if p["id"] == pipeline_id), None)
    if not pipeline:
        return

    aws_conn = await connection_manager.get_valid_connection(user_email)
    result = await asyncio.to_thread(
        _execute_pipeline_sync,
        dict(pipeline),
        branch,
        git_token,
        aws_conn,
        state.get("guardrailRules", []),
    )

    fresh = load_state_fn(user_email)
    target = next((p for p in fresh["pipelines"] if p["id"] == pipeline_id), None)
    if not target:
        return

    target["lastRunNumber"] = result["runNumber"]
    target["status"] = result["status"]
    target["durationSec"] = result["durationSec"]
    target["lastRunAt"] = result["triggeredAt"]
    target["triggeredBy"] = user_email
    target["stages"] = result["stages"]
    target["recentRuns"].insert(
        0,
        {
            "runNumber": result["runNumber"],
            "commitSha": result["commitSha"],
            "status": result["status"],
            "durationSec": result["durationSec"],
            "triggeredAt": result["triggeredAt"],
            "branch": result["branch"],
        },
    )
    target["recentRuns"] = target["recentRuns"][:8]
    save_state_fn(user_email, fresh)
