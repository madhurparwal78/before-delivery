"""Server-rendered pages. Each one arrives complete and readable without script."""

from flask import Blueprint, redirect, render_template, request

from . import catalogue, copy, fields, journal, records
from .db import confirm_store, transaction
from .errors import not_found

pages = Blueprint("pages", __name__)

HOME_JOURNAL_COUNT = 3


@pages.before_request
def require_store():
    """The site is offline whenever its one store is unreachable."""
    confirm_store()


@pages.get("/")
def home():
    with transaction() as cursor:
        published = catalogue.published_catalogue(cursor)
        figures = records.figures(cursor)
        entries = journal.public_entries(cursor, limit=HOME_JOURNAL_COUNT)
        recognitions = records.recognitions(cursor)
    return render_template(
        "home.html",
        page_title=copy.HOME_TITLE,
        featured=[entry for entry in published if entry["featured"]],
        figures=figures,
        entries=entries,
        recognitions=recognitions,
    )


@pages.get("/work")
def work_index():
    given = request.args.getlist("discipline")
    if given and (len(given) > 1 or given[0] not in fields.DISCIPLINES):
        return redirect("/work", code=302)
    discipline = given[0] if given else None
    with transaction() as cursor:
        published = catalogue.published_catalogue(cursor)
    shown = catalogue.filtered(published, discipline)
    return render_template(
        "work_index.html",
        page_title=copy.WORK_TITLE,
        discipline=discipline,
        cases=shown,
        count_announcement=copy.catalogue_count(len(shown)),
    )


@pages.get("/work/<slug>")
def work_detail(slug):
    with transaction() as cursor:
        published = catalogue.published_catalogue(cursor)
    index, entry = catalogue.find_published(published, slug)
    if entry is None:
        raise not_found()
    previous, following = catalogue.neighbours(published, index)
    return render_template(
        "work_detail.html",
        page_title=f"{entry['title']} - {copy.SITE_NAME}",
        case=entry,
        previous=previous,
        following=following,
    )


@pages.get("/journal")
def journal_index():
    with transaction() as cursor:
        entries = journal.public_entries(cursor)
    return render_template(
        "journal_index.html", page_title=copy.JOURNAL_TITLE, entries=entries
    )


@pages.get("/journal/<slug>")
def journal_detail(slug):
    with transaction() as cursor:
        entry = journal.public_entry(cursor, slug)
    if entry is None:
        raise not_found()
    return render_template(
        "journal_detail.html",
        page_title=f"{entry['title']} - {copy.SITE_NAME}",
        entry=entry,
        paragraphs=journal.paragraphs(entry["body"]),
    )


@pages.get("/contact")
def contact():
    return render_template("contact.html", page_title=copy.CONTACT_TITLE)


@pages.get("/studio/login")
def studio_login():
    return render_template("studio_login.html", page_title=copy.STUDIO_LOGIN_TITLE)


@pages.get("/studio")
def studio():
    return render_template("studio.html", page_title=copy.STUDIO_TITLE)
