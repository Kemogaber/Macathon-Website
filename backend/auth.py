"""FastAPI auth dependencies.

- `require_api_key` — gates inference + job endpoints. Disabled (allow-all)
  unless the env var REQUIRE_API_KEY is set to a truthy value, so the local
  frontend keeps working out of the box.
- `require_admin` — gates the key-management endpoints; checks the static
  ADMIN_API_KEY env var. If unset, admin endpoints return 503.
"""
from __future__ import annotations

import hmac
import os

from fastapi import Header, HTTPException, status

import api_keys


def _truthy(v: str | None) -> bool:
    return (v or "").strip().lower() in {"1", "true", "yes", "on"}


def _extract(authorization: str | None, x_api_key: str | None) -> str:
    if x_api_key:
        return x_api_key.strip()
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return ""


def require_api_key(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> None:
    if not _truthy(os.environ.get("REQUIRE_API_KEY")):
        return  # gating disabled
    token = _extract(authorization, x_api_key)
    if not token or not api_keys.verify_key(token):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Missing or invalid API key.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def require_admin(
    authorization: str | None = Header(default=None),
    x_admin_key: str | None = Header(default=None, alias="X-Admin-Key"),
) -> None:
    expected = os.environ.get("ADMIN_API_KEY", "")
    if not expected:
        raise HTTPException(503, "Admin API disabled (set ADMIN_API_KEY to enable).")
    token = _extract(authorization, x_admin_key)
    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid admin key.",
            headers={"WWW-Authenticate": "Bearer"},
        )
