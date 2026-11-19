"""Signing, the three-part seal (signature, PDF, stored bytes) and the public statements."""

from __future__ import annotations

import base64
import hashlib
import html
import json

import asyncpg
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from .clock import format_instant
from .desk import Desk, User, field_errors
from .errors import ApiError
from .jsontypes import JsonObject
from .providers import ProviderDown
from .repository import Window
from .rules import allocation_digest, megawatt_hours
from .views import opinion_of, totals

VERIFIER = ("verifier",)
HELD_COPY = {
    "held_press": "PDF PRESS IS DOWN. YOUR SIGNATURE IS SAFE.",
    "held_store": "THE STORE IS DOWN. YOUR SIGNATURE IS SAFE.",
}
SEAL_LOCK = 7340003
RAW = {"encoding": serialization.Encoding.Raw, "format": serialization.PublicFormat.Raw}


def generate_key() -> dict[str, str]:
    """A new Ed25519 key; its id is the first 16 hex digits of the SHA-256 of the raw public key."""
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(**RAW)
    raw_private = private.private_bytes(
        serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()
    )
    return {
        "key_id": hashlib.sha256(public).hexdigest()[:16],
        "public_key": base64.b64encode(public).decode(),
        "private_key": base64.b64encode(raw_private).decode(),
    }


def sign_bytes(private_key: str, message: bytes) -> str:
    key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(private_key))
    return base64.b64encode(key.sign(message)).decode()


def verifies(public_key: str, signature: str, message: bytes) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key)).verify(base64.b64decode(signature), message)
    except (InvalidSignature, ValueError):
        return False
    return True


def percent(bp: int) -> str:
    return f"{bp // 100}.{bp % 100:02d}%"


def attestation_html(code: str, payload: JsonObject) -> str:
    """The attestation page; every name is escaped so it prints exactly as written."""
    lines = [
        f"Statement {code}",
        f"Site {payload['site_name']}",
        f"Month {payload['month']}",
        f"Month score {percent(payload['month_bp'])}",
        f"Week score {percent(payload['week_bp'])}",
        f"Day score {percent(payload['day_bp'])}",
        f"Hour score {percent(payload['hour_bp'])}",
        f"Consumed {megawatt_hours(payload['consumed_wh'])} MWh",
        f"Hour matched {megawatt_hours(payload['hour_matched_wh'])} MWh",
        f"Opinion {payload['opinion']}",
        f"Verifier firm {payload['firm_name']}",
        f"Allocation digest {payload['allocation_digest']}",
    ]
    body = "".join(f"<p>{html.escape(line)}</p>" for line in lines)
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hourproof attestation</title>'
        "<style>@page{size:A4;margin:18mm}body{font-family:sans-serif;font-size:11pt;color:#111}"
        "h1{font-size:20pt;margin:0 0 14pt}p{margin:0 0 7pt}p:last-child{font-size:8.5pt}</style></head>"
        f"<body><h1>Hourproof attestation</h1>{body}</body></html>"
    )


async def current_key(connection: asyncpg.Connection, firm_id: str) -> asyncpg.Record:
    return await connection.fetchrow("SELECT * FROM firm_keys WHERE firm_id = $1 ORDER BY seq DESC LIMIT 1", firm_id)


async def record_signature(desk: Desk, connection: asyncpg.Connection, window: Window, signer: User) -> str:
    """Inside the window's transaction: sign the attestation payload with the firm's key in force, record the
    signature and that key, freeze the target and the opinion, and set the window to Signed. Returns the code."""
    await connection.execute("SELECT pg_advisory_xact_lock($1)", SEAL_LOCK)
    now = desk.now()
    grains = window.grains(now)
    figures = totals(window, grains)
    columns = window.columns
    payload = {
        "window_id": window.id,
        "site_name": columns["site_name"],
        "month": columns["month"],
        **grains.scores(),
        "opinion": opinion_of(window, figures),
        "firm_name": columns["firm_name"],
        "consumed_wh": figures["consumed"],
        "hour_matched_wh": figures["matched"],
        "allocation_digest": allocation_digest(window.lines),
        "signed_at": format_instant(now),
    }
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    key = await current_key(connection, columns["firm_id"])
    number = (
        await connection.fetchval(
            "SELECT count(*) FROM statements WHERE site_id = $1 AND month = $2", columns["site_id"], columns["month"]
        )
        + 1
    )
    code = f"HP-{columns['month'][:4]}-{columns['month'][5:]}-{columns['site_code']}-{number}"
    await connection.execute(
        "INSERT INTO statements (code, window_id, site_id, month, firm_id, attestation_payload, "
        "attestation_signature, key_id, public_key, signed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        code,
        window.id,
        columns["site_id"],
        columns["month"],
        columns["firm_id"],
        text,
        sign_bytes(key["private_key"], text.encode()),
        key["key_id"],
        key["public_key"],
        now,
    )
    await desk.bump(
        connection,
        window.id,
        signer,
        state="Signed",
        statement_code=code,
        frozen_grain=columns["site_target_grain"],
        frozen_bp=columns["site_target_bp"],
        frozen_opinion=payload["opinion"],
    )
    return code


async def sign_window(desk: Desk, user: User, window_id: str, body: JsonObject) -> tuple[JsonObject, str]:
    """Sign a Cancelled window as its assigned verifier; then try to seal it."""
    async with desk.pool.acquire() as connection:
        async with connection.transaction():
            window = await desk.locked_window(connection, user, window_id, roles=VERIFIER, states=("Cancelled",))
            field_errors(typed_name=body.get("typed_name") == user.name)
            await record_signature(desk, connection, window, user)
    held = await try_seal(desk, window_id)
    return await desk.window_view(window_id), held


class SealHeld(Exception):
    """The press or the store could not finish the seal; the signature stays and the seal is retried."""

    def __init__(self, status: str) -> None:
        super().__init__(status)
        self.status = status


async def store_pdf(desk: Desk, row: asyncpg.Record, object_key: str) -> None:
    """The three-part seal's second and third parts: the rendered PDF is signed under the recorded key and its
    digest recorded, then written, read back and compared. An object already in the store is never replaced."""
    try:
        stored = await desk.store.get(object_key)
    except ProviderDown as error:
        raise SealHeld("held_store") from error
    if stored is not None:
        if row["pdf_sha256"] != hashlib.sha256(stored).hexdigest():
            raise SealHeld("held_store")
        return
    try:
        pdf = await desk.press.render(attestation_html(row["code"], json.loads(row["attestation_payload"])))
    except ProviderDown as error:
        raise SealHeld("held_press") from error
    digest = hashlib.sha256(pdf).hexdigest()
    await desk.pool.execute(
        "UPDATE statements SET pdf_sha256 = $2, pdf_signature = $3 WHERE code = $1",
        row["code"],
        digest,
        sign_bytes(row["private_key"], pdf),
    )
    try:
        await desk.store.put(object_key, pdf)
        returned = await desk.store.get(object_key)
    except ProviderDown as error:
        raise SealHeld("held_store") from error
    if returned is None or hashlib.sha256(returned).hexdigest() != digest:
        raise SealHeld("held_store")


async def try_seal(desk: Desk, window_id: str) -> str:
    """Seal a Signed window under its recorded key. Returns sealed, held_press or held_store."""
    async with desk.locks[f"seal:{window_id}"]:
        row = await desk.pool.fetchrow(
            "SELECT w.state, s.*, k.private_key FROM windows w JOIN statements s ON s.window_id = w.id "
            "JOIN firm_keys k ON k.key_id = s.key_id WHERE w.id = $1",
            window_id,
        )
        if row is None or row["state"] != "Signed":
            return "sealed"
        try:
            await store_pdf(desk, row, f"attestations/{row['code']}.pdf")
        except SealHeld as held:
            await desk.pool.execute(
                "UPDATE windows SET seal_status = $2 WHERE id = $1 AND state = 'Signed'", window_id, held.status
            )
            return held.status
        async with desk.pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    "UPDATE statements SET sealed_at = $2 WHERE code = $1", row["code"], desk.now()
                )
                await desk.bump(connection, window_id, None, state="Sealed", seal_status="sealed")
        return "sealed"


def _percent_scores(payload: JsonObject) -> dict[str, int]:
    return {key: payload[key] for key in ("month_bp", "week_bp", "day_bp", "hour_bp")}


async def statement_json(desk: Desk, code: str) -> JsonObject:
    row = await desk.pool.fetchrow(
        "SELECT s.*, w.state, w.successor_id, f.name AS firm_name FROM statements s JOIN windows w ON w.id = s.window_id "
        "JOIN firms f ON f.id = s.firm_id WHERE s.code = $1 AND w.state IN ('Sealed', 'Restated')",
        code,
    )
    if row is None:
        raise ApiError("NOT_FOUND")
    object_key = f"attestations/{code}.pdf"
    try:
        stored = await desk.store.get(object_key)
    except ProviderDown as error:
        raise ApiError("STORE_UNAVAILABLE") from error
    valid = (
        stored is not None
        and row["pdf_signature"] is not None
        and verifies(row["public_key"], row["pdf_signature"], stored)
    )
    payload = json.loads(row["attestation_payload"])
    successor = None
    if row["state"] == "Restated":
        successor = await desk.pool.fetchrow(
            "SELECT s.code FROM statements s JOIN windows w ON w.id = s.window_id "
            "WHERE s.window_id = $1 AND w.state IN ('Sealed', 'Restated')",
            row["successor_id"],
        )
    return {
        "code": code,
        "state": row["state"],
        "site_name": payload["site_name"],
        "month": payload["month"],
        "scores": _percent_scores(payload),
        "opinion": payload["opinion"],
        "firm_name": payload["firm_name"],
        "consumed_wh": payload["consumed_wh"],
        "hour_matched_wh": payload["hour_matched_wh"],
        "allocation_digest": payload["allocation_digest"],
        "pdf_url": f"/check/{code}/attestation.pdf",
        "pdf_object_key": object_key,
        "pdf_sha256": row["pdf_sha256"],
        "key_id": row["key_id"],
        "public_key": row["public_key"],
        "attestation_payload": row["attestation_payload"],
        "attestation_signature": row["attestation_signature"],
        "pdf_signature": row["pdf_signature"],
        "signature_valid": valid,
        "successor_window_id": row["successor_id"] if row["state"] == "Restated" else None,
        "successor_statement_code": successor["code"] if successor else None,
    }


async def statement_pdf(desk: Desk, code: str) -> bytes:
    exists = await desk.pool.fetchval(
        "SELECT count(*) FROM statements s JOIN windows w ON w.id = s.window_id "
        "WHERE s.code = $1 AND w.state IN ('Sealed', 'Restated')",
        code,
    )
    if not exists:
        raise ApiError("NOT_FOUND")
    try:
        stored = await desk.store.get(f"attestations/{code}.pdf")
    except ProviderDown as error:
        raise ApiError("STORE_UNAVAILABLE") from error
    if stored is None:
        raise ApiError("STORE_UNAVAILABLE")
    return stored


async def sealed_scores(desk: Desk) -> JsonObject:
    rows = await desk.pool.fetch(
        "SELECT s.code, s.attestation_payload FROM statements s JOIN windows w ON w.id = s.window_id "
        "WHERE w.state = 'Sealed' ORDER BY s.sealed_at DESC, s.code DESC LIMIT 20"
    )
    items = []
    for row in rows:
        payload = json.loads(row["attestation_payload"])
        items.append(
            {
                "statement_code": row["code"],
                "site_name": payload["site_name"],
                "month": payload["month"],
                "hour_bp": payload["hour_bp"],
            }
        )
    return {"items": items}


async def rotate_key(desk: Desk, user: User, firm_id: str) -> dict[str, str]:
    if not await desk.pool.fetchval("SELECT count(*) FROM firms WHERE id = $1", firm_id) or (
        user.role == "verifier" and user.firm_id != firm_id
    ):
        raise ApiError("NOT_FOUND")
    if user.role != "verifier":
        raise ApiError("FORBIDDEN")
    key = generate_key()
    await desk.pool.execute(
        "INSERT INTO firm_keys (key_id, firm_id, public_key, private_key) VALUES ($1,$2,$3,$4)",
        key["key_id"],
        firm_id,
        key["public_key"],
        key["private_key"],
    )
    return {"firm_id": firm_id, "key_id": key["key_id"], "public_key": key["public_key"]}
