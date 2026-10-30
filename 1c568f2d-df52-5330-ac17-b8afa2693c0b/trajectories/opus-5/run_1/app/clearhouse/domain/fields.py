"""Field rules. Every value a browser can send is measured here."""
from .. import timeutil
from ..db import row
from ..errors import Refusal
from . import states

TITLE_MESSAGE = "A title of 1 to 80 characters is required"
SUMMARY_MESSAGE = "A summary of 20 to 600 characters is required"
FEE_MESSAGE = "A fee must be between $0.00 and $5,000.00"
REASON_MESSAGE = "A reason of 10 to 400 characters is required"
DAY_MESSAGE = "Use a day written as YYYY-MM-DD"
PAST_DAY_MESSAGE = "Pick today or a later date"
KIND_MESSAGE = "Kind must be licence or accessibility"
RESULT_MESSAGE = "Result must be pass or fail"
MAX_OBJECTS = 40


def title(conn, value, piece_id=None):
    text = value.strip() if isinstance(value, str) else ""
    if not 1 <= len(text) <= 80:
        raise Refusal(400, TITLE_MESSAGE, field="title")
    clash = row(
        conn,
        "select title from pieces where lower(title) = lower(%s)"
        " and state <> 'rejected' and (%s::bigint is null or id <> %s::bigint)",
        (text, piece_id, piece_id),
    )
    if clash:
        raise Refusal(
            400, "A piece named {} already exists".format(clash["title"]), field="title"
        )
    return text


def summary(value):
    text = value.strip() if isinstance(value, str) else ""
    if not 20 <= len(text) <= 600:
        raise Refusal(400, SUMMARY_MESSAGE, field="summary")
    return text


def fee_cents(value, field="fee_cents"):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 500000:
        raise Refusal(400, FEE_MESSAGE, field=field)
    return value


def reason(value):
    text = value.strip() if isinstance(value, str) else ""
    if not 10 <= len(text) <= 400:
        raise Refusal(400, REASON_MESSAGE, field="reason")
    return value


def object_ids(conn, value):
    if not isinstance(value, list):
        raise Refusal(400, "Unknown object {}".format(value), field="object_ids")
    for item in value:
        if isinstance(item, bool) or not isinstance(item, int):
            raise Refusal(400, "Unknown object {}".format(item), field="object_ids")
    if len(value) > MAX_OBJECTS:
        raise Refusal(400, "Cite at most {} objects".format(MAX_OBJECTS), field="object_ids")
    if len(set(value)) != len(value):
        raise Refusal(400, "Each object may be cited once", field="object_ids")
    for object_id in value:
        if not row(conn, "select id from objects where id = %s", (object_id,)):
            raise Refusal(
                400, "Unknown object {}".format(object_id), field="object_ids"
            )
    return value


def kind(value):
    if value not in states.REVIEW_KINDS:
        raise Refusal(400, KIND_MESSAGE, field="kind")
    return value


def result(value):
    if value not in ("pass", "fail"):
        raise Refusal(400, RESULT_MESSAGE, field="result")
    return value


def day(value):
    parsed = timeutil.parse_day(value)
    if parsed is None:
        raise Refusal(400, DAY_MESSAGE, field="day")
    return parsed


def future_day(value):
    parsed = day(value)
    if parsed < timeutil.today():
        raise Refusal(400, PAST_DAY_MESSAGE, field="day")
    return parsed
