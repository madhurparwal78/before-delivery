"""The clearance pack: one document in, one document out."""
import datetime as dt
import uuid

from .. import timeutil
from ..db import row, rows, value
from ..errors import Refusal
from ..money import dollars
from . import budget, states

REQUIRED_META = ("saveVersion", "name", "author", "created", "updated", "uuid")
REQUIRED_CONFIG = ("quarter", "budget_cents")
REQUIRED_PIECE = ("title", "summary", "fee_cents", "state", "object_ids")
CLEARED_STATES = ("cleared", "scheduled", "published", "withdrawn")
PUBLISHED_STATES = ("published", "withdrawn")


def export(conn, account):
    moment = int(timeutil.now().timestamp() * 1000)
    quarter = timeutil.current_quarter()
    return {
        "meta": {
            "saveVersion": "1",
            "name": "Clearhouse clearance pack",
            "author": account["name"],
            "created": moment,
            "updated": moment,
            "uuid": str(uuid.uuid4()),
        },
        "config": {"quarter": quarter, "budget_cents": budget.budget_cents(conn, quarter)},
        "pieces": [
            {
                "title": piece["title"],
                "summary": piece["summary"],
                "fee_cents": piece["fee_cents"],
                "state": piece["state"],
                "object_ids": [
                    found["object_id"]
                    for found in rows(
                        conn,
                        "select object_id from piece_objects where piece_id = %s"
                        " order by position",
                        (piece["id"],),
                    )
                ],
            }
            for piece in rows(conn, "select * from pieces order by id")
        ],
    }


def _missing(document):
    if not isinstance(document.get("meta"), dict):
        return "meta"
    for key in REQUIRED_META:
        if document["meta"].get(key) in (None, ""):
            return "meta." + key
    if not isinstance(document.get("config"), dict):
        return "config"
    for key in REQUIRED_CONFIG:
        if document["config"].get(key) is None:
            return "config." + key
    if not isinstance(document.get("pieces"), list):
        return "pieces"
    for number, entry in enumerate(document["pieces"], start=1):
        if not isinstance(entry, dict):
            return "pieces.{}".format(number)
        for key in REQUIRED_PIECE:
            if entry.get(key) is None:
                return "pieces.{}.{}".format(number, key)
    return None


def _invalid_key(entry):
    title = entry["title"]
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 80:
        return "title"
    summary = entry["summary"]
    if not isinstance(summary, str) or not 20 <= len(summary.strip()) <= 600:
        return "summary"
    if entry["state"] not in states.STATES:
        return "state"
    cited = entry["object_ids"]
    if (
        not isinstance(cited, list)
        or len(cited) > 40
        or len(set(cited)) != len(cited)
        or any(isinstance(item, bool) or not isinstance(item, int) for item in cited)
    ):
        return "object_ids"
    return None


def check(conn, document):
    meta = document.get("meta")
    if isinstance(meta, dict) and meta.get("saveVersion") not in (None, "", "1"):
        raise Refusal(
            400, "Pack version {} is not supported".format(meta["saveVersion"])
        )
    gap = _missing(document)
    if gap:
        raise Refusal(400, "Pack is missing {}".format(gap))
    seen = set()
    for number, entry in enumerate(document["pieces"], start=1):
        fee = entry["fee_cents"]
        if isinstance(fee, bool) or not isinstance(fee, int) or not 0 <= fee <= 500000:
            raise Refusal(400, "Fee out of range in piece {}".format(number))
        bad = _invalid_key(entry)
        if bad:
            raise Refusal(400, "Piece {} has an invalid {}".format(number, bad))
        for object_id in entry["object_ids"]:
            if not row(conn, "select id from objects where id = %s", (object_id,)):
                raise Refusal(
                    400, "Unknown object {} in piece {}".format(object_id, number)
                )
        name = entry["title"].strip()
        clash = row(
            conn,
            "select title from pieces where lower(title) = lower(%s)"
            " and state <> 'rejected'",
            (name,),
        )
        if clash or name.lower() in seen:
            raise Refusal(
                400,
                "A piece named {} already exists".format(
                    clash["title"] if clash else name
                ),
            )
        seen.add(name.lower())
    quarter = timeutil.current_quarter()
    arriving = sum(
        entry["fee_cents"]
        for entry in document["pieces"]
        if entry["state"] in budget.COMMITTED_STATES
    )
    over = (
        budget.committed_cents(conn, quarter)
        + arriving
        - budget.budget_cents(conn, quarter)
    )
    if over > 0:
        raise Refusal(
            400, "Pack would exceed the quarter budget by {}".format(dollars(over))
        )


def _owner_for(conn, author):
    found = row(
        conn,
        "select id from accounts where role = 'maker'"
        " and (lower(name) = lower(%s) or lower(email) = lower(%s))",
        (author, author),
    )
    if found:
        return found["id"]
    return value(
        conn, "select id from accounts where role = 'maker' order by created_at, id limit 1"
    )


def _first_free_day(conn, taken):
    day = timeutil.today()
    while True:
        if day not in taken and not value(
            conn, "select 1 from schedule_slots where day = %s", (day,)
        ):
            return day
        day += dt.timedelta(days=1)


def apply(conn, account, document):
    from .pieces import append_audit

    check(conn, document)
    owner_id = _owner_for(conn, document["meta"]["author"])
    moment = timeutil.now()
    name = document["meta"]["name"]
    taken = set()
    for entry in document["pieces"]:
        state = entry["state"]
        piece_id = row(
            conn,
            "insert into pieces (title, summary, fee_cents, submitted_fee_cents, state,"
            " owner_id, version, created_at, updated_at, published_at, cleared_at)"
            " values (%s, %s, %s, %s, %s, %s, 1, %s, %s, %s, %s) returning id",
            (
                entry["title"].strip(),
                entry["summary"].strip(),
                entry["fee_cents"],
                entry["fee_cents"],
                state,
                owner_id,
                moment,
                moment,
                moment if state in PUBLISHED_STATES else None,
                moment if state in CLEARED_STATES else None,
            ),
        )["id"]
        for position, object_id in enumerate(entry["object_ids"]):
            conn.execute(
                "insert into piece_objects (piece_id, object_id, position)"
                " values (%s, %s, %s)",
                (piece_id, object_id, position),
            )
        if state == "scheduled":
            day = _first_free_day(conn, taken)
            taken.add(day)
            conn.execute(
                "insert into schedule_slots (day, piece_id, view_count) values (%s, %s, 0)",
                (day, piece_id),
            )
        append_audit(
            conn, piece_id, account["id"], "", state, "Imported from pack {}".format(name)
        )
    return {"imported": len(document["pieces"])}
