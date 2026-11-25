import asyncio
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any, Dict, Literal, Optional

from dotenv import load_dotenv
from fastapi import HTTPException, Request
from fastapi_plugin import Auth0FastAPI

from db import DatabaseManager, UserRecord, get_db, normalize_email

load_dotenv()

AUTH0_DOMAIN = os.getenv("AUTH0_DOMAIN", "").strip()
AUTH0_AUDIENCE = os.getenv("AUTH0_AUDIENCE", "").strip()

is_auth0_enabled = bool(
    AUTH0_DOMAIN
    and AUTH0_AUDIENCE
    and "your-tenant" not in AUTH0_DOMAIN
)

auth0_verifier: Optional[Auth0FastAPI] = (
    Auth0FastAPI(
        domain=AUTH0_DOMAIN,
        audience=AUTH0_AUDIENCE,
        dpop_enabled=False,
    )
    if is_auth0_enabled
    else None
)

_require_auth_dependency = auth0_verifier.require_auth() if auth0_verifier else None

_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7  # 7 days


def _get_session_secret(db: Optional[DatabaseManager] = None) -> bytes:
    return (db or get_db()).get_app_secret()


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(val: str) -> bytes:
    padding = "=" * ((4 - len(val) % 4) % 4)
    return base64.urlsafe_b64decode(val + padding)


def _hash_password(password: str, salt_hex: Optional[str] = None) -> str:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return f"{salt.hex()}:{digest.hex()}"


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt_hex, _ = stored_hash.split(":", 1)
    except ValueError:
        return False
    candidate = _hash_password(password, salt_hex=salt_hex)
    return hmac.compare_digest(candidate, stored_hash)


def _serialize_user(row: UserRecord) -> Dict[str, Any]:
    return {
        "email": row.email,
        "firstName": row.first_name or "",
        "lastName": row.last_name or "",
        "accountType": row.account_type or "individual",
        "organization": row.organization or "Individual Workspace",
        "authProvider": row.auth_provider or "email",
        "mobile": {
            "countryCode": row.mobile_country_code or "+1",
            "number": row.mobile_number or "",
        },
        "avatarUrl": row.avatar_url or "",
        "createdAt": row.created_at,
    }


def get_user_profile(email: str, db: Optional[DatabaseManager] = None) -> Optional[Dict[str, Any]]:
    clean_email = normalize_email(email)
    db_mgr = db or get_db()
    with db_mgr.session_scope() as session:
        row = session.get(UserRecord, clean_email)
        return _serialize_user(row) if row else None


def upsert_user_profile(
    email: str,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    account_type: Optional[Literal["individual", "organization"]] = None,
    organization: Optional[str] = None,
    auth_provider: Optional[str] = None,
    mobile: Optional[Dict[str, Any]] = None,
    avatar_url: Optional[str] = None,
    db: Optional[DatabaseManager] = None,
) -> Dict[str, Any]:
    clean_email = normalize_email(email)
    db_mgr = db or get_db()
    with db_mgr.session_scope() as session:
        row = session.get(UserRecord, clean_email)
        if not row:
            row = UserRecord(
                email=clean_email,
                first_name=(first_name or "").strip(),
                last_name=(last_name or "").strip(),
                account_type=account_type or "individual",
                organization=(organization or "Individual Workspace").strip(),
                auth_provider=auth_provider or "local",
                mobile_country_code=(mobile or {}).get("countryCode", "+1") if isinstance(mobile, dict) else "+1",
                mobile_number=(mobile or {}).get("number", "") if isinstance(mobile, dict) else "",
                avatar_url=avatar_url,
                created_at=int(time.time()),
            )
            session.add(row)
        else:
            if first_name is not None:
                row.first_name = first_name.strip()
            if last_name is not None:
                row.last_name = last_name.strip()
            if account_type is not None:
                row.account_type = account_type
            if organization is not None:
                row.organization = organization.strip()
            if auth_provider is not None:
                row.auth_provider = auth_provider
            if isinstance(mobile, dict):
                if mobile.get("countryCode") is not None:
                    row.mobile_country_code = str(mobile.get("countryCode") or "+1")
                if mobile.get("number") is not None:
                    row.mobile_number = str(mobile.get("number") or "")
            if avatar_url is not None:
                row.avatar_url = avatar_url
        session.flush()
        return _serialize_user(row)


def issue_email_session_token(user: Dict[str, Any]) -> str:
    now = int(time.time())
    payload = {
        "sub": user["email"],
        "email": user["email"],
        "accountType": user.get("accountType", "individual"),
        "organization": user.get("organization", "Individual Workspace"),
        "iat": now,
        "exp": now + _TOKEN_TTL_SECONDS,
    }
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(_get_session_secret(), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return f"tesserak.{payload_b64}.{_b64url_encode(sig)}"


def verify_email_session_token(token: str) -> Dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != "tesserak":
        raise HTTPException(
            status_code=401,
            detail={"error": "invalid_token", "error_description": "Malformed email session token"},
        )
    _, payload_b64, sig_b64 = parts
    expected_sig = _b64url_encode(
        hmac.new(_get_session_secret(), payload_b64.encode("ascii"), hashlib.sha256).digest()
    )
    if not hmac.compare_digest(sig_b64, expected_sig):
        raise HTTPException(
            status_code=401,
            detail={"error": "invalid_token", "error_description": "Invalid email session token signature"},
        )
    try:
        claims = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except Exception:
        raise HTTPException(
            status_code=401,
            detail={"error": "invalid_token", "error_description": "Corrupt email session payload"},
        )
    if int(claims.get("exp", 0)) < int(time.time()):
        raise HTTPException(
            status_code=401,
            detail={"error": "invalid_token", "error_description": "Email session token expired"},
        )
    return claims


def register_email_user(
    email: str,
    password: str,
    first_name: str,
    last_name: str,
    account_type: Literal["individual", "organization"],
    organization: Optional[str] = None,
    db: Optional[DatabaseManager] = None,
) -> Dict[str, Any]:
    clean_email = (email or "").strip().lower()
    if not clean_email or "@" not in clean_email:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if not password or len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    if not first_name.strip() or not last_name.strip():
        raise HTTPException(status_code=400, detail="First name and last name are required.")

    clean_org = (organization or "").strip()
    if account_type == "organization" and not clean_org:
        raise HTTPException(status_code=400, detail="Organization name is required for organization accounts.")

    db_mgr = db or get_db()
    with db_mgr.session_scope() as session:
        existing = session.get(UserRecord, clean_email)
        if existing and existing.password_hash:
            raise HTTPException(status_code=409, detail="An account with this email already exists. Please sign in.")

        resolved_org = clean_org if account_type == "organization" else "Individual Workspace"
        if existing:
            existing.password_hash = _hash_password(password)
            existing.first_name = first_name.strip()
            existing.last_name = last_name.strip()
            existing.account_type = account_type
            existing.organization = resolved_org
            existing.auth_provider = "email"
            row = existing
        else:
            row = UserRecord(
                email=clean_email,
                password_hash=_hash_password(password),
                first_name=first_name.strip(),
                last_name=last_name.strip(),
                account_type=account_type,
                organization=resolved_org,
                auth_provider="email",
                mobile_country_code="+1",
                mobile_number="",
                created_at=int(time.time()),
            )
            session.add(row)
        session.flush()
        public_user = _serialize_user(row)
        return {"token": issue_email_session_token(public_user), "user": public_user}


def authenticate_email_user(
    email: str,
    password: str,
    db: Optional[DatabaseManager] = None,
) -> Dict[str, Any]:
    clean_email = (email or "").strip().lower()
    db_mgr = db or get_db()
    with db_mgr.session_scope() as session:
        row = session.get(UserRecord, clean_email)
        if not row or not row.password_hash or not _verify_password(password or "", row.password_hash):
            raise HTTPException(status_code=401, detail="Invalid email or password.")

        public_user = _serialize_user(row)
        return {"token": issue_email_session_token(public_user), "user": public_user}


_auth0_warmup_lock = asyncio.Lock()
_auth0_warmed = False


async def require_auth_if_configured(request: Request) -> Dict[str, Any]:
    """Accept either a verified Auth0 RS256 JWT or a backend-signed Email session token."""
    global _auth0_warmed
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        if token.startswith("tesserak."):
            return verify_email_session_token(token)

    if _require_auth_dependency is None:
        return {}
    if not _auth0_warmed:
        async with _auth0_warmup_lock:
            if not _auth0_warmed:
                result = await _require_auth_dependency(request)
                _auth0_warmed = True
                return result
    return await _require_auth_dependency(request)
