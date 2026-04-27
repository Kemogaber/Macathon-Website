"""Simple JSON-file-backed API key store.

Keys are stored as sha256 hashes; the plaintext is shown once at creation.
Path comes from $API_KEYS_FILE (default ./api_keys.json next to main.py).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import TypedDict

_LOCK = Lock()
_PATH = Path(os.environ.get("API_KEYS_FILE", "api_keys.json"))


class KeyRecord(TypedDict):
    id: str
    name: str
    hash: str
    prefix: str
    created_at: str
    last_used_at: str | None


def _load() -> list[KeyRecord]:
    if not _PATH.exists():
        return []
    try:
        with _PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        keys = data.get("keys", [])
        return keys if isinstance(keys, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _save(keys: list[KeyRecord]) -> None:
    tmp = _PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps({"keys": keys}, indent=2), encoding="utf-8")
    tmp.replace(_PATH)


def _hash(plain: str) -> str:
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()


def list_keys() -> list[dict]:
    with _LOCK:
        keys = _load()
    return [
        {
            "id": k["id"],
            "name": k["name"],
            "prefix": k["prefix"],
            "created_at": k["created_at"],
            "last_used_at": k.get("last_used_at"),
        }
        for k in keys
    ]


def create_key(name: str) -> dict:
    """Returns the newly created record including the plaintext key (one-time)."""
    plaintext = "tx_" + secrets.token_hex(24)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rec: KeyRecord = {
        "id": "kid_" + secrets.token_hex(8),
        "name": name.strip()[:120] or "unnamed",
        "hash": _hash(plaintext),
        "prefix": plaintext[:10],
        "created_at": now,
        "last_used_at": None,
    }
    with _LOCK:
        keys = _load()
        keys.append(rec)
        _save(keys)
    return {
        "id": rec["id"],
        "name": rec["name"],
        "prefix": rec["prefix"],
        "created_at": rec["created_at"],
        "key": plaintext,  # shown ONCE
    }


def revoke_key(key_id: str) -> bool:
    with _LOCK:
        keys = _load()
        new_keys = [k for k in keys if k["id"] != key_id]
        if len(new_keys) == len(keys):
            return False
        _save(new_keys)
        return True


def verify_key(plain: str) -> bool:
    """Constant-time lookup; updates last_used_at on hit."""
    if not plain:
        return False
    digest = _hash(plain)
    with _LOCK:
        keys = _load()
        hit_idx = -1
        for i, k in enumerate(keys):
            if hmac.compare_digest(k["hash"], digest):
                hit_idx = i
                break
        if hit_idx == -1:
            return False
        keys[hit_idx]["last_used_at"] = datetime.now(timezone.utc).isoformat(
            timespec="seconds"
        )
        _save(keys)
        return True
