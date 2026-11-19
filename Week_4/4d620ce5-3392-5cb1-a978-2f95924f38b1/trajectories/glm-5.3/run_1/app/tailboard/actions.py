"""Write actions: ingest, supersession, cards, signatures, deferral, effectivity, scope, erasure.

Multi-step changes that must be atomic run in one database transaction.
"""
import json
import secrets
from datetime import date, datetime, timedelta

import asyncpg

from . import rules
from .clock import clock, format_iso
from .domain import MODELS, NUMBER_PATTERNS, tag_of
from .rules import BASE_TZ
from .errors import ApiError, conflict, forbidden, not_found, validation
from .repo import Repo


def _serialise_person(row):
    if row is None:
        return None
    if row["erased"]:
        return {"id": row["id"], "display_name": row["signer_token"], "licence": None, "erased": True}
    return {"id": row["id"], "display_name": row["display_name"], "licence": row["licence"], "erased": False}


def validate_applicability(ranges) -> list:
    if not isinstance(ranges, list) or not (1 <= len(ranges) <= 20):
        raise validation({"applicability": "Applicability needs 1 to 20 ranges."})
    cleaned = []
    for entry in ranges:
        if not isinstance(entry, dict):
            raise validation({"applicability": "Each range needs a model and serial numbers."})
        model = entry.get("model")
        if model not in MODELS:
            raise validation({"applicability": f"Unknown model code {model!r}."})
        try:
            msn_from = int(entry.get("msn_from"))
            msn_to = int(entry.get("msn_to"))
        except (TypeError, ValueError):
            raise validation({"applicability": "Serial numbers must be integers."})
        if msn_from > msn_to:
            raise validation({"applicability": "First serial must not exceed last serial."})
        cleaned.append({"model": model, "msn_from": msn_from, "msn_to": msn_to})
    return cleaned


def validate_directive_payload(payload, *, require_identity=True, revision=None, prior_credit=None):
    fields = {}
    if require_identity:
        authority = payload.get("authority")
        if authority not in NUMBER_PATTERNS:
            fields["authority"] = "Authority must be one of the five published authorities."
        number = payload.get("number")
        if not isinstance(number, str) or not (authority in NUMBER_PATTERNS and NUMBER_PATTERNS[authority].match(number)):
            fields["number"] = "Directive number must follow the authority's published format."
    else:
        authority = None
        number = None
    title = payload.get("title")
    if not isinstance(title, str) or not (1 <= len(title) <= 200):
        fields["title"] = "Title must be 1 to 200 characters."
    method = payload.get("method")
    if not isinstance(method, str) or not (1 <= len(method) <= 4000):
        fields["method"] = "Method of compliance must be 1 to 4,000 characters."
    effective_date = _parse_date(payload.get("effective_date"))
    if effective_date is None or effective_date > clock().now().astimezone(BASE_TZ).date():
        fields["effective_date"] = "Effective date must be a real date no later than today."
    calendar_days = payload.get("calendar_days")
    if not isinstance(calendar_days, int) or isinstance(calendar_days, bool) or not (1 <= calendar_days <= 3650):
        fields["calendar_days"] = "Calendar limit must be an integer from 1 to 3,650 days."
    fh_interval = _number(payload.get("fh_interval"))
    if fh_interval is None or not (0.1 <= fh_interval <= 100000.0) or _decimals(fh_interval) > 1:
        fields["fh_interval"] = "Flight-hours limit must be from 0.1 to 100,000.0 with at most one decimal."
    document_id = payload.get("document_id")
    if not isinstance(document_id, str) or not document_id:
        fields["document_id"] = "Name a stored directive document."
    applicability = validate_applicability(payload.get("applicability"))
    if fields:
        raise ApiError(422, "validation", "The request is not valid.", fields=fields)
    return {
        "authority": authority,
        "number": number,
        "title": title,
        "method": method,
        "effective_date": effective_date,
        "calendar_days": calendar_days,
        "fh_interval": fh_interval,
        "document_id": document_id,
        "applicability": applicability,
        "revision": revision,
        "prior_credit": prior_credit,
    }


def _parse_date(value):
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _decimals(value: float) -> int:
    text = repr(value)
    if "e" in text or "E" in text:
        return 0
    if "." in text:
        return len(text.split(".")[1].rstrip("0"))
    return 0


def in_effectivity(model: str, msn: int, applicability: list) -> bool:
    """A tail is in effectivity when its model matches and its MSN lies inside a range."""
    return any(
        entry["model"] == model and entry["msn_from"] <= msn <= entry["msn_to"]
        for entry in applicability
    )


class Actions:
    def __init__(self, repo: Repo, pool: asyncpg.Pool, notifier, events):
        self.repo = repo
        self.pool = pool
        self.notifier = notifier
        self.events = events

    async def _audit(self, conn, actor_id, action, directive_id, thread_id, detail):
        await conn.execute(
            "INSERT INTO audit (at, actor_id, action, directive_id, thread_id, detail) VALUES ($1, $2, $3, $4, $5, $6)",
            clock().now(), actor_id, action, directive_id, thread_id, json.dumps(detail or {}),
        )

    async def _publish_threads(self, thread_ids):
        if thread_ids:
            await self.events.publish("threads", {"thread_ids": thread_ids})

    async def _document_key(self, conn, document_id):
        row = await conn.fetchrow("SELECT key FROM documents WHERE id = $1", document_id)
        return row["key"] if row else None

    async def ingest_directive(self, actor, payload) -> dict:
        data = validate_directive_payload(payload, require_identity=True)
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                existing = await conn.fetchrow(
                    "SELECT id, status FROM lineages WHERE authority = $1 AND number = $2",
                    *(data["authority"], data["number"]))
                if existing:
                    raise conflict("directive_exists", f"{data['authority']} {data['number']} is already on the board.")
                document_key = await self._document_key(conn, data["document_id"])
                if document_key is None:
                    raise validation({"document_id": "The named document was never stored."})
                lineage_id = f"dir_{secrets.token_hex(8)}"
                now = clock().now()
                await conn.execute(
                    "INSERT INTO lineages (id, authority, number, revision, status, title) VALUES ($1, $2, $3, 1, 'active', $4)",
                    *(lineage_id, data["authority"], data["number"], data["title"]))
                await conn.execute(
                    """INSERT INTO revisions (lineage_id, revision, title, method, effective_date, calendar_days,
                       fh_interval, applicability, prior_credit, document_key, ingested_at, ingested_by)
                       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10)""",
                    *(lineage_id, data["title"], data["method"], data["effective_date"],
                     data["calendar_days"], data["fh_interval"], json.dumps(data["applicability"]),
                     document_key, now, actor["id"]))
                added = await self._create_or_reopen_threads(
                    conn, lineage_id, data["applicability"], data["title"], data["method"],
                    data["effective_date"], data["calendar_days"], data["fh_interval"], now)
                await self._audit(conn, actor["id"], "directive.ingested", lineage_id, None,
                                  {"authority": data["authority"], "number": data["number"], "revision": 1})
                for thread_id in added:
                    await self._audit(conn, actor["id"], "thread.created", lineage_id, thread_id,
                                      {"stage": "open"})
                splice = {
                    "from": None,
                    "to": "R1",
                    "retargeted": [],
                    "added": added,
                    "removed": [],
                    "kept": [],
                }
        await self.events.publish("revision", {
            "directive_id": lineage_id,
            "splice": splice,
        })
        directive = await self._directive_payload(lineage_id)
        return {"directive": directive, "splice": splice}

    async def ingest_revision(self, actor, lineage_id, payload) -> dict:
        revision_number = payload.get("revision")
        if not isinstance(revision_number, int) or isinstance(revision_number, bool):
            raise conflict("revision_out_of_order", "This directive is now at a later revision.", current=None)
        data = validate_directive_payload(payload, require_identity=False,
                                           prior_credit=payload.get("prior_credit"))
        data["revision"] = revision_number
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                lineage = await conn.fetchrow("SELECT * FROM lineages WHERE id = $1", lineage_id)
                if lineage is None:
                    raise not_found("No such directive.")
                if lineage["status"] == "withdrawn":
                    raise conflict("directive_withdrawn",
                                   f"{lineage['authority']} {lineage['number']} is withdrawn.")
                current = lineage["revision"]
                if revision_number != current + 1:
                    raise conflict("revision_out_of_order",
                                   "This directive is now at a later revision.",
                                   current=tag_of(current))
                document_key = await self._document_key(conn, data["document_id"])
                if document_key is None:
                    raise validation({"document_id": "The named document was never stored."})
                now = clock().now()
                old_revisions = await conn.fetch(
                    "SELECT * FROM revisions WHERE lineage_id = $1 ORDER BY revision", lineage_id)
                old_rev = old_revisions[-1]
                await conn.execute(
                    """INSERT INTO revisions (lineage_id, revision, title, method, effective_date, calendar_days,
                       fh_interval, applicability, prior_credit, document_key, ingested_at, ingested_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)""",
                    *(lineage_id, revision_number, data["title"], data["method"], data["effective_date"],
                     data["calendar_days"], data["fh_interval"], json.dumps(data["applicability"]),
                     bool(data["prior_credit"]), document_key, now, actor["id"]))
                splice = await self._supersede(
                    conn, actor, lineage, old_rev, data, revision_number, now)
                await conn.execute(
                    "UPDATE lineages SET revision = $1, title = $2 WHERE id = $3",
                    *(revision_number, data["title"], lineage_id))
                await self._audit(conn, actor["id"], "revision.ingested", lineage_id, None,
                                  {"revision": revision_number,
                                   "authority": lineage["authority"], "number": lineage["number"]})
        await self.events.publish("revision", {
            "directive_id": lineage_id,
            "splice": splice,
        })
        directive = await self._directive_payload(lineage_id)
        return {"directive": directive, "splice": splice}

    async def _supersede(self, conn, actor, lineage, old_rev, data, new_revision, now) -> dict:
        """One transaction: revision, thread changes, history, snapshot, notices, audit."""
        splice = {"from": tag_of(old_rev["revision"]), "to": tag_of(new_revision),
                  "retargeted": [], "added": [], "removed": [], "kept": []}
        threads = await conn.fetch(
            """SELECT t.*, w.card_id, tm.model, tm.msn, tm.total_hours
               FROM threads t JOIN work_cards w ON w.thread_id = t.id
               JOIN tails tm ON tm.registration = t.registration
               WHERE t.lineage_id = $1 ORDER BY t.registration""", lineage["id"])
        new_effective_midnight = rules.base_midnight(data["effective_date"])
        snapshot_cells = []
        people = {row["id"]: row for row in await conn.fetch("SELECT * FROM people")}

        for thread in threads:
            effective_now = in_effectivity(thread["model"], thread["msn"], data["applicability"])
            was_applicable = thread["stage"] != "not_applicable"
            cell_snapshot = await self._thread_snapshot_state(conn, thread, now)
            snapshot_cells.append(cell_snapshot)

            if not effective_now and thread["stage"] != "withdrawn":
                await self._freeze_history(conn, thread, "removed", now)
                await conn.execute(
                    "UPDATE threads SET stage = 'not_applicable', revision = $1, pinned_revision = NULL, holder_id = NULL, claimed_at = NULL, last_revision_change = $2 WHERE id = $3",
                    *(new_revision, now, thread["id"]))
                await conn.execute(
                    "UPDATE notices SET status = 'withdrawn' WHERE thread_id = $1 AND status = 'queued'",
                    *(thread["id"],))
                splice["removed"].append(thread["id"])
                await self._audit(conn, actor["id"], "thread.removed", lineage["id"], thread["id"],
                                  {"revision": new_revision})
                continue

            if not was_applicable:
                baseline = float(thread["total_hours"])
                threshold = baseline + data["fh_interval"]
                deadline = rules.deadline_of(data["effective_date"], data["calendar_days"])
                await conn.execute(
                    "UPDATE threads SET stage = 'open', revision = $1, pinned_revision = NULL, fh_baseline = $2, threshold = $3, deadline_date = $4, last_revision_change = $5 WHERE id = $6",
                    *(new_revision, baseline, threshold, deadline, now, thread["id"]))
                await self._append_history(conn, thread, new_revision, baseline, threshold, deadline,
                                           data["title"], data["method"], now, "current", entering=True)
                splice["added"].append(thread["id"])
                await self._audit(conn, actor["id"], "thread.added", lineage["id"], thread["id"],
                                  {"revision": new_revision})
                continue

            if thread["stage"] == "certified" and data["prior_credit"]:
                countersign_row = await conn.fetchrow(
                    "SELECT committed_at FROM signatures WHERE thread_id = $1 AND kind = 'countersignature' AND status = 'valid' ORDER BY committed_at DESC LIMIT 1",
                    thread["id"])
                if countersign_row and countersign_row["committed_at"] < new_effective_midnight:
                    await self._freeze_history(conn, thread, "kept", now)
                    await self._append_history(conn, thread, new_revision,
                                               float(thread["fh_baseline"]), float(thread["threshold"]),
                                               thread["deadline_date"], data["title"], data["method"],
                                               now, "current", entering=True, live_limits_pinned=True)
                    await conn.execute(
                        "UPDATE threads SET revision = $1, pinned_revision = $2 WHERE id = $3",
                        *(new_revision, thread["pinned_revision"] or old_rev["revision"], thread["id"]))
                    splice["kept"].append(thread["id"])
                    continue

            baseline = float(thread["total_hours"])
            threshold = baseline + data["fh_interval"]
            deadline = rules.deadline_of(data["effective_date"], data["calendar_days"])
            outcome = "retargeted"
            await self._freeze_history(conn, thread, outcome, now)
            await conn.execute(
                "UPDATE threads SET stage = 'superseded_retargeted', revision = $1, pinned_revision = NULL, fh_baseline = $2, threshold = $3, deadline_date = $4, last_revision_change = $5 WHERE id = $6",
                *(new_revision, baseline, threshold, deadline, now, thread["id"]))
            await conn.execute("DELETE FROM deferrals WHERE thread_id = $1", thread["id"])
            await conn.execute(
                "UPDATE signatures SET status = 'superseded' WHERE thread_id = $1 AND status = 'valid'",
                *(thread["id"],))
            await conn.execute(
                "UPDATE notices SET status = 'withdrawn' WHERE thread_id = $1 AND status IN ('queued', 'sent') AND kind = 'countersignature_request'",
                *(thread["id"],))
            if thread["holder_id"]:
                await self.notifier.queue_card_revision(
                    conn, thread, lineage, tag_of(old_rev["revision"]), tag_of(new_revision),
                    deadline.isoformat(), threshold, holder_id=thread["holder_id"])
            await self._append_history(conn, thread, new_revision, baseline, threshold, deadline,
                                       data["title"], data["method"], now, "current", entering=True)
            splice["retargeted"].append(thread["id"])
            await self._audit(conn, actor["id"], "thread.retargeted", lineage["id"], thread["id"],
                              {"revision": new_revision})

        tails = await conn.fetch("SELECT * FROM tails ORDER BY registration")
        covered = {row["registration"] for row in threads}
        for tail in tails:
            if tail["registration"] in covered:
                continue
            if in_effectivity(tail["model"], tail["msn"], data["applicability"]):
                thread_id = await self._create_thread(
                    conn, lineage["id"], tail, data, now, actor)
                splice["added"].append(thread_id)
                await self._audit(conn, actor["id"], "thread.added", lineage["id"], thread_id,
                                  {"revision": new_revision})

        payload = {"counts": rules.counts_from_states(
                       [(cell["stage"], cell["state"]) for cell in snapshot_cells]),
                   "cells": snapshot_cells}
        await conn.execute(
            """INSERT INTO snapshots (lineage_id, revision, payload, created_at)
               VALUES ($1, $2, $3, $4) ON CONFLICT (lineage_id, revision) DO NOTHING""",
            *(lineage["id"], old_rev["revision"], json.dumps(payload), now))
        return splice

    async def _thread_snapshot_state(self, conn, thread, now) -> dict:
        from .threads import ThreadView
        revisions = await conn.fetch(
            "SELECT * FROM revisions WHERE lineage_id = $1 ORDER BY revision", thread["lineage_id"])
        tails = {thread["registration"]: await conn.fetchrow(
            "SELECT * FROM tails WHERE registration = $1", thread["registration"])}
        signatures = await conn.fetch(
            "SELECT * FROM signatures WHERE thread_id = $1 ORDER BY committed_at", thread["id"])
        deferral = await conn.fetchrow("SELECT * FROM deferrals WHERE thread_id = $1", thread["id"])
        lineage = await conn.fetchrow("SELECT * FROM lineages WHERE id = $1", thread["lineage_id"])
        view = ThreadView(thread, revisions, tails, {}, signatures, [], [], [], deferral, now, lineage)
        cell = view.cell()
        return cell

    async def _freeze_history(self, conn, thread, outcome, now):
        await conn.execute(
            "UPDATE history_entries SET left_at = $1, outcome = $2 WHERE thread_id = $3 AND outcome = 'current'",
            *(now, outcome, thread["id"]))

    async def _append_history(self, conn, thread, revision, baseline, threshold, deadline,
                              title, method, now, outcome, entering=False, live_limits_pinned=False):
        await conn.execute(
            """INSERT INTO history_entries (thread_id, lineage_id, revision, entered_at, outcome,
               fh_baseline, threshold, deadline_date, title, method)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)""",
            *(thread["id"], thread["lineage_id"], revision, now, outcome, baseline, threshold,
             deadline, title, method))

    async def _create_thread(self, conn, lineage_id, tail, data, now, actor) -> str:
        thread_id = f"thr_{secrets.token_hex(8)}"
        baseline = float(tail["total_hours"])
        threshold = baseline + data["fh_interval"]
        deadline = rules.deadline_of(data["effective_date"], data["calendar_days"])
        await conn.execute(
            """INSERT INTO threads (id, lineage_id, registration, stage, revision, pinned_revision,
               fh_baseline, threshold, deadline_date, created_at)
               VALUES ($1, $2, $3, 'open', $4, NULL, $5, $6, $7, $8)""",
            *(thread_id, lineage_id, tail["registration"], data["revision"], baseline, threshold, deadline, now))
        await self._append_history_for_new(conn, thread_id, lineage_id, data, baseline, threshold,
                                           deadline, now)
        await self._allocate_card(conn, thread_id)
        return thread_id

    async def _append_history_for_new(self, conn, thread_id, lineage_id, data, baseline, threshold,
                                      deadline, now):
        await conn.execute(
            """INSERT INTO history_entries (thread_id, lineage_id, revision, entered_at, outcome,
               fh_baseline, threshold, deadline_date, title, method)
               VALUES ($1, $2, $3, $4, 'current', $5, $6, $7, $8, $9)""",
            *(thread_id, lineage_id, data["revision"], now, baseline, threshold, deadline,
             data["title"], data["method"]))

    async def _allocate_card(self, conn, thread_id):
        row = await conn.fetchrow("SELECT card_id FROM work_cards ORDER BY card_id DESC LIMIT 1")
        next_number = 10001 if row is None else int(row["card_id"].split("-")[1]) + 1
        await conn.execute(
            "INSERT INTO work_cards (thread_id, card_id) VALUES ($1, $2)",
            *(thread_id, f"WC-{next_number:05d}"))

    async def _create_or_reopen_threads(self, conn, lineage_id, applicability, title, method,
                                        effective_date, calendar_days, fh_interval, now) -> list:
        """One thread per tail inside effectivity, created the first time the tail is affected."""
        data = {"revision": 1, "title": title, "method": method, "effective_date": effective_date,
                "calendar_days": calendar_days, "fh_interval": fh_interval}
        added = []
        tails = await conn.fetch("SELECT * FROM tails ORDER BY registration")
        for tail in tails:
            if in_effectivity(tail["model"], tail["msn"], applicability):
                thread_id = await self._create_thread(conn, lineage_id, tail, data, now, None)
                added.append(thread_id)
        return added

    async def _directive_payload(self, lineage_id):
        from .service import BoardService
        service = BoardService(self.repo)
        directives = await service.directives()
        for directive in directives:
            if directive["id"] == lineage_id:
                return directive
        return None

    # ---- work cards and signatures -------------------------------------
    async def claim(self, actor, thread_id) -> dict:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                thread = await self._locked_thread(conn, thread_id)
                await self._guard_lineage_active(conn, thread)
                stage = thread["stage"]
                if stage == "superseded_retargeted":
                    raise conflict("effectivity_unconfirmed",
                                   "Waiting for the planner to confirm effectivity.")
                if thread["holder_id"] == actor["id"]:
                    return await self._thread_shape(conn, await self._thread_row(conn, thread_id))
                if thread["holder_id"] is not None:
                    holder = await conn.fetchrow(
                        """SELECT p.* FROM threads t JOIN people p ON p.id = t.holder_id
                           WHERE t.id = $1""", thread_id)
                    raise conflict("card_held", f"Already held by {holder['display_name']}.",
                                   holder=_serialise_person(holder))
                if stage not in ("open", "deferred", "reopened"):
                    raise ApiError(409, "invalid_transition", "This card cannot be claimed now.",
                                   stage=stage, action="claim")
                winner = await conn.fetchrow(
                    """UPDATE threads SET holder_id = $1, claimed_at = $2, stage = CASE
                       WHEN stage = 'reopened' THEN 'reopened' ELSE 'claimed' END
                       WHERE id = $3 AND (holder_id IS NULL OR holder_id = $1)
                       RETURNING threads.id""", actor["id"], clock().now(), thread_id)
                if winner is None:
                    holder = await conn.fetchrow(
                        """SELECT p.* FROM threads t JOIN people p ON p.id = t.holder_id
                           WHERE t.id = $1""", thread_id)
                    raise conflict("card_held", f"Already held by {holder['display_name']}.",
                                   holder=_serialise_person(holder))
                await self._audit(conn, actor["id"], "thread.claimed", thread["lineage_id"],
                                  thread_id, {"stage": "claimed"})
                await self._publish_threads([thread_id])
                updated = await self._thread_row(conn, thread_id)
                return await self._thread_shape(conn, updated)

    async def release(self, actor, thread_id) -> dict:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                thread = await self._locked_thread(conn, thread_id)
                await self._guard_lineage_active(conn, thread, holder_actions=True, actor=actor)
                if thread["holder_id"] != actor["id"]:
                    raise forbidden("You no longer hold this work card.", code="not_holder")
                if thread["stage"] not in ("claimed", "reopened"):
                    raise ApiError(409, "invalid_transition", "This card can no longer be released.",
                                   stage=thread["stage"], action="release")
                await conn.execute(
                    "UPDATE threads SET holder_id = NULL, claimed_at = NULL, stage = $1 WHERE id = $2",
                    *("open", thread_id))
                await self._audit(conn, actor["id"], "thread.released", thread["lineage_id"],
                                  thread_id, {"stage": "open"})
                await self._publish_threads([thread_id])
                released = await self._thread_row(conn, thread_id)
                return await self._thread_shape(conn, released)

    async def attach_evidence(self, actor, thread_id, evidence_row) -> dict:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                thread = await self._locked_thread(conn, thread_id)
                await self._guard_lineage_active(conn, thread, holder_actions=True, actor=actor)
                if thread["holder_id"] != actor["id"]:
                    raise forbidden("You no longer hold this work card.", code="not_holder")
                await conn.execute(
                    """INSERT INTO evidence (id, thread_id, key, sha256, content_type, bytes,
                       attached_by, attached_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
                    *(evidence_row["id"], thread_id, evidence_row["key"], evidence_row["sha256"],
                     evidence_row["content_type"], evidence_row["bytes"], actor["id"], clock().now()))
                await self._publish_threads([thread_id])
                return await self._evidence_shape(conn, evidence_row["id"], actor)

    async def sign_inspection(self, actor, thread_id, payload) -> dict:
        revision = _revision_number(payload.get("revision"))
        fields = {}
        method_ref = payload.get("method_ref")
        if not isinstance(method_ref, str) or not (1 <= len(method_ref) <= 200):
            fields["method_ref"] = "Method reference must be 1 to 200 characters."
        findings = payload.get("findings")
        if not isinstance(findings, str) or not (1 <= len(findings) <= 4000):
            fields["findings"] = "Findings must be 1 to 4,000 characters."
        evidence_ids = payload.get("evidence_ids")
        if not isinstance(evidence_ids, list) or not evidence_ids:
            fields["evidence_ids"] = "Name the evidence objects this inspection relies on."
        if fields:
            raise validation(fields)
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                thread = await self._locked_thread(conn, thread_id)
                await self._guard_lineage_active(conn, thread, holder_actions=True, actor=actor)
                if thread["holder_id"] != actor["id"]:
                    raise forbidden("You no longer hold this work card.", code="not_holder")
                if thread["stage"] == "superseded_retargeted":
                    raise conflict("effectivity_unconfirmed",
                                   "Waiting for the planner to confirm effectivity.")
                if thread["revision"] != revision:
                    raise conflict("revision_changed",
                                   "This thread moved to a new revision. Review the new limits before signing.",
                                   current=tag_of(thread["revision"]))
                if thread["stage"] not in ("claimed", "reopened"):
                    raise ApiError(409, "invalid_transition", "This card cannot be signed now.",
                                   stage=thread["stage"], action="inspect")
                evidence_rows = await conn.fetch(
                    "SELECT id FROM evidence WHERE thread_id = $1", thread_id)
                known = {row["id"] for row in evidence_rows}
                for evidence_id in evidence_ids:
                    if evidence_id not in known:
                        raise validation({"evidence_ids": "Evidence must be attached to this thread."})
                now = clock().now()
                calendar_due = rules.end_of_day(thread["deadline_date"])
                tail = await conn.fetchrow(
                    "SELECT total_hours FROM tails WHERE registration = $1", thread["registration"])
                timeliness = rules.sign_timeliness(now, calendar_due,
                                                    float(tail["total_hours"]), float(thread["threshold"]))
                await conn.execute(
                    """INSERT INTO signatures (id, thread_id, kind, signer_id, revision, committed_at,
                       timeliness, method_ref, findings, status)
                       VALUES ($1, $2, 'inspection', $3, $4, $5, $6, $7, $8, 'valid')""",
                    *(f"sig_{secrets.token_hex(8)}", thread_id, actor["id"], revision, now,
                     timeliness, method_ref, findings))
                certifier = await self._assign_certifier(conn, thread, now)
                await conn.execute(
                    "UPDATE threads SET stage = 'inspected', certifier_id = $1 WHERE id = $2",
                    *(certifier, thread_id))
                await self._audit(conn, actor["id"], "thread.inspection_signed",
                                  thread["lineage_id"], thread_id,
                                  {"revision": tag_of(revision), "timeliness": timeliness})
                await self.notifier.queue_countersignature_request(
                    conn, thread, actor, certifier)
                await self._publish_threads([thread_id])
                updated = await self._thread_row(conn, thread_id)
                shape = await self._thread_shape(conn, updated)
                signature = await self._signature_shape_for(conn, thread_id, "inspection")
                return {"thread": shape, "signature": signature}

    async def countersign(self, actor, thread_id, payload) -> dict:
        revision = _revision_number(payload.get("revision"))
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                thread = await self._locked_thread(conn, thread_id)
                await self._guard_lineage_active(conn, thread)
                if thread["stage"] == "superseded_retargeted":
                    raise conflict("effectivity_unconfirmed",
                                   "Waiting for the planner to confirm effectivity.")
                if thread["revision"] != revision:
                    raise conflict("revision_changed",
                                   "This thread moved to a new revision. Review the new limits before signing.",
                                   current=tag_of(thread["revision"]))
                if thread["stage"] != "inspected":
                    raise ApiError(409, "invalid_transition", "Only an inspected thread can be countersigned.",
                                   stage=thread["stage"], action="countersign")
                scope = json.loads(actor["scope"]) if actor["scope"] else []
                if thread["model"] not in scope:
                    raise forbidden(f"Your certification scope does not cover {MODELS[thread['model']]}.",
                                    code="out_of_scope", model=thread["model"])
                now = clock().now()
                await conn.execute(
                    """INSERT INTO signatures (id, thread_id, kind, signer_id, revision, committed_at,
                       timeliness, method_ref, findings, status)
                       VALUES ($1, $2, 'countersignature', $3, $4, $5, NULL, NULL, NULL, 'valid')""",
                    *(f"sig_{secrets.token_hex(8)}", thread_id, actor["id"], revision, now))
                await conn.execute(
                    "UPDATE threads SET stage = 'certified', pinned_revision = $1 WHERE id = $2",
                    *(revision, thread_id))
                await self._audit(conn, actor["id"], "thread.countersigned", thread["lineage_id"],
                                  thread_id, {"revision": tag_of(revision)})
                await self._publish_threads([thread_id])
                updated = await self._thread_row(conn, thread_id)
                shape = await self._thread_shape(conn, updated)
                signature = await self._signature_shape_for(conn, thread_id, "countersignature")
                return {"thread": shape, "signature": signature}

    async def defer(self, actor, thread_id, payload) -> dict:
        reason = payload.get("reason")
        if not isinstance(reason, str) or not (1 <= len(reason) <= 500):
            raise validation({"reason": "Give a deferral reason of 1 to 500 characters."})
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                thread = await self._locked_thread(conn, thread_id)
                await self._guard_lineage_active(conn, thread)
                if thread["stage"] == "superseded_retargeted":
                    raise conflict("effectivity_unconfirmed",
                                   "Waiting for the planner to confirm effectivity.")
                existing = await conn.fetchrow(
                    "SELECT 1 FROM deferrals WHERE thread_id = $1 AND revision = $2",
                    *(thread_id, thread["revision"]))
                if existing:
                    raise conflict("already_deferred",
                                   f"Already deferred under {tag_of(thread['revision'])}.")
                if thread["stage"] != "open":
                    raise ApiError(409, "invalid_transition", "Only an open thread can be deferred.",
                                   stage=thread["stage"], action="defer")
                calendar_due = rules.end_of_day(thread["deadline_date"])
                tail = await conn.fetchrow(
                    "SELECT total_hours FROM tails WHERE registration = $1", thread["registration"])
                now = clock().now()
                due_at = rules.hours_due_instant(float(thread["threshold"]),
                                                 float(tail["total_hours"]),
                                                 thread["last_revision_change"]) or calendar_due
                if now > due_at:
                    raise conflict("past_due", "Too late to defer: the due instant has passed.")
                new_deadline = thread["deadline_date"] + timedelta(days=rules.CALENDAR_GRACE_DAYS)
                new_threshold = float(thread["threshold"]) + rules.HOURS_GRACE
                await conn.execute(
                    "INSERT INTO deferrals (thread_id, granted_by, granted_at, reason, revision) VALUES ($1, $2, $3, $4, $5)",
                    *(thread_id, actor["id"], now, reason, thread["revision"]))
                await conn.execute(
                    "UPDATE threads SET stage = 'deferred', deadline_date = $1, threshold = $2 WHERE id = $3",
                    *(new_deadline, new_threshold, thread_id))
                await self._audit(conn, actor["id"], "thread.deferred", thread["lineage_id"],
                                  thread_id, {"reason": reason, "deadline": new_deadline.isoformat()})
                await self._publish_threads([thread_id])
                updated = await self._thread_row(conn, thread_id)
                return await self._thread_shape(conn, updated)

    async def confirm_effectivity(self, actor, thread_id, decision, reason) -> dict:
        if not isinstance(reason, str) or not (1 <= len(reason) <= 500):
            raise validation({"reason": "Give an effectivity reason of 1 to 500 characters."})
        if decision not in ("confirmed", "not_applicable"):
            raise validation({"decision": "Effectivity must be confirmed or marked not applicable."})
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                thread = await self._locked_thread(conn, thread_id)
                await self._guard_lineage_active(conn, thread)
                if thread["stage"] != "superseded_retargeted":
                    raise ApiError(409, "invalid_transition",
                                   "This thread no longer needs confirmation.",
                                   stage=thread["stage"], action="confirm_effectivity")
                if decision == "not_applicable":
                    await conn.execute(
                        "UPDATE threads SET stage = 'not_applicable', holder_id = NULL, claimed_at = NULL WHERE id = $1",
                        *(thread_id,))
                    await self._audit(conn, actor["id"], "thread.not_applicable",
                                      thread["lineage_id"], thread_id, {"reason": reason})
                else:
                    stage = "claimed" if thread["holder_id"] else "open"
                    await conn.execute(
                        "UPDATE threads SET stage = $1 WHERE id = $2", stage, thread_id)
                    await self._audit(conn, actor["id"], "thread.effectivity_confirmed",
                                      thread["lineage_id"], thread_id, {"reason": reason})
                await self._publish_threads([thread_id])
                updated = await self._thread_row(conn, thread_id)
                return await self._thread_shape(conn, updated)

    async def reopen(self, actor, thread_id, reason) -> dict:
        if not isinstance(reason, str) or not (1 <= len(reason) <= 500):
            raise validation({"reason": "Give a reopen reason of 1 to 500 characters."})
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                thread = await self._locked_thread(conn, thread_id)
                await self._guard_lineage_active(conn, thread)
                if thread["stage"] != "certified":
                    raise ApiError(409, "invalid_transition", "Only a closed thread can be reopened.",
                                   stage=thread["stage"], action="reopen")
                now = clock().now()
                await conn.execute(
                    "UPDATE signatures SET status = 'void', void_reason = $1 WHERE thread_id = $2 AND status = 'valid'",
                    *(reason, thread_id))
                last_inspection = await conn.fetchrow(
                    """SELECT signer_id FROM signatures WHERE thread_id = $1 AND kind = 'inspection'
                       AND status = 'void' ORDER BY committed_at DESC LIMIT 1""", thread_id)
                last_signer = last_inspection["signer_id"] if last_inspection else None
                signer_erased = False
                if last_signer:
                    signer_row = await conn.fetchrow(
                        "SELECT erased FROM people WHERE id = $1", last_signer)
                    signer_erased = signer_row["erased"] if signer_row else False
                holder = None if signer_erased else last_signer
                current_rev = thread["revision"]
                revision_row = await conn.fetchrow(
                    "SELECT * FROM revisions WHERE lineage_id = $1 AND revision = $2",
                    *(thread["lineage_id"], current_rev))
                tail = await conn.fetchrow(
                    "SELECT total_hours FROM tails WHERE registration = $1", thread["registration"])
                baseline = float(tail["total_hours"])
                threshold = baseline + float(revision_row["fh_interval"])
                deadline = rules.deadline_of(revision_row["effective_date"],
                                              revision_row["calendar_days"])
                await conn.execute(
                    """UPDATE threads SET stage = 'reopened', pinned_revision = NULL, holder_id = $1,
                       claimed_at = $2, fh_baseline = $3, threshold = $4, deadline_date = $5,
                       last_revision_change = $6, revision = $7 WHERE id = $8""",
                    *(holder, now if holder else thread["claimed_at"], baseline, threshold,
                     deadline, now, current_rev, thread_id))
                await self._audit(conn, actor["id"], "thread.reopened", thread["lineage_id"],
                                  thread_id, {"reason": reason})
                await self._publish_threads([thread_id])
                updated = await self._thread_row(conn, thread_id)
                return await self._thread_shape(conn, updated)

    # ---- shared thread helpers -----------------------------------------
    async def _locked_thread(self, conn, thread_id):
        thread = await conn.fetchrow(
            """SELECT t.*, w.card_id, tm.model, tm.msn, tm.total_hours, tm.daily_utilisation,
                      tm.model AS model_label
               FROM threads t JOIN work_cards w ON w.thread_id = t.id
               JOIN tails tm ON tm.registration = t.registration
               WHERE t.id = $1 FOR UPDATE""", thread_id)
        if thread is None:
            raise not_found("No such thread.")
        return thread

    async def _guard_lineage_active(self, conn, thread, holder_actions=False, actor=None):
        lineage = await conn.fetchrow("SELECT * FROM lineages WHERE id = $1", thread["lineage_id"])
        if lineage["status"] == "withdrawn":
            if holder_actions and actor is not None:
                raise ApiError(403, "not_holder", "You no longer hold this work card.")
            raise conflict("directive_withdrawn",
                           f"{lineage['authority']} {lineage['number']} is withdrawn.")

    async def _thread_row(self, conn, thread_id):
        return await conn.fetchrow(
            """SELECT t.*, w.card_id, tm.model, tm.msn, tm.total_hours, tm.daily_utilisation
               FROM threads t JOIN work_cards w ON w.thread_id = t.id
               JOIN tails tm ON tm.registration = t.registration
               WHERE t.id = $1""", thread_id)

    async def _thread_shape(self, conn, thread_row):
        from .service import BoardService
        from .threads import ThreadView
        board = BoardService(self.repo)
        people = await board.load_people()
        tails = await board.load_tails()
        revisions = await self.repo.revisions_of(thread_row["lineage_id"])
        lineage = await self.repo.lineage(thread_row["lineage_id"])
        signatures = await conn.fetch(
            "SELECT * FROM signatures WHERE thread_id = $1 ORDER BY committed_at", thread_row["id"])
        evidence = await conn.fetch(
            "SELECT * FROM evidence WHERE thread_id = $1 ORDER BY attached_at", thread_row["id"])
        history = await conn.fetch(
            "SELECT * FROM history_entries WHERE thread_id = $1 ORDER BY revision", thread_row["id"])
        legacy = await conn.fetch(
            "SELECT * FROM legacy_records WHERE thread_id = $1 ORDER BY created_at", thread_row["id"])
        deferral = await conn.fetchrow(
            "SELECT * FROM deferrals WHERE thread_id = $1", thread_row["id"])
        view = ThreadView(thread_row, revisions, tails, people, signatures, evidence,
                          history, legacy, deferral, clock().now(), lineage)
        return view.shape()

    async def _evidence_shape(self, conn, evidence_id, actor):
        row = await conn.fetchrow("SELECT * FROM evidence WHERE id = $1", evidence_id)
        return {
            "id": row["id"],
            "key": row["key"],
            "sha256": row["sha256"],
            "content_type": row["content_type"],
            "bytes": row["bytes"],
            "attached_by": _serialise_person(actor),
            "attached_at": format_iso(row["attached_at"]),
        }

    async def _signature_shape_for(self, conn, thread_id, kind):
        row = await conn.fetchrow(
            """SELECT s.*, p.display_name, p.licence, p.erased, p.signer_token
               FROM signatures s LEFT JOIN people p ON p.id = s.signer_id
               WHERE s.thread_id = $1 AND s.kind = $2
               ORDER BY s.committed_at DESC LIMIT 1""", thread_id, kind)
        signer = None
        if row["signer_id"]:
            person = await conn.fetchrow("SELECT * FROM people WHERE id = $1", row["signer_id"])
            signer = _serialise_person(person)
        return {
            "id": row["id"],
            "kind": row["kind"],
            "signer": signer,
            "signer_text": None,
            "revision": tag_of(row["revision"]),
            "committed_at": format_iso(row["committed_at"]),
            "timeliness": row["timeliness"],
            "method_ref": row["method_ref"],
            "findings": row["findings"],
            "status": row["status"],
            "void_reason": row["void_reason"],
        }

    async def _assign_certifier(self, conn, thread, now):
        """The first engineer on the model's standby list whose scope covers the model."""
        standby = await conn.fetch(
            """SELECT s.person_id, p.scope FROM standby s JOIN people p ON p.id = s.person_id
               WHERE s.model = $1 ORDER BY s.position""", thread["model"])
        for row in standby:
            scope = json.loads(row["scope"]) if row["scope"] else []
            if thread["model"] in scope:
                return row["person_id"]
        return None

    async def _erase_legacy_text(self, conn, token, person):
        """Legacy signer text equal to the erased name or licence resolves to the token."""
        name = person["display_name"].lower()
        licence = (person["licence"] or "").lower()
        for column in ("inspector_name", "certifier_name"):
            await conn.execute(
                f"UPDATE legacy_records SET {column} = $1 WHERE lower({column}) = ANY($2)",
                *(token, [name, licence] if licence else [name]))
        for column in ("inspector_licence", "certifier_licence"):
            await conn.execute(
                f"UPDATE legacy_records SET {column} = $1 WHERE lower({column}) = ANY($2)",
                *(token, [name, licence] if licence else [name]))

    async def _standby_next(self, conn, model, skip_person_id=None):
        """Succession: the next covering engineer on the model's standby list."""
        standby = await conn.fetch(
            """SELECT s.person_id, p.scope FROM standby s JOIN people p ON p.id = s.person_id
               WHERE s.model = $1 ORDER BY s.position""", model)
        for row in standby:
            if row["person_id"] == skip_person_id:
                continue
            scope = json.loads(row["scope"]) if row["scope"] else []
            if model in scope:
                return row["person_id"]
        return None


    async def withdraw(self, actor, lineage_id, reason) -> dict:
        """Withdrawal: cancel every hold, withdraw queued notices, keep the history."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                lineage = await conn.fetchrow("SELECT * FROM lineages WHERE id = $1 FOR UPDATE", lineage_id)
                if lineage is None:
                    raise not_found("No such directive.")
                if lineage["status"] == "withdrawn":
                    raise conflict("directive_withdrawn",
                                   f"{lineage['authority']} {lineage['number']} is withdrawn.")
                threads = await conn.fetch(
                    "SELECT * FROM threads WHERE lineage_id = $1 FOR UPDATE", lineage_id)
                now = clock().now()
                await conn.execute(
                    "UPDATE lineages SET status = 'withdrawn' WHERE id = $1", lineage_id)
                for thread in threads:
                    await conn.execute(
                        "UPDATE threads SET stage = 'withdrawn', holder_id = NULL, claimed_at = NULL WHERE id = $1",
                        *(thread["id"],))
                    await conn.execute(
                        "UPDATE notices SET status = 'withdrawn' WHERE thread_id = $1 AND status = 'queued'",
                        *(thread["id"],))
                    await self._audit(conn, actor["id"], "thread.withdrawn", lineage_id,
                                      thread["id"], {"reason": reason})
                await self._audit(conn, actor["id"], "directive.withdrawn", lineage_id, None,
                                  {"reason": reason})
                await self.events.publish("threads", {"thread_ids": [t["id"] for t in threads]})
        directive = await self._directive_payload(lineage_id)
        return {"directive": directive}

    # ---- scope changes, succession and erasure -------------------------
    async def change_scope(self, actor, user_id, models) -> dict:
        unknown = [model for model in models if model not in MODELS]
        if unknown:
            raise validation({"models": f"Unknown model code {unknown[0]}."})
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                engineer = await conn.fetchrow("SELECT * FROM people WHERE id = $1 FOR UPDATE", user_id)
                if engineer is None or engineer["role"] != "certifying_engineer":
                    raise not_found("No such certifying engineer.")
                old_scope = json.loads(engineer["scope"]) if engineer["scope"] else []
                new_scope = sorted(set(models), key=lambda m: list(MODELS).index(m))
                await conn.execute(
                    "UPDATE people SET scope = $1 WHERE id = $2",
                    *(json.dumps(new_scope), user_id))
                await self._audit(conn, actor["id"], "scope.changed", None, None,
                                  {"engineer": _serialise_person(engineer), "scope": new_scope})
                succession = []
                removed_models = [model for model in old_scope if model not in new_scope]
                added_models = [model for model in new_scope if model not in old_scope]
                for model in removed_models:
                    rows = await conn.fetch(
                        """SELECT t.* FROM threads t JOIN tails tm ON tm.registration = t.registration
                           WHERE tm.model = $1 AND t.certifier_id = $2 AND t.stage = 'inspected'
                           FOR UPDATE""", model, user_id)
                    for thread in rows:
                        replacement = await self._standby_next(conn, model, skip_person_id=user_id)
                        await conn.execute(
                            "UPDATE threads SET certifier_id = $1 WHERE id = $2",
                            *(replacement, thread["id"]))
                        from_person = await conn.fetchrow(
                            "SELECT * FROM people WHERE id = $1", user_id)
                        to_person = None
                        if replacement:
                            to_person = await conn.fetchrow(
                                "SELECT * FROM people WHERE id = $1", replacement)
                            await self.notifier.queue_succession(
                                conn, thread, from_person, to_person, replacement_authorized=True)
                        succession.append({
                            "thread_id": thread["id"],
                            "from": _serialise_person(from_person),
                            "to": _serialise_person(to_person),
                        })
                        await self._audit(conn, actor["id"], "thread.certifier_changed",
                                          thread["lineage_id"], thread["id"],
                                          {"to": replacement, "model": model})
                for model in added_models:
                    rows = await conn.fetch(
                        """SELECT t.* FROM threads t JOIN tails tm ON tm.registration = t.registration
                           WHERE tm.model = $1 AND t.certifier_id IS NULL AND t.stage = 'inspected'
                           FOR UPDATE""", model)
                    for thread in rows:
                        candidates = await conn.fetch(
                            """SELECT s.person_id, p.scope FROM standby s JOIN people p ON p.id = s.person_id
                               WHERE s.model = $1 ORDER BY s.position""", model)
                        assigned = None
                        for row in candidates:
                            scope = json.loads(row["scope"]) if row["scope"] else []
                            if model in scope:
                                assigned = row["person_id"]
                                break
                        if assigned:
                            await conn.execute(
                                "UPDATE threads SET certifier_id = $1 WHERE id = $2",
                                *(assigned, thread["id"]))
                            to_person = await conn.fetchrow(
                                "SELECT * FROM people WHERE id = $1", assigned)
                            await self.notifier.queue_succession(
                                conn, thread, None, to_person, replacement_authorized=True)
                            succession.append({
                                "thread_id": thread["id"],
                                "from": None,
                                "to": _serialise_person(to_person),
                            })
                            await self._audit(conn, actor["id"], "thread.certifier_changed",
                                              thread["lineage_id"], thread["id"],
                                              {"to": assigned, "model": model})
                await self._publish_threads([entry["thread_id"] for entry in succession])
                engineer_row = await conn.fetchrow("SELECT * FROM people WHERE id = $1", user_id)
                return {
                    "engineer": _engineer_shape(engineer_row),
                    "succession": succession,
                }

    async def erase(self, actor, user_id, reason) -> dict:
        if not isinstance(reason, str) or not (1 <= len(reason) <= 500):
            raise validation({"reason": "Give an erasure reason of 1 to 500 characters."})
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                person = await conn.fetchrow("SELECT * FROM people WHERE id = $1 FOR UPDATE", user_id)
                if person is None:
                    raise not_found("No such person.")
                if not person["contractor"]:
                    raise conflict("not_contractor", "Only contractor records can be erased.")
                if person["erased"]:
                    raise conflict("already_erased", "This person was already erased.")
                token = f"SIGNER-{secrets.token_hex(4).upper()}"
                await conn.execute(
                    """UPDATE people SET erased = true, signer_token = $1, display_name = $1,
                       licence = NULL, email = NULL WHERE id = $2""", token, user_id)
                await conn.execute("DELETE FROM sessions WHERE person_id = $1", user_id)
                held = await conn.fetch(
                    "SELECT * FROM threads WHERE holder_id = $1", user_id)
                for thread in held:
                    if thread["stage"] == "claimed":
                        await conn.execute(
                            "UPDATE threads SET stage = 'open', holder_id = NULL, claimed_at = NULL WHERE id = $1",
                            *(thread["id"],))
                        await self._audit(conn, actor["id"], "thread.card_cleared",
                                          thread["lineage_id"], thread["id"],
                                          {"reason": "erasure", "stage": "open"})
                    else:
                        await conn.execute(
                            "UPDATE threads SET holder_id = NULL, claimed_at = NULL WHERE id = $1",
                            *(thread["id"],))
                        await self._audit(conn, actor["id"], "thread.card_cleared",
                                          thread["lineage_id"], thread["id"],
                                          {"reason": "erasure", "stage": thread["stage"]})
                await conn.execute(
                    "UPDATE notices SET status = 'withdrawn' WHERE to_person = $1 AND status = 'queued'",
                    *(user_id,))
                await conn.execute(
                    """UPDATE notices SET subject = replace(replace(subject, $1, $2), $3, $2),
                       body = replace(replace(body, $1, $2), $3, $2)
                       WHERE status = 'queued' AND (subject ILIKE $1 OR body ILIKE $1)""",
                    *(person["display_name"], token, person["licence"]))
                await self._erase_legacy_text(conn, token, person)
                await self._audit(conn, actor["id"], "person.erased", None, None,
                                  {"person": token, "reason": reason})
                await self._publish_threads([thread["id"] for thread in held])
                return {
                    "id": person["id"],
                    "display_name": token,
                    "licence": None,
                    "erased": True,
                }


def _engineer_shape(row):
    return {
        "id": row["id"],
        "display_name": row["signer_token"] if row["erased"] else row["display_name"],
        "licence": None if row["erased"] else row["licence"],
        "erased": row["erased"],
        "username": row["username"],
        "role": row["role"],
        "contractor": row["contractor"],
        "email": None if row["erased"] else row["email"],
        "scope": json.loads(row["scope"]) if row["scope"] else None,
    }


def _revision_number(value):
    if isinstance(value, str) and value.startswith("R") and value[1:].isdigit():
        return int(value[1:])
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    raise validation({"revision": "Name the revision the signature binds to."})
