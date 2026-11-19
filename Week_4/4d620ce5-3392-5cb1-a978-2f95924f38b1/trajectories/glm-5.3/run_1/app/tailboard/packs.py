"""Compliance packs: content-addressed objects, one email, all-or-nothing (DP-46 to DP-50)."""
import csv
import hashlib
import io
import json
import secrets

from .clock import clock, format_iso
from .domain import tag_of
from .errors import conflict, not_found


def neutralise(value: str) -> str:
    """Cells a spreadsheet could read as a formula are written with a leading apostrophe."""
    if value and value[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def pack_csv(directive, threads) -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    writer.writerow(["registration", "model", "msn", "directive", "revision", "title", "state",
                     "governing_revision", "deadline_date", "fh_threshold", "governing",
                     "inspector", "inspector_licence", "inspected_at", "certifier",
                     "certifier_licence", "certified_at", "timeliness", "legacy_notes"])
    label = f"{directive['authority']} {directive['number']}"
    for thread in threads:
        inspector = next((s for s in thread["signatures"] if s["kind"] == "inspection" and s["status"] != "void"), None)
        certifier = next((s for s in thread["signatures"] if s["kind"] == "countersignature" and s["status"] != "void"), None)
        inspector_name = _signer_name(inspector)
        certifier_name = _signer_name(certifier)
        legacy_notes = " | ".join(
            record["notes"] for record in thread.get("legacy_records", []) if record.get("notes"))
        writer.writerow([
            neutralise(thread["registration"]),
            neutralise(thread["model"]),
            thread["msn"],
            neutralise(label),
            neutralise(thread["revision"]),
            neutralise(thread["wording"]["title"]),
            neutralise(thread["state"]),
            neutralise(thread["governing_revision"]),
            neutralise(thread["limits"]["deadline_date"]),
            thread["limits"]["fh_threshold"],
            neutralise(thread["governing"] or ""),
            neutralise(inspector_name),
            neutralise(_licence_of(inspector)),
            inspector["committed_at"] if inspector else "",
            neutralise(certifier_name),
            neutralise(_licence_of(certifier)),
            certifier["committed_at"] if certifier else "",
            neutralise(inspector["timeliness"] if inspector else ""),
            neutralise(legacy_notes),
        ])
    return buffer.getvalue().encode("utf-8")


def _signer_name(signature) -> str:
    if signature is None:
        return ""
    if signature["signer"]:
        return signature["signer"]["display_name"]
    return signature.get("signer_text") or ""


def _licence_of(signature) -> str:
    if signature is None or signature["signer"] is None:
        return ""
    return signature["signer"]["licence"] or ""


def pack_pdf(directive, threads, generated_at) -> bytes:
    """A minimal PDF with uncompressed text so every line is byte-searchable."""
    label = f"{directive['authority']} {directive['number']}"
    lines = [
        f"Compliance pack {label} {tag_of(directive['revision'])}",
        "Operator: Fenwick Regional Airways",
        f"Generated: {generated_at}",
        "",
    ]
    for thread in threads:
        inspector = next((s for s in thread["signatures"] if s["kind"] == "inspection" and s["status"] != "void"), None)
        lines.append(
            f"{thread['registration']} {thread['model']} {thread['msn']} "
            f"{thread['state']} {thread['governing_revision']} {thread['limits']['deadline_date']} "
            f"{_signer_name(inspector)} {thread['label']}")
    lines.append("")
    content = "\n".join(lines)
    escaped = content.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
    chunks = escaped.split("\n")
    stream = "BT /F1 9 Tf 12 TL 40 780 Td\n" + "".join(f"({chunk}) Tj T*\n" for chunk in chunks) + "ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        ("<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream)).encode("latin-1", "replace"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{index} 0 obj\n".encode())
        out.write(obj)
        out.write(b"\nendobj\n")
    start = out.tell()
    out.write(b"xref\n0 %d\n" % (len(objects) + 1))
    out.write(b"0000000000 65535 f \n")
    for offset in offsets:
        out.write(b"%010d 00000 n \n" % offset)
    out.write(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, start))
    return out.getvalue()


class PackService:
    def __init__(self, repo, pool, storage, mailer, app_url, authority_mailbox, actions):
        self.repo = repo
        self.pool = pool
        self.storage = storage
        self.mailer = mailer
        self.app_url = app_url
        self.authority_mailbox = authority_mailbox
        self.actions = actions

    async def request(self, actor, lineage_id) -> tuple[dict, int]:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                lineage = await conn.fetchrow("SELECT * FROM lineages WHERE id = $1", lineage_id)
                if lineage is None:
                    raise not_found("No such directive.")
                queued = await conn.fetchrow(
                    "SELECT id FROM packs WHERE lineage_id = $1 AND status = 'queued'", lineage_id)
                if queued:
                    raise conflict("pack_already_queued",
                                   f"A pack for {lineage['authority']} {lineage['number']} is already queued.",
                                   pack_id=queued["id"])
                pack_id = f"pk_{secrets.token_hex(6)}"
                await conn.execute(
                    """INSERT INTO packs (id, lineage_id, revision, status, waiting_for,
                       requested_by, requested_at) VALUES ($1, $2, $3, 'queued', NULL, $4, $5)""",
                    *(pack_id, lineage_id, lineage["revision"], actor["id"], clock().now()))
                await conn.execute(
                    "INSERT INTO audit (at, actor_id, action, directive_id, thread_id, detail) VALUES ($1, $2, 'pack.requested', $3, NULL, $4)",
                    *(clock().now(), actor["id"], lineage_id, json.dumps({"pack_id": pack_id})))
        pack = await self.repo.pack(pack_id)
        return pack_shape(pack), 201

    async def attempt(self, pack_id: str) -> bool:
        """One attempt under a claim lock: only a worker that flips the pack to
        'sending' proceeds, so exactly one email and one pair of objects exist."""
        async with self.pool.acquire() as conn:
            claimed = await conn.fetchrow(
                """UPDATE packs SET waiting_for = NULL, attempts = attempts + 1
                   WHERE id = $1 AND status = 'queued' RETURNING *""", pack_id)
        if claimed is None:
            return False
        pack = claimed

        lineage = await self.repo.lineage(pack["lineage_id"])
        threads = await self.repo.threads_of_lineage(pack["lineage_id"])
        from .service import BoardService
        board = BoardService(self.repo)
        people = await board.load_people()
        tails = await board.load_tails()
        now = clock().now()
        shapes = []
        for thread_row in threads:
            view = await board.thread_view(thread_row, people, tails, now)
            shapes.append(view.shape())
        directive = {
            "authority": lineage["authority"],
            "number": lineage["number"],
            "revision": pack["revision"],
        }
        generated_at = format_iso(now)
        pdf_bytes = pack_pdf(directive, shapes, generated_at)
        csv_bytes = pack_csv(directive, shapes)

        pdf_sha = hashlib.sha256(pdf_bytes).hexdigest()
        csv_sha = hashlib.sha256(csv_bytes).hexdigest()
        from .storage import pack_pdf_key, pack_csv_key
        pdf_key = pack_pdf_key(pdf_sha)
        csv_key = pack_csv_key(csv_sha)
        if not await self.storage.available():
            await self._mark_waiting(pack_id, "object_storage")
            return False
        try:
            await self.storage.put(pdf_key, pdf_bytes, "application/pdf")
            await self.storage.put(csv_key, csv_bytes, "text/csv")
        except Exception:
            await self._mark_waiting(pack_id, "object_storage")
            return False

        label = f"{lineage['authority']} {lineage['number']}"
        subject = f"Compliance pack {label} {tag_of(pack['revision'])} from Fenwick Regional Airways"
        body = (
            f"Pack: {pack_id}\n"
            f"Link: {self.app_url}/api/packs/{pack_id}/pdf\n"
            f"PDF SHA-256: {pdf_sha}\n"
            f"CSV SHA-256: {csv_sha}\n"
        )
        sent = await self.mailer.send(
            self.authority_mailbox, subject, body,
            attachments=[(f"{pack_id}-manifest.csv", "text/csv", csv_bytes)])
        if not sent:
            await self.storage.delete(pdf_key)
            await self.storage.delete(csv_key)
            await self._mark_waiting(pack_id, "mail")
            return False

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    """UPDATE packs SET status = 'transmitted', waiting_for = NULL, transmitted_at = $1,
                       pdf_key = $2, csv_key = $3,
                       pdf_sha256 = $4, csv_sha256 = $5 WHERE id = $6""",
                    *(clock().now(), pdf_key, csv_key, pdf_sha, csv_sha, pack_id))
                await conn.execute(
                    "INSERT INTO audit (at, actor_id, action, directive_id, thread_id, detail) VALUES ($1, 'per_system', 'pack.transmitted', $2, NULL, $3)",
                    *(clock().now(), pack["lineage_id"], json.dumps({"pack_id": pack_id})))
        return True

    async def _mark_waiting(self, pack_id, waiting_for):
        async with self.pool.acquire() as conn:
            await conn.execute(
                "UPDATE packs SET waiting_for = $1, attempts = attempts + 1 WHERE id = $2",
                *(waiting_for, pack_id))

    async def pending(self) -> list:
        return await self.repo.pool.fetch(
            "SELECT id FROM packs WHERE status = 'queued' ORDER BY requested_at")


def pack_shape(row) -> dict:
    return {
        "id": row["id"],
        "directive_id": row["lineage_id"],
        "revision": tag_of(row["revision"]),
        "status": row["status"],
        "waiting_for": row["waiting_for"],
        "requested_by": row["requested_by"],
        "requested_at": format_iso(row["requested_at"]),
        "transmitted_at": format_iso(row["transmitted_at"]) if row["transmitted_at"] else None,
        "attempts": row["attempts"],
        "pdf_key": row["pdf_key"],
        "csv_key": row["csv_key"],
        "pdf_sha256": row["pdf_sha256"],
        "csv_sha256": row["csv_sha256"],
    }
