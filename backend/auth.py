import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import smtplib
import ssl
import time
from email.message import EmailMessage
from typing import Any, Dict, Literal, Optional

from dotenv import load_dotenv
from fastapi import HTTPException, Request
from fastapi_plugin import Auth0FastAPI

from db import DatabaseManager, EmailVerificationRecord, UserRecord, get_db, normalize_email

logger = logging.getLogger("tesserak.auth")

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
_OTP_TTL_SECONDS = 60 * 10  # 10 minutes
_OTP_RESEND_COOLDOWN_SECONDS = 30
_OTP_MAX_ATTEMPTS = 5
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


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


def issue_email_session_token(user: Dict[str, Any], db: Optional[DatabaseManager] = None) -> str:
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
    sig = hmac.new(_get_session_secret(db), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return f"tesserak.{payload_b64}.{_b64url_encode(sig)}"


def verify_email_session_token(token: str, db: Optional[DatabaseManager] = None) -> Dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != "tesserak":
        raise HTTPException(
            status_code=401,
            detail={"error": "invalid_token", "error_description": "Malformed email session token"},
        )
    _, payload_b64, sig_b64 = parts
    expected_sig = _b64url_encode(
        hmac.new(_get_session_secret(db), payload_b64.encode("ascii"), hashlib.sha256).digest()
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


def _validate_email(email: str) -> str:
    clean_email = (email or "").strip().lower()
    if not clean_email or not _EMAIL_RE.match(clean_email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    return clean_email


def _generate_otp_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _hash_otp(email: str, otp: str, db: Optional[DatabaseManager] = None) -> str:
    msg = f"{email}:{otp.strip()}".encode("utf-8")
    return hmac.new(_get_session_secret(db), msg, hashlib.sha256).hexdigest()


def _send_otp_email(
    recipient: str,
    otp_code: str,
    first_name: str,
    account_type: str,
    organization: str,
) -> str:
    smtp_host = os.getenv("SMTP_HOST", "").strip()
    if not smtp_host:
        logger.info(
            "[Tesserak Auth] SMTP_HOST not set; local verification OTP for %s (%s): %s",
            recipient,
            organization,
            otp_code,
        )
        return "dev-preview"

    smtp_port = int(os.getenv("SMTP_PORT", "587").strip() or "587")
    smtp_user = (os.getenv("SMTP_USER") or os.getenv("SMTP_USERNAME") or "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    smtp_from = os.getenv("SMTP_FROM", "").strip() or smtp_user or "no-reply@tesserak.local"
    use_ssl = os.getenv("SMTP_USE_SSL", "").strip().lower() in {"1", "true", "yes"} or smtp_port == 465
    use_tls_env = os.getenv("SMTP_USE_TLS", "").strip().lower()
    use_tls = (smtp_port == 587) if not use_tls_env else use_tls_env in {"1", "true", "yes"}

    scope_label = f"Organization ({organization})" if account_type == "organization" else "Individual Workspace"
    display_name = first_name.strip() or recipient.split("@")[0]

    msg = EmailMessage()
    msg["Subject"] = f"Your Tesserak verification code: {otp_code}"
    msg["From"] = smtp_from
    msg["To"] = recipient
    msg.set_content(
        f"Hi {display_name},\n\n"
        f"Use this 6-digit OTP to verify your email and create your Tesserak {scope_label} account:\n\n"
        f"    {otp_code}\n\n"
        f"This code expires in 10 minutes.\n"
        f"If you did not request this, you can safely ignore this email.\n"
    )
    msg.add_alternative(
        f"""
        <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;">
          <h2 style="margin:0 0 8px;color:#09090b;">Verify your Tesserak email</h2>
          <p style="color:#475569;margin:0 0 16px;">Hi {display_name}, confirm your {scope_label} signup with this 6-digit verification code:</p>
          <div style="font-size:28px;font-weight:800;letter-spacing:6px;padding:14px 18px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:10px;text-align:center;">
            {otp_code}
          </div>
          <p style="color:#64748b;font-size:12px;margin:16px 0 0;">This verification code expires in 10 minutes.</p>
        </div>
        """,
        subtype="html",
    )

    try:
        if use_ssl:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=12, context=ssl.create_default_context()) as client:
                if smtp_user:
                    client.login(smtp_user, smtp_password)
                client.send_message(msg)
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=12) as client:
                if use_tls:
                    client.starttls(context=ssl.create_default_context())
                if smtp_user:
                    client.login(smtp_user, smtp_password)
                client.send_message(msg)
        return "smtp"
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to send verification OTP email via SMTP ({exc}).",
        )


def _build_otp_challenge_response(
    email: str,
    pending_payload: Dict[str, Any],
    delivery_mode: str,
    otp_code: str,
) -> Dict[str, Any]:
    response: Dict[str, Any] = {
        "verificationRequired": True,
        "email": email,
        "accountType": pending_payload.get("accountType", "individual"),
        "organization": pending_payload.get("organization", "Individual Workspace"),
        "expiresInSeconds": _OTP_TTL_SECONDS,
        "resendAfterSeconds": _OTP_RESEND_COOLDOWN_SECONDS,
        "deliveryMode": delivery_mode,
        "message": (
            f"Verification code sent to {email}. Enter the 6-digit OTP to create your account."
            if delivery_mode == "smtp"
            else f"Verification code generated for {email}. SMTP is not configured locally; use the preview code below."
        ),
    }
    if delivery_mode != "smtp":
        response["devOtp"] = otp_code
    return response


def register_email_user(
    email: str,
    password: str,
    first_name: str,
    last_name: str,
    account_type: Literal["individual", "organization"],
    organization: Optional[str] = None,
    db: Optional[DatabaseManager] = None,
) -> Dict[str, Any]:
    clean_email = _validate_email(email)
    if not password or len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    if not first_name.strip() or not last_name.strip():
        raise HTTPException(status_code=400, detail="First name and last name are required.")

    clean_org = (organization or "").strip()
    if account_type == "organization" and not clean_org:
        raise HTTPException(status_code=400, detail="Organization name is required for organization accounts.")

    resolved_org = clean_org if account_type == "organization" else "Individual Workspace"
    db_mgr = db or get_db()
    with db_mgr.session_scope() as session:
        existing = session.get(UserRecord, clean_email)
        if existing and existing.password_hash:
            raise HTTPException(status_code=409, detail="An account with this email already exists. Please sign in.")

    otp_code = _generate_otp_code()
    pending_payload = {
        "passwordHash": _hash_password(password),
        "firstName": first_name.strip(),
        "lastName": last_name.strip(),
        "accountType": account_type,
        "organization": resolved_org,
    }
    delivery_mode = _send_otp_email(
        recipient=clean_email,
        otp_code=otp_code,
        first_name=pending_payload["firstName"],
        account_type=account_type,
        organization=resolved_org,
    )

    now = int(time.time())
    with db_mgr.session_scope() as session:
        record = session.get(EmailVerificationRecord, clean_email)
        otp_digest = _hash_otp(clean_email, otp_code, db_mgr)
        if record:
            record.otp_hash = otp_digest
            record.pending_user_json = pending_payload
            record.expires_at = now + _OTP_TTL_SECONDS
            record.attempts = 0
            record.resend_available_at = now + _OTP_RESEND_COOLDOWN_SECONDS
            record.created_at = now
        else:
            session.add(
                EmailVerificationRecord(
                    email=clean_email,
                    otp_hash=otp_digest,
                    pending_user_json=pending_payload,
                    expires_at=now + _OTP_TTL_SECONDS,
                    attempts=0,
                    resend_available_at=now + _OTP_RESEND_COOLDOWN_SECONDS,
                    created_at=now,
                )
            )
    return _build_otp_challenge_response(clean_email, pending_payload, delivery_mode, otp_code)


def verify_email_registration_otp(
    email: str,
    otp: str,
    db: Optional[DatabaseManager] = None,
) -> Dict[str, Any]:
    clean_email = _validate_email(email)
    clean_otp = re.sub(r"\s+", "", otp or "")
    if len(clean_otp) != 6 or not clean_otp.isdigit():
        raise HTTPException(status_code=400, detail="Enter the 6-digit verification code.")

    db_mgr = db or get_db()
    now = int(time.time())
    failure_status: Optional[int] = None
    failure_detail = ""
    public_user: Optional[Dict[str, Any]] = None

    with db_mgr.session_scope() as session:
        pending = session.get(EmailVerificationRecord, clean_email)
        if not pending:
            existing = session.get(UserRecord, clean_email)
            if existing and existing.password_hash:
                failure_status = 409
                failure_detail = "An account with this email is already verified. Please sign in."
            else:
                failure_status = 404
                failure_detail = "No pending verification found for this email. Please create your account again."
        elif int(pending.expires_at or 0) < now:
            failure_status = 400
            failure_detail = "Verification code expired. Click Resend Code to get a new 6-digit OTP."
        elif int(pending.attempts or 0) >= _OTP_MAX_ATTEMPTS:
            failure_status = 429
            failure_detail = "Too many incorrect attempts. Click Resend Code to generate a new 6-digit OTP."
        elif not hmac.compare_digest(pending.otp_hash, _hash_otp(clean_email, clean_otp, db_mgr)):
            pending.attempts = int(pending.attempts or 0) + 1
            remaining = max(0, _OTP_MAX_ATTEMPTS - pending.attempts)
            failure_status = 400
            failure_detail = (
                f"Invalid verification code. {remaining} attempt(s) remaining."
                if remaining > 0
                else "Invalid verification code. Maximum attempts reached; click Resend Code."
            )
        else:
            existing = session.get(UserRecord, clean_email)
            if existing and existing.password_hash:
                session.delete(pending)
                failure_status = 409
                failure_detail = "An account with this email already exists. Please sign in."
            else:
                spec = dict(pending.pending_user_json or {})
                account_type = spec.get("accountType") if spec.get("accountType") in ("individual", "organization") else "individual"
                resolved_org = spec.get("organization") or ("Individual Workspace" if account_type == "individual" else "Team Workspace")
                if existing:
                    existing.password_hash = spec.get("passwordHash")
                    existing.first_name = spec.get("firstName", "")
                    existing.last_name = spec.get("lastName", "")
                    existing.account_type = account_type
                    existing.organization = resolved_org
                    existing.auth_provider = "email"
                    row = existing
                else:
                    row = UserRecord(
                        email=clean_email,
                        password_hash=spec.get("passwordHash"),
                        first_name=spec.get("firstName", ""),
                        last_name=spec.get("lastName", ""),
                        account_type=account_type,
                        organization=resolved_org,
                        auth_provider="email",
                        mobile_country_code="+1",
                        mobile_number="",
                        created_at=now,
                    )
                    session.add(row)
                session.delete(pending)
                session.flush()
                public_user = _serialize_user(row)

    if failure_status is not None:
        raise HTTPException(status_code=failure_status, detail=failure_detail)
    assert public_user is not None
    return {
        "verified": True,
        "token": issue_email_session_token(public_user, db=db_mgr),
        "user": public_user,
        "message": (
            f"Organization account verified and created for {public_user['organization']}."
            if public_user["accountType"] == "organization"
            else f"Individual account verified and created for {public_user['email']}."
        ),
    }


def resend_email_registration_otp(
    email: str,
    db: Optional[DatabaseManager] = None,
) -> Dict[str, Any]:
    clean_email = _validate_email(email)
    db_mgr = db or get_db()
    now = int(time.time())
    with db_mgr.session_scope() as session:
        existing = session.get(UserRecord, clean_email)
        if existing and existing.password_hash:
            raise HTTPException(status_code=409, detail="An account with this email already exists. Please sign in.")
        pending = session.get(EmailVerificationRecord, clean_email)
        if not pending:
            raise HTTPException(status_code=404, detail="No pending verification found for this email. Please submit the Create Account form first.")
        wait_seconds = int(pending.resend_available_at or 0) - now
        if wait_seconds > 0:
            raise HTTPException(status_code=429, detail=f"Please wait {wait_seconds}s before requesting another verification code.")
        spec = dict(pending.pending_user_json or {})

    otp_code = _generate_otp_code()
    delivery_mode = _send_otp_email(
        recipient=clean_email,
        otp_code=otp_code,
        first_name=str(spec.get("firstName") or ""),
        account_type=str(spec.get("accountType") or "individual"),
        organization=str(spec.get("organization") or "Individual Workspace"),
    )
    with db_mgr.session_scope() as session:
        pending = session.get(EmailVerificationRecord, clean_email)
        if not pending:
            raise HTTPException(status_code=404, detail="Pending verification expired or already completed.")
        pending.otp_hash = _hash_otp(clean_email, otp_code, db_mgr)
        pending.expires_at = now + _OTP_TTL_SECONDS
        pending.attempts = 0
        pending.resend_available_at = now + _OTP_RESEND_COOLDOWN_SECONDS

    return _build_otp_challenge_response(clean_email, spec, delivery_mode, otp_code)


def authenticate_email_user(
    email: str,
    password: str,
    db: Optional[DatabaseManager] = None,
) -> Dict[str, Any]:
    clean_email = _validate_email(email)
    db_mgr = db or get_db()
    with db_mgr.session_scope() as session:
        row = session.get(UserRecord, clean_email)
        if not row or not row.password_hash:
            pending = session.get(EmailVerificationRecord, clean_email)
            if pending:
                raise HTTPException(
                    status_code=403,
                    detail="Email verification is pending for this account. Please verify your 6-digit OTP first.",
                )
            raise HTTPException(status_code=401, detail="Invalid email or password.")
        if not _verify_password(password or "", row.password_hash):
            raise HTTPException(status_code=401, detail="Invalid email or password.")

        public_user = _serialize_user(row)
        return {"token": issue_email_session_token(public_user, db=db_mgr), "user": public_user}


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
