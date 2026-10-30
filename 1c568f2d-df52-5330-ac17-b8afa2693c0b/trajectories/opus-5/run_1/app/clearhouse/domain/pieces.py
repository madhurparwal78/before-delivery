"""Pieces: their shape, the queue, and every write that moves one."""
from .. import errors, timeutil
from ..db import row, rows, value
from ..errors import Refusal
from . import budget, catalogue, fields, guard, schedule, states

JOINED = (
    "select p.*, a.name as owner_name,"
    " lr.result as licence_review, ar.result as accessibility_review,"
    " lr.reviewer_id as licence_reviewer_id"
    " from pieces p join accounts a on a.id = p.owner_id"
    " left join reviews lr on lr.piece_id = p.id and lr.kind = 'licence'"
    " left join reviews ar on ar.piece_id = p.id and ar.kind = 'accessibility'"
)

SORTS = {
    "newest": "p.created_at desc, p.id desc",
    "oldest": "p.created_at asc, p.id asc",
    "title": "lower(p.title) asc",
    "fee": "p.fee_cents desc, p.id desc",
}

NEEDS = {
    "licence_reviewer": (
        "((p.state = 'submitted' and p.owner_id <> %(viewer)s)"
        " or (p.state = 'in_review' and p.owner_id <> %(viewer)s and lr.id is null))"
    ),
    "access_reviewer": (
        "((p.state = 'submitted' and p.owner_id <> %(viewer)s)"
        " or (p.state = 'in_review' and p.owner_id <> %(viewer)s and ar.id is null"
        " and coalesce(lr.reviewer_id, '') <> %(viewer)s))"
    ),
    "lead": (
        "((p.state = 'in_review' and lr.result = 'pass' and ar.result = 'pass')"
        " or p.state in ('cleared', 'scheduled'))"
    ),
    "maker": "(p.owner_id = %(viewer)s and p.state in ('draft', 'changes_requested'))",
    "auditor": "false",
}

ALREADY_RECORDED = "That review is already recorded"
ACK_FIRST = "Acknowledge every flagged duplicate first"
BOTH_REVIEWS = "Both reviews must pass before clearing"
ALREADY_ACKED = "That duplicate is already acknowledged"


def shape(piece):
    return {
        "id": piece["id"],
        "title": piece["title"],
        "summary": piece["summary"],
        "fee_cents": piece["fee_cents"],
        "submitted_fee_cents": piece["submitted_fee_cents"],
        "state": piece["state"],
        "owner": {"id": piece["owner_id"], "name": piece["owner_name"]},
        "version": piece["version"],
        "created_at": timeutil.iso(piece["created_at"]),
        "updated_at": timeutil.iso(piece["updated_at"]),
        "cleared_at": timeutil.iso(piece["cleared_at"]),
        "published_at": timeutil.iso(piece["published_at"]),
        "licence_review": piece["licence_review"],
        "accessibility_review": piece["accessibility_review"],
    }


def queue_row(piece):
    body = shape(piece)
    body.pop("summary")
    return body


def full(conn, piece_id):
    return row(conn, JOINED + " where p.id = %s", (piece_id,))


def visible(conn, piece_id, account):
    found = row(
        conn,
        JOINED + " where p.id = %(id)s" + guard.visible_sql(account),
        {"id": piece_id, "viewer": account["id"]},
    )
    if found is None:
        raise errors.not_found()
    return found


def lock(conn, piece_id):
    """Takes the row lock, so two decisions from one version cannot both land."""
    conn.execute("select id from pieces where id = %s for update", (piece_id,))
    return full(conn, piece_id)


def check_version(conn, body, piece, required=True):
    sent = body.get("version")
    if sent is None:
        if required:
            raise Refusal(400, errors.VERSION_REQUIRED, field="version")
        return
    try:
        sent = int(sent)
    except (TypeError, ValueError):
        sent = None
    if sent != piece["version"]:
        raise Refusal(409, errors.STALE_VERSION, current=shape(piece))


def cited_objects(conn, piece_id):
    return rows(
        conn,
        "select o.* from piece_objects po join objects o on o.id = po.object_id"
        " where po.piece_id = %s order by po.position",
        (piece_id,),
    )


def piece_audit(conn, piece_id):
    return rows(
        conn,
        "select e.id, e.piece_id, e.from_state, e.to_state, e.reason, e.created_at,"
        " a.id as actor_id, a.name as actor_name, a.role as actor_role"
        " from audit_entries e join accounts a on a.id = e.actor_id"
        " where e.piece_id = %s order by e.created_at desc, e.id desc",
        (piece_id,),
    )


def reviews_of(conn, piece_id):
    return rows(
        conn,
        "select r.id, r.piece_id, r.kind, r.result, r.reason, r.created_at,"
        " r.reviewer_id, a.name as reviewer_name"
        " from reviews r join accounts a on a.id = r.reviewer_id"
        " where r.piece_id = %s",
        (piece_id,),
    )


def acks_of(conn, piece_id):
    return rows(
        conn,
        "select d.piece_id, d.object_id, d.duplicate_object_id, d.acknowledged_by,"
        " d.acknowledged_at, a.name as acknowledged_by_name, o.title as duplicate_title"
        " from duplicate_acks d join accounts a on a.id = d.acknowledged_by"
        " join objects o on o.id = d.duplicate_object_id where d.piece_id = %s",
        (piece_id,),
    )


def detail(conn, piece):
    body = shape(piece)
    body["objects"] = cited_objects(conn, piece["id"])
    body["reviews"] = [
        {
            "id": entry["id"],
            "piece_id": entry["piece_id"],
            "kind": entry["kind"],
            "result": entry["result"],
            "reason": entry["reason"],
            "reviewer_id": entry["reviewer_id"],
            "reviewer_name": entry["reviewer_name"],
            "created_at": timeutil.iso(entry["created_at"]),
        }
        for entry in reviews_of(conn, piece["id"])
    ]
    body["duplicate_acks"] = [
        {
            "piece_id": entry["piece_id"],
            "object_id": entry["object_id"],
            "duplicate_object_id": entry["duplicate_object_id"],
            "acknowledged_by": entry["acknowledged_by"],
            "acknowledged_at": timeutil.iso(entry["acknowledged_at"]),
        }
        for entry in acks_of(conn, piece["id"])
    ]
    body["audit"] = [
        {
            "id": entry["id"],
            "piece_id": entry["piece_id"],
            "piece_title": piece["title"],
            "from_state": entry["from_state"],
            "to_state": entry["to_state"],
            "reason": entry["reason"],
            "actor": {
                "id": entry["actor_id"],
                "name": entry["actor_name"],
                "role": entry["actor_role"],
            },
            "created_at": timeutil.iso(entry["created_at"]),
        }
        for entry in piece_audit(conn, piece["id"])
    ]
    return body


def queue(conn, account, state=None, mine=False, needs=False, q=None, sort="newest",
          page=1, rows_per_page=50):
    params = {"viewer": account["id"]}
    where = guard.visible_sql(account)
    counts = {name: 0 for name in states.STATES}
    for found in rows(
        conn, "select p.state, count(*) as n from pieces p where true" + where
        + " group by p.state", params
    ):
        counts[found["state"]] = found["n"]
    filters = ""
    if state in states.STATES:
        filters += " and p.state = %(state)s"
        params["state"] = state
    if mine:
        filters += " and p.owner_id = %(viewer)s"
    if needs:
        filters += " and " + NEEDS[account["role"]]
    if q and len(q.strip()) >= 2:
        filters += " and (p.title ilike %(q)s or a.name ilike %(q)s)"
        params["q"] = "%" + q.strip() + "%"
    total = value(
        conn,
        "select count(*) from (" + JOINED + " where true" + where + filters + ") t",
        params,
    )
    page = max(1, page)
    params["limit"] = rows_per_page
    params["offset"] = (page - 1) * rows_per_page
    found = rows(
        conn,
        JOINED + " where true" + where + filters
        + " order by " + SORTS.get(sort, SORTS["newest"])
        + " limit %(limit)s offset %(offset)s",
        params,
    )
    return {
        "rows": [queue_row(piece) for piece in found],
        "counts": counts,
        "total": total,
        "page": page,
        "rows_per_page": rows_per_page,
    }


def append_audit(conn, piece_id, actor_id, from_state, to_state, reason):
    conn.execute(
        "insert into audit_entries (piece_id, actor_id, from_state, to_state, reason)"
        " values (%s, %s, %s, %s, %s)",
        (piece_id, actor_id, from_state, to_state, reason),
    )


def advance(conn, piece, to_state, account, reason, published_at=None, cleared_at=None):
    """One unit: the piece moves, version rises, one audit entry lands."""
    conn.execute(
        "update pieces set state = %s, version = version + 1, updated_at = now(),"
        " published_at = coalesce(%s, published_at),"
        " cleared_at = coalesce(cleared_at, %s) where id = %s",
        (to_state, published_at, cleared_at, piece["id"]),
    )
    append_audit(conn, piece["id"], account["id"], piece["state"], to_state, reason)
    return full(conn, piece["id"])


def create(conn, account, body):
    title = fields.title(conn, body.get("title"))
    summary = fields.summary(body.get("summary"))
    fee = fields.fee_cents(body.get("fee_cents", 0))
    piece_id = row(
        conn,
        "insert into pieces (title, summary, fee_cents, submitted_fee_cents, state,"
        " owner_id) values (%s, %s, %s, %s, 'draft', %s) returning id",
        (title, summary, fee, fee, account["id"]),
    )["id"]
    return full(conn, piece_id)


def patch(conn, account, piece_id, body):
    piece = lock(conn, piece_id)
    check_version(conn, body, piece)
    if piece["state"] != "draft":
        raise Refusal(409, states.illegal(piece["state"]))
    changes, params = [], []
    if "title" in body:
        changes.append("title = %s")
        params.append(fields.title(conn, body["title"], piece_id))
    if "summary" in body:
        changes.append("summary = %s")
        params.append(fields.summary(body["summary"]))
    if "fee_cents" in body:
        changes.append("fee_cents = %s")
        params.append(fields.fee_cents(body["fee_cents"]))
    conn.execute(
        "update pieces set " + ", ".join(changes + ["version = version + 1"])
        + ", updated_at = now() where id = %s",
        tuple(params) + (piece_id,),
    )
    return full(conn, piece_id)


def set_objects(conn, account, piece_id, body):
    piece = lock(conn, piece_id)
    check_version(conn, body, piece)
    if piece["state"] != "draft":
        raise Refusal(409, states.illegal(piece["state"]))
    chosen = fields.object_ids(conn, body.get("object_ids"))
    conn.execute("delete from piece_objects where piece_id = %s", (piece_id,))
    for position, object_id in enumerate(chosen):
        conn.execute(
            "insert into piece_objects (piece_id, object_id, position) values (%s, %s, %s)",
            (piece_id, object_id, position),
        )
    conn.execute(
        "update pieces set version = version + 1, updated_at = now() where id = %s",
        (piece_id,),
    )
    return full(conn, piece_id)


def citation_check(conn, piece_id):
    cited = cited_objects(conn, piece_id)
    if not cited:
        raise Refusal(400, "Cite at least one object", field="object_ids")
    lines = []
    for obj in cited:
        reason = catalogue.unusable_reason(obj)
        if reason:
            lines.append("{}: {}".format(obj["title"], reason))
    if lines:
        raise Refusal(
            400, "Some cited objects cannot be used", field="object_ids", lines=lines
        )


def unacknowledged(conn, piece_id):
    cited = [obj["id"] for obj in cited_objects(conn, piece_id)]
    flagged = catalogue.flagged_duplicates(conn, cited)
    known = {
        (entry["object_id"], entry["duplicate_object_id"])
        for entry in acks_of(conn, piece_id)
    }
    return [
        (object_id, duplicate["id"])
        for object_id, duplicates in flagged.items()
        for duplicate in duplicates
        if (object_id, duplicate["id"]) not in known
    ]


def transition(conn, account, piece_id, body, version_required=True):
    piece = lock(conn, piece_id)
    check_version(conn, body, piece, version_required)
    action = body.get("action")
    if not states.allows(action, piece["state"]):
        raise Refusal(409, states.illegal(piece["state"]))
    step = states.step(action)
    reason = fields.reason(body.get("reason")) if step[4] else None
    cleared_at = None
    published_at = None
    if action == "submit":
        citation_check(conn, piece_id)
        conn.execute(
            "update pieces set submitted_fee_cents = fee_cents where id = %s", (piece_id,)
        )
    elif action == "clear":
        if piece["licence_review"] != "pass" or piece["accessibility_review"] != "pass":
            raise Refusal(409, BOTH_REVIEWS)
        budget.check_clear(conn, piece)
        cleared_at = timeutil.now()
    elif action == "schedule":
        schedule.book(conn, piece, fields.future_day(body.get("day")))
    elif action == "unschedule":
        schedule.free(conn, piece_id)
    elif action == "publish":
        schedule.check_day_arrived(conn, piece_id)
        published_at = timeutil.now()
    elif action == "withdraw":
        schedule.free(conn, piece_id)
    elif action == "revise":
        conn.execute("delete from reviews where piece_id = %s", (piece_id,))
        conn.execute("delete from duplicate_acks where piece_id = %s", (piece_id,))
    return advance(conn, piece, step[1], account, reason, published_at, cleared_at)


def record_review(conn, account, piece_id, body):
    piece = lock(conn, piece_id)
    check_version(conn, body, piece)
    if piece["state"] != states.REVIEW_STATE:
        raise Refusal(409, states.illegal(piece["state"]))
    kind = fields.kind(body.get("kind"))
    result = fields.result(body.get("result"))
    reason = fields.reason(body.get("reason")) if result == "fail" else body.get("reason")
    if piece["licence_review" if kind == "licence" else "accessibility_review"]:
        raise Refusal(409, ALREADY_RECORDED)
    if kind == "licence" and result == "pass" and unacknowledged(conn, piece_id):
        raise Refusal(409, ACK_FIRST)
    review_id = row(
        conn,
        "insert into reviews (piece_id, kind, reviewer_id, result, reason)"
        " values (%s, %s, %s, %s, %s) returning id, created_at",
        (piece_id, kind, account["id"], result, reason),
    )
    moved = advance(conn, piece, states.review_to_state(result), account, reason)
    return {
        "id": review_id["id"],
        "piece_id": piece_id,
        "kind": kind,
        "result": result,
        "reason": reason,
        "reviewer_id": account["id"],
        "created_at": timeutil.iso(review_id["created_at"]),
        "piece": shape(moved),
    }


def acknowledge(conn, account, piece_id, body):
    piece = lock(conn, piece_id)
    if piece["state"] != states.REVIEW_STATE:
        raise Refusal(409, states.illegal(piece["state"]))
    object_id = body.get("object_id")
    duplicate_id = body.get("duplicate_object_id")
    cited = [obj["id"] for obj in cited_objects(conn, piece_id)]
    if object_id not in cited:
        raise Refusal(400, "That object is not cited by this piece", field="object_id")
    flagged = {
        duplicate["id"]
        for duplicate in catalogue.flagged_duplicates(conn, [object_id])[object_id]
    }
    if duplicate_id not in flagged:
        raise Refusal(
            400, "That object is not a flagged duplicate", field="duplicate_object_id"
        )
    landed = row(
        conn,
        "insert into duplicate_acks (piece_id, object_id, duplicate_object_id,"
        " acknowledged_by) values (%s, %s, %s, %s)"
        " on conflict do nothing returning acknowledged_at",
        (piece_id, object_id, duplicate_id, account["id"]),
    )
    if landed is None:
        raise Refusal(409, ALREADY_ACKED)
    return {
        "piece_id": piece_id,
        "object_id": object_id,
        "duplicate_object_id": duplicate_id,
        "acknowledged_by": account["id"],
        "acknowledged_at": timeutil.iso(landed["acknowledged_at"]),
    }
