from __future__ import annotations

import os
from typing import Optional, Tuple

from dotenv import load_dotenv
from fastapi import Header, HTTPException, Request
from fastapi_plugin import Auth0FastAPI

load_dotenv()

_auth0_cache: Tuple[str, str, Optional[Auth0FastAPI]] = ("", "", None)


def get_auth0_settings() -> Tuple[str, str]:
    load_dotenv(override=False)
    domain = os.getenv("AUTH0_DOMAIN", "").strip()
    audience = os.getenv("AUTH0_AUDIENCE", "").strip()
    if "your-tenant" in domain or "your-api" in audience:
        return "", ""
    return domain, audience


def get_auth0_client() -> Optional[Auth0FastAPI]:
    """Return a single reusable Auth0FastAPI instance when AUTH0_DOMAIN & AUTH0_AUDIENCE are set."""
    global _auth0_cache
    domain, audience = get_auth0_settings()
    if not domain or not audience:
        return None
    cached_domain, cached_audience, client = _auth0_cache
    if client is not None and cached_domain == domain and cached_audience == audience:
        return client
    client = Auth0FastAPI(domain=domain, audience=audience)
    _auth0_cache = (domain, audience, client)
    return client


async def require_auth0_claims(request: Request) -> dict:
    """Strict Auth0 JWT/DPoP dependency backed by auth0-fastapi-api."""
    auth0 = get_auth0_client()
    if auth0 is None:
        raise HTTPException(
            status_code=503,
            detail="Auth0 JWT verification is not configured (set AUTH0_DOMAIN and AUTH0_AUDIENCE in backend/.env).",
        )
    checker = auth0.require_auth()
    return await checker(request)


async def resolve_authenticated_email(
    request: Request,
    x_user_email: str = Header(default="demo@tesserak.dev"),
) -> str:
    """
    Validate Auth0 Bearer/DPoP JWT whenever Authorization header is sent (or when AUTH0_ENFORCE_BEARER=true).
    Falls back to x-user-email for local workspace sessions when no Authorization header is attached.
    """
    auth_header = request.headers.get("authorization", "").strip()
    enforce_bearer = os.getenv("AUTH0_ENFORCE_BEARER", "").strip().lower() in ("1", "true", "yes")
    auth0 = get_auth0_client()

    if auth0 is not None and (auth_header or enforce_bearer):
        checker = auth0.require_auth()
        claims = await checker(request)
        claim_email = (
            claims.get("email")
            or claims.get("https://tesserak.dev/email")
            or (x_user_email if x_user_email and x_user_email != "demo@tesserak.dev" else None)
            or claims.get("sub")
        )
        return str(claim_email)

    return x_user_email or "demo@tesserak.dev"
