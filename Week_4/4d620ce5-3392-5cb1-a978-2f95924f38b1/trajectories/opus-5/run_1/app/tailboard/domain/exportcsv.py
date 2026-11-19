"""The regulator CSV export and the pack's CSV manifest: one set of rows, one
neutralisation rule."""

import csv
import io

from .. import clock
from . import limits as limit_rules
from . import people as people_rules
from . import threads as thread_rules
from .directives import tag_of

COLUMNS = [
    "registration", "model", "msn", "directive", "revision", "title", "state",
    "governing_revision", "deadline_date", "fh_threshold", "governing", "inspector",
    "inspector_licence", "inspected_at", "certifier", "certifier_licence", "certified_at",
    "timeliness", "legacy_notes",
]
RISKY_FIRST_CHARACTERS = ("=", "+", "-", "@", "\t", "\r")


def neutralise(value):
    """Every cell a spreadsheet could read as a formula is written with a leading
    apostrophe."""
    text = "" if value is None else str(value)
    if text[:1] in RISKY_FIRST_CHARACTERS:
        return "'" + text
    return text


def rows_for(cursor, directive_id):
    context = thread_rules.load_context(cursor)
    directive = context["directives"][directive_id]
    people = context["people"]
    at = clock.now()
    rows = []
    for thread_row in thread_rules.thread_rows(cursor, directive_id=directive_id):
        governing_number = thread_rules.governing_revision_number(thread_row, directive)
        revision = directive["revisions"][governing_number]
        evaluation = thread_rules.evaluate(thread_row, context, at)
        tail = context["tails"][thread_row["registration"]]
        stub = thread_row["stage"] in limit_rules.STUB_STAGES
        legacy = cursor.all(
            "SELECT * FROM legacy_records WHERE thread_id = %s ORDER BY created_at, id",
            (thread_row["id"],),
        )
        inspection = _signed_by(cursor, thread_row["id"], "inspection", people, legacy)
        countersignature = _signed_by(
            cursor, thread_row["id"], "countersignature", people, legacy
        )
        rows.append(
            {
                "registration": thread_row["registration"],
                "model": tail["model_code"],
                "msn": int(tail["msn"]),
                "directive": f"{directive['authority']} {directive['number']}",
                "revision": tag_of(directive["current_revision"]),
                "title": revision["title"],
                "state": limit_rules.state_for(thread_row["stage"], evaluation["overdue"]),
                "governing_revision": tag_of(governing_number),
                "deadline_date": evaluation["limits"]["deadline_date"],
                "fh_threshold": f"{evaluation['limits']['fh_threshold']:.1f}",
                "governing": "" if stub else evaluation["governing"],
                "inspector": inspection["name"],
                "inspector_licence": inspection["licence"],
                "inspected_at": inspection["at"],
                "certifier": countersignature["name"],
                "certifier_licence": countersignature["licence"],
                "certified_at": countersignature["at"],
                "timeliness": thread_row["timeliness"] or "",
                "legacy_notes": "; ".join(row["notes"] or "" for row in legacy),
            }
        )
    return directive, rows


def _signed_by(cursor, thread_id, kind, people, legacy):
    row = cursor.one(
        """SELECT * FROM signatures WHERE thread_id = %s AND kind = %s AND status <> 'void'
            ORDER BY seq DESC LIMIT 1""",
        (thread_id, kind),
    )
    if row is not None:
        person = people_rules.person(people[row["signer_id"]])
        return {
            "name": person["display_name"],
            "licence": person["licence"] or "",
            "at": clock.iso(row["committed_at"]),
        }
    column = "inspector" if kind == "inspection" else "certifier"
    date_column = "inspected_on" if kind == "inspection" else "certified_on"
    for record in reversed(legacy):
        if record[column]:
            return {
                "name": record[column],
                "licence": record[f"{column}_licence"] or "",
                "at": record[date_column].isoformat() if record[date_column] else "",
            }
    return {"name": "", "licence": "", "at": ""}


def render(cursor, directive_id):
    """UTF-8 with CRLF line ends, quoted as RFC 4180 requires."""
    _directive, rows = rows_for(cursor, directive_id)
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    writer.writerow(COLUMNS)
    for row in rows:
        writer.writerow([neutralise(row[column]) for column in COLUMNS])
    return buffer.getvalue().encode("utf-8")
