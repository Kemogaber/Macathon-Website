"""Admin endpoints for API-key management.

Protected by the static ADMIN_API_KEY env var (see auth.require_admin).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import api_keys
from auth import require_admin

router = APIRouter(prefix="/admin/keys", tags=["admin"])


class CreateKeyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


@router.get("", dependencies=[Depends(require_admin)])
def list_keys():
    return {"keys": api_keys.list_keys()}


@router.post("", dependencies=[Depends(require_admin)])
def create_key(body: CreateKeyRequest):
    """Returns the plaintext key once. Save it — it cannot be recovered."""
    return api_keys.create_key(body.name)


@router.delete("/{key_id}", dependencies=[Depends(require_admin)])
def revoke_key(key_id: str):
    if not api_keys.revoke_key(key_id):
        raise HTTPException(404, "Key not found.")
    return {"ok": True}
