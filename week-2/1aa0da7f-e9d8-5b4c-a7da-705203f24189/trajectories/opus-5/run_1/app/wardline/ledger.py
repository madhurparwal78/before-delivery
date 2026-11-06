"""The single hash-chained ledger: canonical form, digests and serialised appends."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from . import db

ZERO_DIGEST = "0" * 64

_SHORT_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\t": "\\t",
    "\n": "\\n",
    "\f": "\\f",
    "\r": "\\r",
}


def canonical_string(text: str) -> str:
    out = ['"']
    for ch in text:
        short = _SHORT_ESCAPES.get(ch)
        if short is not None:
            out.append(short)
        elif ch < " ":
            out.append("\\u%04x" % ord(ch))
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def canonical_json(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return canonical_string(value)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        parts = [
            canonical_string(key) + ":" + canonical_json(value[key])
            for key in sorted(value.keys())
        ]
        return "{" + ",".join(parts) + "}"
    raise TypeError(f"not canonical: {type(value)!r}")


def entry_canonical(entry: dict[str, Any]) -> str:
    return canonical_json(
        {
            "action": entry["action"],
            "actor_id": entry["actor_id"],
            "at": entry["at"],
            "detail": entry["detail"],
            "seq": int(entry["seq"]),
            "session_id": entry.get("session_id"),
            "target": entry["target"],
        }
    )


def entry_digest(prev_digest: str, entry: dict[str, Any]) -> str:
    payload = (prev_digest + "\n" + entry_canonical(entry)).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def ledger_time(moment: datetime | None = None) -> str:
    moment = moment or datetime.now(timezone.utc)
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def append(
    cur: Any,
    *,
    action: str,
    actor_id: str,
    session_id: str | None,
    target: str,
    detail: dict[str, Any] | None = None,
    at: str | None = None,
) -> dict[str, Any]:
    """Append one link, serialised across every running copy of the app."""
    db.take_lock(cur, db.LOCK_LEDGER, 1)
    cur.execute("SELECT seq, digest FROM ledger_entries ORDER BY seq DESC LIMIT 1")
    row = cur.fetchone()
    if row is None:
        seq = 1
        prev_digest = ZERO_DIGEST
    else:
        seq = int(row["seq"]) + 1
        prev_digest = row["digest"]
    entry = {
        "seq": seq,
        "at": at or ledger_time(),
        "actor_id": actor_id,
        "session_id": session_id,
        "action": action,
        "target": target,
        "detail": detail or {},
    }
    digest = entry_digest(prev_digest, entry)
    cur.execute(
        """
        INSERT INTO ledger_entries
            (seq, at, actor_id, session_id, action, target, detail, prev_digest, digest)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            entry["seq"],
            entry["at"],
            entry["actor_id"],
            entry["session_id"],
            entry["action"],
            entry["target"],
            json.dumps(entry["detail"]),
            prev_digest,
            digest,
        ),
    )
    entry["prev_digest"] = prev_digest
    entry["digest"] = digest
    return entry


def raise_signal(cur: Any, kind: str, target: str) -> str:
    signal_id = db.next_id(cur, "SIG")
    cur.execute(
        "INSERT INTO signals (id, kind, at, target) VALUES (%s, %s, %s, %s)",
        (signal_id, kind, datetime.now(timezone.utc), target),
    )
    return signal_id
