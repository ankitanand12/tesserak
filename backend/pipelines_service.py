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


def build_eks_kubeconfig_yaml(cluster_name: str, endpoint: str, ca_data: str, region: str) -> str:
    """Build an IAM-exec kubeconfig YAML using `aws eks get-token` for an EKS cluster."""
    return f"""apiVersion: v1
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


def build_eks_cli_env(conn: Any, kubeconfig_path: Path, region: Optional[str] = None) -> Dict[str, str]:
    resolved_region = region or getattr(conn, "region", None) or "us-east-1"
    return {
        "KUBECONFIG": str(kubeconfig_path),
        "AWS_ACCESS_KEY_ID": conn.accessKey,
        "AWS_SECRET_ACCESS_KEY": conn.secretKey,
        "AWS_DEFAULT_REGION": resolved_region,
    }


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
    dest.write_text(build_eks_kubeconfig_yaml(cluster_name, endpoint, ca_data, region))
    return build_eks_cli_env(conn, dest, region)


def _parse_applied_workloads(apply_out: str) -> Tuple[List[str], List[str]]:
    """Extract applied Kubernetes workload controllers and standalone pods from `kubectl apply` output."""
    controllers: List[str] = []
    pods: List[str] = []
    for kind_ref in re.findall(r"((?:deployment|statefulset|daemonset)\.apps/[^\s]+)", apply_out):
        if kind_ref not in controllers:
            controllers.append(kind_ref)
    for pod_ref in re.findall(r"\b(pod/[^\s]+)", apply_out):
        if pod_ref not in pods:
            pods.append(pod_ref)
    return controllers, pods


def _verify_cluster_rollout(
    base_kubectl: List[str],
    kubectl_env: Dict[str, str],
    namespace: str,
    apply_out: str,
) -> Tuple[bool, str, float]:
    """Wait for deployed workloads/pods to reach Running/Ready before capturing final cluster state."""
    controllers, standalone_pods = _parse_applied_workloads(apply_out)
    log_sections: List[str] = []
    total_dur = 0.0
    rollout_ok = True

    for ctrl_ref in controllers:
        rc, out, dur = _run_cmd(
            base_kubectl + ["rollout", "status", ctrl_ref, "-n", namespace, "--timeout=120s"],
            env=kubectl_env,
            timeout=125,
        )
        total_dur += dur
        log_sections.append(out)
        if rc != 0:
            rollout_ok = False

    if not controllers and standalone_pods:
        for pod_ref in standalone_pods:
            rc, out, dur = _run_cmd(
                base_kubectl + ["wait", "--for=condition=Ready", pod_ref, "-n", namespace, "--timeout=90s"],
                env=kubectl_env,
                timeout=95,
            )
            total_dur += dur
            log_sections.append(out)
            if rc != 0:
                rollout_ok = False

    ver_rc, ver_out, ver_dur = _run_cmd(
        base_kubectl + ["get", "deployments,pods,svc", "-n", namespace, "-o", "wide"],
        env=kubectl_env,
        timeout=30,
    )
    total_dur += ver_dur
    log_sections.append(ver_out)

    if ver_rc != 0:
        rollout_ok = False

    if not rollout_ok:
        _, ev_out, ev_dur = _run_cmd(
            base_kubectl + ["get", "events", "-n", namespace, "--field-selector=type=Warning", "--sort-by=.lastTimestamp"],
            env=kubectl_env,
            timeout=20,
        )
        total_dur += ev_dur
        if ev_out and "(no output)" not in ev_out:
            log_sections.append("--- Recent Warning Events ---\n" + "\n".join(ev_out.splitlines()[-15:]))

    return rollout_ok, "\n\n".join(s for s in log_sections if s).strip(), round(total_dur, 2)


def _prepare_kubectl_target(
    target_cluster: str,
    aws_conn: Optional[Any],
    workdir: Path,
) -> Tuple[Optional[List[str]], Dict[str, str], Optional[str]]:
    """Build kubectl base args and env for either eks:<cluster> or ctx:<context>."""
    base_kubectl = ["kubectl"]
    kubectl_env: Dict[str, str] = {}
    clean_target = (target_cluster or "").strip()
    if clean_target.startswith("eks:"):
        eks_name = clean_target[len("eks:") :]
        if not aws_conn:
            return None, {}, "No active AWS IAM connector found to authenticate against EKS cluster."
        try:
            kubectl_env = _write_eks_kubeconfig(aws_conn, eks_name, workdir / "kubeconfig")
        except Exception as exc:
            return None, {}, f"AWS EKS describe_cluster failed for '{eks_name}': {exc}"
    elif clean_target.startswith("ctx:"):
        base_kubectl.extend(["--context", clean_target[len("ctx:") :]])
    elif clean_target:
        base_kubectl.extend(["--context", clean_target])
    return base_kubectl, kubectl_env, None


def _extract_applied_resource_refs_from_stages(stages: List[Dict[str, Any]]) -> List[str]:
    refs: List[str] = []
    for st in stages or []:
        if st.get("name") == "Deploy to Cluster" and st.get("log"):
            for m in re.findall(
                r"^([a-z0-9.-]+/[a-z0-9.-]+)\s+(?:created|configured|unchanged)\b",
                str(st["log"]),
                flags=re.MULTILINE,
            ):
                if m not in refs:
                    refs.append(m)
    return refs


def cleanup_pipeline_deployments_sync(
    pipeline: Dict[str, Any],
    git_token: Optional[str],
    aws_conn: Optional[Any],
) -> Dict[str, Any]:
    """Delete Kubernetes workloads/services created by a pipeline before removing it from Tesserak."""
    has_deployed = (pipeline.get("lastRunNumber") or 0) > 0 or any(
        st.get("name") == "Deploy to Cluster" and st.get("status") == "Succeeded"
        for st in (pipeline.get("stages") or [])
    )
    if not has_deployed:
        return {
            "attempted": False,
            "cleaned": True,
            "deletedResources": [],
            "log": "Pipeline has no deployed runs to clean up.",
        }

    workdir = Path(tempfile.mkdtemp(prefix=f"tesserak_del_{pipeline['id']}_"))
    repo_dir = workdir / "repo"
    namespace = (pipeline.get("namespace") or "default").strip() or "default"
    target_cluster = (pipeline.get("targetCluster") or "").strip()

    try:
        base_kubectl, kubectl_env, prep_err = _prepare_kubectl_target(target_cluster, aws_conn, workdir)
        if prep_err or not base_kubectl:
            return {
                "attempted": True,
                "cleaned": False,
                "deletedResources": [],
                "error": prep_err or "Target cluster unavailable.",
            }

        deleted_lines: List[str] = []
        errors: List[str] = []
        manifest_deleted = False

        repo_url = (pipeline.get("repositoryUrl") or "").strip()
        branch = (pipeline.get("branch") or "main").strip()
        manifest_rel = (pipeline.get("manifestPath") or ".").strip()

        if repo_url:
            auth_url = _inject_git_token(repo_url, git_token)
            clone_rc, clone_out, _ = _run_cmd(
                ["git", "clone", "--depth", "1", "--branch", branch, auth_url, str(repo_dir)],
                timeout=60,
            )
            if clone_rc == 0:
                manifest_target = repo_dir / manifest_rel
                if manifest_target.exists():
                    del_rc, del_out, _ = _run_cmd(
                        base_kubectl
                        + [
                            "delete",
                            "-n",
                            namespace,
                            "-f",
                            str(manifest_target),
                            "--ignore-not-found=true",
                            "--wait=false",
                        ],
                        env=kubectl_env,
                        timeout=60,
                    )
                    if del_rc == 0:
                        manifest_deleted = True
                        for line in del_out.splitlines():
                            clean_line = line.strip()
                            if clean_line and clean_line != "(no output)":
                                deleted_lines.append(clean_line)
                    else:
                        errors.append(del_out)
            else:
                errors.append(_sanitize_logs(clone_out, git_token))

        # Fallback/supplement: also delete explicit resource refs captured in Deploy logs
        recorded_refs = _extract_applied_resource_refs_from_stages(pipeline.get("stages") or [])
        if recorded_refs and not manifest_deleted:
            del_rc, del_out, _ = _run_cmd(
                base_kubectl
                + ["delete", "-n", namespace, *recorded_refs, "--ignore-not-found=true", "--wait=false"],
                env=kubectl_env,
                timeout=60,
            )
            if del_rc == 0:
                for line in del_out.splitlines():
                    clean_line = line.strip()
                    if clean_line and clean_line != "(no output)" and clean_line not in deleted_lines:
                        deleted_lines.append(clean_line)
            else:
                errors.append(del_out)

        return {
            "attempted": True,
            "cleaned": len(deleted_lines) > 0 or manifest_deleted or not errors,
            "deletedResources": deleted_lines,
            "error": "; ".join(errors) if errors and not deleted_lines else None,
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


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
        base_kubectl, kubectl_env, prep_err = _prepare_kubectl_target(target_cluster, aws_conn, workdir)
        if prep_err or not base_kubectl:
            stages.append(
                {
                    "name": "Deploy to Cluster",
                    "status": "Failed",
                    "durationSec": 0.1,
                    "log": prep_err or "Failed to configure cluster credentials.",
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

        # Stage 5: Wait for container/rollout readiness and capture Running pods & services
        ver_ok, ver_out, ver_dur = _verify_cluster_rollout(
            base_kubectl,
            kubectl_env,
            namespace,
            apply_out,
        )
        total_duration += ver_dur
        stages.append(
            {
                "name": "Cluster Pod Verification",
                "status": "Succeeded" if ver_ok else "Failed",
                "durationSec": ver_dur,
                "log": ver_out,
            }
        )
        if not ver_ok:
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
