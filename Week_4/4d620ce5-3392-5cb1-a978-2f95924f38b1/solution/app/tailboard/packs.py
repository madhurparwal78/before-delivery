"""Compliance packs: stored, emailed and marked transmitted together, or not at all (brief: Packs)."""

import logging
import time
from datetime import timedelta

from . import clock, db, exports, mail, rules, storage, views
from .config import settings
from .errors import ApiError, invalid

AUTHORITY_MAILBOX = "continuing-airworthiness@caa-oversight.test"
RETRY_SECONDS = 10
log = logging.getLogger("tailboard.packs")
_last_rerender = 0.0


def pack_json(fleet: views.Fleet, p) -> dict:
    return {
        "id": p["id"], "directive_id": p["directive_id"], "revision": rules.tag(p["revision"]),
        "status": p["status"], "waiting_for": p["waiting_for"], "requested_by": views.person(fleet, p["requested_by"]),
        "requested_at": clock.iso(p["requested_at"]), "transmitted_at": clock.iso(p["transmitted_at"]),
        "attempts": p["attempts"], "pdf_key": p["pdf_key"], "csv_key": p["csv_key"], "pdf_sha256": p["pdf_sha256"],
        "csv_sha256": p["csv_sha256"],
    }


def render(snapshot: dict) -> tuple[bytes, bytes]:
    return exports.pdf_bytes(snapshot), exports.csv_bytes(snapshot["rows"])


async def _referenced(conn, key: str) -> bool:
    return bool(await conn.fetchval("SELECT 1 FROM packs WHERE pdf_key = $1 OR csv_key = $1", key))


async def discard(conn, keys: list[str]) -> None:
    """Delete pack objects that no pack record references any longer."""
    for key in keys:
        if not await _referenced(conn, key):
            try:
                await storage.delete(key)
            except storage.StorageUnavailable:
                log.warning("could not delete %s", key)


async def attempt(conn, pack_id: str, actor_id: str | None = None) -> None:
    """Render from the state at this moment, store both objects, send the email, and only then mark transmitted."""
    p = await conn.fetchrow("SELECT * FROM packs WHERE id = $1", pack_id)
    fleet = await views.load_fleet(conn)
    d = fleet.directives[p["directive_id"]]
    now = clock.now()
    rows, refs = await exports.regulator_rows(conn, fleet, d["id"])
    snapshot = {"generated_at": clock.iso(now), "directive": views.directive_name(d),
                "revision": rules.tag(d["current_revision"]), "title": d["revisions"][d["current_revision"]]["title"],
                "rows": rows, "refs": refs}
    pdf, manifest = render(snapshot)
    pdf_key, pdf_sha = storage.content_key("packs", pdf, "pdf")
    csv_key, csv_sha = storage.content_key("packs", manifest, "csv")
    await conn.execute("UPDATE packs SET attempts = attempts + 1, last_attempt_at = $2, revision = $3 WHERE id = $1",
                       pack_id, now, d["current_revision"])
    stored = []
    try:
        for key, data, ctype in ((pdf_key, pdf, "application/pdf"), (csv_key, manifest, "text/csv")):
            await storage.put(key, data, ctype)
            stored.append(key)
    except storage.StorageUnavailable as error:
        log.info("pack %s waits for object storage (%s)", pack_id, type(error).__name__)
        await discard(conn, stored)
        await conn.execute("UPDATE packs SET waiting_for = 'object_storage' WHERE id = $1", pack_id)
        return
    subject = f"Compliance pack {snapshot['directive']} {snapshot['revision']} from {exports.OPERATOR}"
    body = (f"Compliance pack {pack_id} for {snapshot['directive']} {snapshot['revision']} from {exports.OPERATOR}.\n\n"
            f"{settings.public_url}/api/packs/{pack_id}/pdf\n"
            f"PDF SHA-256: {pdf_sha}\nCSV SHA-256: {csv_sha}\n")
    try:
        await mail.send(AUTHORITY_MAILBOX, subject, body, (f"{pack_id}-manifest.csv", manifest))
    except mail.MailUnavailable as error:
        log.info("pack %s waits for mail (%s)", pack_id, type(error).__name__)
        await discard(conn, stored)
        await conn.execute("UPDATE packs SET waiting_for = 'mail' WHERE id = $1", pack_id)
        return
    await conn.execute(
        "UPDATE packs SET status = 'transmitted', waiting_for = NULL, transmitted_at = $2, pdf_key = $3, csv_key = $4,"
        " pdf_sha256 = $5, csv_sha256 = $6, snapshot = $7 WHERE id = $1",
        pack_id, clock.now(), pdf_key, csv_key, pdf_sha, csv_sha, snapshot)
    await db.audit(conn, actor_id, "pack.transmitted",
                   f"Pack for {snapshot['directive']} {snapshot['revision']} transmitted.", d["id"])


async def request(conn, user: dict, body: dict) -> tuple[int, dict]:
    rules.require_role(user, "pack")
    directive_id = body.get("directive_id") if isinstance(body.get("directive_id"), str) else None
    await conn.execute("SELECT 1 FROM directives WHERE id = $1 FOR UPDATE", directive_id)
    queued = await conn.fetchval("SELECT id FROM packs WHERE directive_id = $1 AND status = 'queued'", directive_id)
    if queued:
        name = await conn.fetchval("SELECT authority || ' ' || number FROM directives WHERE id = $1", directive_id)
        raise ApiError("pack_already_queued", f"A pack for {name} is already queued.", pack_id=queued)
    if not await conn.fetchval("SELECT 1 FROM directives WHERE id = $1", directive_id):
        raise invalid({"directive_id": "Choose a directive on the board."})
    pack_id = db.new_id("pck")
    revision = await conn.fetchval("SELECT current_revision FROM directives WHERE id = $1", directive_id)
    await conn.execute("INSERT INTO packs (id, directive_id, revision, status, requested_by, requested_at) "
                       "VALUES ($1, $2, $3, 'queued', $4, $5)", pack_id, directive_id, revision, user["id"],
                       clock.now())
    await db.audit(conn, user["id"], "pack.requested", "Compliance pack requested.", directive_id)
    await attempt(conn, pack_id, user["id"])
    fleet = await views.load_fleet(conn)
    p = await conn.fetchrow("SELECT * FROM packs WHERE id = $1", pack_id)
    return (201 if p["status"] == "transmitted" else 202), {"pack": pack_json(fleet, p)}


async def download(conn, pack_id: str, part: str) -> tuple[bytes, str, str]:
    p = await conn.fetchrow("SELECT * FROM packs WHERE id = $1", pack_id)
    if p is None:
        raise ApiError("not_found")
    if p["status"] != "transmitted":
        raise ApiError("pack_not_transmitted")
    key = p["pdf_key"] if part == "pdf" else p["csv_key"]
    try:
        data = await storage.get(key)
    except storage.StorageUnavailable:
        data = None
    if data is None:
        raise ApiError("storage_unavailable", "Pack storage is unavailable.")
    return data, "application/pdf" if part == "pdf" else "text/csv; charset=utf-8", f"{pack_id}.{part}"


async def anonymise(conn, user_id: str, texts: set[str], token: str) -> None:
    """Replace the person in every transmitted pack's rows and mark the pack's objects for re-rendering."""
    name_columns = {exports.COLUMNS.index(c) for c in ("inspector", "certifier")}
    text_columns = {exports.COLUMNS.index(c) for c in ("inspector", "inspector_licence", "certifier",
                                                         "certifier_licence")}
    notes_column = exports.COLUMNS.index("legacy_notes")
    for p in await conn.fetch("SELECT * FROM packs WHERE status = 'transmitted' FOR UPDATE"):
        snapshot = p["snapshot"]
        changed = False
        for row_i, col, ref in snapshot["refs"]:
            if ref == user_id:
                snapshot["rows"][row_i][col] = token if col in name_columns else None
                changed = True
        for row in snapshot["rows"]:
            for col in text_columns:
                if isinstance(row[col], str) and row[col].lower() in texts:
                    row[col], changed = token, True
            if isinstance(row[notes_column], str):
                replaced = replace_texts(row[notes_column], texts, token)
                if replaced != row[notes_column]:
                    row[notes_column], changed = replaced, True
        if changed:
            await conn.execute("UPDATE packs SET snapshot = $2, stale = true WHERE id = $1", p["id"], snapshot)


async def rerender_stale(conn) -> None:
    """Store re-rendered objects for packs whose rows changed, under new content-addressed keys, then delete the
    old objects no pack references any longer. While storage is down the packs stay marked and wait."""
    for p in await conn.fetch("SELECT * FROM packs WHERE stale ORDER BY seq"):
        async with conn.transaction():
            p = await conn.fetchrow("SELECT * FROM packs WHERE id = $1 AND stale FOR UPDATE SKIP LOCKED", p["id"])
            if p is None:
                continue
            pdf, manifest = render(p["snapshot"])
            pdf_key, pdf_sha = storage.content_key("packs", pdf, "pdf")
            csv_key, csv_sha = storage.content_key("packs", manifest, "csv")
            try:
                await storage.put(pdf_key, pdf, "application/pdf")
                await storage.put(csv_key, manifest, "text/csv")
            except storage.StorageUnavailable:
                return
            await conn.execute("UPDATE packs SET pdf_key = $2, csv_key = $3, pdf_sha256 = $4, csv_sha256 = $5,"
                               " stale = false WHERE id = $1", p["id"], pdf_key, csv_key, pdf_sha, csv_sha)
            await discard(conn, [k for k in (p["pdf_key"], p["csv_key"]) if k not in (pdf_key, csv_key)])


def replace_texts(value: str, texts: set[str], token: str) -> str:
    """Replace every case-insensitive occurrence of the given texts."""
    lowered = value.lower()
    for text in sorted(texts, key=len, reverse=True):
        start = lowered.find(text)
        while start != -1:
            value = value[:start] + token + value[start + len(text):]
            lowered = value.lower()
            start = lowered.find(text, start + len(token))
    return value


async def retry_due() -> None:
    """One pass of the background sender: each queued pack is retried at most every 10 seconds, and packs whose
    objects wait for a re-render after an erasure are stored again."""
    global _last_rerender
    cutoff = clock.now() - timedelta(seconds=RETRY_SECONDS)
    async with db.pool.acquire() as conn:
        if time.monotonic() - _last_rerender >= RETRY_SECONDS:
            _last_rerender = time.monotonic()
            await rerender_stale(conn)
        while True:
            async with conn.transaction():
                p = await conn.fetchrow(
                    "SELECT id FROM packs WHERE status = 'queued' AND (last_attempt_at IS NULL OR last_attempt_at"
                    " <= $1) ORDER BY seq LIMIT 1 FOR UPDATE SKIP LOCKED", cutoff)
                if p is None:
                    return
                await attempt(conn, p["id"])
