"""The private desk: drafting, publication, clearance windows and the queue.

Each handler follows the published error precedence: the session, then the body
shape, then the resource, then the role, then state conflicts, then fields.
"""

from __future__ import annotations

from flask import Blueprint, Response, request

from ..domain import previews
from ..domain.clock import helsinki_stamp
from ..domain.fields import (
    changes,
    is_hostile,
    parse_stamp,
    parse_window_date,
    validate,
    voids_clearance,
)
from ..domain.references import (
    bump_version,
    desk_order,
    figures_of,
    is_live,
    place,
    renumber,
)
from ..domain.slugs import claim_slug, rename, slugify
from ..http import (
    STALE,
    Refusal,
    json_response,
    not_found,
    raw_body,
    read_object,
    store,
)
from .support import (
    desk_account,
    desk_detail,
    desk_row,
    enquiry_row,
    own_reference,
    require_steward,
)

bp = Blueprint("desk_api", __name__)

NO_TITLE = "Give the reference a title that makes a web address"
ALREADY_PUBLISHED = {"message": "This reference is already published"}
NEEDS_WINDOW = {"message": "Record a clearance window before publishing"}
WINDOW_ENDED = {"message": "The clearance window has ended"}
NEEDS_FIGURE = {"message": "Add at least one result figure before publishing"}
NOT_PUBLISHED = {"message": "This reference is not published"}
NOT_LIVE = {"message": "Only a live reference can be moved"}
INVERTED = "The window cannot end before it starts"
BAD_SLUG = "Name the reference to move by its slug"
BAD_ORDINAL = "Give the new position as a whole number from 1 upwards"


def _route(rule: str, name: str, methods: list[str]):
    def register(view):
        bp.add_url_rule(rule, name, view, methods=methods, provide_automatic_options=False)
        return view

    return register


def _check_if_match(row) -> None:
    header = request.headers.get("If-Match")
    if header is None:
        return
    value = header.strip()
    if value == "*":
        return
    if len(value) > 2 and value.startswith('"') and value.endswith('"'):
        inner = value[1:-1]
        if inner.isdigit() and int(inner) == row["version"]:
            return
    raise Refusal(412, STALE)


def _write_figures(conn, reference_id: int, figures: list[dict]) -> None:
    conn.execute("DELETE FROM figure WHERE reference_id = %s", (reference_id,))
    for position, figure in enumerate(figures, start=1):
        conn.execute(
            "INSERT INTO figure (reference_id, label, value, position) VALUES (%s, %s, %s, %s)",
            (reference_id, figure["label"], figure["value"], position),
        )


def _apply_columns(conn, reference_id: int, values: dict) -> None:
    columns = [name for name in values if name != "figures"]
    if not columns:
        return
    assignments = ", ".join(f"{name} = %s" for name in columns)
    conn.execute(
        f"UPDATE reference_entry SET {assignments} WHERE id = %s",
        [values[name] for name in columns] + [reference_id],
    )


@_route("/api/desk/references", "list_references", ["GET", "POST"])
def references():
    if request.method == "POST":
        return _create_reference()
    with store() as st:
        account = desk_account(st)
        rows = st.conn.execute(
            "SELECT * FROM reference_entry WHERE programme_id = %s",
            (account["programme_id"],),
        ).fetchall()
        return json_response(
            [desk_row(row, st.today) for row in desk_order(rows, st.today)]
        )


def _create_reference():
    raw = raw_body()
    with store(write=True) as st:
        account = desk_account(st)
        body = read_object(raw)
        clean, errors = validate(body, creating=True)
        if "title" in clean and not slugify(clean["title"]):
            errors["title"] = NO_TITLE
        if errors:
            raise Refusal(422, {"errors": errors})

        slug = claim_slug(st.conn, account["programme_id"], clean["title"], None)
        row = st.conn.execute(
            """INSERT INTO reference_entry
                   (programme_id, slug, sector, customer, title, summary, challenge,
                    work, title_fi, body_fi, published, version, quote, quote_speaker,
                    quote_role)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, false, 1, %s, %s, %s)
               RETURNING id""",
            (
                account["programme_id"],
                slug,
                clean["sector"],
                clean["customer"],
                clean["title"],
                clean["summary"],
                clean["challenge"],
                clean["work"],
                clean.get("title_fi"),
                clean.get("body_fi"),
                clean.get("quote"),
                clean.get("quote_speaker"),
                clean.get("quote_role"),
            ),
        ).fetchone()
        if clean.get("figures"):
            _write_figures(st.conn, int(row["id"]), clean["figures"])
        return json_response({"slug": slug}, 201)


@_route("/api/desk/references/<slug>", "one_reference", ["GET", "PATCH"])
def one_reference(slug: str):
    if request.method == "PATCH":
        return _edit_reference(slug)
    with store() as st:
        account = desk_account(st)
        row = own_reference(st, account, slug)
        return json_response(desk_detail(st.conn, row, st.today))


def _edit_reference(slug: str):
    raw = raw_body()
    with store(write=True) as st:
        account = desk_account(st)
        body = read_object(raw)
        row = own_reference(st, account, slug)
        _check_if_match(row)

        clean, errors = validate(body, creating=False)
        if "title" in clean and not slugify(clean["title"]):
            errors["title"] = NO_TITLE
        if errors:
            raise Refusal(422, {"errors": errors})

        stored_figures = figures_of(st.conn, row["id"])
        voided = voids_clearance(row, clean, stored_figures)
        different = changes(row, clean, stored_figures)
        version, current = row["version"], row["slug"]

        if different:
            _apply_columns(st.conn, row["id"], different)
            if "figures" in different:
                _write_figures(st.conn, row["id"], different["figures"])
            if voided:
                st.conn.execute(
                    """UPDATE reference_entry
                          SET clearance_from = NULL, clearance_until = NULL
                        WHERE id = %s""",
                    (row["id"],),
                )
            version = bump_version(st.conn, row["id"])
            if "title" in different:
                current = claim_slug(
                    st.conn, account["programme_id"], clean["title"], row["id"]
                )
                rename(st.conn, account["programme_id"], row["id"], row["slug"], current)
            renumber(st.conn, account["programme_id"], st.today)

        return json_response(
            {"slug": current, "version": version, "clearance_voided": voided}
        )


@_route("/api/desk/references/<slug>/publish", "publish", ["POST"])
def publish(slug: str):
    raw_body()
    with store(write=True) as st:
        account = desk_account(st)
        row = own_reference(st, account, slug)
        if row["published"]:
            raise Refusal(409, ALREADY_PUBLISHED)
        if row["clearance_from"] is None or row["clearance_until"] is None:
            raise Refusal(409, NEEDS_WINDOW)
        if row["clearance_until"] < st.today:
            raise Refusal(409, WINDOW_ENDED)
        if not figures_of(st.conn, row["id"]):
            raise Refusal(409, NEEDS_FIGURE)

        st.conn.execute(
            "UPDATE reference_entry SET published = true, retired_at = NULL WHERE id = %s",
            (row["id"],),
        )
        bump_version(st.conn, row["id"])
        previews.retire_links(st.conn, row["id"])
        renumber(st.conn, account["programme_id"], st.today)
        placed = st.conn.execute(
            "SELECT ordinal FROM reference_entry WHERE id = %s", (row["id"],)
        ).fetchone()
        return json_response({"slug": slug, "ordinal": placed["ordinal"]})


@_route("/api/desk/references/<slug>/retire", "retire", ["POST"])
def retire(slug: str):
    raw_body()
    with store(write=True) as st:
        account = desk_account(st)
        row = own_reference(st, account, slug)
        if not row["published"]:
            raise Refusal(409, NOT_PUBLISHED)
        st.conn.execute(
            """UPDATE reference_entry
                  SET published = false, retired_at = %s, ordinal = NULL
                WHERE id = %s""",
            (st.now, row["id"]),
        )
        bump_version(st.conn, row["id"])
        previews.retire_links(st.conn, row["id"])
        renumber(st.conn, account["programme_id"], st.today)
        return json_response({"slug": slug})


@_route("/api/desk/references/<slug>/clearance", "clearance", ["PUT"])
def clearance(slug: str):
    raw = raw_body()
    with store(write=True) as st:
        account = desk_account(st)
        body = read_object(raw)
        row = own_reference(st, account, slug)
        require_steward(account)

        errors = {}
        start, message = parse_window_date(body.get("clearance_from"))
        if message:
            errors["clearance_from"] = message
        end, message = parse_window_date(body.get("clearance_until"))
        if message:
            errors["clearance_until"] = message
        if not errors and start > end:
            errors["clearance_until"] = INVERTED
        if errors:
            raise Refusal(422, {"errors": errors})

        if (row["clearance_from"], row["clearance_until"]) != (start, end):
            st.conn.execute(
                """UPDATE reference_entry
                      SET clearance_from = %s, clearance_until = %s WHERE id = %s""",
                (start, end, row["id"]),
            )
            bump_version(st.conn, row["id"])
            renumber(st.conn, account["programme_id"], st.today)

        updated = st.conn.execute(
            "SELECT * FROM reference_entry WHERE id = %s", (row["id"],)
        ).fetchone()
        return json_response(
            {
                "slug": slug,
                "clearance_from": start.isoformat(),
                "clearance_until": end.isoformat(),
                "live": is_live(updated, st.today),
            }
        )


@_route("/api/desk/references/<slug>/preview", "preview", ["POST"])
def preview(slug: str):
    raw = raw_body()
    with store(write=True) as st:
        account = desk_account(st)
        body = read_object(raw)
        row = own_reference(st, account, slug)
        if row["published"]:
            raise Refusal(409, ALREADY_PUBLISHED)

        expires_at = None
        if "expires_at" in body:
            expires_at, message = parse_stamp(body["expires_at"])
            if message is None:
                message = previews.check_expiry(expires_at, st.now)
            if message:
                raise Refusal(422, {"errors": {"expires_at": message}})

        link = previews.mint(st.conn, row, st.now, expires_at)
        return json_response(
            {"token": link["token"], "expires_at": helsinki_stamp(link["expires_at"])},
            201,
        )


@_route("/api/desk/order", "order", ["PUT"])
def order():
    raw = raw_body()
    with store(write=True) as st:
        account = desk_account(st)
        body = read_object(raw)

        errors = {}
        slug = body.get("slug")
        if not isinstance(slug, str) or is_hostile(slug) or not slug:
            errors["slug"] = BAD_SLUG
        ordinal = body.get("ordinal")
        if isinstance(ordinal, bool) or not isinstance(ordinal, int) or ordinal < 1:
            errors["ordinal"] = BAD_ORDINAL

        row = None if "slug" in errors else own_reference(st, account, slug)
        if errors:
            raise Refusal(422, {"errors": errors})
        if not is_live(row, st.today):
            raise Refusal(409, NOT_LIVE)

        return json_response(
            place(st.conn, account["programme_id"], st.today, row["id"], ordinal)
        )


@_route("/api/desk/enquiries", "enquiries", ["GET"])
def enquiries():
    with store() as st:
        account = desk_account(st)
        rows = st.conn.execute(
            """SELECT id, email, phone, reference, created_at, agreed FROM enquiry
                WHERE programme_id = %s AND open ORDER BY created_at DESC, id DESC""",
            (account["programme_id"],),
        ).fetchall()
        return json_response([enquiry_row(row) for row in rows])


@_route("/api/desk/enquiries/<enquiry_id>", "delete_enquiry", ["DELETE"])
def delete_enquiry(enquiry_id: str):
    with store(write=True) as st:
        account = desk_account(st)
        if not enquiry_id.isdigit() or int(enquiry_id) > 2**63 - 1:
            raise not_found()
        row = st.conn.execute(
            "SELECT id FROM enquiry WHERE id = %s AND programme_id = %s AND open",
            (int(enquiry_id), account["programme_id"]),
        ).fetchone()
        if row is None:
            raise not_found()
        require_steward(account)
        st.conn.execute("UPDATE enquiry SET open = false WHERE id = %s", (row["id"],))
        return Response("", status=204)
