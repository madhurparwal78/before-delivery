"""The single ledger chain: canonical form, digest and serialised append."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from typing import Any
from urllib.parse import quote

import asyncpg

from wardline.db import LEDGER_LOCK

GENESIS = "0" * 64


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def canonical(entry: dict[str, Any]) -> str:
    return canonical_json({key: entry[key] for key in ("action", "actor_id", "at", "detail", "seq", "session_id", "target")})


def link_digest(prev_digest: str, entry: dict[str, Any]) -> str:
    return hashlib.sha256(f"{prev_digest}\n{canonical(entry)}".encode()).hexdigest()


def encode_target(raw: bytes) -> str:
    """Every byte outside the unreserved set as upper-case %XX, cut to its first 200 characters."""
    return quote(raw, safe="")[:200]


async def append(
    conn: asyncpg.Connection,
    *,
    actor_id: str,
    session_id: str | None,
    action: str,
    target: str,
    detail: dict[str, Any] | None = None,
) -> None:
    """Append one entry inside the caller's transaction. The lock holds until that commit."""
    await conn.execute("SELECT pg_advisory_xact_lock($1)", LEDGER_LOCK)
    last = await conn.fetchrow("SELECT seq, digest FROM ledger_entries ORDER BY seq DESC LIMIT 1")
    seq = last["seq"] + 1 if last else 1
    prev_digest = last["digest"] if last else GENESIS
    at = dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    entry = {
        "seq": seq,
        "at": at,
        "actor_id": actor_id,
        "session_id": session_id,
        "action": action,
        "target": target,
        "detail": detail or {},
    }
    digest = link_digest(prev_digest, entry)
    await conn.execute(
        "INSERT INTO ledger_entries (seq, at, actor_id, session_id, action, target, detail, prev_digest, digest)"
        " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        seq, at, actor_id, session_id, action, target, entry["detail"], prev_digest, digest,
    )


def entry_json(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "seq": row["seq"],
        "at": row["at"],
        "actor_id": row["actor_id"],
        "session_id": row["session_id"],
        "action": row["action"],
        "target": row["target"],
        "detail": row["detail"],
        "prev_digest": row["prev_digest"],
        "digest": row["digest"],
    }


async def raise_signal(conn: asyncpg.Connection, kind: str, target: str) -> None:
    number = await conn.fetchval("SELECT nextval('signals_seq')")
    await conn.execute(
        "INSERT INTO signals (id, kind, at, target) VALUES ($1, $2, now(), $3)", f"SIG-{number:04d}", kind, target
    )
