"""Legacy spreadsheet import: one normalisation, one matching rule, one ledger."""

import csv
import datetime
import hashlib
import io
import json

from .. import clock
from ..errors import validation
from ..ids import new_id
from . import audit
from . import people as people_rules
from .directives import in_effectivity, normalise_number, numbers_match, tag_of

REQUIRED_COLUMNS = (
    "tail", "directive", "revision", "status", "inspector", "inspector_licence",
    "inspected_on", "certifier", "certifier_licence", "certified_on", "notes",
)
MAX_ROWS = 2000
DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y")


def normalise_tail(value):
    return "".join(value.split()).upper().replace("-", "")


def normalise_revision(value):
    text = "".join(value.split()).upper()
    if text.startswith("REV"):
        text = text[3:]
    elif text.startswith("R"):
        text = text[1:]
    if text in ("ORIG", "ORIGINAL"):
        return 1
    if text.isdigit() and int(text) >= 1:
        return int(text)
    return None


def _parse_date(value):
    for layout in DATE_FORMATS:
        try:
            return datetime.datetime.strptime(value, layout).date(), True
        except ValueError:
            continue
    return None, False


def _reject_reason(row):
    """Rejection is decided before matching, in the published field order."""
    status = (row.get("status") or "").strip().lower()
    if status not in ("complied", "open"):
        return "status", "must be complied or open"
    if normalise_revision((row.get("revision") or "").strip()) is None:
        return "revision", "must be ORIG or a whole number of 1 or more"
    dates = {}
    for column in ("inspected_on", "certified_on"):
        raw = (row.get(column) or "").strip()
        if raw:
            parsed, ok = _parse_date(raw)
            if not ok:
                return column, "must be YYYY-MM-DD or DD/MM/YYYY"
            dates[column] = parsed
        else:
            dates[column] = None
    if status == "complied":
        for column in ("inspected_on", "certified_on"):
            if dates[column] is None:
                return column, "is required on a complied row"
    if len(row.get("notes") or "") > 1000:
        return "notes", "must be 1,000 characters or fewer"
    return None, None


def run(cursor, user, body, at):
    digest = hashlib.sha256(body).hexdigest()
    earlier = cursor.one("SELECT id, result FROM imports WHERE file_sha256 = %s", (digest,))
    if earlier:
        result = earlier["result"]
        result["replayed_file"] = True
        return result, 200, []

    text = body.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader)
    except StopIteration:
        raise validation({"file": "must hold a header row"})
    index = {name.strip().lower(): position for position, name in enumerate(header)}
    missing = [column for column in REQUIRED_COLUMNS if column not in index]
    if missing:
        raise validation({"file": f"is missing the column {missing[0]}"})
    data_rows = [row for row in reader if any((cell or "").strip() for cell in row)]
    if len(data_rows) > MAX_ROWS:
        raise validation({"file": f"must hold no more than {MAX_ROWS} data rows"})

    import_id = new_id("imp")
    result = {
        "import_id": import_id,
        "file_sha256": digest,
        "rows": len(data_rows),
        "merged": 0,
        "duplicates": 0,
        "closed": 0,
        "orphans": [],
        "rejected": [],
        "replayed_file": False,
    }
    context = _match_context(cursor)
    seen = set()
    touched = []
    for number, raw in enumerate(data_rows, start=1):
        # fields are stored exactly as they arrive; only matching fields are normalised
        row = {
            column: (raw[position] if position < len(raw) else "")
            for column, position in index.items()
        }
        field, message = _reject_reason(row)
        if field:
            result["rejected"].append({"row": number, "field": field, "message": message})
            continue
        _handle_row(cursor, user, row, number, result, context, seen, touched, import_id, at)

    cursor.execute(
        """INSERT INTO imports (id, file_sha256, result, created_by, created_at)
           VALUES (%s,%s,%s::jsonb,%s,%s)""",
        (import_id, digest, json.dumps(result), user["id"], at),
    )
    audit.write(
        cursor, at, user["id"], "import.merged", None, None,
        f"{result['merged']} merged, {result['duplicates']} duplicates, "
        f"{len(result['orphans'])} orphans, {len(result['rejected'])} rejected",
    )
    return result, 201, touched


def _match_context(cursor):
    tails = cursor.all("SELECT registration, model_code, msn, total_hours FROM tails")
    directives = cursor.all(
        "SELECT id, authority, number, current_revision FROM directives"
    )
    applicability = {}
    for row in cursor.all(
        "SELECT directive_id, revision, model_code, msn_from, msn_to FROM revision_applicability"
    ):
        applicability.setdefault((row["directive_id"], row["revision"]), []).append(
            {"model": row["model_code"], "msn_from": int(row["msn_from"]),
             "msn_to": int(row["msn_to"])}
        )
    return {
        "tails": {normalise_tail(row["registration"]): row for row in tails},
        "directives": [
            {**row, "normalised": normalise_number(row["number"])} for row in directives
        ],
        "applicability": applicability,
    }


def _handle_row(cursor, user, row, number, result, context, seen, touched, import_id, at):
    tail = context["tails"].get(normalise_tail(row["tail"]))
    directive = None
    normalised_directive = normalise_number(row["directive"])
    for candidate in context["directives"]:
        if numbers_match(candidate["normalised"], normalised_directive):
            directive = candidate
            break
    revision = normalise_revision(row["revision"])

    def orphan(reason):
        result["orphans"].append(
            {
                "row": number,
                "tail": row["tail"],
                "directive": row["directive"],
                "revision": tag_of(revision),
                "reason": reason,
            }
        )

    if tail is None:
        return orphan("unknown_tail")
    if directive is None:
        return orphan("unknown_directive")
    if revision > directive["current_revision"]:
        return orphan("unknown_revision")
    thread = cursor.one(
        "SELECT * FROM threads WHERE directive_id = %s AND registration = %s",
        (directive["id"], tail["registration"]),
    )
    ranges = context["applicability"].get((directive["id"], revision), [])
    if thread is None or not in_effectivity(tail["model_code"], int(tail["msn"]), ranges):
        return orphan("not_in_effectivity")

    status = row["status"].strip().lower()
    inspected_on = _parse_date(row["inspected_on"].strip())[0] if row["inspected_on"].strip() \
        else None
    certified_on = _parse_date(row["certified_on"].strip())[0] if row["certified_on"].strip() \
        else None
    key = "|".join(
        [
            thread["id"], str(revision), status,
            inspected_on.isoformat() if inspected_on else "",
            certified_on.isoformat() if certified_on else "",
        ]
    )
    if key in seen or cursor.value(
        "SELECT 1 FROM legacy_records WHERE row_key = %s", (key,)
    ):
        result["duplicates"] += 1
        return None
    seen.add(key)

    inspector = _signer_text(cursor, row["inspector"], row["inspector_licence"])
    certifier = _signer_text(cursor, row["certifier"], row["certifier_licence"])
    cursor.execute(
        """INSERT INTO legacy_records (id, thread_id, revision, row_key, status, inspector,
                                       inspector_licence, inspected_on, certifier,
                                       certifier_licence, certified_on, notes, import_id,
                                       created_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (new_id("lgr"), thread["id"], revision, key, status, inspector["name"],
         inspector["licence"], inspected_on, certifier["name"], certifier["licence"],
         certified_on, row["notes"], import_id, at),
    )
    result["merged"] += 1
    if _close_from_legacy(cursor, user, thread, directive, revision, status, inspector, certifier,
                          certified_on, tail, at):
        result["closed"] += 1
        touched.append(thread["id"])
    return None


def _signer_text(cursor, name, licence):
    """A legacy signer named by an erased contractor reads as their signer token."""
    token = people_rules.erased_token_for(cursor, name) or people_rules.erased_token_for(
        cursor, licence
    )
    if token:
        return {"name": token, "licence": None}
    return {"name": name or None, "licence": licence or None}


def _close_from_legacy(cursor, user, thread, directive, revision, status, inspector, certifier,
                       certified_on, tail, at):
    """A merged complied row for the current revision closes an untouched open thread."""
    if status != "complied" or revision != directive["current_revision"]:
        return False
    if thread["stage"] != "open" or thread["holder_id"] is not None:
        return False
    if cursor.value("SELECT 1 FROM signatures WHERE thread_id = %s", (thread["id"],)):
        return False
    closed_at = clock.day_end(certified_on)
    for kind, signer in (("inspection", inspector), ("countersignature", certifier)):
        cursor.execute(
            """INSERT INTO signatures (id, thread_id, kind, signer_id, signer_text, revision,
                                       committed_at, status)
               VALUES (%s,%s,'legacy',NULL,%s,%s,%s,'valid')""",
            (new_id("sig"), thread["id"], signer["name"] or f"legacy {kind}", revision, closed_at),
        )
    cursor.execute(
        """UPDATE threads SET stage = 'certified', certified_at = %s, certified_hours = %s
            WHERE id = %s""",
        (closed_at, float(tail["total_hours"]), thread["id"]),
    )
    audit.write(cursor, at, user["id"], "thread.closed_from_legacy", directive["id"],
                thread["id"], f"Closed from a legacy record under {tag_of(revision)}")
    return True


def listed(cursor):
    rows = cursor.all("SELECT result FROM imports ORDER BY created_at DESC, id DESC")
    return [row["result"] for row in rows]
