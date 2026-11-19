"""Ingesting a directive or a revision, and withdrawing a lineage.

A revision ingest commits in one transaction: the revision, every thread change, the
history entries, the per-revision snapshot, the notice rewrites and the audit entries.
"""

import json

from .. import clock
from ..errors import ApiError
from ..ids import new_id
from . import audit, notices
from . import limits as limit_rules
from . import threads as thread_rules
from .directives import (
    in_effectivity,
    label_of,
    load_directive,
    normalise_number,
    numbers_match,
    tag_of,
    write_applicability,
)


def _lock_directive(cursor, directive_id):
    cursor.execute("SELECT id FROM directives WHERE id = %s FOR UPDATE", (directive_id,))
    return load_directive(cursor, directive_id)


def _new_work_card(cursor):
    number = int(cursor.value("SELECT nextval('work_card_seq')"))
    return f"WC-{number:05d}"


def _affected_tails(cursor, ranges):
    rows = cursor.all(
        "SELECT registration, model_code, msn, total_hours FROM tails ORDER BY registration"
    )
    return [row for row in rows if in_effectivity(row["model_code"], int(row["msn"]), ranges)]


def ingest_directive(cursor, actor_id, fields, at):
    for row in cursor.all("SELECT authority, number FROM directives"):
        if row["authority"] == fields["authority"] and numbers_match(
            normalise_number(row["number"]), normalise_number(fields["number"])
        ):
            raise ApiError(
                "directive_exists",
                f"{row['authority']} {row['number']} is already on the board.",
            )
    directive_id = new_id("dir")
    rail_order = (
        cursor.value(
            "SELECT COALESCE(MAX(rail_order), 0) + 1 FROM directives WHERE authority = %s",
            (fields["authority"],),
        )
        or 1
    )
    cursor.execute(
        """INSERT INTO directives (id, authority, number, current_revision, status, created_at,
                                   rail_order)
           VALUES (%s,%s,%s,1,'active',%s,%s)""",
        (directive_id, fields["authority"], fields["number"], at, rail_order),
    )
    document_key = _document_key(cursor, fields["document_id"])
    cursor.execute(
        """INSERT INTO directive_revisions (directive_id, revision, title, method, effective_date,
                                            calendar_days, fh_interval, prior_credit, document_key,
                                            ingested_at, ingested_by)
           VALUES (%s,1,%s,%s,%s,%s,%s,false,%s,%s,%s)""",
        (directive_id, fields["title"], fields["method"], fields["effective_date"],
         fields["calendar_days"], fields["fh_interval"], document_key, at, actor_id),
    )
    write_applicability(cursor, directive_id, 1, fields["applicability"])
    label = f"{fields['authority']} {fields['number']}"
    audit.write(cursor, at, actor_id, "directive.ingested", directive_id, None,
                f"{label} R1 ingested")

    added = []
    for tail in _affected_tails(cursor, fields["applicability"]):
        thread_id = _create_thread(cursor, directive_id, tail, 1, at)
        audit.write(cursor, at, actor_id, "thread.created", directive_id, thread_id,
                    f"{tail['registration']} entered effectivity under R1")
        added.append(thread_id)
    return directive_id, {
        "from": None,
        "to": "R1",
        "retargeted": [],
        "added": added,
        "removed": [],
        "kept": [],
    }


def _document_key(cursor, document_id):
    if not document_id:
        return None
    return cursor.value("SELECT key FROM documents WHERE id = %s", (document_id,))


def _create_thread(cursor, directive_id, tail, revision_number, at):
    thread_id = new_id("thr")
    cursor.execute(
        """INSERT INTO threads (id, directive_id, registration, work_card_id, stage, fh_baseline,
                                entered_at)
           VALUES (%s,%s,%s,%s,'open',%s,%s)""",
        (thread_id, directive_id, tail["registration"], _new_work_card(cursor),
         float(tail["total_hours"]), at),
    )
    cursor.execute(
        "INSERT INTO thread_history (thread_id, revision, entered_at) VALUES (%s,%s,%s)",
        (thread_id, revision_number, at),
    )
    return thread_id


def ingest_revision(cursor, actor_id, directive_id, fields, revision_number, prior_credit, at):
    directive = _lock_directive(cursor, directive_id)
    if directive["status"] == "withdrawn":
        raise ApiError("directive_withdrawn", f"{label_of(directive)} is withdrawn.")
    old_number = directive["current_revision"]
    if revision_number != old_number + 1:
        raise ApiError(
            "revision_out_of_order",
            f"This directive is now at {tag_of(old_number)}. Reload and try again.",
            current=tag_of(old_number),
        )
    old_tag, new_tag = tag_of(old_number), tag_of(revision_number)
    context_before = thread_rules.load_context(cursor)
    existing = {
        row["registration"]: row
        for row in thread_rules.thread_rows(cursor, directive_id=directive_id)
    }
    _store_snapshot(cursor, directive, list(existing.values()), context_before, at)

    cursor.execute(
        """INSERT INTO directive_revisions (directive_id, revision, title, method, effective_date,
                                            calendar_days, fh_interval, prior_credit, document_key,
                                            ingested_at, ingested_by)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (directive_id, revision_number, fields["title"], fields["method"],
         fields["effective_date"], fields["calendar_days"], fields["fh_interval"], prior_credit,
         _document_key(cursor, fields["document_id"]), at, actor_id),
    )
    write_applicability(cursor, directive_id, revision_number, fields["applicability"])
    cursor.execute(
        """UPDATE directive_revisions SET superseded_at = %s
            WHERE directive_id = %s AND revision = %s""",
        (at, directive_id, old_number),
    )
    cursor.execute(
        "UPDATE directives SET current_revision = %s WHERE id = %s",
        (revision_number, directive_id),
    )
    audit.write(cursor, at, actor_id, "directive.revision_ingested", directive_id, None,
                f"{label_of(directive)} {new_tag} supersedes {old_tag}")

    credit_cutoff = clock.day_start(fields["effective_date"])
    splice = {"from": old_tag, "to": new_tag, "retargeted": [], "added": [], "removed": [],
              "kept": []}
    tails = {
        row["registration"]: row
        for row in cursor.all(
            """SELECT registration, model_code, msn, total_hours FROM tails ORDER BY registration"""
        )
    }
    for registration, tail in tails.items():
        inside = in_effectivity(tail["model_code"], int(tail["msn"]), fields["applicability"])
        thread = existing.get(registration)
        if thread is None:
            if not inside:
                continue
            thread_id = _create_thread(cursor, directive_id, tail, revision_number, at)
            audit.write(cursor, at, actor_id, "thread.created", directive_id, thread_id,
                        f"{registration} entered effectivity under {new_tag}")
            splice["added"].append(thread_id)
            continue
        outcome = _retarget_one(
            cursor, actor_id, directive, thread, tail, inside, fields, revision_number,
            prior_credit, credit_cutoff, context_before, old_tag, new_tag, at
        )
        if outcome is not None:
            splice[outcome].append(thread["id"])
    return splice


def _retarget_one(cursor, actor_id, directive, thread, tail, inside, fields, revision_number,
                  prior_credit, credit_cutoff, context_before, old_tag, new_tag, at):
    thread_id = thread["id"]
    directive_id = directive["id"]
    registration = thread["registration"]
    stage = thread["stage"]
    kept = (
        inside
        and stage == "certified"
        and prior_credit
        and thread["certified_at"] is not None
        and thread["certified_at"] < credit_cutoff
    )
    if not inside:
        _freeze(cursor, thread, context_before, "removed", at)
        _append_live(cursor, thread_id, revision_number, at)
        if stage == "not_applicable":
            return None
        if thread["holder_id"]:
            notices.queue_card_revision(
                cursor, thread_id, thread["holder_id"], old_tag, new_tag,
                _new_limits(fields, float(tail["total_hours"])), True, at
            )
        cursor.execute(
            """UPDATE threads SET stage = 'not_applicable', holder_id = NULL, claimed_at = NULL,
                   certifier_id = NULL, certifier_status = NULL, deferred = false,
                   deferral_by = NULL, deferral_at = NULL, deferral_reason = NULL
                WHERE id = %s""",
            (thread_id,),
        )
        notices.withdraw_for_thread(cursor, thread_id,
                                    ("countersignature_request", "succession"))
        audit.write(cursor, at, actor_id, "thread.left_effectivity", directive_id, thread_id,
                    f"{registration} is not applicable under {new_tag}")
        return "removed"

    if kept:
        _freeze(cursor, thread, context_before, "kept", at)
        cursor.execute(
            "UPDATE threads SET pinned_revision = %s WHERE id = %s",
            (thread["pinned_revision"] or revision_number - 1, thread_id),
        )
        _append_live(cursor, thread_id, revision_number, at)
        return "kept"

    if stage == "not_applicable":
        _freeze(cursor, thread, context_before, "added", at)
        cursor.execute(
            """UPDATE threads SET stage = 'open', pinned_revision = NULL, fh_baseline = %s,
                   entered_at = %s, timeliness = NULL, certified_at = NULL, certified_hours = NULL
                WHERE id = %s""",
            (float(tail["total_hours"]), at, thread_id),
        )
        _append_live(cursor, thread_id, revision_number, at)
        audit.write(cursor, at, actor_id, "thread.entered_effectivity", directive_id, thread_id,
                    f"{registration} re-entered effectivity under {new_tag}")
        return "added"

    _freeze(cursor, thread, context_before, "retargeted", at)
    cursor.execute(
        """UPDATE threads SET stage = 'superseded_retargeted', pinned_revision = NULL,
               fh_baseline = %s, entered_at = %s, timeliness = NULL, certifier_id = NULL,
               certifier_status = NULL, deferred = false, deferral_by = NULL, deferral_at = NULL,
               deferral_reason = NULL, certified_at = NULL, certified_hours = NULL
            WHERE id = %s""",
        (float(tail["total_hours"]), at, thread_id),
    )
    cursor.execute(
        "UPDATE signatures SET status = 'superseded' WHERE thread_id = %s AND status = 'valid'",
        (thread_id,),
    )
    notices.withdraw_for_thread(cursor, thread_id, ("countersignature_request", "succession"))
    if thread["holder_id"]:
        notices.queue_card_revision(cursor, thread_id, thread["holder_id"], old_tag, new_tag,
                                    _new_limits(fields, float(tail["total_hours"])), False, at)
    _append_live(cursor, thread_id, revision_number, at)
    audit.write(cursor, at, actor_id, "thread.retargeted", directive_id, thread_id,
                f"{registration} retargeted to {new_tag}")
    return "retargeted"


def _new_limits(fields, baseline):
    return {
        "deadline_date": limit_rules.deadline_date(
            fields["effective_date"], fields["calendar_days"], False
        ).isoformat(),
        "fh_threshold": limit_rules.fh_threshold(baseline, fields["fh_interval"], False),
    }


def _freeze(cursor, thread, context_before, outcome, at):
    limits, wording, outcome = thread_rules.frozen_entry_fields(
        thread, context_before, outcome, at
    )
    cursor.execute(
        """UPDATE thread_history SET left_at = %s, limits = %s::jsonb, wording = %s::jsonb,
               outcome = %s
            WHERE thread_id = %s AND left_at IS NULL""",
        (at, json.dumps(limits), json.dumps(wording), outcome, thread["id"]),
    )


def _append_live(cursor, thread_id, revision_number, at):
    cursor.execute(
        """INSERT INTO thread_history (thread_id, revision, entered_at) VALUES (%s,%s,%s)
           ON CONFLICT (thread_id, revision) DO NOTHING""",
        (thread_id, revision_number, at),
    )


def _store_snapshot(cursor, directive, rows, context_before, at):
    """The read-only state of every thread of the lineage at the moment before the
    new revision."""
    number = directive["current_revision"]
    current = directive["revisions"][number]
    counts = limit_rules.empty_counts()
    cells = []
    for row in rows:
        built = thread_rules.cell(row, context_before, at)
        cells.append(built)
        limit_rules.count_cell(counts, built)
    data = {
        "directive": {
            "id": directive["id"],
            "authority": directive["authority"],
            "number": directive["number"],
            "title": current["title"],
            "revision": tag_of(number),
            "status": directive["status"],
            "prior_revisions": [tag_of(other) for other in sorted(directive["revisions"])
                                if other != number],
            "counts": counts,
        },
        "cells": cells,
        "totals": counts,
        "threads": {
            row["id"]: thread_rules.thread_shape(cursor, row, context_before, at) for row in rows
        },
    }
    cursor.execute(
        """INSERT INTO snapshots (directive_id, revision, taken_at, data)
           VALUES (%s,%s,%s,%s::jsonb)
           ON CONFLICT (directive_id, revision) DO NOTHING""",
        (directive["id"], number, at, json.dumps(data)),
    )


def read_snapshot(cursor, directive_id, tag):
    number = None
    if isinstance(tag, str) and tag.upper().startswith("R") and tag[1:].isdigit():
        number = int(tag[1:])
    row = cursor.one(
        "SELECT data, taken_at FROM snapshots WHERE directive_id = %s AND revision = %s",
        (directive_id, number),
    )
    if row is None:
        raise ApiError("not_found", "No snapshot stands under that revision tag.")
    data = row["data"]
    if isinstance(data, str):
        data = json.loads(data)
    return data


def withdraw(cursor, actor_id, directive_id, reason, at):
    directive = _lock_directive(cursor, directive_id)
    if directive["status"] == "withdrawn":
        raise ApiError("directive_withdrawn", f"{label_of(directive)} is withdrawn.")
    cursor.execute(
        "UPDATE directives SET status = 'withdrawn', withdrawn_reason = %s, withdrawn_at = %s"
        " WHERE id = %s",
        (reason, at, directive_id),
    )
    audit.write(cursor, at, actor_id, "directive.withdrawn", directive_id, None, reason)
    for row in thread_rules.thread_rows(cursor, directive_id=directive_id):
        if row["stage"] == "withdrawn":
            continue
        cursor.execute(
            """UPDATE threads SET stage = 'withdrawn', holder_id = NULL, claimed_at = NULL,
                   certifier_id = NULL, certifier_status = NULL WHERE id = %s""",
            (row["id"],),
        )
        audit.write(cursor, at, actor_id, "thread.withdrawn", directive_id, row["id"],
                    f"{row['registration']} withdrawn with the directive")
    notices.withdraw_for_directive(cursor, directive_id)
    return load_directive(cursor, directive_id)
