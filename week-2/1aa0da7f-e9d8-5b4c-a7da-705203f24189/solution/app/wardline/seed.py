"""Seed data: idempotent, safe when several copies start at once, objects written only for missing records."""

from __future__ import annotations

import datetime as dt
import hashlib
import struct
import tempfile
import zlib

import asyncpg

from wardline import ledger, media
from wardline.auth import digest_token, hash_password
from wardline.db import DB, SEED_LOCK, next_id
from wardline.errors import StorageUnavailable
from wardline.routes.releases import ITEMS_SQL, manifest_digest
from wardline.s3 import STORAGE, fresh_key

PASSWORD = "Custody-Seed-2026!"
PEOPLE = (
    ("USR-01", "Tamsin Oduya", "tamsin.oduya@ashgrove.example", "case_lead", "TAMSINODUYA2WARD"),
    ("USR-02", "Rafael Lindqvist", "rafael.lindqvist@ashgrove.example", "case_lead", "RAFAELLINDQ3WARD"),
    ("USR-03", "Ines Marlow", "ines.marlow@ashgrove.example", "intake_officer", "INESMARLOW4WARDL"),
    ("USR-04", "Kofi Brandt", "kofi.brandt@ashgrove.example", "intake_officer", "KOFIBRANDT5WARDL"),
    ("USR-05", "Mbali Serrano", "mbali.serrano@ashgrove.example", "intake_officer", "MBALISERRANO6WRD"),
    ("USR-06", "Noor Halloran", "noor.halloran@ashgrove.example", "investigator", "NOORHALLORAN7WRD"),
    ("USR-07", "Dmitri Vance", "dmitri.vance@ashgrove.example", "investigator", "DMITRIVANCE2LINE"),
    ("USR-08", "Yuki Castellan", "yuki.castellan@ashgrove.example", "investigator", "YUKICASTELLAN3WD"),
    ("USR-09", "Sefa Whitlock", "sefa.whitlock@ashgrove.example", "auditor", "SEFAWHITLOCK4WRD"),
)
NAMES = {person[0]: person[1] for person in PEOPLE}
COMPARTMENTS = (
    ("CMP-0001", "Harrowgate Depot Payments", "USR-01", (("USR-01", "full"), ("USR-02", "full"), ("USR-03", "full"), ("USR-04", "full"), ("USR-06", "full"))),
    ("CMP-0002", "Saltmarsh Witness Statements", "USR-02", (("USR-02", "full"), ("USR-04", "full"), ("USR-05", "full"), ("USR-07", "full"))),
    ("CMP-0003", "Eastbank Tender Records", "USR-01", (("USR-01", "full"), ("USR-03", "full"), ("USR-08", "derivatives"))),
)
WHOLE_PAGE = {"page": 1, "x": 0, "y": 0, "w": 1000, "h": 1000}
GATE_REGION = {"page": 1, "x": 100, "y": 100, "w": 400, "h": 300}


def _text_pdf(words: str, author: str | None = None) -> bytes:
    drawing = f"BT /F1 18 Tf 72 700 Td ({words}) Tj ET\n".encode()
    objects = {
        1: b"<< /Pages 2 0 R /Type /Catalog >>",
        2: b"<< /Count 1 /Kids [3 0 R] /Type /Pages >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        4: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        5: b"<< /Length %d >>\nstream\n" % len(drawing) + drawing + b"endstream",
    }
    if author:
        objects[6] = f"<< /Author ({author}) >>".encode()
    out = bytearray(b"%PDF-1.5\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for number in sorted(objects):
        offsets[number] = len(out)
        out += f"{number} 0 obj\n".encode() + objects[number] + b"\nendobj\n"
    start = len(out)
    size = max(objects) + 1
    out += f"xref\n0 {size}\n0000000000 65535 f \n".encode()
    for number in range(1, size):
        out += f"{offsets[number]:010d} 00000 n \n".encode()
    info = " /Info 6 0 R" if author else ""
    out += f"trailer\n<< /Size {size} /Root 1 0 R{info} >>\nstartxref\n{start}\n%%EOF\n".encode()
    return bytes(out)


def _gate_png() -> bytes:
    """A drawn gatehouse scene: sky, ground, a barrier and posts."""
    rows = bytearray()
    for y in range(600):
        rows.append(0)
        for x in range(800):
            if 395 <= y < 425 and 120 <= x < 680:
                pixel = (214, 120, 40) if (x // 40) % 2 else (240, 236, 224)
            elif 300 <= y and (100 <= x < 130 or 670 <= x < 700):
                pixel = (60, 62, 68)
            elif y < 340:
                shade = 150 + y // 6
                pixel = (shade - 40, shade - 10, shade + 30)
            else:
                pixel = (96 + (x + y) % 9, 92 + (x + y) % 7, 84 + (x * y) % 5)
            rows += bytes(pixel)
    return (
        b"\x89PNG\r\n\x1a\n"
        + media.png_chunk(b"IHDR", struct.pack(">IIBBBBB", 800, 600, 8, 2, 0, 0, 0))
        + media.png_chunk(b"tEXt", b"Camera\0Gatehouse-2")
        + media.png_chunk(b"IDAT", zlib.compress(bytes(rows), 6))
        + media.png_chunk(b"IEND", b"")
    )


def _silent_wav() -> bytes:
    pcm = b"\0\0" * 8000
    return b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 8000, 16000, 2, 16) + b"data" + struct.pack("<I", len(pcm)) + pcm


# id, compartment, name, state, registered by, cleared by, type, bytes, marks version, saved by, regions
EXHIBITS = (
    ("EX-0001", "CMP-0001", "Harrowgate payment ledger scan", "cleared", "USR-03", "USR-04", "application/pdf",
     lambda: _text_pdf("HARROWGATE-PAYEE-7731", "Harrowgate Archive Desk"), 1, "USR-06", [WHOLE_PAGE]),
    ("EX-0002", "CMP-0001", "Depot gate photograph", "cleared", "USR-04", "USR-03", "image/png",
     _gate_png, 1, "USR-06", [GATE_REGION]),
    ("EX-0003", "CMP-0001", "Anonymous courier note", "quarantined", "USR-03", None, "application/pdf",
     lambda: _text_pdf("COURIER-NOTE-0093"), 0, None, []),
    ("EX-0004", "CMP-0002", "Saltmarsh witness recording 14", "cleared", "USR-05", "USR-04", "audio/wav",
     _silent_wav, 0, None, []),
    ("EX-0005", "CMP-0002", "Saltmarsh boat manifest", "held", "USR-05", "USR-04", "application/pdf",
     lambda: _text_pdf("SALTMARSH-WITNESS-2208"), 0, None, []),
    ("EX-0006", "CMP-0003", "Eastbank tender export", "cleared", "USR-03", "USR-01", "application/pdf",
     lambda: _text_pdf("EASTBANK-TENDER-5510"), 0, None, []),
)
DERIVATIVES = (("DV-0001", "EX-0006", "USR-01"), ("DV-0002", "EX-0002", "USR-06"), ("DV-0003", "EX-0001", "USR-06"))


async def _system(conn: asyncpg.Connection, action: str, target: str, detail: dict | None = None) -> None:
    await ledger.append(conn, actor_id="system", session_id=None, action=action, target=target, detail=detail)


async def seed_records() -> None:
    """People, compartments and grants: nothing here touches storage."""
    async with DB.connection() as conn:
        await conn.execute("SELECT pg_advisory_lock($1)", SEED_LOCK)
        try:
            for person_id, name, email, role, secret in PEOPLE:
                if not await conn.fetchval("SELECT 1 FROM people WHERE id = $1", person_id):
                    await conn.execute(
                        "INSERT INTO people (id, name, email, role, password_hash, totp_secret) VALUES ($1, $2, $3, $4, $5, $6)",
                        person_id, name, email, role, hash_password(PASSWORD), secret,
                    )
            for compartment_id, name, owner, grants in COMPARTMENTS:
                if await conn.fetchval("SELECT 1 FROM compartments WHERE id = $1", compartment_id):
                    continue
                async with conn.transaction():
                    await conn.execute(
                        "INSERT INTO compartments (id, name, owner_id) VALUES ($1, $2, $3)", compartment_id, name, owner
                    )
                    await _system(conn, "compartment.created", compartment_id)
                    for user_id, scope in grants:
                        grant_id = await next_id(conn, "GRT", "grants_seq")
                        await conn.execute(
                            "INSERT INTO grants (id, compartment_id, user_id, scope, state, kind) VALUES ($1, $2, $3, $4, 'active', 'grant')",
                            grant_id, compartment_id, user_id, scope,
                        )
                        await _system(conn, "grant.issued", grant_id, {"compartment_id": compartment_id, "user_id": user_id})
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", SEED_LOCK)


async def _put_confirmed(key: str, data: bytes) -> None:
    await STORAGE.put_bytes(key, data)
    if await STORAGE.digest_of(key) != (hashlib.sha256(data).hexdigest(), len(data)):
        raise StorageUnavailable("seed object not confirmed")


async def _seed_exhibit(conn: asyncpg.Connection, spec: tuple) -> None:
    exhibit_id, compartment_id, name, state, registrar, clearer, kind, make, version, saved_by, regions = spec
    if await conn.fetchval("SELECT 1 FROM exhibits WHERE id = $1", exhibit_id):
        return
    data = make()
    page_count, over_limits = None, False
    if not kind.startswith("audio/"):
        with tempfile.NamedTemporaryFile(prefix="wardline-") as spool:
            spool.write(data)
            spool.flush()
            page_count, over_limits = await media.POOL.run(media.inspect, spool.name, kind)
    key = fresh_key("originals")
    await _put_confirmed(key, data)
    digest = hashlib.sha256(data).hexdigest()
    async with conn.transaction():
        await conn.execute(
            """INSERT INTO exhibits (id, compartment_id, name, state, sha256, size, sniffed_type, page_count, over_render_limits,
                 registered_by, object_key, marks_version, marks_saved_by, regions, source, collected_by, collected_on)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'Seed record', $15, '2026-09-14')""",
            exhibit_id, compartment_id, name, state, digest, len(data), kind, page_count, over_limits,
            registrar, key, version, saved_by, regions, NAMES[registrar],
        )
        await _system(conn, "exhibit.sealed", exhibit_id, {"sha256": digest, "size": len(data)})
        if clearer:
            await _system(conn, "exhibit.cleared", exhibit_id)
        if version:
            await _system(conn, "redaction.saved", exhibit_id, {"marks_version": version})
        if state == "held":
            reason = "Seed hold for matter M-2026-077"
            await conn.execute(
                "INSERT INTO holds (id, exhibit_id, matter_ref, reason, placed_by) VALUES ('HLD-0001', $1, 'M-2026-077', $2, 'USR-02')",
                exhibit_id, reason,
            )
            await _system(conn, "hold.placed", exhibit_id, {"hold_id": "HLD-0001", "matter_ref": "M-2026-077", "reason": reason})


async def _seed_derivative(conn: asyncpg.Connection, derivative_id: str, exhibit_id: str, creator: str) -> None:
    if await conn.fetchval("SELECT 1 FROM derivatives WHERE id = $1", derivative_id):
        return
    exhibit = await conn.fetchrow("SELECT * FROM exhibits WHERE id = $1", exhibit_id)
    with tempfile.NamedTemporaryFile(prefix="wardline-") as source, tempfile.NamedTemporaryFile(prefix="wardline-") as output:
        if not await STORAGE.spool(exhibit["object_key"], source):
            raise StorageUnavailable("seed original missing")
        content_type, page_count = await media.POOL.run(
            media.render_derivative, source.name, exhibit["sniffed_type"], exhibit["regions"], output.name
        )
        output.seek(0)
        data = output.read()
    key = fresh_key("derivatives")
    await _put_confirmed(key, data)
    digest = hashlib.sha256(data).hexdigest()
    async with conn.transaction():
        await conn.execute(
            """INSERT INTO derivatives (id, exhibit_id, compartment_id, sha256, size, content_type, page_count,
                 created_by, marks_version, marks_saved_by, object_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)""",
            derivative_id, exhibit_id, exhibit["compartment_id"], digest, len(data), content_type, page_count,
            creator, exhibit["marks_version"], exhibit["marks_saved_by"], key,
        )
        await _system(conn, "derivative.rendered", derivative_id, {
            "exhibit_id": exhibit_id, "sha256": digest, "size": len(data), "marks_version": exhibit["marks_version"],
        })


async def _seed_release(conn: asyncpg.Connection, release_id: str, name: str, matter: str, recipient: str, state: str,
                        item_id: str, derivative_id: str, label: str) -> None:
    if await conn.fetchval("SELECT 1 FROM releases WHERE id = $1", release_id):
        return
    derivative = await conn.fetchrow("SELECT * FROM derivatives WHERE id = $1", derivative_id)
    async with conn.transaction():
        await conn.execute(
            """INSERT INTO releases (id, compartment_id, name, matter_ref, recipient_kind, state, assembler_id)
               VALUES ($1, 'CMP-0001', $2, $3, $4, $5, 'USR-06')""",
            release_id, name, matter, recipient, state,
        )
        await conn.execute(
            "INSERT INTO release_items (id, release_id, derivative_id, label) VALUES ($1, $2, $3, $4)",
            item_id, release_id, derivative_id, label,
        )
        await conn.execute("INSERT INTO release_contributors (release_id, user_id) VALUES ($1, 'USR-06')", release_id)
        await _system(conn, "release.created", release_id)
        await _system(conn, "release.item_added", release_id, {
            "item_id": item_id, "derivative_id": derivative_id, "exhibit_id": derivative["exhibit_id"],
        })
        await _system(conn, "release.submitted", release_id)
        if state == "shared":
            items = await conn.fetch(ITEMS_SQL, release_id)
            await _system(conn, "release.signed_off", release_id, {
                "manifest_digest": manifest_digest(items), "opened_items": [item_id],
            })
            await conn.execute(
                "INSERT INTO links (id, release_id, token_hash, expires_at) VALUES ('LNK-0001', $1, $2, $3)",
                release_id, digest_token("harrowgate-counsel-seed-link"),
                dt.datetime(2036, 1, 1, tzinfo=dt.UTC),
            )
            await _system(conn, "release.shared", release_id, {"link_id": "LNK-0001"})


async def seed_objects() -> bool:
    """Exhibits, derivatives and releases. Returns False while storage is down, for a later retry."""
    async with DB.connection() as conn:
        await conn.execute("SELECT pg_advisory_lock($1)", SEED_LOCK)
        try:
            for spec in EXHIBITS:
                await _seed_exhibit(conn, spec)
            for derivative_id, exhibit_id, creator in DERIVATIVES:
                await _seed_derivative(conn, derivative_id, exhibit_id, creator)
            await _seed_release(conn, "REL-0001", "Harrowgate disclosure to counsel", "M-2026-041", "counsel", "shared",
                                "ITM-0001", "DV-0002", "Gate photograph, redacted")
            await _seed_release(conn, "REL-0002", "Harrowgate public disclosure", "FOI-2026-118", "requester", "submitted",
                                "ITM-0002", "DV-0003", "Payment ledger, redacted")
        except StorageUnavailable:
            return False
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", SEED_LOCK)
    return True
