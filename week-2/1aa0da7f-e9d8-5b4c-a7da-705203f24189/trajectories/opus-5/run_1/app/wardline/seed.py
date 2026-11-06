"""Idempotent schema seeding: the published people, compartments and exhibits."""

from __future__ import annotations

import hashlib
import json
import struct
import zlib
from datetime import datetime, timezone
from typing import Any

from . import auth, db, ledger, media, storage

PASSWORD = "Custody-Seed-2026!"

PEOPLE = [
    ("USR-01", "Tamsin Oduya", "tamsin.oduya@ashgrove.example", "case_lead", "TAMSINODUYA2WARD"),
    ("USR-02", "Rafael Lindqvist", "rafael.lindqvist@ashgrove.example", "case_lead", "RAFAELLINDQ3WARD"),
    ("USR-03", "Ines Marlow", "ines.marlow@ashgrove.example", "intake_officer", "INESMARLOW4WARDL"),
    ("USR-04", "Kofi Brandt", "kofi.brandt@ashgrove.example", "intake_officer", "KOFIBRANDT5WARDL"),
    ("USR-05", "Mbali Serrano", "mbali.serrano@ashgrove.example", "intake_officer", "MBALISERRANO6WRD"),
    ("USR-06", "Noor Halloran", "noor.halloran@ashgrove.example", "investigator", "NOORHALLORAN7WRD"),
    ("USR-07", "Dmitri Vance", "dmitri.vance@ashgrove.example", "investigator", "DMITRIVANCE2LINE"),
    ("USR-08", "Yuki Castellan", "yuki.castellan@ashgrove.example", "investigator", "YUKICASTELLAN3WD"),
    ("USR-09", "Sefa Whitlock", "sefa.whitlock@ashgrove.example", "auditor", "SEFAWHITLOCK4WRD"),
]

COMPARTMENTS = [
    ("CMP-0001", "Harrowgate Depot Payments", "USR-01"),
    ("CMP-0002", "Saltmarsh Witness Statements", "USR-02"),
    ("CMP-0003", "Eastbank Tender Records", "USR-01"),
]

GRANTS = [
    ("CMP-0001", "USR-01", "full"),
    ("CMP-0001", "USR-02", "full"),
    ("CMP-0001", "USR-03", "full"),
    ("CMP-0001", "USR-04", "full"),
    ("CMP-0001", "USR-06", "full"),
    ("CMP-0002", "USR-02", "full"),
    ("CMP-0002", "USR-04", "full"),
    ("CMP-0002", "USR-05", "full"),
    ("CMP-0002", "USR-07", "full"),
    ("CMP-0003", "USR-01", "full"),
    ("CMP-0003", "USR-03", "full"),
    ("CMP-0003", "USR-08", "derivatives"),
]

NAMES = {person[0]: person[1] for person in PEOPLE}


def _pdf(text: str, author: str | None) -> bytes:
    content = (
        b"BT\n/F1 24 Tf\n72 700 Td\n(" + text.encode("ascii") + b") Tj\nET\n"
    )
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]"
        b" /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length "
        + str(len(content)).encode()
        + b" >>\nstream\n"
        + content
        + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica"
        b" /Encoding /WinAnsiEncoding >>",
    ]
    if author is not None:
        objects.append(b"<< /Author (" + author.encode("ascii") + b") >>")
    out = bytearray(b"%PDF-1.7\n")
    offsets = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{index} 0 obj\n".encode())
        out.extend(body)
        out.extend(b"\nendobj\n")
    xref_at = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    out.extend(b"0000000000 65535 f \n")
    for offset in offsets:
        out.extend(f"{offset:010d} 00000 n \n".encode())
    trailer = f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R"
    if author is not None:
        trailer += f" /Info {len(objects)} 0 R"
    trailer += f" >>\nstartxref\n{xref_at}\n"
    out.extend(trailer.encode())
    out.extend(b"%%EOF\n")
    return bytes(out)


def _png(width: int, height: int, note: str) -> bytes:
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            rows.extend(((x * 255) // width, (y * 255) // height, 180))
    out = bytearray(b"\x89PNG\r\n\x1a\n")

    def chunk(kind: bytes, payload: bytes) -> None:
        out.extend(len(payload).to_bytes(4, "big"))
        out.extend(kind)
        out.extend(payload)
        out.extend(zlib.crc32(kind + payload).to_bytes(4, "big"))

    chunk(
        b"IHDR",
        width.to_bytes(4, "big") + height.to_bytes(4, "big") + bytes([8, 2, 0, 0, 0]),
    )
    chunk(b"tEXt", b"Comment\x00" + note.encode("latin-1"))
    chunk(b"IDAT", zlib.compress(bytes(rows), 6))
    chunk(b"IEND", b"")
    return bytes(out)


def _wav(seconds: int = 1, rate: int = 44100) -> bytes:
    frames = rate * seconds
    data = b"\x00\x00" * frames
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
    header += b"data" + struct.pack("<I", len(data))
    return header + data


EXHIBITS = [
    {
        "id": "EX-0001",
        "compartment": "CMP-0001",
        "name": "Harrowgate payment ledger scan",
        "state": "cleared",
        "registered_by": "USR-03",
        "cleared_by": "USR-04",
        "marks_version": 1,
        "marks_saved_by": "USR-06",
        "regions": [{"page": 1, "x": 0, "y": 0, "w": 1000, "h": 1000}],
        "type": "application/pdf",
        "payload": lambda: _pdf("HARROWGATE-PAYEE-7731", "Harrowgate Archive Desk"),
    },
    {
        "id": "EX-0002",
        "compartment": "CMP-0001",
        "name": "Depot gate photograph",
        "state": "cleared",
        "registered_by": "USR-04",
        "cleared_by": "USR-03",
        "marks_version": 1,
        "marks_saved_by": "USR-06",
        "regions": [{"page": 1, "x": 100, "y": 100, "w": 400, "h": 300}],
        "type": "image/png",
        "payload": lambda: _png(800, 600, "Camera=Gatehouse-2"),
    },
    {
        "id": "EX-0003",
        "compartment": "CMP-0001",
        "name": "Anonymous courier note",
        "state": "quarantined",
        "registered_by": "USR-03",
        "cleared_by": None,
        "marks_version": 0,
        "marks_saved_by": None,
        "regions": [],
        "type": "application/pdf",
        "payload": lambda: _pdf("COURIER-NOTE-0093", None),
    },
    {
        "id": "EX-0004",
        "compartment": "CMP-0002",
        "name": "Saltmarsh witness recording 14",
        "state": "cleared",
        "registered_by": "USR-05",
        "cleared_by": "USR-04",
        "marks_version": 0,
        "marks_saved_by": None,
        "regions": [],
        "type": "audio/wav",
        "payload": _wav,
    },
    {
        "id": "EX-0005",
        "compartment": "CMP-0002",
        "name": "Saltmarsh boat manifest",
        "state": "held",
        "registered_by": "USR-05",
        "cleared_by": "USR-04",
        "marks_version": 0,
        "marks_saved_by": None,
        "regions": [],
        "type": "application/pdf",
        "payload": lambda: _pdf("SALTMARSH-WITNESS-2208", None),
    },
    {
        "id": "EX-0006",
        "compartment": "CMP-0003",
        "name": "Eastbank tender export",
        "state": "cleared",
        "registered_by": "USR-03",
        "cleared_by": "USR-01",
        "marks_version": 0,
        "marks_saved_by": None,
        "regions": [],
        "type": "application/pdf",
        "payload": lambda: _pdf("EASTBANK-TENDER-5510", None),
    },
]

DERIVATIVES = [
    ("DV-0001", "EX-0006", "USR-01", None, 0),
    ("DV-0002", "EX-0002", "USR-06", "USR-06", 1),
    ("DV-0003", "EX-0001", "USR-06", "USR-06", 1),
]

RELEASES = [
    {
        "id": "REL-0001",
        "compartment": "CMP-0001",
        "name": "Harrowgate disclosure to counsel",
        "matter_ref": "M-2026-041",
        "recipient_kind": "counsel",
        "state": "shared",
        "assembler": "USR-06",
        "signed_off_by": "USR-01",
        "items": [("ITM-0001", "DV-0002", "Gate photograph, redacted")],
    },
    {
        "id": "REL-0002",
        "compartment": "CMP-0001",
        "name": "Harrowgate public disclosure",
        "matter_ref": "FOI-2026-118",
        "recipient_kind": "requester",
        "state": "submitted",
        "assembler": "USR-06",
        "signed_off_by": None,
        "items": [("ITM-0002", "DV-0003", "Payment ledger, redacted")],
    },
]

SEED_LINK_TOKEN = "harrowgate-counsel-seed-link"


def _system_entry(cur: Any, action: str, target: str, detail: dict | None = None) -> None:
    ledger.append(
        cur,
        action=action,
        actor_id="system",
        session_id=None,
        target=target,
        detail=detail or {},
    )


def seed_people() -> None:
    now = datetime.now(timezone.utc)
    with db.tx() as cur:
        db.take_lock(cur, db.LOCK_SEED, 2)
        cur.execute("SELECT count(*) AS n FROM users")
        if cur.fetchone()["n"] > 0:
            return
        password_hash = auth.hash_password(PASSWORD)
        for person_id, name, email, role, secret in PEOPLE:
            cur.execute(
                """
                INSERT INTO users (id, name, email, role, password_hash, totp_secret)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (person_id, name, email, role, password_hash, secret),
            )
        for compartment_id, name, owner in COMPARTMENTS:
            cur.execute(
                """
                INSERT INTO compartments (id, name, owner_id, access_version, created_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (compartment_id, name, owner, len(GRANTS), now),
            )
            _system_entry(cur, "compartment.created", compartment_id)
        for index, (compartment_id, user_id, scope) in enumerate(GRANTS, start=1):
            grant_id = f"GRT-{index:04d}"
            cur.execute(
                """
                INSERT INTO grants
                    (id, compartment_id, user_id, scope, state, expires_at, kind, created_at)
                VALUES (%s, %s, %s, %s, 'active', NULL, 'grant', %s)
                """,
                (grant_id, compartment_id, user_id, scope, now),
            )
            _system_entry(
                cur,
                "grant.issued",
                grant_id,
                {"compartment_id": compartment_id, "user_id": user_id},
            )
        db.reserve_id(cur, "CMP", len(COMPARTMENTS))
        db.reserve_id(cur, "GRT", len(GRANTS))


def _store(payload: bytes, prefix: str) -> tuple[str, int, str]:
    key = storage.object_key(prefix)
    storage.put_object(key, payload)
    size, digest = storage.measure_object(key)
    if size != len(payload) or digest != hashlib.sha256(payload).hexdigest():
        raise storage.StorageDown("seed object did not confirm")
    return key, size, digest


def seed_records() -> bool:
    """Seeds exhibits, derivatives and releases; needs storage for their objects."""
    now = datetime.now(timezone.utc)
    with db.tx() as cur:
        cur.execute("SELECT count(*) AS n FROM exhibits")
        if cur.fetchone()["n"] >= len(EXHIBITS):
            return True
    payloads: dict[str, bytes] = {}
    stored: dict[str, tuple[str, int, str]] = {}
    for spec in EXHIBITS:
        payload = spec["payload"]()
        payloads[spec["id"]] = payload
        stored[spec["id"]] = _store(payload, "originals")
    derivative_objects: dict[str, tuple[str, int, str, str, int | None]] = {}
    for derivative_id, exhibit_id, _creator, _saver, marks_version in DERIVATIVES:
        spec = next(item for item in EXHIBITS if item["id"] == exhibit_id)
        regions = spec["regions"] if marks_version > 0 else []
        pages = media.inspect(payloads[exhibit_id], spec["type"]).page_count or 1
        payload, content_type = media.render_derivative(
            payloads[exhibit_id], spec["type"], pages, regions
        )
        key, size, digest = _store(payload, "derivatives")
        derivative_objects[derivative_id] = (
            key,
            size,
            digest,
            content_type,
            pages if content_type == "application/pdf" else 1,
        )
    with db.tx() as cur:
        db.take_lock(cur, db.LOCK_SEED, 3)
        cur.execute("SELECT count(*) AS n FROM exhibits")
        if cur.fetchone()["n"] >= len(EXHIBITS):
            return True
        for spec in EXHIBITS:
            key, size, digest = stored[spec["id"]]
            inspection = media.inspect(payloads[spec["id"]], spec["type"])
            cur.execute(
                """
                INSERT INTO exhibits
                    (id, compartment_id, name, state, sha256, size, sniffed_type,
                     page_count, registered_by, marks_version, marks_saved_by, seal_check,
                     object_key, renderable, source, collected_by, collected_on,
                     capture_notes, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL, %s, %s,
                        'Seed record', %s, '2026-09-14', NULL, %s)
                """,
                (
                    spec["id"],
                    spec["compartment"],
                    spec["name"],
                    spec["state"],
                    digest,
                    size,
                    spec["type"],
                    inspection.page_count,
                    spec["registered_by"],
                    spec["marks_version"],
                    spec["marks_saved_by"],
                    key,
                    inspection.renderable,
                    NAMES[spec["registered_by"]],
                    now,
                ),
            )
            _system_entry(
                cur, "exhibit.sealed", spec["id"], {"sha256": digest, "size": size}
            )
            if spec["cleared_by"] is not None:
                _system_entry(cur, "exhibit.cleared", spec["id"])
            if spec["marks_version"] > 0:
                cur.execute(
                    "INSERT INTO redactions (exhibit_id, regions) VALUES (%s, %s)",
                    (spec["id"], json.dumps(spec["regions"])),
                )
                _system_entry(
                    cur,
                    "redaction.saved",
                    spec["id"],
                    {"marks_version": spec["marks_version"]},
                )
        cur.execute(
            """
            INSERT INTO holds (id, exhibit_id, matter_ref, placed_by, reason, state, placed_at)
            VALUES ('HLD-0001', 'EX-0005', 'M-2026-077', 'USR-02',
                    'Seed hold for matter M-2026-077', 'active', %s)
            """,
            (now,),
        )
        _system_entry(
            cur,
            "hold.placed",
            "EX-0005",
            {"hold_id": "HLD-0001", "matter_ref": "M-2026-077"},
        )
        for derivative_id, exhibit_id, creator, saver, marks_version in DERIVATIVES:
            key, size, digest, content_type, pages = derivative_objects[derivative_id]
            compartment = next(
                item["compartment"] for item in EXHIBITS if item["id"] == exhibit_id
            )
            cur.execute(
                """
                INSERT INTO derivatives
                    (id, exhibit_id, compartment_id, sha256, size, content_type,
                     page_count, created_by, marks_version, marks_saved_by, object_key,
                     disposed, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, false, %s)
                """,
                (
                    derivative_id,
                    exhibit_id,
                    compartment,
                    digest,
                    size,
                    content_type,
                    pages,
                    creator,
                    marks_version,
                    saver,
                    key,
                    now,
                ),
            )
            _system_entry(
                cur,
                "derivative.rendered",
                derivative_id,
                {"exhibit_id": exhibit_id, "marks_version": marks_version},
            )
        for spec in RELEASES:
            cur.execute(
                """
                INSERT INTO releases
                    (id, compartment_id, name, matter_ref, recipient_kind, state,
                     assembler_id, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    spec["id"],
                    spec["compartment"],
                    spec["name"],
                    spec["matter_ref"],
                    spec["recipient_kind"],
                    spec["state"],
                    spec["assembler"],
                    now,
                ),
            )
            _system_entry(cur, "release.created", spec["id"])
            for item_id, derivative_id, label in spec["items"]:
                cur.execute(
                    """
                    INSERT INTO release_items (id, release_id, derivative_id, label, created_at)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (item_id, spec["id"], derivative_id, label, now),
                )
                exhibit_id = next(
                    row[1] for row in DERIVATIVES if row[0] == derivative_id
                )
                creator = next(row[2] for row in DERIVATIVES if row[0] == derivative_id)
                saver = next(row[3] for row in DERIVATIVES if row[0] == derivative_id)
                for contributor in {spec["assembler"], creator, saver}:
                    if contributor is not None:
                        cur.execute(
                            """
                            INSERT INTO release_contributors (release_id, user_id)
                            VALUES (%s, %s) ON CONFLICT DO NOTHING
                            """,
                            (spec["id"], contributor),
                        )
                _system_entry(
                    cur,
                    "release.item_added",
                    spec["id"],
                    {
                        "item_id": item_id,
                        "derivative_id": derivative_id,
                        "exhibit_id": exhibit_id,
                    },
                )
            _system_entry(cur, "release.submitted", spec["id"])
            if spec["signed_off_by"] is not None:
                _system_entry(cur, "release.signed_off", spec["id"])
        cur.execute(
            """
            INSERT INTO links (id, release_id, token_hash, state, expires_at, created_at)
            VALUES ('LNK-0001', 'REL-0001', %s, 'active', '2036-01-01T00:00:00Z', %s)
            """,
            (auth.token_digest(SEED_LINK_TOKEN), now),
        )
        _system_entry(cur, "release.shared", "REL-0001", {"link_id": "LNK-0001"})
        db.reserve_id(cur, "EX", len(EXHIBITS))
        db.reserve_id(cur, "DV", len(DERIVATIVES))
        db.reserve_id(cur, "REL", len(RELEASES))
        db.reserve_id(cur, "ITM", 2)
        db.reserve_id(cur, "HLD", 1)
        db.reserve_id(cur, "LNK", 1)
    return True
