"""Signing a window and the three-part seal: signature, PDF and stored bytes."""

from __future__ import annotations

import hashlib
import json
from html import escape
from typing import Any

from . import clock, engine, store
from .db import Cursor
from .domain import attestation, opinion as opinion_rules, states
from .domain.model import ACTUAL, WindowRecord
from .domain.allocation import digest as allocation_digest
from .errors import HELD_PRESS_COPY, HELD_STORE_COPY
from .services import objectstore, press
from .services.http import ProviderUnavailable
from .signing import sign
from .store import live_lines

HELD_PRESS = "held_press"
HELD_STORE = "held_store"
SEALED = "sealed"

HELD_COPY = {HELD_PRESS: HELD_PRESS_COPY, HELD_STORE: HELD_STORE_COPY}


def sign_window(
    cursor: Cursor, window: WindowRecord, user_id: str, typed_name: str
) -> str:
    """Record the signature under the firm's key in force and fix the opinion."""
    figs = engine.figures(window)
    sample = store.sample_rows(cursor, window.id)
    exceptions = sum(1 for row in sample if row["result"] == "exception")
    non_actual_wh = sum(hour.consumed_wh for hour in figs.hours if hour.quality != ACTUAL)
    opinion = window.frozen_opinion or opinion_rules.decide(
        non_actual_wh, figs.consumed_wh, exceptions
    )
    firm = store.firm(cursor, window.verifier_firm_id)
    assert firm is not None
    key = store.key_in_force(cursor, firm["id"])
    signed_count = cursor.value(
        "SELECT COUNT(*) FROM signatures JOIN windows ON windows.id = signatures.window_id"
        " WHERE windows.site_id = %s AND windows.month = %s",
        (window.site.id, window.month),
    )
    code = attestation.statement_code(window.month, window.site.code, int(signed_count))
    scores = figs.scores()
    payload = attestation.payload(
        window_id=window.id,
        site_name=window.site.name,
        month=window.month,
        scores=scores,
        opinion=opinion,
        firm_name=firm["name"],
        consumed_wh=figs.consumed_wh,
        hour_matched_wh=figs.hour_matched_wh,
        allocation_digest=allocation_digest(live_lines(window)),
        signed_at=clock.instant(clock.now()),
    )
    signature = sign(bytes(key["private_key"]), payload.encode("utf-8"))
    cursor.execute(
        "INSERT INTO signatures (statement_code, window_id, firm_id, key_id, signed_by,"
        " signed_at, attestation_payload, attestation_signature, pdf_object_key)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            code,
            window.id,
            firm["id"],
            key["key_id"],
            typed_name,
            clock.now(),
            payload,
            signature,
            attestation.object_key(code),
        ),
    )
    store.set_field(cursor, window, "frozen_opinion", opinion)
    store.set_field(cursor, window, "frozen_target_grain", window.target_grain)
    store.set_field(cursor, window, "frozen_target_bp", window.target_bp)
    store.set_state(cursor, window, states.SIGNED)
    store.bump_revision(cursor, window, typed_name)
    return code


def advance_seal(cursor: Cursor, window: WindowRecord) -> str:
    """Render, store and read back; the window is Sealed only when all three hold."""
    record = store.signature_for(cursor, window.id)
    assert record is not None
    if record["sealed_at"] is not None:
        return SEALED
    key = cursor.one(
        "SELECT private_key, public_key FROM firm_keys WHERE key_id = %s",
        (record["key_id"],),
    )
    assert key is not None
    try:
        pdf = press.render(_attestation_html(cursor, window, record))
    except ProviderUnavailable:
        store.set_field(cursor, window, "seal_status", HELD_PRESS)
        return HELD_PRESS
    digest = hashlib.sha256(pdf).hexdigest()
    pdf_signature = sign(bytes(key["private_key"]), pdf)
    cursor.execute(
        "UPDATE signatures SET pdf_sha256 = %s, pdf_signature = %s WHERE statement_code = %s",
        (digest, pdf_signature, record["statement_code"]),
    )
    try:
        objectstore.put(record["pdf_object_key"], pdf)
        stored = objectstore.get(record["pdf_object_key"])
    except ProviderUnavailable:
        store.set_field(cursor, window, "seal_status", HELD_STORE)
        return HELD_STORE
    if hashlib.sha256(stored).hexdigest() != digest:
        store.set_field(cursor, window, "seal_status", HELD_STORE)
        return HELD_STORE
    cursor.execute(
        "UPDATE signatures SET sealed_at = %s WHERE statement_code = %s",
        (clock.now(), record["statement_code"]),
    )
    store.set_field(cursor, window, "seal_status", SEALED)
    store.set_state(cursor, window, states.SEALED)
    store.bump_revision(cursor, window, None)
    return SEALED


def _attestation_html(
    cursor: Cursor, window: WindowRecord, record: dict[str, Any]
) -> str:
    payload = json.loads(record["attestation_payload"])
    firm = store.firm(cursor, record["firm_id"])
    assert firm is not None
    lines = attestation.printed_lines(
        code=record["statement_code"],
        site_name=payload["site_name"],
        month=payload["month"],
        scores={
            "month_bp": payload["month_bp"],
            "week_bp": payload["week_bp"],
            "day_bp": payload["day_bp"],
            "hour_bp": payload["hour_bp"],
        },
        consumed_wh=payload["consumed_wh"],
        hour_matched_wh=payload["hour_matched_wh"],
        opinion=payload["opinion"],
        firm_name=firm["name"],
        allocation_digest=payload["allocation_digest"],
    )
    body = "\n".join(f"<p>{escape(line)}</p>" for line in lines)
    return (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<title>Hourproof attestation</title><style>"
        "@page{size:A4;margin:18mm}"
        "body{font-family:sans-serif;font-size:12pt;color:#000;background:#fff}"
        "h1{font-size:20pt;margin:0 0 12mm}p{margin:0 0 4mm;white-space:pre}"
        "</style></head><body><h1>HOURPROOF ATTESTATION</h1>"
        f"{body}</body></html>"
    )
