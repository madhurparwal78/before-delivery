"""The public read API, in English and in its Finnish mirror."""

from __future__ import annotations

from flask import Blueprint, redirect

from ..db import is_ready, reachable
from ..domain import previews
from ..domain.references import (
    by_slug,
    current_slug_for_earlier,
    is_live,
    live_sectors,
    live_set,
)
from ..http import (
    first_arg,
    json_response,
    not_found,
    raw_query_for_header,
    store,
)
from .support import (
    PREVIEW_HEADERS,
    detail_entry,
    index_entry,
    served_programme_id,
)

bp = Blueprint("read_api", __name__)


def _get(rule: str, name: str):
    def register(view):
        bp.add_url_rule(
            rule, name, view, methods=["GET"], provide_automatic_options=False
        )
        return view

    return register


@_get("/api/health", "health")
def health():
    if is_ready() and reachable():
        return json_response({"status": "ok"})
    return json_response({"status": "starting"}, 503)


def _index(locale: str):
    sector = first_arg("sector") or None
    with store() as st:
        programme_id = served_programme_id(st)
        rows = live_set(st.conn, programme_id, st.today, sector)
        return json_response([index_entry(st.conn, row, locale) for row in rows])


def _sectors(locale: str):
    with store() as st:
        return json_response(live_sectors(st.conn, served_programme_id(st), st.today))


def _notes(locale: str):
    with store() as st:
        rows = st.conn.execute(
            """SELECT slug, title, preview, published_on FROM note
                WHERE programme_id = %s AND published_on IS NOT NULL
                ORDER BY published_on DESC, slug""",
            (served_programme_id(st),),
        ).fetchall()
        return json_response(
            [
                {
                    "slug": row["slug"],
                    "title": row["title"],
                    "preview": row["preview"],
                    "published_on": row["published_on"].isoformat(),
                }
                for row in rows
            ]
        )


def _detail(locale: str, slug: str):
    prefix = "/api/fi/references/" if locale == "fi" else "/api/references/"
    token = first_arg("preview")
    with store() as st:
        programme_id = served_programme_id(st)
        row = by_slug(st.conn, programme_id, slug)
        if row is not None and is_live(row, st.today):
            return json_response(detail_entry(st.conn, row, locale))
        if row is None:
            current = current_slug_for_earlier(st.conn, programme_id, st.today, slug)
            if current is not None:
                query = raw_query_for_header()
                target = f"{prefix}{current}" + (f"?{query}" if query else "")
                return redirect(target, code=308)
        if token:
            hidden = previews.resolve(st.conn, programme_id, slug, token, st.now)
            if hidden is not None:
                return json_response(
                    detail_entry(st.conn, hidden, locale), headers=PREVIEW_HEADERS
                )
        raise not_found()


@_get("/api/references", "index_en")
def index_en():
    return _index("en")


@_get("/api/fi/references", "index_fi")
def index_fi():
    return _index("fi")


@_get("/api/sectors", "sectors_en")
def sectors_en():
    return _sectors("en")


@_get("/api/fi/sectors", "sectors_fi")
def sectors_fi():
    return _sectors("fi")


@_get("/api/notes", "notes_en")
def notes_en():
    return _notes("en")


@_get("/api/fi/notes", "notes_fi")
def notes_fi():
    return _notes("fi")


@_get("/api/references/<slug>", "detail_en")
def detail_en(slug: str):
    return _detail("en", slug)


@_get("/api/fi/references/<slug>", "detail_fi")
def detail_fi(slug: str):
    return _detail("fi", slug)
