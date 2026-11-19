"""The lead's oversight, the firms' keys, the public check and the health probe."""

from __future__ import annotations

import base64
import json

from flask import Blueprint, Response

from .. import clock, corrections, db, signing, store, views
from ..domain import states
from ..domain.scores import GRAINS
from ..errors import field_error, not_found, store_unavailable, wrong_state
from ..services import objectstore
from ..services.http import ProviderUnavailable
from . import (
    ANALYST,
    LEAD,
    VERIFIER,
    envelope,
    read_body,
    readable_window,
    readable_windows,
    require_account,
    require_role,
)

oversight = Blueprint("oversight", __name__)

GRAIN_WORDS = ("MONTH", "WEEK", "DAY", "HOUR")


@oversight.get("/group/scores")
def group_scores():
    with db.tx() as cursor:
        account = require_account(cursor)
        require_role(account, LEAD)
        windows = readable_windows(cursor, account)
        return envelope(
            {
                "windows": [views.window_json(cursor, window) for window in windows],
                "rollups": views.group_rollups(cursor, windows),
            }
        )


@oversight.put("/sites/<site_id>/policy")
def set_policy(site_id: str):
    body = read_body()
    with db.tx() as cursor:
        account = require_account(cursor)
        site = store.load_site(cursor, site_id)
        if site is None:
            raise not_found()
        require_role(account, LEAD)
        grain = body.get("target_grain")
        if grain not in GRAIN_WORDS:
            raise field_error("target_grain")
        target_bp = body.get("target_bp")
        if (
            not isinstance(target_bp, int)
            or isinstance(target_bp, bool)
            or not 0 <= target_bp <= 10000
        ):
            raise field_error("target_bp")
        cursor.execute(
            "UPDATE sites SET target_grain = %s, target_bp = %s WHERE id = %s",
            (grain, target_bp, site_id),
        )
        return envelope(
            {"site_id": site_id, "target_grain": grain, "target_bp": target_bp}
        )


@oversight.put("/windows/<window_id>/verifier")
def assign_verifier(window_id: str):
    body = read_body()
    with db.tx() as cursor:
        account = require_account(cursor)
        window = readable_window(cursor, account, window_id, lock=True)
        firm_id = body.get("firm_id")
        firm = store.firm(cursor, firm_id) if isinstance(firm_id, str) else None
        if firm is None:
            raise not_found()
        require_role(account, LEAD)
        if window.verifier_firm_id == firm_id:
            return envelope(views.window_json(cursor, window))
        if window.state not in states.LEGAL_STATES["verifier"]:
            raise wrong_state(window.state)
        store.set_field(cursor, window, "verifier_firm_id", firm_id)
        store.clear_sample(cursor, window.id)
        return envelope(views.window_json(cursor, window))


@oversight.get("/firms")
def list_firms():
    with db.tx() as cursor:
        account = require_account(cursor)
        require_role(account, LEAD)
        return envelope({"firms": cursor.all("SELECT id, name FROM firms ORDER BY name")})


@oversight.post("/firms/<firm_id>/keys/rotate")
def rotate_key(firm_id: str):
    with db.tx() as cursor:
        account = require_account(cursor)
        firm = store.firm(cursor, firm_id)
        if firm is None or account.firm_id != firm_id:
            raise not_found()
        require_role(account, VERIFIER)
        private_raw, public_raw = signing.generate()
        key_id = signing.key_id(public_raw)
        cursor.execute(
            "INSERT INTO firm_keys (key_id, firm_id, private_key, public_key, created_at)"
            " VALUES (%s, %s, %s, %s, %s)",
            (key_id, firm_id, private_raw, public_raw, clock.now()),
        )
        return envelope(
            {
                "firm_id": firm_id,
                "key_id": key_id,
                "public_key": base64.b64encode(public_raw).decode("ascii"),
            }
        )


@oversight.post("/sites/<site_id>/corrections/pull")
def pull_corrections(site_id: str):
    with db.tx() as cursor:
        account = require_account(cursor)
        site = store.load_site(cursor, site_id)
        if site is None:
            raise not_found()
        require_role(account, ANALYST)
        result = corrections.pull(cursor, site, account.name)
        return envelope(
            {
                "applied": result.applied,
                "restated": result.restated,
                "skipped": result.skipped,
            }
        )


@oversight.get("/public/statements/<code>")
def public_statement(code: str):
    with db.tx() as cursor:
        record = store.signature_by_code(cursor, code)
        if record is None or record["sealed_at"] is None:
            raise not_found()
        window = store.load_window(cursor, record["window_id"])
        assert window is not None
        if window.state not in (states.SEALED, states.RESTATED):
            raise not_found()
        firm = store.firm(cursor, record["firm_id"])
        assert firm is not None
        key = cursor.one(
            "SELECT public_key FROM firm_keys WHERE key_id = %s", (record["key_id"],)
        )
        assert key is not None
        public_raw = bytes(key["public_key"])
        successor_code = None
        if window.successor_id:
            successor = store.signature_for(cursor, window.successor_id)
            if successor is not None and successor["sealed_at"] is not None:
                successor_code = successor["statement_code"]
        payload = record["attestation_payload"]
        signature = bytes(record["attestation_signature"])
        pdf_signature = bytes(record["pdf_signature"])
    try:
        stored = objectstore.get(record["pdf_object_key"])
    except ProviderUnavailable:
        raise store_unavailable() from None
    valid = signing.verify(public_raw, pdf_signature, stored) and signing.verify(
        public_raw, signature, payload.encode("utf-8")
    )
    body = _statement_body(
        record, window, firm["name"], public_raw, valid, successor_code
    )
    return envelope(body)


def _statement_body(record, window, firm_name, public_raw, valid, successor_code):
    payload = json.loads(record["attestation_payload"])
    return {
        "code": record["statement_code"],
        "state": window.state,
        "site_name": payload["site_name"],
        "month": payload["month"],
        "scores": {f"{grain}_bp": payload[f"{grain}_bp"] for grain in GRAINS},
        "opinion": payload["opinion"],
        "firm_name": firm_name,
        "consumed_wh": payload["consumed_wh"],
        "hour_matched_wh": payload["hour_matched_wh"],
        "allocation_digest": payload["allocation_digest"],
        "pdf_url": f"/check/{record['statement_code']}/attestation.pdf",
        "pdf_object_key": record["pdf_object_key"],
        "pdf_sha256": record["pdf_sha256"],
        "key_id": record["key_id"],
        "public_key": base64.b64encode(public_raw).decode("ascii"),
        "attestation_payload": record["attestation_payload"],
        "attestation_signature": base64.b64encode(
            bytes(record["attestation_signature"])
        ).decode("ascii"),
        "pdf_signature": base64.b64encode(bytes(record["pdf_signature"])).decode("ascii"),
        "signature_valid": valid,
        "successor_window_id": window.successor_id,
        "successor_statement_code": successor_code,
    }


@oversight.get("/public/sealed-scores")
def sealed_scores():
    with db.tx() as cursor:
        rows = cursor.all(
            "SELECT signatures.statement_code, signatures.attestation_payload,"
            " signatures.sealed_at FROM signatures"
            " JOIN windows ON windows.id = signatures.window_id"
            " WHERE windows.state = %s AND signatures.sealed_at IS NOT NULL"
            " ORDER BY signatures.sealed_at DESC, signatures.statement_code DESC"
            " LIMIT 20",
            (states.SEALED,),
        )
    items = []
    for row in rows:
        payload = json.loads(row["attestation_payload"])
        items.append(
            {
                "statement_code": row["statement_code"],
                "site_name": payload["site_name"],
                "month": payload["month"],
                "hour_bp": payload["hour_bp"],
            }
        )
    return envelope({"items": items})


@oversight.get("/health")
def health():
    return Response(
        '{"status":"ok"}', status=200, content_type="application/json; charset=utf-8"
    )
