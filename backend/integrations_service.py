from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional, Tuple
import base64
import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

import boto3


def utc_now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def http_json_request(
    url: str,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    json_body: Optional[Dict[str, Any]] = None,
    form_body: Optional[Dict[str, str]] = None,
    timeout: int = 12,
) -> Tuple[int, Any, int]:
    req_headers = {"User-Agent": "Tesserak-ControlPlane/1.0", **(headers or {})}
    data: Optional[bytes] = None
    if json_body is not None:
        req_headers.setdefault("Content-Type", "application/json")
        data = json.dumps(json_body).encode("utf-8")
    elif form_body is not None:
        req_headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
        data = urllib.parse.urlencode(form_body).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            elapsed = max(1, int((time.perf_counter() - start) * 1000))
            try:
                return resp.status, json.loads(raw), elapsed
            except Exception:
                return resp.status, raw, elapsed
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        elapsed = max(1, int((time.perf_counter() - start) * 1000))
        try:
            return err.code, json.loads(raw), elapsed
        except Exception:
            return err.code, raw, elapsed
    except Exception as exc:
        elapsed = max(1, int((time.perf_counter() - start) * 1000))
        return 0, {"error": str(exc)}, elapsed


def mask_secret(secret: str) -> str:
    clean = (secret or "").strip()
    if not clean:
        return "Inherited from AWS IAM"
    if len(clean) <= 8:
        return "••••••••"
    return f"{clean[:4]}••••••••{clean[-4:]}"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _sign_rs256_with_openssl(signing_input: bytes, private_key_pem: str) -> bytes:
    with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as kf:
        kf.write(private_key_pem)
        key_path = kf.name
    try:
        proc = subprocess.run(
            ["/usr/bin/openssl", "dgst", "-sha256", "-sign", key_path],
            input=signing_input,
            capture_output=True,
            timeout=10,
            check=False,
        )
        if proc.returncode != 0:
            err = proc.stderr.decode("utf-8", errors="replace").strip()
            raise ValueError(f"Invalid GCP private key format: {err or 'OpenSSL signing failed'}")
        return proc.stdout
    finally:
        if os.path.exists(key_path):
            os.remove(key_path)


async def verify_integration_credentials(
    provider: str,
    category: str,
    scope: str,
    secret: str,
    endpoint: Optional[str] = None,
    username: Optional[str] = None,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    region: Optional[str] = None,
    connection_manager: Any = None,
    user_email: str = "",
) -> Dict[str, Any]:
    """
    Validate credentials directly against the real external provider API or AWS SDK.
    Raises ValueError with exact upstream errors when credentials are missing, dummy, or invalid.
    """
    prov = provider.strip().lower()
    token = (secret or "").strip()

    if prov == "github":
        if not token:
            raise ValueError("GitHub Personal Access Token (PAT) is required.")
        status, body, latency = http_json_request(
            "https://api.github.com/user",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
            },
        )
        if status != 200 or not isinstance(body, dict) or not body.get("login"):
            msg = body.get("message") if isinstance(body, dict) else str(body)
            raise ValueError(f"GitHub rejected token (HTTP {status}): {msg}")

        login = body["login"]
        resolved_scope = scope.strip() or f"github.com/{login}"
        metadata: Dict[str, Any] = {"login": login, "userUrl": body.get("html_url")}

        repo_slug = scope.strip().replace("https://github.com/", "").strip("/")
        if "/" in repo_slug and not repo_slug.startswith("github.com"):
            r_status, r_body, _ = http_json_request(
                f"https://api.github.com/repos/{repo_slug}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            )
            if r_status != 200:
                msg = r_body.get("message") if isinstance(r_body, dict) else str(r_body)
                raise ValueError(f"GitHub repository '{repo_slug}' not accessible (HTTP {r_status}): {msg}")
            metadata["verifiedRepo"] = r_body.get("full_name")
            resolved_scope = f"github.com/{r_body.get('full_name')}"
        else:
            r_status, r_body, _ = http_json_request(
                "https://api.github.com/user/repos?per_page=10&sort=updated",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            )
            if r_status == 200 and isinstance(r_body, list):
                metadata["reposSample"] = [r.get("full_name") for r in r_body if isinstance(r, dict)]

        return {
            "scope": resolved_scope,
            "credentialHint": mask_secret(token),
            "latencyMs": latency,
            "metadata": metadata,
            "secretPayload": {"token": token, "login": login},
        }

    if prov == "gitlab":
        if not token:
            raise ValueError("GitLab Personal / Project Access Token is required.")
        base = (endpoint or "https://gitlab.com").rstrip("/")
        if not base.startswith("http"):
            base = f"https://{base}"
        status, body, latency = http_json_request(
            f"{base}/api/v4/user",
            headers={"PRIVATE-TOKEN": token},
        )
        if status != 200 or not isinstance(body, dict) or not body.get("username"):
            msg = body.get("message") or body.get("error") if isinstance(body, dict) else str(body)
            raise ValueError(f"GitLab rejected token at {base} (HTTP {status}): {msg}")
        gl_user = body["username"]
        return {
            "scope": scope.strip() or f"{base}/{gl_user}",
            "credentialHint": mask_secret(token),
            "latencyMs": latency,
            "metadata": {"username": gl_user, "baseUrl": base},
            "secretPayload": {"token": token, "username": gl_user, "baseUrl": base},
        }

    if prov == "dockerhub":
        docker_user = (username or scope or "").strip().split("/")[-1]
        if not docker_user or not token:
            raise ValueError("Docker Hub username and access token/password are required.")
        status, body, latency = http_json_request(
            "https://hub.docker.com/v2/users/login",
            method="POST",
            json_body={"username": docker_user, "password": token},
        )
        if status != 200 or not isinstance(body, dict) or not body.get("token"):
            detail = body.get("detail") if isinstance(body, dict) else str(body)
            raise ValueError(f"Docker Hub authentication failed (HTTP {status}): {detail or 'Invalid credentials'}")

        r_status, r_body, _ = http_json_request(
            f"https://hub.docker.com/v2/repositories/{urllib.parse.quote(docker_user)}/?page_size=10",
            headers={"Authorization": f"JWT {body['token']}"},
        )
        repo_names = []
        if r_status == 200 and isinstance(r_body, dict):
            repo_names = [f"{docker_user}/{r.get('name')}" for r in r_body.get("results", [])]

        return {
            "scope": f"docker.io/{docker_user} · {len(repo_names)} repos listed",
            "credentialHint": mask_secret(token),
            "latencyMs": latency,
            "metadata": {"username": docker_user, "reposSample": repo_names},
            "secretPayload": {"username": docker_user, "token": token},
        }

    if prov == "cloudflare":
        if not token:
            raise ValueError("Cloudflare API Token is required.")
        status, body, latency = http_json_request(
            "https://api.cloudflare.com/client/v4/user/tokens/verify",
            headers={"Authorization": f"Bearer {token}"},
        )
        if status != 200 or not isinstance(body, dict) or not body.get("success"):
            errs = body.get("errors") if isinstance(body, dict) else str(body)
            raise ValueError(f"Cloudflare rejected API token (HTTP {status}): {errs}")

        z_status, z_body, _ = http_json_request(
            "https://api.cloudflare.com/client/v4/zones?per_page=10",
            headers={"Authorization": f"Bearer {token}"},
        )
        zones = []
        if z_status == 200 and isinstance(z_body, dict) and z_body.get("success"):
            zones = [z.get("name") for z in z_body.get("result", [])]

        return {
            "scope": scope.strip() or (", ".join(zones) if zones else "Token verified (no zones scoped)"),
            "credentialHint": mask_secret(token),
            "latencyMs": latency,
            "metadata": {"tokenStatus": body.get("result", {}).get("status"), "zones": zones},
            "secretPayload": {"token": token},
        }

    if prov == "gcp":
        if not token:
            raise ValueError("GCP Service Account JSON is required.")
        try:
            sa = json.loads(token)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid Service Account JSON: {exc}") from exc

        for req_key in ("client_email", "private_key", "project_id"):
            if not sa.get(req_key):
                raise ValueError(f"GCP Service Account JSON missing required field '{req_key}'.")

        token_uri = sa.get("token_uri") or "https://oauth2.googleapis.com/token"
        now = int(time.time())
        header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode("utf-8"))
        claim = _b64url(
            json.dumps(
                {
                    "iss": sa["client_email"],
                    "scope": "https://www.googleapis.com/auth/cloud-platform",
                    "aud": token_uri,
                    "exp": now + 3600,
                    "iat": now,
                }
            ).encode("utf-8")
        )
        signing_input = f"{header}.{claim}".encode("ascii")
        sig = _b64url(_sign_rs256_with_openssl(signing_input, sa["private_key"]))
        assertion = f"{header}.{claim}.{sig}"

        status, body, latency = http_json_request(
            token_uri,
            method="POST",
            form_body={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
        )
        if status != 200 or not isinstance(body, dict) or not body.get("access_token"):
            msg = body.get("error_description") or body.get("error") if isinstance(body, dict) else str(body)
            raise ValueError(f"GCP OAuth2 token exchange failed (HTTP {status}): {msg}")

        return {
            "scope": f"project:{sa['project_id']} · {sa['client_email']}",
            "credentialHint": mask_secret(sa.get("private_key_id") or sa["client_email"]),
            "latencyMs": latency,
            "metadata": {"projectId": sa["project_id"], "clientEmail": sa["client_email"]},
            "secretPayload": {"serviceAccountJson": token},
        }

    if prov in ("aws-ecr", "aws-secrets", "aws"):
        ak = (access_key or "").strip()
        sk = (secret_key or "").strip()
        reg = (region or "").strip()

        if not (ak and sk) and connection_manager is not None and user_email:
            conn = await connection_manager.get_active_connection(user_email)
            if conn:
                ak = conn.accessKey
                sk = conn.secretKey
                reg = reg or conn.region or "us-east-1"

        if not ak or not sk:
            raise ValueError(
                "AWS Access Key + Secret Key are required (or connect an AWS IAM account first)."
            )
        reg = reg or "us-east-1"
        start = time.perf_counter()
        try:
            session = boto3.Session(
                aws_access_key_id=ak,
                aws_secret_access_key=sk,
                region_name=reg,
            )
            account_id = session.client("sts").get_caller_identity()["Account"]
            metadata: Dict[str, Any] = {"accountId": account_id, "region": reg}

            if prov == "aws-ecr":
                repos_resp = session.client("ecr").describe_repositories(maxResults=25)
                repos = repos_resp.get("repositories", [])
                metadata["repositories"] = [r.get("repositoryName") for r in repos]
                resolved_scope = f"{reg} · {account_id}.dkr.ecr ({len(repos)} repos)"
            elif prov == "aws-secrets":
                sec_resp = session.client("secretsmanager").list_secrets(MaxResults=20)
                secrets = sec_resp.get("SecretList", [])
                metadata["secretsCount"] = len(secrets)
                resolved_scope = f"{reg} · {len(secrets)} Secrets Verified"
            else:
                resolved_scope = f"{reg} · Account {account_id}"

            latency = max(1, int((time.perf_counter() - start) * 1000))
        except Exception as exc:
            raise ValueError(f"AWS SDK verification failed: {exc}") from exc

        return {
            "scope": resolved_scope,
            "credentialHint": mask_secret(ak),
            "latencyMs": latency,
            "metadata": metadata,
            "secretPayload": {"accessKey": ak, "secretKey": sk, "region": reg},
        }

    raise ValueError(f"Unsupported integration provider '{provider}'. Supported: github, gitlab, aws-ecr, aws-secrets, dockerhub, cloudflare, gcp.")
