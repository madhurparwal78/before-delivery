"""Record serialisers: one place for each API shape."""
from __future__ import annotations

import datetime
from typing import Any

from ..db import as_utc_iso


def person(row) -> dict:
    pid, name, email, role = row
    return {"id": pid, "name": name, "role": role}


def grant(row) -> dict:
    gid, cid, uid, scope, kind, state, expires_at = row
    return {
        "id": gid,
        "compartment_id": cid,
        "user_id": uid,
        "scope": scope,
        "state": state,
        "expires_at": as_utc_iso(expires_at) if expires_at else None,
        "kind": kind,
    }


def compartment(row, caller_scope: str | None, exhibit_count: int = 0,
                quarantine_count: int = 0, release_bytes: int = 0, access: list | None = None) -> dict:
    cid, name, owner_id, access_version = row
    return {
        "id": cid,
        "name": name,
        "owner_id": owner_id,
        "access_version": access_version,
        "caller_scope": caller_scope,
        "exhibit_count": exhibit_count,
        "quarantine_count": quarantine_count,
        "release_bytes": release_bytes,
        "access": access,
    }


def exhibit(row, holds: list[dict], provenance: dict | None) -> dict:
    (eid, cid, name, state, sha, size, sniffed, page_count, registered_by,
     marks_version, seal_check, disposal_proposed_by, source, collected_by,
     collected_on, capture_notes) = row
    out = {
        "id": eid,
        "compartment_id": cid,
        "name": name,
        "state": state,
        "sealed": True,
        "sha256": sha,
        "size": size,
        "sniffed_type": sniffed,
        "page_count": page_count,
        "registered_by": registered_by,
        "marks_version": marks_version,
        "seal_check": seal_check,
        "disposal_proposed_by": disposal_proposed_by,
        "holds": holds,
        "provenance": None,
    }
    if provenance is not None:
        out["provenance"] = {
            "source": source,
            "collected_by": collected_by,
            "collected_on": collected_on,
            "capture_notes": capture_notes,
        }
    return out


def hold(row) -> dict:
    hid, matter_ref, placed_by = row
    return {"id": hid, "matter_ref": matter_ref, "placed_by": placed_by}


def derivative(row) -> dict:
    """row: id, exhibit_id, compartment_id, sha256, size, content_type, page_count,
    created_by, marks_version, marks_saved_by, disposed, superseded."""
    (did, eid, cid, sha, size, content_type, page_count, created_by,
     marks_version, marks_saved_by, disposed, superseded) = row
    return {
        "id": did,
        "exhibit_id": eid,
        "compartment_id": cid,
        "sha256": sha,
        "size": size,
        "content_type": content_type,
        "page_count": page_count,
        "created_by": created_by,
        "marks_version": marks_version,
        "marks_saved_by": marks_saved_by,
        "superseded": superseded,
        "disposed": disposed,
    }


def release(row, items: list[dict], total_bytes: int, contributors: list[str],
            opened_by_caller: dict[str, bool] | None = None, with_assembler: bool = True) -> dict:
    (rid, cid, name, matter_ref, recipient_kind, state, assembler_id,
     rejection_reason, manifest_digest) = row
    out_items = []
    for item in items:
        it = dict(item)
        if opened_by_caller is not None:
            it["opened_by_caller"] = opened_by_caller.get(it["id"], False)
        out_items.append(it)
    out = {
        "id": rid,
        "compartment_id": cid,
        "name": name,
        "matter_ref": matter_ref,
        "recipient_kind": recipient_kind,
        "state": state,
        "assembler_id": assembler_id,
        "contributor_ids": contributors,
        "manifest_digest": manifest_digest,
        "items": out_items,
        "total_bytes": total_bytes,
        "rejection_reason": rejection_reason,
    }
    if not with_assembler:
        out.pop("assembler_id")
    return out


def release_item(row) -> dict:
    iid, derivative_id, label, superseded = row
    return {"id": iid, "derivative_id": derivative_id, "label": label,
            "size": row[4] if len(row) > 4 else 0, "superseded": superseded}


def ledger_entry(row) -> dict:
    seq, at, actor_id, session_id, action, target, detail, prev_digest, digest = row
    return {
        "seq": seq,
        "at": at,
        "actor_id": actor_id,
        "session_id": session_id,
        "action": action,
        "target": target,
        "detail": detail,
        "prev_digest": prev_digest,
        "digest": digest,
    }


def signal(row) -> dict:
    sid, kind, at, target = row
    return {"id": str(sid), "kind": kind, "at": as_utc_iso(at), "target": target}
