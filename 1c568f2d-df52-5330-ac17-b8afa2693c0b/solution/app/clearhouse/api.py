"""The JSON API under /api."""

from flask import Blueprint, Response, g, request

from . import audit, auth, budget, catalogue, pack, pieces, prefs, queue, rules, shapes
from .boundary import body, json_response, session_token
from .db import transaction
from .errors import invalid, not_found
from .identity import watcher
from .timefmt import today

api = Blueprint("api", __name__, url_prefix="/api")


@api.get("/health")
def health() -> Response:
    with transaction() as tx:
        tx.value("SELECT 1")
    return json_response({"status": "ok", "ok": True, "identity": watcher.status()})


@api.post("/auth/login")
def login() -> Response:
    fields = rules.only_published(body(), ("email", "password"))
    token = auth.sign_in(fields)
    response = json_response({"access_token": token})
    response.set_cookie(auth.COOKIE, token, httponly=True, samesite="Lax", path="/")
    return response


@api.post("/auth/logout")
def logout() -> Response:
    auth.sign_out(session_token())
    response = Response(status=204)
    response.delete_cookie(auth.COOKIE, path="/")
    return response


@api.get("/auth/me")
def me() -> Response:
    account = g.account
    return json_response({"id": account["id"], "email": account["email"], "name": account["name"],
                          "role": account["role"]})


@api.get("/pieces")
def list_pieces() -> Response:
    chosen = queue.options(request.args)
    with transaction() as tx:
        per_page = prefs.load(tx, g.account["id"])["rows_per_page"]
        rows, total = queue.search(tx, g.account, chosen, per_page)
        return json_response({"rows": [shapes.piece_of(r, with_summary=False) for r in rows],
                              "counts": queue.counts(tx, g.account), "total": total, "page": chosen["page"],
                              "rows_per_page": per_page})


@api.post("/pieces")
def create_piece() -> Response:
    return json_response(pieces.create(g.account, body()), 201)


@api.get("/pieces/<int:piece_id>")
def get_piece(piece_id: int) -> Response:
    with transaction() as tx:
        rules.find_piece(tx, g.account, piece_id, lock=False)
        return json_response(shapes.piece_detail(tx, piece_id))


@api.patch("/pieces/<int:piece_id>")
def edit_piece(piece_id: int) -> Response:
    return json_response(pieces.edit(g.account, piece_id, body()))


@api.put("/pieces/<int:piece_id>/objects")
def cite_objects(piece_id: int) -> Response:
    return json_response(pieces.cite(g.account, piece_id, body()))


@api.post("/pieces/<int:piece_id>/transition")
def transition(piece_id: int) -> Response:
    return json_response(pieces.transition(g.account, piece_id, body()))


@api.post("/pieces/<int:piece_id>/reviews")
def record_review(piece_id: int) -> Response:
    return json_response(pieces.review(g.account, piece_id, body()), 201)


@api.post("/pieces/<int:piece_id>/duplicate-acks")
def acknowledge(piece_id: int) -> Response:
    return json_response(pieces.acknowledge(g.account, piece_id, body()), 201)


@api.get("/objects")
def objects() -> Response:
    args = request.args
    with transaction() as tx:
        page = catalogue.walk(tx, seed=catalogue.whole(args.get("seed"), 1, 1, catalogue.SEED_MAX),
                              cursor=args.get("cursor") or None,
                              limit=catalogue.whole(args.get("limit"), catalogue.PAGE_LIMIT, 1, catalogue.PAGE_LIMIT),
                              q=args.get("q") or "", licence=args.get("license") or "")
    return json_response({"objects": [shapes.object_of(o) for o in page["objects"]],
                          "nextCursor": page["nextCursor"], "wrap": page["wrap"], "total": page["total"]})


def _object(tx, object_id: int):
    found = tx.one("SELECT * FROM objects WHERE id = :id", id=object_id)
    if found is None:
        raise not_found()
    return found


@api.get("/objects/<int:object_id>")
def get_object(object_id: int) -> Response:
    with transaction() as tx:
        return json_response(shapes.object_of(_object(tx, object_id)))


@api.get("/objects/<int:object_id>/similar")
def similar(object_id: int) -> Response:
    limit = catalogue.whole(request.args.get("limit"), 20, 1, 50)
    offset = catalogue.whole(request.args.get("offset"), 0, 0)
    with transaction() as tx:
        found = catalogue.similar(tx, _object(tx, object_id))[offset:offset + limit]
    return json_response({"id": object_id, "offset": offset,
                          "results": [{"object": shapes.object_of(o), "score": s} for o, s in found]})


def month_param() -> str:
    month = request.args.get("month") or today().isoformat()[:7]
    if len(month) != 7 or month[4] != "-" or not (month[:4] + month[5:]).isdigit() or not 1 <= int(month[5:]) <= 12:
        raise invalid("month", "Use a month written as YYYY-MM")
    return month


def schedule_month(tx, account, month: str) -> list[dict]:
    rows = tx.rows("SELECT s.day, s.view_count, p.id, p.title, p.state FROM schedule_slots s "
                   f"JOIN pieces p ON p.id = s.piece_id WHERE to_char(s.day, 'YYYY-MM') = :m "
                   f"AND {rules.visible_clause(account)} ORDER BY s.day", m=month, me=account["id"])
    return [{"day": r["day"].isoformat(), "piece": {"id": r["id"], "title": r["title"], "state": r["state"]},
             "view_count": r["view_count"]} for r in rows]


@api.get("/schedule")
def schedule() -> Response:
    month = month_param()
    with transaction() as tx:
        return json_response(schedule_month(tx, g.account, month))


@api.put("/schedule/<day>")
def book(day: str) -> Response:
    return json_response(pieces.book(g.account, day, body()))


@api.delete("/schedule/<day>")
def unbook(day: str) -> Response:
    pieces.unbook(g.account, day, request.args.get("version"))
    return Response(status=204)


def _budget_shape(view: dict) -> dict:
    return view | {"rows": [{"id": r["id"], "title": r["title"], "owner_name": r["owner_name"], "state": r["state"],
                             "fee_cents": r["fee_cents"], "version": r["version"]} for r in view["rows"]]}


@api.get("/budget")
def get_budget() -> Response:
    quarter = request.args.get("quarter") or rules.current_quarter()
    budget.valid_quarter(quarter)
    with transaction() as tx:
        return json_response(_budget_shape(budget.view(tx, g.account, quarter)))


@api.patch("/budget/<quarter>")
def change_budget(quarter: str) -> Response:
    return json_response(_budget_shape(budget.change(g.account, quarter, body())))


def _audit_rows(page: int | None) -> tuple[list, int, int]:
    chosen = audit.filters(request.args)
    with transaction() as tx:
        per_page = prefs.load(tx, g.account["id"])["rows_per_page"]
        rows, total = audit.listing(tx, g.account, chosen, page=page, per_page=per_page)
    return rows, total, per_page


@api.get("/audit")
def audit_list() -> Response:
    page = catalogue.whole(request.args.get("page"), 1, 1)
    rows, total, per_page = _audit_rows(page)
    return json_response({"rows": [shapes.audit_of(r) for r in rows], "total": total, "page": page,
                          "rows_per_page": per_page})


@api.get("/audit/export")
def audit_export() -> Response:
    rows, _, _ = _audit_rows(None)
    return Response(audit.csv_text(rows).encode(), content_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="clearhouse-audit.csv"'})


@api.get("/pack")
def export_pack() -> Response:
    return json_response(pack.export(g.account))


@api.post("/pack")
def import_pack() -> Response:
    return json_response({"imported": pack.apply(g.account, body())}, 201)


@api.get("/preferences")
def get_preferences() -> Response:
    with transaction() as tx:
        return json_response(prefs.load(tx, g.account["id"]))


@api.put("/preferences")
def put_preferences() -> Response:
    fields = rules.only_published(body(), prefs.FIELDS)
    with transaction() as tx:
        return json_response(prefs.save(tx, g.account, fields))

