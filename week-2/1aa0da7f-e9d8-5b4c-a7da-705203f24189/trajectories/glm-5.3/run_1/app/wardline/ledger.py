"""The single hash-chained ledger (DP-82, DP-35).

Appends take an advisory transaction lock so the chain never forks across
all running copies of the app.
"""
from __future__ import annotations

import datetime
import hashlib
from typing import Any

from psycopg.types.json import Jsonb

from .db import _canonical

LEDGER_LOCK_KEY = 917331
ZERO_DIGEST = "0" * 64


def canonical_entry(seq: int, at: str, actor_id: str, session_id: str | None, action: str, target: str, detail: Any) -> str:
    body = {
        "action": action,
        "actor_id": actor_id,
        "at": at,
        "detail": detail,
        "seq": seq,
        "session_id": session_id,
        "target": target,
    }
    return _canonical(body)


def digest_for(prev_digest: str, canonical: str) -> str:
    return hashlib.sha256((prev_digest + "\n" + canonical).encode("utf-8")).hexdigest()


def append(cur, actor_id: str, session_id: str | None, action: str, target: str, detail: dict) -> dict:
    """Append one entry inside the caller's transaction. Returns the stored row."""
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (LEDGER_LOCK_KEY,))
    row = cur.execute(
        "SELECT seq, digest FROM ledger_entries ORDER BY seq DESC LIMIT 1"
    ).fetchone()
    if row:
        seq, prev_digest = int(row[0]) + 1, row[1]
    else:
        seq, prev_digest = 1, ZERO_DIGEST
    at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"
    canonical = canonical_entry(seq, at, actor_id, session_id, action, target, detail)
    digest = digest_for(prev_digest, canonical)
    cur.execute(
        "INSERT INTO ledger_entries (seq, at, actor_id, session_id, action, target, detail, prev_digest, digest) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (seq, at, actor_id, session_id, action, target, Jsonb(detail), prev_digest, digest),
    )
    return {"seq": seq, "at": at, "actor_id": actor_id, "session_id": session_id, "action": action,
            "target": target, "detail": detail, "prev_digest": prev_digest, "digest": digest}


def manifest_digest(items: list[dict]) -> str:
    """Release manifest digest: SHA-256 of the canonical JSON array."""
    array = [{"derivative_id": i["derivative_id"], "label": i["label"], "sha256": i["sha256"]} for i in items]
    canonical = _canonical(array)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
