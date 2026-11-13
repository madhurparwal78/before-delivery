"""The public pages, mounted at / and again at /fi, the desk page, and the error pages."""
from datetime import date
from urllib.parse import quote

import psycopg
from flask import Blueprint, render_template, request

from . import clock, content, library, settings
from .api import PREVIEW_HEADERS, moved_address
from .copy import copy_for
from .store import db

pages = Blueprint("pages", __name__)
desk = Blueprint("desk", __name__)

FEATURED_COUNT = 3
PAGE_METHODS = "GET, HEAD"
# What may follow a path segment unescaped, so a language link repeats an address as it was written.
PATH_SAFE = "/-._~!$&'()*+,;=:@"


def is_finnish_path(path):
    return path == "/fi" or path.startswith("/fi/")


def other_language_address(path, query):
    """The same route and raw query in the other language."""
    path = quote(path, safe=PATH_SAFE)
    if is_finnish_path(path):
        other = path[len("/fi"):] or "/"
    else:
        other = "/fi" if path == "/" else "/fi" + path
    return other + (f"?{query}" if query else "")


def settle_for_page():
    """Every page that needs the store settles the run first; raises while Postgres is unreachable."""
    library.settle_every_run(db())


def footer_line():
    """The footer's year and programme name, worked out when the page is served; (None, None) in an outage."""
    try:
        conn = db()
        return clock.today(conn).year, library.served_programme(conn)["name"]
    except psycopg.OperationalError:
        return None, None


def render_page(template, status=200, **context):
    """Render a public page with its chrome: language, alternate, switch, footer year and programme name."""
    finnish = is_finnish_path(request.path)
    year, programme_name = footer_line()
    return render_template(
        template, t=copy_for(finnish), lang="fi" if finnish else "en", prefix="/fi" if finnish else "",
        other_lang="en" if finnish else "fi",
        alternate=other_language_address(request.path, request.query_string.decode("latin-1")),
        year=year, programme_name=programme_name, **context), status


def page_row(row, finnish):
    """An index row for a page: the API entry, plus the language its title is written in."""
    return library.index_entry(row, finnish) | {"title_lang": "fi" if finnish and row["title_fi"] else "en"}


@pages.get("/", strict_slashes=False)
def home():
    conn = db()
    programme_id = library.served_programme(conn)["id"]
    finnish = is_finnish_path(request.path)
    featured = [page_row(row, finnish) for row in library.live_rows(conn, programme_id)[:FEATURED_COUNT]]
    return render_page("home.html", featured=featured, quote=library.first_live_quote(conn, programme_id),
                       panels=content.SERVICE_PANELS, current=None)


def sector_echo(sector):
    """The sector value as the count line repeats it: no NUL, no undecodable byte."""
    return sector.replace("\0", "").replace("�", "")


@pages.get("/references")
def references():
    conn = db()
    programme_id = library.served_programme(conn)["id"]
    sector = request.args.get("sector") or None
    finnish = is_finnish_path(request.path)
    rows = [page_row(row, finnish) for row in library.live_rows(conn, programme_id, sector)]
    return render_page("references.html", rows=rows, sector=sector, sector_echo=sector_echo(sector or ""),
                       sectors=library.live_sectors(conn, programme_id), current="references")


@pages.get("/references/<slug>")
def reference(slug):
    conn = db()
    found, row = library.find_public_reference(conn, library.served_programme(conn)["id"], slug,
                                               request.args.get("preview"))
    if found == "moved":
        return "", 301, {"Location": moved_address(row)}
    if found is None:
        return not_found_page()
    finnish = is_finnish_path(request.path)
    detail = library.reference_detail(conn, row, finnish)
    translated = detail.get("translated", False)
    # Without a Finnish body the page reads in English throughout, title included.
    title_lang = "fi" if translated and row["title_fi"] else "en"
    page, status = render_page(
        "detail.html", reference=detail, previewing=found == "preview", translated=translated,
        title=row["title_fi"] if title_lang == "fi" else row["title"], title_lang=title_lang,
        figures=[(figure["value"], figure["label"]) for figure in detail["figures"]],
        social_image=f"{settings.PUBLIC_URL}/static/img/social-preview.png", current=None)
    return page, status, PREVIEW_HEADERS if found == "preview" else {}


@pages.get("/programme")
def programme():
    return render_page("programme.html", chapters=content.PROGRAMME_CHAPTERS, quote=content.PROGRAMME_QUOTE,
                       figures=content.PROGRAMME_FIGURES, terms=content.TERMS, current="programme")


@pages.get("/story")
def story():
    return render_page("story.html", chapters=content.STORY_CHAPTERS, quote=content.STORY_QUOTE,
                       figures=content.STORY_FIGURES, current="story")


MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December")


def display_date(day, finnish):
    return f"{day.day}.{day.month}.{day.year}" if finnish else f"{day.day} {MONTHS[day.month - 1]} {day.year}"


@pages.get("/notes")
def notes():
    conn = db()
    finnish = is_finnish_path(request.path)
    dated = [note | {"display_date": display_date(date.fromisoformat(note["published_on"]), finnish)}
             for note in library.dated_notes(conn, library.served_programme(conn)["id"])]
    return render_page("notes.html", notes=dated, current="notes")


@pages.get("/contact")
def contact():
    conn = db()
    finnish = is_finnish_path(request.path)
    choices = [page_row(row, finnish) for row in library.live_rows(conn, library.served_programme(conn)["id"])]
    return render_page("contact.html", choices=choices, managers=content.MANAGERS, privacy=content.PRIVACY,
                       current=None)


@desk.get("/desk")
def desk_page():
    return render_template("desk.html", public_url=settings.PUBLIC_URL,
                           text_fields=[name for name in library.EDITABLE_FIELDS if name != "figures"])


def not_found_page():
    return render_page("not_found.html", status=404, current=None)


def not_allowed_page():
    page, status = render_page("unavailable.html", status=405, heading_key="not_allowed", current=None)
    return page, status, {"Allow": PAGE_METHODS}


def outage_page():
    """Postgres is unreachable: a page carrying the outage sentence, rendered without the store."""
    return render_page("unavailable.html", status=503, heading_key="unavailable", current=None)
