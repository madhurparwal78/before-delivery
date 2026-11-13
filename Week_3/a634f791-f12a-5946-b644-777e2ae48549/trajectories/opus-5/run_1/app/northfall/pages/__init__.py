"""The served pages, each answering at its English address and under /fi."""

from __future__ import annotations

import json
from functools import partial

from flask import Blueprint, redirect, render_template

from ..config import SERVED_PROGRAMME
from ..domain import previews
from ..domain.references import (
    by_slug,
    current_slug_for_earlier,
    figures_of,
    is_live,
    live_sectors,
    live_set,
    programme_id_for,
    quote_of,
)
from ..http import PREVIEW_HEADERS, first_arg, not_found, raw_query_for_header, store
from ..strings import index_count, note_date, table
from . import content
from .render import chrome, echo, path_for

bp = Blueprint("pages", __name__)


def _served(st) -> int:
    return programme_id_for(st.conn, SERVED_PROGRAMME)


def _title(t: dict, heading: str) -> str:
    return f"{heading} \u2014 Northfall {t['wordmark_tail']}"


def _shown_title(row, locale: str) -> str:
    if locale == "fi" and row["title_fi"]:
        return row["title_fi"]
    return row["title"]


def _row_entry(conn, row, locale: str) -> dict:
    figures = figures_of(conn, row["id"])
    return {
        "ordinal": row["ordinal"],
        "sector": row["sector"],
        "title": _shown_title(row, locale),
        "href": path_for(locale, "detail", row["slug"]),
        "figure": figures[0] if figures else None,
    }


def home(locale: str):
    t = table(locale)
    with store() as st:
        rows = live_set(st.conn, _served(st), st.today)
        quoted = next((row for row in rows if row["quote"] is not None), None)
        context = chrome(
            locale,
            route="home",
            title=_title(t, t["home_heading"]),
            description=t["home_sub"],
            year=st.today.year,
        )
        return render_template(
            "home.html",
            featured=[_row_entry(st.conn, row, locale) for row in rows[:3]],
            quote=quote_of(quoted) if quoted is not None else None,
            panels=content.HOME_PANELS[locale],
            programme_href=path_for(locale, "programme"),
            **context,
        )


def index(locale: str):
    t = table(locale)
    sector = first_arg("sector") or None
    with store() as st:
        programme_id = _served(st)
        sectors = live_sectors(st.conn, programme_id, st.today)
        rows = live_set(st.conn, programme_id, st.today, sector)
        index_href = path_for(locale, "references")
        filters = [
            {"href": index_href, "label": t["all_sectors"], "current": sector is None}
        ] + [
            {
                "href": f"{index_href}?sector={name}",
                "label": name,
                "current": sector == name,
            }
            for name in sectors
        ]
        context = chrome(
            locale,
            route="references",
            title=_title(t, t["index_heading"]),
            description=t["home_sub"],
            year=st.today.year,
        )
        return render_template(
            "index.html",
            entries=[_row_entry(st.conn, row, locale) for row in rows],
            filters=filters,
            count_line=index_count(locale, len(rows), echo(sector) if sector else None),
            **context,
        )


def detail(locale: str, slug: str):
    token = first_arg("preview")
    with store() as st:
        programme_id = _served(st)
        row = by_slug(st.conn, programme_id, slug)
        if row is not None and is_live(row, st.today):
            return _detail_page(st, locale, row, preview=False)
        if row is None:
            current = current_slug_for_earlier(st.conn, programme_id, st.today, slug)
            if current is not None:
                query = raw_query_for_header()
                target = path_for(locale, "detail", current)
                return redirect(target + (f"?{query}" if query else ""), code=308)
        if token:
            hidden = previews.resolve(st.conn, programme_id, slug, token, st.now)
            if hidden is not None:
                return _detail_page(st, locale, hidden, preview=True)
        raise not_found()


def _detail_page(st, locale: str, row, *, preview: bool):
    t = table(locale)
    title = _shown_title(row, locale)
    context = chrome(
        locale,
        route=None,
        title=_title(t, title),
        description=row["summary"],
        year=st.today.year,
        noindex=preview,
    )
    body = render_template(
        "detail.html",
        reference=row,
        display_title=title,
        figures=figures_of(st.conn, row["id"]),
        quote=quote_of(row),
        translated=bool(row["body_fi"]) if locale == "fi" else True,
        finnish_body=row["body_fi"].split("\n\n") if row["body_fi"] else [],
        preview=preview,
        **context,
    )
    if preview:
        return body, 200, PREVIEW_HEADERS
    return body


def programme(locale: str):
    t = table(locale)
    addresses = {
        "index": path_for(locale, "references"),
        "contact": path_for(locale, "contact"),
        "note": path_for(locale, "notes"),
    }
    with store() as st:
        chapters = [
            {
                "fragment": chapter["fragment"],
                "eyebrow": chapter["eyebrow"],
                "heading": heading,
                "paragraphs": [text.format(**addresses) for text in chapter["paragraphs"]],
            }
            for chapter, heading in zip(
                content.PROGRAMME_CHAPTERS[locale], t["chapter_titles"], strict=True
            )
        ]
        context = chrome(
            locale,
            route="programme",
            title=_title(t, t["programme_heading"]),
            description=t["home_sub"],
            year=st.today.year,
        )
        return render_template(
            "programme.html",
            chapters=chapters,
            pull_quote=content.PROGRAMME_QUOTE[locale],
            figure_pairs=content.PROGRAMME_FIGURES[locale],
            **context,
        )


def story(locale: str):
    t = table(locale)
    with store() as st:
        context = chrome(
            locale,
            route="story",
            title=_title(t, t["story_heading"]),
            description=t["home_sub"],
            year=st.today.year,
        )
        return render_template(
            "story.html",
            chapters=content.STORY_CHAPTERS[locale],
            pull_quote=content.STORY_QUOTE[locale],
            figure_pairs=content.STORY_FIGURES[locale],
            **context,
        )


def notes(locale: str):
    t = table(locale)
    with store() as st:
        rows = st.conn.execute(
            """SELECT title, preview, published_on FROM note
                WHERE programme_id = %s AND published_on IS NOT NULL
                ORDER BY published_on DESC, slug""",
            (_served(st),),
        ).fetchall()
        entries = [
            {
                "title": row["title"],
                "preview": row["preview"],
                "date_text": note_date(locale, row["published_on"]),
                "date_value": row["published_on"].isoformat(),
            }
            for row in rows
        ]
        count = (
            t["notes_count_one"]
            if len(entries) == 1
            else t["notes_count_many"].format(n=len(entries))
        )
        context = chrome(
            locale,
            route="notes",
            title=_title(t, t["notes_heading"]),
            description=t["home_sub"],
            year=st.today.year,
        )
        return render_template("notes.html", entries=entries, count_line=count, **context)


def contact(locale: str):
    t = table(locale)
    with store() as st:
        rows = live_set(st.conn, _served(st), st.today)
        context = chrome(
            locale,
            route="contact",
            title=_title(t, t["contact_heading"]),
            description=t["home_sub"],
            year=st.today.year,
        )
        return render_template(
            "contact.html",
            managers=content.MANAGERS,
            choices=[
                {"slug": row["slug"], "title": _shown_title(row, locale)} for row in rows
            ],
            enquiry_copy=_enquiry_copy(t),
            **context,
        )


def _enquiry_copy(t: dict) -> str:
    """The published wording the enquiry form needs once script is running."""
    return json.dumps(
        {
            "submit": t["submit"],
            "pending": t["submit_pending"],
            "success": t["enquiry_success"],
            "refused": t["enquiry_refused"],
            "outage": t["enquiry_outage"],
            "errors": t["errors"],
        },
        ensure_ascii=False,
    ).replace("</", "<\\/")


def legal(locale: str, kind: str):
    t = table(locale)
    page = content.LEGAL[kind][locale]
    with store() as st:
        context = chrome(
            locale,
            route=None,
            title=_title(t, page["heading"]),
            description=page["heading"],
            year=st.today.year,
        )
        return render_template("legal.html", page=page, **context)


def desk():
    return render_template("desk.html")


PUBLIC_ROUTES = (
    ("", "home", home),
    ("/references", "index", index),
    ("/references/<slug>", "detail", detail),
    ("/programme", "programme", programme),
    ("/story", "story", story),
    ("/notes", "notes", notes),
    ("/contact", "contact", contact),
    ("/privacy", "privacy", partial(legal, kind="privacy")),
    ("/terms", "terms", partial(legal, kind="terms")),
)


def _register() -> None:
    for locale, prefix in (("en", ""), ("fi", "/fi")):
        for tail, name, view in PUBLIC_ROUTES:
            rules = [f"{prefix}{tail}" or "/"]
            if not tail and prefix:
                rules.append(f"{prefix}/")
            for number, rule in enumerate(rules):
                bp.add_url_rule(
                    rule,
                    f"{name}_{locale}_{number}",
                    partial(view, locale),
                    methods=["GET"],
                    provide_automatic_options=False,
                )
    bp.add_url_rule("/desk", "desk", desk, methods=["GET"], provide_automatic_options=False)


_register()
