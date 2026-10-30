"""The JSON API on the app's own origin."""
import datetime as dt
import json

from flask import Blueprint, Response, g, request

from . import auth, config, errors, identity, timeutil
from .db import ready, tx
from .domain import audit, budget, catalogue, guard, pack, pieces, prefs, schedule
from .errors import Refusal

bp = Blueprint("api", __name__, url_prefix="/api")

PIECE_FIELDS = ("title", "summary", "fee_cents")
PATCH_FIELDS = ("version",) + PIECE_FIELDS
OBJECT_FIELDS = ("version", "object_ids")
TRANSITION_FIELDS = ("version", "action", "reason", "day")
REVIEW_FIELDS = ("version", "kind", "result", "reason")
ACK_FIELDS = ("object_id", "duplicate_object_id")
SCHEDULE_FIELDS = ("piece_id", "version")
BUDGET_FIELDS = ("piece_id", "delta_cents", "version", "reset")
LOGIN_FIELDS = ("email", "password")


def send(payload, status=200):
    return Response(
        json.dumps(payload),
        status=status,
        content_type="application/json; charset=utf-8",
    )


def body():
    return request.get_json(silent=True)


def flag(name):
    return request.args.get(name) in ("1", "true", "yes", "on")


def whole(name, default, low=None, high=None):
    try:
        number = int(request.args.get(name, default))
    except (TypeError, ValueError):
        number = default
    if low is not None:
        number = max(low, number)
    if high is not None:
        number = min(high, number)
    return number


def rows_per_page(conn):
    return prefs.get(conn, g.account["id"])["rows_per_page"]


@bp.get("/health")
def health():
    if not ready():
        return send({"status": "starting", "ok": False, "identity": identity.monitor.status()}, 503)
    return send({"status": "ok", "ok": True, "identity": identity.monitor.status()})


@bp.post("/auth/login")
def login():
    sent = guard.published_fields(guard.body_object(body()), LOGIN_FIELDS)
    with tx() as conn:
        refusal = None
        try:
            token, _account = auth.sign_in(
                conn, sent.get("email"), sent.get("password")
            )
        except Refusal as caught:
            refusal = caught
    if refusal is not None:
        raise refusal
    response = send({"access_token": token})
    response.set_cookie(
        config.SESSION_COOKIE, token, httponly=True, samesite="Lax", path="/"
    )
    return response


@bp.post("/auth/logout")
def logout():
    with tx() as conn:
        auth.revoke_session(conn, g.token)
    response = Response(status=204)
    response.delete_cookie(config.SESSION_COOKIE, path="/")
    return response


@bp.get("/auth/me")
def me():
    return send(
        {
            "id": g.account["id"],
            "email": g.account["email"],
            "name": g.account["name"],
            "role": g.account["role"],
        }
    )


@bp.get("/pieces")
def list_pieces():
    with tx() as conn:
        return send(
            pieces.queue(
                conn,
                g.account,
                state=request.args.get("state"),
                mine=flag("mine"),
                needs=flag("needs"),
                q=request.args.get("q"),
                sort=request.args.get("sort", "newest"),
                page=whole("page", 1, low=1),
                rows_per_page=rows_per_page(conn),
            )
        )


@bp.post("/pieces")
def create_piece():
    with tx() as conn:
        sent = guard.published_fields(guard.body_object(body()), PIECE_FIELDS)
        guard.may_act(g.account, "create")
        return send(pieces.shape(pieces.create(conn, g.account, sent)), 201)


@bp.get("/pieces/<int:piece_id>")
def read_piece(piece_id):
    with tx() as conn:
        return send(pieces.detail(conn, pieces.visible(conn, piece_id, g.account)))


@bp.patch("/pieces/<int:piece_id>")
def patch_piece(piece_id):
    with tx() as conn:
        piece = pieces.visible(conn, piece_id, g.account)
        sent = guard.published_fields(guard.body_object(body()), PATCH_FIELDS)
        guard.may_act(g.account, "edit_draft", piece)
        return send(pieces.shape(pieces.patch(conn, g.account, piece_id, sent)))


@bp.put("/pieces/<int:piece_id>/objects")
def put_objects(piece_id):
    with tx() as conn:
        piece = pieces.visible(conn, piece_id, g.account)
        sent = guard.published_fields(guard.body_object(body()), OBJECT_FIELDS)
        guard.may_act(g.account, "edit_draft", piece)
        moved = pieces.set_objects(conn, g.account, piece_id, sent)
        return send(
            {
                "piece": pieces.shape(moved),
                "objects": pieces.cited_objects(conn, piece_id),
            }
        )


@bp.post("/pieces/<int:piece_id>/transition")
def transition(piece_id):
    with tx() as conn:
        piece = pieces.visible(conn, piece_id, g.account)
        sent = guard.published_fields(guard.body_object(body()), TRANSITION_FIELDS)
        guard.may_act(g.account, "transition:{}".format(sent.get("action")), piece)
        return send(pieces.shape(pieces.transition(conn, g.account, piece_id, sent)))


@bp.post("/pieces/<int:piece_id>/reviews")
def record_review(piece_id):
    with tx() as conn:
        piece = pieces.visible(conn, piece_id, g.account)
        sent = guard.published_fields(guard.body_object(body()), REVIEW_FIELDS)
        guard.may_act(
            g.account,
            "review:{}".format(sent.get("kind")),
            piece,
            piece["licence_reviewer_id"],
        )
        return send(pieces.record_review(conn, g.account, piece_id, sent), 201)


@bp.post("/pieces/<int:piece_id>/duplicate-acks")
def acknowledge(piece_id):
    with tx() as conn:
        piece = pieces.visible(conn, piece_id, g.account)
        sent = guard.body_object(body())
        for key in ACK_FIELDS:
            if sent.get(key) is not None:
                guard.object_or_404(conn, sent[key])
        guard.published_fields(sent, ACK_FIELDS)
        guard.may_act(g.account, "ack", piece)
        return send(pieces.acknowledge(conn, g.account, piece_id, sent), 201)


@bp.get("/objects")
def list_objects():
    with tx() as conn:
        found = catalogue.walk(
            conn,
            request.args.get("cursor"),
            whole("limit", catalogue.MAX_LIMIT, low=1, high=catalogue.MAX_LIMIT),
            whole("seed", 1, low=1, high=catalogue.MAX_SEED),
            request.args.get("q"),
            request.args.get("license"),
        )
        found.pop("offset")
        return send(found)


@bp.get("/objects/<int:object_id>")
def read_object(object_id):
    with tx() as conn:
        found = catalogue.get(conn, object_id)
        if found is None:
            raise errors.not_found()
        return send(found)


@bp.get("/objects/<int:object_id>/similar")
def similar_objects(object_id):
    with tx() as conn:
        found = catalogue.get(conn, object_id)
        if found is None:
            raise errors.not_found()
        offset = whole("offset", 0, low=0)
        return send(
            {
                "id": object_id,
                "offset": offset,
                "results": catalogue.similar(
                    conn, found, whole("limit", 20, low=1, high=50), offset
                ),
            }
        )


@bp.get("/schedule")
def read_schedule():
    month = request.args.get("month") or timeutil.current_month()
    span = timeutil.month_range(month)
    if span is None:
        raise Refusal(400, "Use a month written as YYYY-MM", field="month")
    with tx() as conn:
        return send([schedule.shape(slot) for slot in schedule.month(conn, *span)])


@bp.put("/schedule/<day>")
def book_day(day):
    with tx() as conn:
        sent = guard.body_object(body())
        piece = pieces.visible(conn, sent.get("piece_id"), g.account)
        guard.published_fields(sent, SCHEDULE_FIELDS)
        guard.may_act(g.account, "transition:schedule", piece)
        pieces.transition(
            conn,
            g.account,
            piece["id"],
            {"version": sent.get("version"), "action": "schedule", "day": day},
            version_required=False,
        )
        slot = schedule.slot_for_day(conn, timeutil.parse_day(day))
        return send(
            {"day": day, "piece_id": slot["id"], "view_count": slot["view_count"]}
        )


@bp.delete("/schedule/<day>")
def free_day(day):
    with tx() as conn:
        parsed = timeutil.parse_day(day)
        slot = schedule.slot_for_day(conn, parsed) if parsed else None
        if slot is None:
            raise errors.not_found()
        piece = pieces.visible(conn, slot["id"], g.account)
        guard.may_act(g.account, "transition:unschedule", piece)
        pieces.transition(
            conn,
            g.account,
            piece["id"],
            {"version": request.args.get("version"), "action": "unschedule"},
            version_required=False,
        )
        return Response(status=204)


@bp.get("/budget")
def read_budget():
    quarter = request.args.get("quarter") or timeutil.current_quarter()
    if timeutil.quarter_range(quarter) is None:
        raise Refusal(400, "Use a quarter written as YYYY-QN", field="quarter")
    with tx() as conn:
        return send(budget.shape(conn, quarter))


@bp.patch("/budget/<quarter>")
def change_budget(quarter):
    if timeutil.quarter_range(quarter) is None:
        raise errors.not_found()
    with tx() as conn:
        sent = guard.body_object(body())
        resetting = sent.get("reset") is True
        piece = (
            None
            if resetting
            else pieces.visible(conn, sent.get("piece_id"), g.account)
        )
        guard.published_fields(sent, BUDGET_FIELDS)
        guard.may_act(g.account, "budget", piece)
        if resetting:
            budget.reset(conn, g.account, quarter)
        else:
            locked = pieces.lock(conn, piece["id"])
            pieces.check_version(conn, sent, locked, required=False)
            budget.adjust(conn, g.account, quarter, locked, sent.get("delta_cents"))
        return send(budget.shape(conn, quarter))


@bp.get("/audit")
def read_audit():
    with tx() as conn:
        return send(
            audit.trail(
                conn,
                g.account,
                piece=whole("piece", 0, low=0) or None,
                actor=request.args.get("actor"),
                to_state=request.args.get("to"),
                since=timeutil.parse_day(request.args.get("from")),
                until=_until(request.args.get("until")),
                page=whole("page", 1, low=1),
                rows_per_page=rows_per_page(conn),
            )
        )


def _until(text):
    parsed = timeutil.parse_day(text)
    return parsed + dt.timedelta(days=1) if parsed else None


@bp.get("/audit/export")
def export_audit():
    with tx() as conn:
        document = audit.csv_document(
            audit.every_row(
                conn,
                g.account,
                piece=whole("piece", 0, low=0) or None,
                actor=request.args.get("actor"),
                to_state=request.args.get("to"),
                since=timeutil.parse_day(request.args.get("from")),
                until=_until(request.args.get("until")),
            )
        )
    return Response(
        document,
        content_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="clearhouse-audit.csv"'},
    )


@bp.get("/pack")
def export_pack():
    with tx() as conn:
        guard.may_act(g.account, "pack")
        return send(pack.export(conn, g.account))


@bp.post("/pack")
def import_pack():
    with tx() as conn:
        sent = guard.body_object(body())
        guard.may_act(g.account, "pack")
        return send(pack.apply(conn, g.account, sent), 201)


@bp.get("/preferences")
def read_preferences():
    with tx() as conn:
        return send(prefs.get(conn, g.account["id"]))


@bp.put("/preferences")
def write_preferences():
    with tx() as conn:
        sent = guard.published_fields(guard.body_object(body()), prefs.FIELDS)
        guard.may_act(g.account, guard.PREFERENCES)
        return send(prefs.put(conn, g.account["id"], sent))
