"""Field validation. Every 422 in the API is built from these checks."""

import datetime
import re

from .. import clock
from ..errors import validation
from ..seed import AUTHORITIES, MODEL_CODES

NUMBER_FORMATS = {
    "EASA": re.compile(r"^\d{4}-\d{4}$"),
    "UK CAA": re.compile(r"^G-\d{4}-\d{4}$"),
    "ATR": re.compile(r"^ATR72-\d{2}-\d{4}$"),
    "De Havilland": re.compile(r"^84-\d{2}-\d{4}$"),
    "Embraer": re.compile(r"^E170-\d{2}-\d{4}$"),
}
NUMBER_HINTS = {
    "EASA": "must look like YYYY-NNNN",
    "UK CAA": "must look like G-YYYY-NNNN",
    "ATR": "must look like ATR72-CC-NNNN",
    "De Havilland": "must look like 84-CC-NNNN",
    "Embraer": "must look like E170-CC-NNNN",
}


class Fields:
    def __init__(self):
        self.errors = {}

    def add(self, name, message):
        self.errors.setdefault(name, message)

    def raise_if_any(self):
        if self.errors:
            raise validation(self.errors)


def text(fields, body, name, minimum, maximum, label=None):
    value = body.get(name)
    if not isinstance(value, str) or not minimum <= len(value) <= maximum:
        fields.add(name, f"{label or name} must be {minimum} to {maximum} characters")
        return None
    return value


def reason(body, name="reason"):
    fields = Fields()
    value = text(fields, body, name, 1, 500)
    fields.raise_if_any()
    return value


def one_decimal(value):
    return round(float(value), 1) == float(value)


def _integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def hours(body, name="hours"):
    fields = Fields()
    value = body.get(name)
    if not _number(value) or not 0.1 <= float(value) <= 24.0 or not one_decimal(value):
        fields.add(name, "must be 0.1 to 24.0 hours with at most one decimal")
    fields.raise_if_any()
    return round(float(value), 1)


def applicability(fields, body):
    ranges = body.get("applicability")
    if not isinstance(ranges, list) or not 1 <= len(ranges) <= 20:
        fields.add("applicability", "must hold 1 to 20 model and serial ranges")
        return []
    cleaned = []
    for entry in ranges:
        if not isinstance(entry, dict) or entry.get("model") not in MODEL_CODES:
            fields.add("applicability", "each range needs a known model code")
            return []
        first, last = entry.get("msn_from"), entry.get("msn_to")
        if not _integer(first) or not _integer(last) or first > last:
            fields.add(
                "applicability", "each range needs whole serials, first no greater than last"
            )
            return []
        cleaned.append({"model": entry["model"], "msn_from": first, "msn_to": last})
    return cleaned


def revision_body(body, with_identity, documents_exist):
    """The shared ingest fields of a directive and of a revision."""
    fields = Fields()
    authority = None
    number = None
    if with_identity:
        authority = body.get("authority")
        if authority not in AUTHORITIES:
            fields.add("authority", "must be one of the five issuing authorities")
        number = body.get("number")
        if not isinstance(number, str):
            fields.add("number", "is required")
        elif authority in NUMBER_FORMATS and not NUMBER_FORMATS[authority].match(number):
            fields.add("number", NUMBER_HINTS[authority])

    title = text(fields, body, "title", 1, 200, "Title")
    method = text(fields, body, "method", 1, 4000, "Method of compliance")

    effective_date = None
    raw_date = body.get("effective_date")
    try:
        effective_date = datetime.date.fromisoformat(str(raw_date))
        if effective_date > clock.today():
            fields.add("effective_date", "must not be later than today")
            effective_date = None
    except (TypeError, ValueError):
        fields.add("effective_date", "must be a real date as YYYY-MM-DD")

    calendar_days = body.get("calendar_days")
    if not _integer(calendar_days) or not 1 <= calendar_days <= 3650:
        fields.add("calendar_days", "must be a whole number of 1 to 3,650 days")

    fh_interval = body.get("fh_interval")
    if not _number(fh_interval) or not 0.1 <= float(fh_interval) <= 100000.0 or not one_decimal(
        fh_interval
    ):
        fields.add("fh_interval", "must be 0.1 to 100,000.0 with at most one decimal")

    ranges = applicability(fields, body)

    document_id = body.get("document_id")
    if document_id is not None and not isinstance(document_id, str):
        fields.add("document_id", "must name a stored document")
    elif isinstance(document_id, str) and not documents_exist(document_id):
        fields.add("document_id", "must name a stored document")

    fields.raise_if_any()
    return {
        "authority": authority,
        "number": number,
        "title": title,
        "method": method,
        "effective_date": effective_date,
        "calendar_days": calendar_days,
        "fh_interval": round(float(fh_interval), 1),
        "applicability": ranges,
        "document_id": document_id,
    }


def inspection_body(body, attached_ids):
    fields = Fields()
    method_ref = text(fields, body, "method_ref", 1, 200, "Method reference")
    findings = text(fields, body, "findings", 1, 4000, "Findings")
    evidence_ids = body.get("evidence_ids")
    if (
        not isinstance(evidence_ids, list)
        or not evidence_ids
        or any(item not in attached_ids for item in evidence_ids)
    ):
        fields.add("evidence_ids", "must list evidence attached to this thread")
    fields.raise_if_any()
    return method_ref, findings, evidence_ids


def search_query(value):
    if not isinstance(value, str) or not 2 <= len(value) <= 100:
        raise validation({"q": "must be 2 to 100 characters"})
    return value
