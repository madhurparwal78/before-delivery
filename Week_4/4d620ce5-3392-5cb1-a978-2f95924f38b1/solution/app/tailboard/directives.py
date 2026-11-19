"""Directive lineages: document upload, ingest, supersession and withdrawal (brief: Supersession, Withdrawal)."""

import re
from datetime import date
from decimal import Decimal, InvalidOperation

from . import clock, db, notices, rules, storage, views
from .errors import ApiError, invalid, reason as require_reason
from .rules import tag

ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


async def upload_document(conn, user: dict, data: bytes) -> tuple[int, dict]:
    rules.require_role(user, "upload_document")
    if not data.startswith(b"%PDF-"):
        raise invalid({"document": "must be a PDF"})
    key, digest = storage.content_key("directives", data, "pdf")
    existing = await conn.fetchrow("SELECT * FROM documents WHERE sha256 = $1", digest)
    if existing:
        return 200, {"document_id": existing["id"], "key": existing["key"], "sha256": digest, "bytes": existing["bytes"]}
    try:
        await storage.put(key, data, "application/pdf")
    except storage.StorageUnavailable:
        raise ApiError("storage_unavailable", "Document storage is unavailable. Nothing was stored.") from None
    document_id = db.new_id("doc")
    await conn.execute(
        "INSERT INTO documents (id, sha256, key, bytes, uploaded_by, uploaded_at) VALUES ($1, $2, $3, $4, $5, $6)",
        document_id, digest, key, len(data), user["id"], clock.now())
    await db.audit(conn, user["id"], "document.uploaded", f"Directive document {key} stored.")
    return 201, {"document_id": document_id, "key": key, "sha256": digest, "bytes": len(data)}


def _decimal_one_place(value) -> Decimal | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    try:
        amount = Decimal(str(value))
    except InvalidOperation:
        return None
    return amount if amount.as_tuple().exponent >= -1 else None


async def _revision_fields(conn, body: dict) -> tuple[dict, dict]:
    """Validate the fields every ingest shares; returns (parsed values, field errors)."""
    errors, parsed = {}, {}
    title, method = body.get("title"), body.get("method")
    # Typed text is stored exactly as it arrives, whitespace included (brief: Regulator CSV, Neutralisation).
    if not isinstance(title, str) or not title.strip() or len(title) > 200:
        errors["title"] = "Enter a title of 1 to 200 characters."
    else:
        parsed["title"] = title
    if not isinstance(method, str) or not method.strip() or len(method) > 4000:
        errors["method"] = "Enter the method of compliance (1 to 4,000 characters)."
    else:
        parsed["method"] = method
    effective = body.get("effective_date")
    try:
        day = date.fromisoformat(effective) if isinstance(effective, str) and ISO_DATE.fullmatch(effective) else None
    except ValueError:
        day = None
    if day is None:
        errors["effective_date"] = "Enter a real date as YYYY-MM-DD."
    elif day > clock.today():
        errors["effective_date"] = "The effective date cannot be later than today."
    else:
        parsed["effective_date"] = day
    days = body.get("calendar_days")
    if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= 3650:
        errors["calendar_days"] = "Enter whole days from 1 to 3,650."
    else:
        parsed["calendar_days"] = days
    interval = _decimal_one_place(body.get("fh_interval"))
    if interval is None or not Decimal("0.1") <= interval <= Decimal("100000.0"):
        errors["fh_interval"] = "Enter flight hours from 0.1 to 100,000.0 with at most one decimal."
    else:
        parsed["fh_interval"] = interval
    ranges = body.get("applicability")
    if not isinstance(ranges, list) or not 1 <= len(ranges) <= 20:
        errors["applicability"] = "Add 1 to 20 model and serial ranges."
    else:
        clean = []
        for i, r in enumerate(ranges):
            ok = (isinstance(r, dict) and r.get("model") in rules.MODELS
                  and all(isinstance(r.get(k), int) and not isinstance(r.get(k), bool) and r.get(k) >= 0
                          for k in ("msn_from", "msn_to")))
            if not ok or r["msn_from"] > r["msn_to"]:
                errors[f"applicability.{i}"] = "Choose a model and a first serial no greater than the last."
            else:
                clean.append({"model": r["model"], "msn_from": r["msn_from"], "msn_to": r["msn_to"]})
        parsed["applicability"] = clean
    document_id = body.get("document_id")
    document = (await conn.fetchrow("SELECT * FROM documents WHERE id = $1", document_id)
                if isinstance(document_id, str) else None)
    if document is None:
        errors["document_id"] = "Attach the directive PDF."
    else:
        parsed["document"] = document
    return parsed, errors


async def _document_reachable(document) -> None:
    try:
        stored = await storage.exists(document["key"])
    except storage.StorageUnavailable:
        stored = None
    if not stored:
        raise ApiError("storage_unavailable", "Document storage is unavailable. Nothing was ingested.")


async def _new_thread(conn, directive_id: str, registration: str, revision: int, baseline: Decimal, now) -> str:
    thread_id = db.new_id("thr")
    await conn.execute(
        "INSERT INTO threads (id, directive_id, registration, work_card_id, stage, rule_revision, entered_at,"
        " fh_baseline) VALUES ($1, $2, $3, 'WC-' || lpad(nextval('work_card_seq')::text, 5, '0'), 'open', $4, $5, $6)",
        thread_id, directive_id, registration, revision, now, baseline)
    return thread_id


async def _insert_revision(conn, directive_id: str, n: int, parsed: dict, prior_credit: bool, user: dict, now) -> None:
    await conn.execute(
        "INSERT INTO revisions (directive_id, revision, title, method, effective_date, calendar_days, fh_interval,"
        " applicability, prior_credit, document_id, ingested_at, ingested_by)"
        " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
        directive_id, n, parsed["title"], parsed["method"], parsed["effective_date"], parsed["calendar_days"],
        parsed["fh_interval"], parsed["applicability"], prior_credit, parsed["document"]["id"], now, user["id"])


async def ingest_directive(conn, user: dict, body: dict) -> tuple[int, dict]:
    rules.require_role(user, "ingest")
    authority, number = body.get("authority"), body.get("number")
    await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"directive|{authority}|{number}")
    if await conn.fetchval("SELECT 1 FROM directives WHERE authority = $1 AND number = $2", authority, number):
        raise ApiError("directive_exists", f"{authority} {number} is already on the board.")
    parsed, errors = await _revision_fields(conn, body)
    if authority not in rules.AUTHORITIES:
        errors["authority"] = "Choose an issuing authority."
    elif not isinstance(number, str) or not rules.NUMBER_FORMATS[authority].fullmatch(number):
        errors["number"] = f"Use the {authority} number format."
    if errors:
        raise invalid(errors)
    await _document_reachable(parsed["document"])
    now = clock.now()
    directive_id = db.new_id("dir")
    await conn.execute("INSERT INTO directives (id, authority, number, status, current_revision) "
                       "VALUES ($1, $2, $3, 'active', 1)", directive_id, authority, number)
    await _insert_revision(conn, directive_id, 1, parsed, False, user, now)
    fleet = await views.load_fleet(conn)
    added = []
    for tail in fleet.tails.values():
        if rules.in_effectivity(parsed["applicability"], tail.model, tail.msn):
            thread_id = await _new_thread(conn, directive_id, tail.registration, 1, tail.total, now)
            added.append(thread_id)
            await db.audit(conn, user["id"], "thread.added", f"{tail.registration} entered effectivity under R1.",
                           directive_id, thread_id)
    await db.audit(conn, user["id"], "directive.ingested", f"{authority} {number} R1 ingested.", directive_id)
    splice = {"from": None, "to": "R1", "retargeted": [], "added": added, "removed": [], "kept": []}
    await db.publish(conn, "revision", {"directive_id": directive_id, "splice": splice})
    return 201, {"directive": views.directive_json(fleet, fleet.directives[directive_id]), "splice": splice}


async def _snapshot(conn, fleet: views.Fleet, d: dict, rows, statuses: dict, now) -> None:
    """The column exactly as it stood the moment before the new revision (brief: Board as it stood)."""
    entry = views.column_entry(fleet, d, list(statuses.values()))
    cells = [views.cell(fleet, t, statuses[t["id"]]) for t in rows]
    await conn.execute(
        "INSERT INTO board_snapshots (directive_id, revision, taken_at, entry, cells, threads) "
        "VALUES ($1, $2, $3, $4, $5, $6)",
        d["id"], d["current_revision"], now, entry, cells, await views.threads_json(conn, fleet, rows))


async def ingest_revision(conn, user: dict, directive_id: str, body: dict) -> tuple[int, dict]:
    row = await conn.fetchrow("SELECT * FROM directives WHERE id = $1 FOR UPDATE", directive_id)
    if row is None:
        raise ApiError("not_found")
    rules.require_role(user, "ingest")
    name = f"{row['authority']} {row['number']}"
    if row["status"] == "withdrawn":
        raise ApiError("directive_withdrawn", f"{name} is withdrawn.")
    old = row["current_revision"]
    if body.get("revision") != old + 1 or isinstance(body.get("revision"), bool):
        raise ApiError("revision_out_of_order", f"This directive is now at {tag(old)}.", current=tag(old))
    parsed, errors = await _revision_fields(conn, body)
    prior_credit = body.get("prior_credit")
    if not isinstance(prior_credit, bool):
        errors["prior_credit"] = "Say whether work under the prior revision is credited."
    if errors:
        raise invalid(errors)
    await _document_reachable(parsed["document"])

    now = clock.now()
    fleet = await views.load_fleet(conn)
    d = fleet.directives[directive_id]
    rows = await conn.fetch("SELECT * FROM threads WHERE directive_id = $1 ORDER BY registration FOR UPDATE",
                            directive_id)
    statuses = {t["id"]: views.status(fleet, t) for t in rows}
    await _snapshot(conn, fleet, d, rows, statuses, now)

    new = old + 1
    await _insert_revision(conn, directive_id, new, parsed, prior_credit, user, now)
    await conn.execute("UPDATE directives SET current_revision = $2 WHERE id = $1", directive_id, new)
    closed_at = dict(await conn.fetch(
        "SELECT thread_id, max(committed_at) FROM signatures WHERE status = 'valid' AND signs_as = 'countersignature'"
        " AND thread_id = ANY($1) GROUP BY thread_id", [t["id"] for t in rows]))
    new_rule = rules.Rule(parsed["effective_date"], parsed["calendar_days"], parsed["fh_interval"])
    by_registration = {t["registration"]: t for t in rows}
    splice = {"from": tag(old), "to": tag(new), "retargeted": [], "added": [], "removed": [], "kept": []}
    leaving: list[str] = []

    for tail in fleet.tails.values():
        inside = rules.in_effectivity(parsed["applicability"], tail.model, tail.msn)
        t = by_registration.get(tail.registration)
        if t is None:
            if inside:
                thread_id = await _new_thread(conn, directive_id, tail.registration, new, tail.total, now)
                splice["added"].append(thread_id)
                await db.audit(conn, user["id"], "thread.added",
                               f"{tail.registration} entered effectivity under {tag(new)}.", directive_id, thread_id)
            continue
        if t["stage"] == "not_applicable":
            outcome = "added" if inside else "removed"
        elif not inside:
            outcome = "removed"
        elif t["stage"] == "certified" and rules.is_kept(prior_credit, closed_at.get(t["id"]), new_rule.effective_date):
            outcome = "kept"
        else:
            outcome = "retargeted"
        await conn.execute(
            "INSERT INTO thread_history (thread_id, revision, entered_at, left_at, limits, wording, outcome) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7)",
            t["id"], old, t["entered_at"], now, views.revision_limits(fleet, t), views.wording(fleet, t), outcome)

        if outcome == "kept":
            await conn.execute("UPDATE threads SET pinned = true, entered_at = $2 WHERE id = $1", t["id"], now)
            splice["kept"].append(t["id"])
            continue
        was_open = t["stage"] != "not_applicable"
        stage = rules.SUPERSESSION[outcome]
        keep_holder = outcome == "retargeted"
        await conn.execute(
            "UPDATE threads SET stage = $2, rule_revision = $3, pinned = false, entered_at = $4, fh_baseline = $5,"
            " deferred = false, deferral_by = NULL, deferral_at = NULL, deferral_reason = NULL, timeliness = NULL,"
            " certifier_id = NULL, certifier_status = NULL, frozen = NULL,"
            " holder_id = CASE WHEN $6 THEN holder_id END, claimed_at = CASE WHEN $6 THEN claimed_at END"
            " WHERE id = $1", t["id"], stage, new, now, tail.total, keep_holder)
        if not was_open:
            if outcome == "added":
                splice["added"].append(t["id"])
                await db.audit(conn, user["id"], "thread.added",
                               f"{tail.registration} re-entered effectivity under {tag(new)}.", directive_id, t["id"])
            continue
        await conn.execute("UPDATE signatures SET status = 'superseded' WHERE thread_id = $1 AND status = 'valid'",
                           t["id"])
        leaving.append(t["id"])
        splice[outcome].append(t["id"])
        await db.audit(conn, user["id"], f"thread.{outcome}",
                       f"{tail.registration} {outcome} from {tag(old)} to {tag(new)}.", directive_id, t["id"])
        if t["holder_id"]:
            limits = rules.evaluate(new_rule, tail.total, False, now, tail, now)["limits"]
            await notices.card_revision(conn, t["holder_id"], t["id"], {
                "card": t["work_card_id"], "registration": tail.registration, "directive": name,
                "old_tag": tag(old), "new_tag": tag(new), "removed": outcome == "removed",
                "deadline": limits["deadline_date"], "threshold": limits["fh_threshold"]})

    await notices.withdraw_for_threads(conn, leaving, "countersignature_request")
    await db.audit(conn, user["id"], "directive.revised", f"{name} {tag(new)} supersedes {tag(old)}.", directive_id)
    await db.publish(conn, "revision", {"directive_id": directive_id, "splice": splice})
    fleet = await views.load_fleet(conn)
    return 201, {"directive": views.directive_json(fleet, fleet.directives[directive_id]), "splice": splice}


async def withdraw(conn, user: dict, directive_id: str, body: dict) -> dict:
    row = await conn.fetchrow("SELECT * FROM directives WHERE id = $1 FOR UPDATE", directive_id)
    if row is None:
        raise ApiError("not_found")
    rules.require_role(user, "withdraw")
    name = f"{row['authority']} {row['number']}"
    if row["status"] == "withdrawn":
        raise ApiError("directive_withdrawn", f"{name} is withdrawn.")
    reason = require_reason(body, "Give a withdrawal reason of 1 to 500 characters.")
    now = clock.now()
    await conn.execute("UPDATE directives SET status = 'withdrawn', withdrawn_at = $2, withdrawal_reason = $3 "
                       "WHERE id = $1", directive_id, now, reason)
    ids = [r["id"] for r in await conn.fetch(
        "UPDATE threads SET stage = $2, holder_id = NULL, claimed_at = NULL, certifier_id = NULL,"
        " certifier_status = NULL WHERE directive_id = $1 RETURNING id", directive_id, rules.WITHDRAWN)]
    await notices.withdraw_for_threads(conn, ids)
    for thread_id in ids:
        await db.audit(conn, user["id"], "thread.withdrawn", "Directive withdrawn; holds cancelled.", directive_id,
                       thread_id)
    await db.audit(conn, user["id"], "directive.withdrawn", f"{name} withdrawn: {reason}", directive_id)
    await db.publish(conn, "threads", {"thread_ids": sorted(ids)})
    fleet = await views.load_fleet(conn)
    return {"directive": views.directive_json(fleet, fleet.directives[directive_id])}
