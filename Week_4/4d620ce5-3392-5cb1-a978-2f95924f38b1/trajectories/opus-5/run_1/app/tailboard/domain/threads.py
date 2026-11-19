"""Reading threads, cells and the fleet board. Every board value comes from here."""

from .. import clock
from ..errors import ApiError
from . import limits as limit_rules
from . import people as people_rules
from .directives import directive_shape, load_directives, tag_of


def load_context(cursor):
    directives = load_directives(cursor)
    tails = {
        row["registration"]: row
        for row in cursor.all(
            """SELECT registration, model_code, msn, seed_hours, total_hours, daily_utilisation
                 FROM tails ORDER BY registration"""
        )
    }
    logs = {registration: [] for registration in tails}
    for row in cursor.all(
        "SELECT registration, logged_at, running_total FROM flight_hour_logs ORDER BY logged_at, id"
    ):
        logs[row["registration"]].append((row["logged_at"], float(row["running_total"])))
    return {
        "people": people_rules.load_people(cursor),
        "directives": directives,
        "tails": tails,
        "logs": logs,
    }


def tail_shape(row):
    return {
        "registration": row["registration"],
        "model": row["model_code"],
        "msn": int(row["msn"]),
        "total_hours": float(row["total_hours"]),
        "daily_utilisation": float(row["daily_utilisation"]),
    }


def governing_revision_number(thread_row, directive):
    return thread_row["pinned_revision"] or directive["current_revision"]


def evaluate(thread_row, context, at=None):
    directive = context["directives"][thread_row["directive_id"]]
    revision = directive["revisions"][governing_revision_number(thread_row, directive)]
    tail = context["tails"][thread_row["registration"]]
    return limit_rules.evaluate(
        thread_row, revision, tail, context["logs"][thread_row["registration"]], at or clock.now()
    )


def cell(thread_row, context, at=None):
    directive = context["directives"][thread_row["directive_id"]]
    evaluation = evaluate(thread_row, context, at)
    stage = thread_row["stage"]
    stub = stage in limit_rules.STUB_STAGES
    label = limit_rules.label_for(stage, evaluation["overdue"], evaluation["due_soon"])
    return {
        "thread_id": thread_row["id"],
        "registration": thread_row["registration"],
        "directive_id": thread_row["directive_id"],
        "state": limit_rules.state_for(stage, evaluation["overdue"]),
        "stage": stage,
        "label": label,
        "revision": tag_of(directive["current_revision"]),
        "pinned_revision": tag_of(thread_row["pinned_revision"]),
        "governing": None if stub else evaluation["governing"],
        "calendar_used": 0.0 if stub else evaluation["calendar_used"],
        "hours_used": 0.0 if stub else evaluation["hours_used"],
        "due_at": None if stub else evaluation["limits"]["due_at"],
    }


def thread_rows(cursor, directive_id=None, registration=None, thread_id=None):
    return cursor.all(
        """SELECT * FROM threads
            WHERE (%s::text IS NULL OR directive_id = %s)
              AND (%s::text IS NULL OR registration = %s)
              AND (%s::text IS NULL OR id = %s)
            ORDER BY registration""",
        (directive_id, directive_id, registration, registration, thread_id, thread_id),
    )


def board(cursor, directive_id=None):
    context = load_context(cursor)
    rows = thread_rows(cursor, directive_id=directive_id)
    at = clock.now()
    cells = []
    per_directive = {key: limit_rules.empty_counts() for key in context["directives"]}
    for row in rows:
        built = cell(row, context, at)
        cells.append(built)
        limit_rules.count_cell(per_directive[row["directive_id"]], built)
    totals = limit_rules.empty_counts()
    listed = []
    for directive in context["directives"].values():
        if directive_id and directive["id"] != directive_id:
            continue
        counts = per_directive[directive["id"]]
        limit_rules.add_counts(totals, counts)
        current = directive["revisions"][directive["current_revision"]]
        listed.append(
            {
                "id": directive["id"],
                "authority": directive["authority"],
                "number": directive["number"],
                "title": current["title"],
                "revision": tag_of(directive["current_revision"]),
                "status": directive["status"],
                "prior_revisions": [
                    tag_of(number)
                    for number in sorted(directive["revisions"])
                    if number != directive["current_revision"]
                ],
                "counts": counts,
            }
        )
    return {
        "generated_at": clock.iso(at),
        "as_of": None,
        "directives": listed,
        "tails": [tail_shape(row) for row in context["tails"].values()],
        "cells": cells,
        "totals": totals,
    }


def signature_shape(row, people):
    return {
        "id": row["id"],
        "kind": row["kind"],
        "signer": people_rules.person(people.get(row["signer_id"])) if row["signer_id"] else None,
        "signer_text": (
            row["signer_text"]
            if row["signer_id"] is None
            else people_rules.display_name(people[row["signer_id"]])
        ),
        "revision": tag_of(row["revision"]),
        "committed_at": clock.iso(row["committed_at"]),
        "timeliness": row["timeliness"],
        "method_ref": row["method_ref"],
        "findings": row["findings"],
        "status": row["status"],
        "void_reason": row["void_reason"],
    }


def evidence_shape(row, people):
    return {
        "id": row["id"],
        "key": row["key"],
        "sha256": row["sha256"],
        "content_type": row["content_type"],
        "bytes": int(row["bytes"]),
        "attached_by": people_rules.person(people.get(row["attached_by"])),
        "attached_at": clock.iso(row["attached_at"]),
    }


def legacy_shape(row):
    return {
        "id": row["id"],
        "revision": tag_of(row["revision"]),
        "status": row["status"],
        "inspector": row["inspector"],
        "inspector_licence": row["inspector_licence"],
        "inspected_on": row["inspected_on"].isoformat() if row["inspected_on"] else None,
        "certifier": row["certifier"],
        "certifier_licence": row["certifier_licence"],
        "certified_on": row["certified_on"].isoformat() if row["certified_on"] else None,
        "notes": row["notes"],
    }


def load_thread_row(cursor, thread_id):
    row = cursor.one("SELECT * FROM threads WHERE id = %s", (thread_id,))
    if row is None:
        raise ApiError("not_found", "No such thread.")
    return row


def thread_shape(cursor, thread_row, context=None, at=None):
    context = context or load_context(cursor)
    people = context["people"]
    directive = context["directives"][thread_row["directive_id"]]
    governing_number = governing_revision_number(thread_row, directive)
    revision = directive["revisions"][governing_number]
    tail = context["tails"][thread_row["registration"]]
    evaluation = evaluate(thread_row, context, at)
    stage = thread_row["stage"]
    stub = stage in limit_rules.STUB_STAGES

    signatures = cursor.all(
        "SELECT * FROM signatures WHERE thread_id = %s ORDER BY seq", (thread_row["id"],)
    )
    evidence = cursor.all(
        "SELECT * FROM evidence WHERE thread_id = %s ORDER BY seq", (thread_row["id"],)
    )
    legacy = cursor.all(
        "SELECT * FROM legacy_records WHERE thread_id = %s ORDER BY created_at, id",
        (thread_row["id"],),
    )
    history = _history(cursor, thread_row, directive, evaluation, revision, legacy)

    return {
        "id": thread_row["id"],
        "registration": thread_row["registration"],
        "model": tail["model_code"],
        "msn": int(tail["msn"]),
        "directive_id": directive["id"],
        "directive": f"{directive['authority']} {directive['number']}",
        "state": limit_rules.state_for(stage, evaluation["overdue"]),
        "stage": stage,
        "label": limit_rules.label_for(stage, evaluation["overdue"], evaluation["due_soon"]),
        "revision": tag_of(directive["current_revision"]),
        "pinned_revision": tag_of(thread_row["pinned_revision"]),
        "governing_revision": tag_of(governing_number),
        "governing": None if stub else evaluation["governing"],
        "wording": {"title": revision["title"], "method": revision["method"]},
        "limits": evaluation["limits"],
        "timeliness": thread_row["timeliness"],
        "work_card": {
            "id": thread_row["work_card_id"],
            "holder": people_rules.person(people.get(thread_row["holder_id"])),
            "claimed_at": clock.iso(thread_row["claimed_at"]),
        },
        "evidence": [evidence_shape(row, people) for row in evidence],
        "signatures": [signature_shape(row, people) for row in signatures],
        "certifier": {
            "assigned": people_rules.person(people.get(thread_row["certifier_id"])),
            "status": thread_row["certifier_status"],
        },
        "deferral": (
            {
                "granted_by": people_rules.person(people.get(thread_row["deferral_by"])),
                "granted_at": clock.iso(thread_row["deferral_at"]),
                "reason": thread_row["deferral_reason"],
            }
            if thread_row["deferred"]
            else None
        ),
        "history": history,
        "legacy_records": [legacy_shape(row) for row in legacy],
    }


def _history(cursor, thread_row, directive, evaluation, revision, legacy):
    rows = cursor.all(
        "SELECT * FROM thread_history WHERE thread_id = %s ORDER BY revision",
        (thread_row["id"],),
    )
    entries = []
    for row in rows:
        live = row["revision"] == directive["current_revision"]
        entries.append(
            {
                "revision": tag_of(row["revision"]),
                "entered_at": clock.iso(row["entered_at"]),
                "left_at": clock.iso(row["left_at"]),
                "limits": evaluation["limits"] if live else row["limits"],
                "wording": (
                    {"title": revision["title"], "method": revision["method"]}
                    if live
                    else row["wording"]
                ),
                "outcome": "current" if live else row["outcome"],
                "legacy_records": [
                    legacy_shape(record)
                    for record in legacy
                    if record["revision"] == row["revision"]
                ],
            }
        )
    return entries


def frozen_entry_fields(thread_row, context, outcome, at):
    """The limits, wording and outcome a revision's entry keeps for good."""
    directive = context["directives"][thread_row["directive_id"]]
    revision = directive["revisions"][governing_revision_number(thread_row, directive)]
    evaluation = evaluate(thread_row, context, at)
    return (
        evaluation["limits"],
        {"title": revision["title"], "method": revision["method"]},
        outcome,
    )


def directive_list(cursor):
    context = load_context(cursor)
    return [
        directive_shape(directive, context["people"])
        for directive in context["directives"].values()
    ]
