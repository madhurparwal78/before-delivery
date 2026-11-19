"""Work on one thread: claim, release, evidence, inspection, countersignature, deferral, effectivity, reopen."""

from decimal import Decimal

from . import clock, db, notices, rules, storage, views
from .errors import ApiError, invalid, reason as require_reason
from .rules import tag

EVIDENCE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf"}


async def _locked(conn, thread_id: str):
    t = await conn.fetchrow("SELECT * FROM threads WHERE id = $1 FOR UPDATE", thread_id)
    if t is None:
        raise ApiError("not_found")
    return t


def _guard(user: dict, t, action: str, directive: dict) -> None:
    """The shared part of the precedence: 403 forbidden, not_holder, then 409 directive_withdrawn and
    effectivity_unconfirmed."""
    rules.require_role(user, action)
    if action in rules.HOLDER_ACTIONS and t["holder_id"] != user["id"]:
        raise ApiError("not_holder")
    if directive["status"] == "withdrawn":
        raise ApiError("directive_withdrawn")
    if t["stage"] == "superseded_retargeted" and action in rules.NEEDS_EFFECTIVITY:
        raise ApiError("effectivity_unconfirmed")


def _revision_tag(body: dict, current: int) -> None:
    value = body.get("revision")
    if not isinstance(value, str):
        raise invalid({"revision": "Send the revision tag you were shown."})
    if value != tag(current):
        raise ApiError("revision_changed", current=tag(current))


async def _respond(conn, thread_id: str) -> dict:
    fleet = await views.load_fleet(conn)
    await db.changed_threads(conn, [thread_id])
    return await views.thread_json(conn, fleet, thread_id)


async def _context(conn, thread_id: str):
    t = await _locked(conn, thread_id)
    fleet = await views.load_fleet(conn)
    return t, fleet, fleet.directives[t["directive_id"]]


async def claim(conn, user: dict, thread_id: str) -> tuple[int, dict]:
    t, fleet, d = await _context(conn, thread_id)
    _guard(user, t, "claim", d)
    if t["holder_id"] == user["id"] and t["stage"] in ("claimed", "reopened"):
        return 200, {"thread": await views.thread_json(conn, fleet, thread_id)}
    if t["holder_id"] not in (None, user["id"]):
        raise ApiError("card_held", f"Already held by {fleet.people[t['holder_id']]['display_name']}.",
                       holder=views.person(fleet, t["holder_id"]))
    stage = rules.transition(t["stage"], "claim")
    await conn.execute("UPDATE threads SET stage = $2, holder_id = $3, claimed_at = $4 WHERE id = $1",
                       thread_id, stage, user["id"], clock.now())
    await db.audit(conn, user["id"], "thread.claimed", f"Work card {t['work_card_id']} claimed.", d["id"], thread_id)
    return 200, {"thread": await _respond(conn, thread_id)}


async def release(conn, user: dict, thread_id: str) -> dict:
    t, fleet, d = await _context(conn, thread_id)
    _guard(user, t, "release", d)
    stage = rules.transition(t["stage"], "release")
    await conn.execute("UPDATE threads SET stage = $2, holder_id = NULL, claimed_at = NULL WHERE id = $1",
                       thread_id, stage)
    await db.audit(conn, user["id"], "thread.released", f"Work card {t['work_card_id']} released.", d["id"], thread_id)
    return {"thread": await _respond(conn, thread_id)}


async def attach_evidence(conn, user: dict, thread_id: str, data: bytes, content_type: str) -> dict:
    t, fleet, d = await _context(conn, thread_id)
    _guard(user, t, "attach_evidence", d)
    rules.transition(t["stage"], "attach_evidence")
    if not data:
        raise invalid({"evidence": "The file is empty."})
    key, digest = storage.content_key("evidence", data, EVIDENCE_TYPES[content_type])
    try:
        await storage.put(key, data, content_type)
    except storage.StorageUnavailable:
        raise ApiError("storage_unavailable") from None
    evidence_id = db.new_id("evd")
    await conn.execute(
        "INSERT INTO evidence (id, thread_id, key, sha256, content_type, bytes, attached_by, attached_at) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        evidence_id, thread_id, key, digest, content_type, len(data), user["id"], clock.now())
    await db.audit(conn, user["id"], "thread.evidence_attached", f"Evidence {key} attached.", d["id"], thread_id)
    await db.changed_threads(conn, [thread_id])
    row = await conn.fetchrow("SELECT * FROM evidence WHERE id = $1", evidence_id)
    return {"evidence": views.evidence_json(fleet, row)}


async def standby_list(conn, model: str) -> list[dict]:
    """The model's standby list with each engineer's scope, read (and share-locked) in this transaction."""
    rows = await conn.fetch(
        "SELECT u.id, u.scope FROM standby s JOIN users u ON u.id = s.user_id WHERE s.model = $1 "
        "ORDER BY s.position FOR SHARE OF u", model)
    return [dict(r) for r in rows]


async def sign_inspection(conn, user: dict, thread_id: str, body: dict) -> tuple[int, dict]:
    t, fleet, d = await _context(conn, thread_id)
    _guard(user, t, "inspection", d)
    _revision_tag(body, d["current_revision"])
    stage = rules.transition(t["stage"], "inspection")
    fields = {}
    method_ref, findings, evidence_ids = body.get("method_ref"), body.get("findings"), body.get("evidence_ids")
    if not isinstance(method_ref, str) or not 1 <= len(method_ref.strip()) <= 200:
        fields["method_ref"] = "Enter the method reference (1 to 200 characters)."
    if not isinstance(findings, str) or not 1 <= len(findings.strip()) <= 4000:
        fields["findings"] = "Enter the findings (1 to 4,000 characters)."
    attached = {r["id"] for r in await conn.fetch("SELECT id FROM evidence WHERE thread_id = $1", thread_id)}
    if (not isinstance(evidence_ids, list) or not evidence_ids
            or not all(isinstance(e, str) and e in attached for e in evidence_ids)):
        fields["evidence_ids"] = "Attach evidence to this thread before signing."
    if fields:
        raise invalid(fields)
    now = clock.now()
    timeliness = "on_time" if views.status(fleet, t, now)["on_time"] else "overdue"
    tail = fleet.tails[t["registration"]]
    certifier = rules.next_certifier(await standby_list(conn, tail.model), tail.model)
    signature_id = db.new_id("sig")
    await conn.execute(
        "INSERT INTO signatures (id, thread_id, kind, signs_as, signer_id, revision, committed_at, timeliness,"
        " method_ref, findings, status, evidence_ids) VALUES ($1, $2, 'inspection', 'inspection', $3, $4, $5, $6,"
        " $7, $8, 'valid', $9)",
        signature_id, thread_id, user["id"], d["current_revision"], now, timeliness, method_ref.strip(),
        findings.strip(), evidence_ids)
    await conn.execute(
        "UPDATE threads SET stage = $2, timeliness = $3, certifier_id = $4, certifier_status = $5 WHERE id = $1",
        thread_id, stage, timeliness, certifier["id"] if certifier else None,
        "awaiting_countersignature" if certifier else "awaiting_certifier")
    if certifier:
        await notices.queue(conn, "countersignature_request", certifier["id"], {
            "registration": t["registration"], "directive": views.directive_name(d),
            "tag": tag(d["current_revision"]), "inspector_id": user["id"]}, thread_id)
    await db.audit(conn, user["id"], "thread.inspected",
                   f"Inspection signed under {tag(d['current_revision'])}, {timeliness.replace('_', ' ')}.",
                   d["id"], thread_id)
    thread = await _respond(conn, thread_id)
    return 201, {"thread": thread, "signature": next(s for s in thread["signatures"] if s["id"] == signature_id)}


async def countersign(conn, user: dict, thread_id: str, body: dict) -> tuple[int, dict]:
    t, fleet, d = await _context(conn, thread_id)
    rules.require_role(user, "countersign")
    model = fleet.tails[t["registration"]].model
    scope = await conn.fetchval("SELECT scope FROM users WHERE id = $1 FOR SHARE", user["id"])
    if not rules.scope_covers(scope, model):
        raise ApiError("out_of_scope", f"Your certification scope does not cover {rules.MODELS[model]}.", model=model)
    _guard(user, t, "countersign", d)
    _revision_tag(body, d["current_revision"])
    stage = rules.transition(t["stage"], "countersign")
    now = clock.now()
    signature_id = db.new_id("sig")
    await conn.execute(
        "INSERT INTO signatures (id, thread_id, kind, signs_as, signer_id, revision, committed_at, timeliness,"
        " status) VALUES ($1, $2, 'countersignature', 'countersignature', $3, $4, $5, $6, 'valid')",
        signature_id, thread_id, user["id"], d["current_revision"], now, t["timeliness"])
    await conn.execute(
        "UPDATE threads SET stage = $2, frozen = $3, holder_id = NULL, certifier_id = NULL, certifier_status = NULL"
        " WHERE id = $1", thread_id, stage, rules.freeze(views.status(fleet, t, now)))
    await notices.withdraw_for_threads(conn, [thread_id], "countersignature_request")
    await db.audit(conn, user["id"], "thread.countersigned",
                   f"Countersigned under {tag(d['current_revision'])}. Thread closed.", d["id"], thread_id)
    thread = await _respond(conn, thread_id)
    return 201, {"thread": thread, "signature": next(s for s in thread["signatures"] if s["id"] == signature_id)}


async def defer(conn, user: dict, thread_id: str, body: dict) -> tuple[int, dict]:
    t, fleet, d = await _context(conn, thread_id)
    _guard(user, t, "deferral", d)
    if views.status(fleet, t)["past_due"]:
        raise ApiError("past_due")
    if t["deferred"]:
        raise ApiError("already_deferred", f"Already deferred under {tag(d['current_revision'])}.",
                       current=tag(d["current_revision"]))
    stage = rules.transition(t["stage"], "deferral")
    reason = require_reason(body)
    await conn.execute(
        "UPDATE threads SET stage = $2, deferred = true, deferral_by = $3, deferral_at = $4, deferral_reason = $5 "
        "WHERE id = $1", thread_id, stage, user["id"], clock.now(), reason)
    await db.audit(conn, user["id"], "thread.deferred", f"Deferred: {reason}", d["id"], thread_id)
    return 201, {"thread": await _respond(conn, thread_id)}


async def effectivity(conn, user: dict, thread_id: str, body: dict) -> dict:
    t, fleet, d = await _context(conn, thread_id)
    _guard(user, t, "effectivity", d)
    rules.transition(t["stage"], "effectivity")
    decision = body.get("decision")
    if decision not in ("confirmed", "not_applicable"):
        raise invalid({"decision": "Choose confirmed or not_applicable."})
    reason = require_reason(body)
    stage = rules.effectivity_outcome(decision, t["holder_id"] is not None)
    keep = decision == "confirmed"
    await conn.execute("UPDATE threads SET stage = $2, holder_id = CASE WHEN $3 THEN holder_id END,"
                       " claimed_at = CASE WHEN $3 THEN claimed_at END WHERE id = $1", thread_id, stage, keep)
    if keep:
        await db.audit(conn, user["id"], "thread.effectivity_confirmed", f"Effectivity confirmed: {reason}",
                       d["id"], thread_id)
    else:
        await db.audit(conn, user["id"], "thread.marked_not_applicable", f"Marked not applicable: {reason}",
                       d["id"], thread_id)
    return {"thread": await _respond(conn, thread_id)}


async def reopen(conn, user: dict, thread_id: str, body: dict) -> dict:
    t, fleet, d = await _context(conn, thread_id)
    _guard(user, t, "reopen", d)
    stage = rules.transition(t["stage"], "reopen")
    reason = require_reason(body)
    last = await conn.fetchrow(
        "SELECT s.signer_id, u.erased FROM signatures s JOIN users u ON u.id = s.signer_id WHERE s.thread_id = $1 "
        "AND s.kind = 'inspection' ORDER BY s.seq DESC LIMIT 1", thread_id)
    holder = last["signer_id"] if last and not last["erased"] else None
    current = d["current_revision"]
    moved = t["rule_revision"] != current
    baseline = fleet.tails[t["registration"]].total if moved else Decimal(t["fh_baseline"])
    now = clock.now()
    await conn.execute("UPDATE signatures SET status = 'void', void_reason = $2 WHERE thread_id = $1",
                       thread_id, reason)
    await conn.execute(
        "UPDATE threads SET stage = $8, rule_revision = $2, pinned = false, frozen = NULL, holder_id = $3,"
        " claimed_at = $4, timeliness = NULL, fh_baseline = $5, entered_at = CASE WHEN $6 THEN $7 ELSE entered_at END"
        " WHERE id = $1", thread_id, current, holder, now if holder else None, baseline, moved, now, stage)
    await db.audit(conn, user["id"], "thread.reopened", f"Reopened: {reason}", d["id"], thread_id)
    return {"thread": await _respond(conn, thread_id)}


async def log_hours(conn, user: dict, registration: str, body: dict) -> dict:
    tail = await conn.fetchrow("SELECT * FROM tails WHERE registration = $1 FOR UPDATE", registration)
    if tail is None:
        raise ApiError("not_found")
    rules.require_role(user, "log_hours")
    hours = body.get("hours")
    amount = Decimal(str(hours)) if isinstance(hours, int | float) and not isinstance(hours, bool) else None
    if amount is None or not Decimal("0.1") <= amount <= Decimal("24.0") or amount.as_tuple().exponent < -1:
        raise invalid({"hours": "Enter sector hours from 0.1 to 24.0 with at most one decimal."})
    previous = await conn.fetchval(
        "SELECT total_after FROM flight_hours WHERE registration = $1 ORDER BY id DESC LIMIT 1", registration)
    total = (previous if previous is not None else tail["seed_hours"]) + amount
    now = clock.now()
    await conn.execute(
        "INSERT INTO flight_hours (registration, hours, total_after, logged_at, logged_by) VALUES ($1, $2, $3, $4, $5)",
        registration, amount, total, now, user["id"])
    await db.audit(conn, user["id"], "tail.hours_logged", f"{registration}: {amount} FH logged, total {total} FH.")
    ids = [r["id"] for r in await conn.fetch("SELECT id FROM threads WHERE registration = $1", registration)]
    await db.changed_threads(conn, ids)
    return {"registration": registration, "total_hours": float(total), "logged_at": clock.iso(now)}
