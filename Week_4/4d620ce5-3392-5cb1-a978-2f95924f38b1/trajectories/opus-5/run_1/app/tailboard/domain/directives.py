"""Directives, revisions and effectivity."""

import re

from .. import clock
from ..errors import ApiError
from ..seed import AUTHORITIES
from . import people as people_rules

AUTHORITY_ORDER = {name: index for index, name in enumerate(AUTHORITIES)}


def tag_of(revision_number):
    return None if revision_number is None else f"R{revision_number}"


def revision_number_of(tag):
    """Accepts a tag such as "R2" or a plain revision number."""
    if isinstance(tag, int) and not isinstance(tag, bool):
        return tag
    if isinstance(tag, str):
        text = tag.strip().upper()
        if text.startswith("R"):
            text = text[1:]
        if text.isdigit():
            return int(text)
    return None


def normalise_number(number):
    """The published normalised form of a directive number, used by search and import."""
    text = number.upper().strip()
    text = re.sub(r"^(EASA|CAA|AD|SB)[ -]", "", text)
    while True:
        stripped = re.sub(r"^(EASA|CAA|AD|SB)[ -]", "", text)
        if stripped == text:
            break
        text = stripped
    return re.sub(r"[ /._]+", "-", text)


def numbers_match(left, right):
    """Two normalised numbers match segment by segment, as text or as integers."""
    left_parts = left.split("-")
    right_parts = right.split("-")
    if len(left_parts) != len(right_parts):
        return False
    for one, other in zip(left_parts, right_parts):
        if one == other:
            continue
        if one.isdigit() and other.isdigit() and int(one) == int(other):
            continue
        return False
    return True


def load_directives(cursor):
    directives = {}
    for row in cursor.all(
        """SELECT id, authority, number, current_revision, status, withdrawn_reason,
                  withdrawn_at, created_at, rail_order
             FROM directives"""
    ):
        row["revisions"] = {}
        directives[row["id"]] = row
    for row in cursor.all(
        """SELECT directive_id, revision, title, method, effective_date, calendar_days,
                  fh_interval, prior_credit, document_key, ingested_at, ingested_by, superseded_at
             FROM directive_revisions ORDER BY directive_id, revision"""
    ):
        row["applicability"] = []
        directives[row["directive_id"]]["revisions"][row["revision"]] = row
    for row in cursor.all(
        """SELECT directive_id, revision, model_code, msn_from, msn_to
             FROM revision_applicability ORDER BY directive_id, revision, idx"""
    ):
        directives[row["directive_id"]]["revisions"][row["revision"]]["applicability"].append(
            {"model": row["model_code"], "msn_from": int(row["msn_from"]),
             "msn_to": int(row["msn_to"])}
        )
    ordered = sorted(
        directives.values(),
        key=lambda row: (AUTHORITY_ORDER[row["authority"]], row["rail_order"], row["number"]),
    )
    return {row["id"]: row for row in ordered}


def load_directive(cursor, directive_id):
    directives = load_directives(cursor)
    if directive_id not in directives:
        raise ApiError("not_found", "No such directive.")
    return directives[directive_id]


def revision_shape(row, people):
    return {
        "revision": row["revision"],
        "title": row["title"],
        "method": row["method"],
        "effective_date": row["effective_date"].isoformat(),
        "calendar_days": row["calendar_days"],
        "fh_interval": float(row["fh_interval"]),
        "applicability": row["applicability"],
        "prior_credit": bool(row["prior_credit"]),
        "document_key": row["document_key"],
        "ingested_at": clock.iso(row["ingested_at"]),
        "ingested_by": people_rules.person(people.get(row["ingested_by"])),
    }


def directive_shape(directive, people):
    current = directive["revisions"][directive["current_revision"]]
    return {
        "id": directive["id"],
        "authority": directive["authority"],
        "number": directive["number"],
        "title": current["title"],
        "revision": tag_of(directive["current_revision"]),
        "status": directive["status"],
        "revisions": [
            revision_shape(directive["revisions"][number], people)
            for number in sorted(directive["revisions"])
        ],
    }


def label_of(directive):
    return f"{directive['authority']} {directive['number']}"


def in_effectivity(model_code, msn, ranges):
    """A tail is in effectivity when its model matches and its MSN lies in a range,
    both ends inclusive."""
    return any(
        entry["model"] == model_code and entry["msn_from"] <= msn <= entry["msn_to"]
        for entry in ranges
    )


def write_applicability(cursor, directive_id, revision, ranges):
    for idx, entry in enumerate(ranges):
        cursor.execute(
            """INSERT INTO revision_applicability (directive_id, revision, idx, model_code,
                                                   msn_from, msn_to)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            (directive_id, revision, idx, entry["model"], entry["msn_from"], entry["msn_to"]),
        )
