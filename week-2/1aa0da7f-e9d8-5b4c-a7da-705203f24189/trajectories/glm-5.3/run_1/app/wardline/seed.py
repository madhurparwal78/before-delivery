"""Seed data, applied idempotently on every start (DP-97)."""
from __future__ import annotations

import datetime
import hashlib
import io

from . import ledger, rendering, security
from .sniffing import sniff

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

PASSWORD = "Custody-Seed-2026!"
SEED_DATE = "2026-09-14"


def _pdf_with_text(text: str) -> bytes:
    """A one-page PDF whose page image carries the seed text."""
    return rendering.pdf_from_pngs([(_text_png(text), 600, 400)])


def _text_png(text: str) -> bytes:
    """A plain black-text page image used for the seeded PDFs."""
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (600, 400), "white")
    draw = ImageDraw.Draw(image)
    draw.text((40, 180), text, fill="black")
    png = rendering._png_bytes(_rows_of(image), 600, 400)
    return png


def _rows_of(image) -> list[bytes]:
    buf = image.convert("RGB").tobytes()
    stride = image.width * 3
    return [buf[y * stride:(y + 1) * stride] for y in range(image.height)]


def _png_with_text_chunk() -> bytes:
    import struct
    import zlib

    from PIL import Image, ImageDraw

    image = Image.new("RGB", (800, 600), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((100, 100, 500, 400), outline="black", width=4)
    raw = bytearray()
    for row in _rows_of(image):
        raw.append(0)
        raw.extend(row)
    out = bytearray(b"\x89PNG\r\n\x1a\n")

    def chunk(tag, data):
        out.extend(struct.pack(">I", len(data)))
        out.extend(tag)
        out.extend(data)
        out.extend(struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    chunk(b"IHDR", struct.pack(">IIBBBBB", 800, 600, 8, 2, 0, 0, 0))
    chunk(b"tEXt", b"Camera\x00Gatehouse-2")
    chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    chunk(b"IEND", b"")
    return bytes(out)


def _wav_silent() -> bytes:
    import struct

    data = b"\x00" * 4410
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack(
        "<IHHIIHH", 16, 1, 1, 44100, 44100, 2, 16
    ) + b"data" + struct.pack("<I", len(data))
    return header + data


def apply(app) -> None:
    """Insert seed people, records and exhibits, all through the ledger."""
    import psycopg

    conn = app.db.connect()
    try:
        _seed_people(app, conn)
        _seed_compartments(app, conn)
        _seed_exhibits(app, conn)
        _seed_releases(app, conn)
        with conn:
            with conn.cursor() as cur:
                cur.execute("INSERT INTO seed_state (key, value) VALUES ('seeded', 'v1') "
                            "ON CONFLICT (key) DO UPDATE SET value = 'v1'")
                conn.commit()
    finally:
        app.db.put(conn)


def _seed_people(app, conn) -> None:
    with conn:
        with conn.cursor() as cur:
            cur.execute("SELECT value FROM seed_state WHERE key = 'seeded'")
            if cur.fetchone():
                conn.rollback()
                return
            for pid, name, email, role, secret in PEOPLE:
                cur.execute(
                    "INSERT INTO people (id, name, email, role, password_sha256, totp_secret) "
                    "VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
                    (pid, name, email, role,
                     security.sha256_hex(PASSWORD.encode("utf-8")), secret),
                )
            conn.commit()


def _seed_compartments(app, conn) -> None:
    with conn:
        with conn.cursor() as cur:
            compartments = [
                ("CMP-0001", "Harrowgate Depot Payments", "USR-01"),
                ("CMP-0002", "Saltmarsh Witness Statements", "USR-02"),
                ("CMP-0003", "Eastbank Tender Records", "USR-01"),
            ]
            for cid, name, owner in compartments:
                cur.execute("SELECT 1 FROM compartments WHERE id = %s", (cid,))
                if cur.fetchone():
                    continue
                cur.execute("INSERT INTO compartments (id, name, owner_id, access_version) VALUES (%s, %s, %s, 1)",
                            (cid, name, owner))
                ledger.append(cur, "system", None, "compartment.created", cid, {})
            grants = [
                ("GRN-0001", "CMP-0001", "USR-01", "full"),
                ("GRN-0002", "CMP-0001", "USR-02", "full"),
                ("GRN-0003", "CMP-0001", "USR-03", "full"),
                ("GRN-0004", "CMP-0001", "USR-04", "full"),
                ("GRN-0005", "CMP-0001", "USR-06", "full"),
                ("GRN-0006", "CMP-0002", "USR-02", "full"),
                ("GRN-0007", "CMP-0002", "USR-04", "full"),
                ("GRN-0008", "CMP-0002", "USR-05", "full"),
                ("GRN-0009", "CMP-0002", "USR-07", "full"),
                ("GRN-0010", "CMP-0003", "USR-01", "full"),
                ("GRN-0011", "CMP-0003", "USR-03", "full"),
                ("GRN-0012", "CMP-0003", "USR-08", "derivatives"),
            ]
            for gid, cid, uid, scope in grants:
                cur.execute("SELECT 1 FROM grants WHERE id = %s", (gid,))
                if cur.fetchone():
                    continue
                cur.execute(
                    "INSERT INTO grants (id, compartment_id, user_id, scope, kind, state) "
                    "VALUES (%s, %s, %s, %s, 'grant', 'active')", (gid, cid, uid, scope),
                )
                ledger.append(cur, "system", None, "grant.issued", gid,
                              {"compartment_id": cid, "user_id": uid})
            conn.commit()


def _seed_exhibits(app, conn) -> None:
    files = {
        "EX-0001": (_pdf_with_text("HARROWGATE-PAYEE-7731"), "application/pdf"),
        "EX-0002": (_png_with_text_chunk(), "image/png"),
        "EX-0003": (_pdf_with_text("COURIER-NOTE-0093"), "application/pdf"),
        "EX-0004": (_wav_silent(), "audio/wav"),
        "EX-0005": (_pdf_with_text("SALTMARSH-WITNESS-2208"), "application/pdf"),
        "EX-0006": (_pdf_with_text("EASTBANK-TENDER-5510"), "application/pdf"),
    }
    meta = [
        ("EX-0001", "CMP-0001", "Harrowgate payment ledger scan", "cleared", "USR-03", "USR-04", 1),
        ("EX-0002", "CMP-0001", "Depot gate photograph", "cleared", "USR-04", "USR-03", 1),
        ("EX-0003", "CMP-0001", "Anonymous courier note", "quarantined", "USR-03", None, 0),
        ("EX-0004", "CMP-0002", "Saltmarsh witness recording 14", "cleared", "USR-05", "USR-04", 0),
        ("EX-0005", "CMP-0002", "Saltmarsh boat manifest", "held", "USR-05", "USR-04", 0),
        ("EX-0006", "CMP-0003", "Eastbank tender export", "cleared", "USR-03", "USR-01", 0),
    ]
    for eid, cid, name, state, registered_by, cleared_by, marks_version in meta:
        data, content_type = files[eid]
        digest = hashlib.sha256(data).hexdigest()
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM exhibits WHERE id = %s", (eid,))
            if cur.fetchone():
                conn.rollback()
                continue
        key = f"originals/seed-{eid.lower()}"
        try:
            if app.storage.stat(key) is None:
                app.storage.put_bytes(key, data, content_type)
        except Exception:
            continue
        page_count = None
        try:
            parsed = rendering.parse(data, content_type)
            if parsed is not None:
                page_count = parsed.page_count
        except Exception:
            page_count = None
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO exhibits (id, compartment_id, name, state, sha256, size, sniffed_type, "
                    "page_count, storage_key, registered_by, cleared_by, marks_version, "
                    "provenance_source, provenance_collected_by, provenance_collected_on) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'Seed record', %s, %s)",
                    (eid, cid, name, state, digest, len(data), content_type, page_count, key,
                     registered_by, cleared_by, marks_version,
                     _person_name(registered_by), SEED_DATE),
                )
                ledger.append(cur, "system", None, "exhibit.sealed", eid,
                              {"sha256": digest, "size": len(data)})
                if cleared_by:
                    ledger.append(cur, "system", None, "exhibit.cleared", eid, {})
    # regions for marks version 1 exhibits
    with conn:
        with conn.cursor() as cur:
            regions = {
                "EX-0002": [(1, 100, 100, 400, 300)],
                "EX-0001": [(1, 0, 0, 1000, 1000)],
            }
            for eid, rs in regions.items():
                for page, x, y, w, h in rs:
                    cur.execute(
                        "INSERT INTO redaction_regions (exhibit_id, page, x, y, w, h) "
                        "SELECT %s, %s, %s, %s, %s, %s WHERE NOT EXISTS "
                        "(SELECT 1 FROM redaction_regions WHERE exhibit_id = %s AND page = %s AND x = %s AND y = %s AND w = %s AND h = %s)",
                        (eid, page, x, y, w, h, eid, page, x, y, w, h),
                    )
            # hold for EX-0005
            cur.execute("SELECT 1 FROM holds WHERE id = 'HLD-0001'")
            if not cur.fetchone():
                cur.execute(
                    "INSERT INTO holds (id, exhibit_id, matter_ref, reason, placed_by, active) "
                    "VALUES ('HLD-0001', 'EX-0005', 'M-2026-077', 'Seed hold for matter M-2026-077', 'USR-02', true)"
                )
                ledger.append(cur, "system", None, "hold.placed", "EX-0005",
                              {"hold_id": "HLD-0001", "matter_ref": "M-2026-077"})
            conn.commit()
    _seed_derivatives(app, conn)
    _seed_releases(app, conn)


def _person_name(pid: str) -> str:
    return dict((p[0], p[1]) for p in PEOPLE)[pid]


def _seed_derivatives(app, conn) -> None:
    derivatives = [
        ("DV-0001", "EX-0006", "CMP-0003", "USR-01", None, 0),
        ("DV-0002", "EX-0002", "CMP-0001", "USR-06", "USR-06", 1),
        ("DV-0003", "EX-0001", "CMP-0001", "USR-06", "USR-06", 1),
    ]
    for did, eid, cid, created_by, saved_by, mv in derivatives:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM derivatives WHERE id = %s", (did,))
            if cur.fetchone():
                continue
        with conn.cursor() as cur:
            cur.execute("SELECT storage_key, sniffed_type FROM exhibits WHERE id = %s", (eid,))
            key, sniffed = cur.fetchone()
            cur.execute("SELECT page, x, y, w, h FROM redaction_regions WHERE exhibit_id = %s ORDER BY page, y, x", (eid,))
            regions = [{"page": p, "x": x, "y": y, "w": w, "h": h} for p, x, y, w, h in cur.fetchall()]
        try:
            data = app.storage.get(key)
            parsed = rendering.parse(data, sniffed)
            if isinstance(parsed, rendering.ImagePages):
                blob = parsed.raster(1, regions)
                content_type = "image/png"
                page_count = 1
            else:
                pages = [(parsed.raster(p, regions),) for p in range(1, parsed.page_count + 1)]
                blob = rendering.pdf_from_pngs([(p[0], _png_size(p[0])[0], _png_size(p[0])[1]) for p in pages])
                content_type = "application/pdf"
                page_count = parsed.page_count
        except Exception:
            continue
        dkey = f"derivatives/seed-{did.lower()}"
        try:
            if app.storage.stat(dkey) is None:
                app.storage.put_bytes(dkey, blob, content_type)
        except Exception:
            continue
        digest = hashlib.sha256(blob).hexdigest()
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO derivatives (id, exhibit_id, compartment_id, sha256, size, content_type, "
                    "page_count, storage_key, marks_version, marks_saved_by, created_by) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (did, eid, cid, digest, len(blob), content_type, page_count, dkey, mv, saved_by, created_by),
                )
                ledger.append(cur, "system", None, "derivative.rendered", did, {"exhibit_id": eid})


def _png_size(png: bytes) -> tuple[int, int]:
    import struct

    w, h = struct.unpack(">II", png[16:24])
    return w, h


def _seed_releases(app, conn) -> None:
    from .ledger import manifest_digest as _manifest

    with conn:
        with conn.cursor() as cur:
            if not cur.execute("SELECT 1 FROM releases WHERE id = 'REL-0001'").fetchone():
                cur.execute("SELECT sha256, size FROM derivatives WHERE id = 'DV-0002'")
                sha, size = cur.fetchone()
                manifest = _manifest([{"derivative_id": "DV-0002",
                                       "label": "Gate photograph, redacted", "sha256": sha}])
                cur.execute(
                    "INSERT INTO releases (id, compartment_id, name, matter_ref, recipient_kind, state, "
                    "assembler_id, manifest_digest, total_bytes) VALUES ('REL-0001', 'CMP-0001', "
                    "'Harrowgate disclosure to counsel', 'M-2026-041', 'counsel', 'shared', 'USR-06', %s, %s)",
                    (manifest, size),
                )
                ledger.append(cur, "system", None, "release.created", "REL-0001", {})
                cur.execute(
                    "INSERT INTO release_items (id, release_id, derivative_id, label, position) "
                    "VALUES ('ITM-0001', 'REL-0001', 'DV-0002', 'Gate photograph, redacted', 1)"
                )
                ledger.append(cur, "system", None, "release.item_added", "REL-0001",
                              {"item_id": "ITM-0001", "derivative_id": "DV-0002", "exhibit_id": "EX-0002"})
                ledger.append(cur, "system", None, "release.submitted", "REL-0001", {})
                ledger.append(cur, "system", None, "release.signed_off", "REL-0001",
                              {"manifest_digest": manifest, "opened_items": ["ITM-0001"]})
                cur.execute("INSERT INTO release_contributors VALUES ('REL-0001', 'USR-06')")
                cur.execute(
                    "INSERT INTO links (id, release_id, token_sha256, expires_at, state) "
                    "VALUES ('LNK-0001', 'REL-0001', %s, '2036-01-01T00:00:00Z', 'active')",
                    (security.hash_token("harrowgate-counsel-seed-link"),),
                )
                ledger.append(cur, "system", None, "release.shared", "REL-0001", {"link_id": "LNK-0001"})
            if not cur.execute("SELECT 1 FROM releases WHERE id = 'REL-0002'").fetchone():
                cur.execute("SELECT sha256, size FROM derivatives WHERE id = 'DV-0003'")
                sha, size = cur.fetchone()
                manifest = _manifest([{"derivative_id": "DV-0003",
                                       "label": "Payment ledger, redacted", "sha256": sha}])
                cur.execute(
                    "INSERT INTO releases (id, compartment_id, name, matter_ref, recipient_kind, state, "
                    "assembler_id, manifest_digest, total_bytes) VALUES ('REL-0002', 'CMP-0001', "
                    "'Harrowgate public disclosure', 'FOI-2026-118', 'requester', 'submitted', 'USR-06', %s, %s)",
                    (manifest, size),
                )
                ledger.append(cur, "system", None, "release.created", "REL-0002", {})
                cur.execute(
                    "INSERT INTO release_items (id, release_id, derivative_id, label, position) "
                    "VALUES ('ITM-0002', 'REL-0002', 'DV-0003', 'Payment ledger, redacted', 1)"
                )
                ledger.append(cur, "system", None, "release.item_added", "REL-0002",
                              {"item_id": "ITM-0002", "derivative_id": "DV-0003", "exhibit_id": "EX-0001"})
                ledger.append(cur, "system", None, "release.submitted", "REL-0002", {})
                cur.execute("INSERT INTO release_contributors VALUES ('REL-0002', 'USR-06')")
            conn.commit()
