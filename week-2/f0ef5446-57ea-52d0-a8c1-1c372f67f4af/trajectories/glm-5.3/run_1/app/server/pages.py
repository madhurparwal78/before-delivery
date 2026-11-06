"""The public pages. Every route answers 200 with its page when opened
directly; an unknown address answers 404 with the not-found page."""
from __future__ import annotations

import datetime as dt

from jinja2 import Environment, FileSystemLoader, select_autoescape

from . import db, reply_due, state

_env = Environment(
    loader=FileSystemLoader("/app/site/templates"),
    autoescape=select_autoescape(["html"]),
)
_env.filters["berlin"] = reply_due.format_berlin

AGENTS = [
    {
        "slug": "sales-agent", "name": "Sales Agent", "title": "Relayo Sales Agent",
        "promise": "Relayo sits in on your sales calls and turns them into the record your pipeline runs on.",
        "before_title": "Before the call",
        "before": "Relayo reads the invite, the account history and the last conversation, and hands the rep a one-page brief with the account's open questions.",
        "during_title": "During the call",
        "during": "Relayo joins as a participant, captures the whole conversation and marks the objections, next steps and competitor mentions as they happen.",
        "after_title": "After the call",
        "after": "The recap lands in the deal record within a minute, with follow-up tasks assigned and a summary the rep can send on.",
        "capabilities": [
            ("Brief in hand", "A one-page brief before every call, built from your own record."),
            ("Objections, marked", "Every objection is timestamped and searchable across the account."),
            ("Follow-ups that move", "Tasks are assigned while the call is still fresh."),
        ],
    },
    {
        "slug": "education-agent", "name": "Education Agent", "title": "Relayo Education Agent",
        "promise": "Relayo attends every class and gives each student the same complete record.",
        "before_title": "Before class",
        "before": "Relayo collects the reading, the session plan and last week's questions, so the seminar starts where the cohort actually is.",
        "during_title": "During class",
        "during": "Relayo records the discussion, keeps the questions students asked, and notes where the seminar agreed or disagreed.",
        "after_title": "After class",
        "after": "Every student receives the session's searchable notes, with the exam-relevant points surfaced for revision.",
        "capabilities": [
            ("One record for all", "Every student gets the same complete session notes."),
            ("Questions kept", "Student questions are captured, not lost in the room."),
            ("Revision-ready", "Exam-relevant points are surfaced after each session."),
        ],
    },
    {
        "slug": "media-agent", "name": "Media Agent", "title": "Relayo Media Agent",
        "promise": "Relayo keeps the quote, the cut and the whole interview searchable.",
        "before_title": "Before the interview",
        "before": "Relayo gathers the guest's background, the angle and the questions you mean to ask, and keeps them beside the recording.",
        "during_title": "During the interview",
        "during": "Relayo records the conversation and marks the moments worth cutting, with the guest's own words kept verbatim.",
        "after_title": "After the interview",
        "after": "The transcript lands in the edit suite, with the quotes you flagged ready to lift and the audio searchable end to end.",
        "capabilities": [
            ("The quote, kept", "Verbatim quotes are marked the moment they are said."),
            ("Cutting list", "The marked moments become the edit suite's cutting list."),
            ("Searchable audio", "Every word of the recording is searchable."),
        ],
    },
    {
        "slug": "sdr-agent", "name": "SDR Agent", "title": "Relayo SDR Agent",
        "promise": "Relayo qualifies inbound interest while it is still warm, and books the demo with the notes attached.",
        "before_title": "Before the demo",
        "before": "Relayo reads the inbound trail, the account and the prior conversations, and briefs the SDR on what this prospect actually needs.",
        "during_title": "During the demo",
        "during": "Relayo joins the qualification call, captures the requirements as they are stated, and notes the buying signals.",
        "after_title": "After the demo",
        "after": "The recap reaches the account owner with the qualification answered, the requirements listed and the next step booked.",
        "capabilities": [
            ("Warm routing", "Inbound interest reaches the right rep with the trail attached."),
            ("Qualification, answered", "The call answers the qualification questions in the prospect's own words."),
            ("Booked, not lost", "The next meeting leaves the call with notes attached."),
        ],
    },
    {
        "slug": "recruiting-agent", "name": "Recruiting Agent", "title": "Relayo Recruiting Agent",
        "promise": "Relayo gives every interview the same complete record, so hiring decisions rest on evidence.",
        "before_title": "Before the interview",
        "before": "Relayo assembles the role's scorecard, the candidate's trail and the panel's questions, so every interviewer starts from the same page.",
        "during_title": "During the interview",
        "during": "Relayo records the conversation and captures the candidate's answers alongside the scorecard criteria.",
        "after_title": "After the interview",
        "after": "The debrief is recorded as it happens, so the panel compares answers, not memories.",
        "capabilities": [
            ("Same page, every panel", "Every interviewer starts from the same scorecard."),
            ("Answers, not memories", "The candidate's answers are kept verbatim."),
            ("Debrief that lasts", "The decision debrief survives the weekend."),
        ],
    },
]

_USE_CASES = [
    ("Sales Agent", "Run calls that leave a record", "Briefs, objections and follow-ups, on every deal.", "/sales-agent"),
    ("Education Agent", "Teach with one record", "Session notes for the whole cohort, searchable by exam topic.", "/education-agent"),
    ("Media Agent", "Keep the quote", "Verbatim quotes, a cutting list and searchable audio.", "/media-agent"),
    ("SDR Agent", "Qualify while it's warm", "Inbound interest routed and demoed with notes attached.", "/sdr-agent"),
    ("Recruiting Agent", "Decide on evidence", "Interview answers and debriefs, kept and comparable.", "/recruiting-agent"),
]

INTEGRATION_CATEGORIES = [
    "All Integrations", "Collaboration", "CRM", "Calendar", "Desktop App",
    "Mobile", "Browser Extensions", "Storage", "Analytics", "Dialers",
    "Video Conferencing",
]
BLOG_CATEGORIES = ["All", "Product Updates", "Sales", "Education", "Media",
                   "Hiring", "Company"]
PRESS_CATEGORIES = ["All", "News", "Press Releases"]


def _render(template: str, **context) -> tuple[bytes, int]:
    page = _env.get_template(template)
    return page.render(**context).encode("utf-8"), 200


def home() -> tuple[bytes, int]:
    return _render(
        "home.html", agents=AGENTS, use_cases=_USE_CASES,
        nav_categories=INTEGRATION_CATEGORIES,
    )


def agent(slug: str) -> tuple[bytes, int] | None:
    for entry in AGENTS:
        if entry["slug"] == slug:
            return _render("agent.html", agent=entry, agents=AGENTS)
    return None


def integrations() -> tuple[bytes, int]:
    return _render(
        "integrations.html", agents=AGENTS,
        categories=INTEGRATION_CATEGORIES,
    )


def integration_detail(slug: str) -> tuple[bytes, int] | None:
    from .public_lists import _integration_items

    for item in _integration_items(None):
        if item["slug"] == slug:
            return _render(
                "integration.html", agents=AGENTS, integration=item,
            )
    return None


def blog() -> tuple[bytes, int]:
    return _render(
        "blog.html", agents=AGENTS, categories=BLOG_CATEGORIES,
    )


def article_detail(slug: str) -> tuple[bytes, int] | None:
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT slug, title, category, summary, author, read_time,"
                " cover_ref, body, published_at FROM articles"
                " WHERE slug = %s AND published = TRUE"
                " AND published_at <= now()", (slug,),
            )
            row = cur.fetchone()
    if row is None:
        return None
    published = row[8]
    if published.tzinfo is None:
        published = published.replace(tzinfo=dt.timezone.utc)
    return _render(
        "article.html", agents=AGENTS,
        article={
            "slug": row[0], "title": row[1], "category": row[2],
            "summary": row[3], "author": row[4], "read_time": row[5],
            "cover_ref": row[6], "body": row[7],
            "published_at": published.strftime("%Y-%m-%d"),
        },
    )


def press() -> tuple[bytes, int]:
    return _render(
        "press.html", agents=AGENTS, categories=PRESS_CATEGORIES,
    )


def resources() -> tuple[bytes, int]:
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT block, category, title, date, summary, target_link"
                " FROM resource_cards WHERE published = TRUE"
                " ORDER BY date DESC, id DESC"
            )
            rows = cur.fetchall()
    cards = [
        {"block": row[0], "category": row[1], "title": row[2],
         "date": row[3].isoformat(), "summary": row[4],
         "target_link": row[5]}
        for row in rows
    ]
    return _render(
        "resources.html", agents=AGENTS, cards=cards,
        blocks=["Updates", "Case Studies", "Webinars", "Guides", "Videos"],
    )


def careers() -> tuple[bytes, int]:
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT title, location FROM jobs WHERE is_open = TRUE"
                " ORDER BY id"
            )
            rows = cur.fetchall()
    return _render("careers.html", agents=AGENTS, jobs=rows)


def partner_program() -> tuple[bytes, int]:
    from .application_rules import (
        OPTION_COMPANY_TYPES, OPTION_CUSTOMER_SEGMENTS,
        OPTION_EMPLOYEE_BANDS, OPTION_MARKETS,
        OPTION_PARTNERSHIP_INTERESTS, TEXT_FIELDS,
    )
    return _render(
        "partner.html", agents=AGENTS,
        company_types=OPTION_COMPANY_TYPES,
        employee_bands=OPTION_EMPLOYEE_BANDS,
        markets=OPTION_MARKETS,
        customer_segments=OPTION_CUSTOMER_SEGMENTS,
        interests=OPTION_PARTNERSHIP_INTERESTS,
        limits=TEXT_FIELDS,
    )


def review() -> tuple[bytes, int]:
    return _render("review.html", agents=AGENTS)


def not_found() -> tuple[bytes, int]:
    page, _status = _render("not_found.html", agents=AGENTS)
    return page, 404


def render(path: str) -> tuple[bytes | None, int]:
    """The page for a public route, or None when the address is unknown."""
    if not state.ready():
        return None, 503
    if path == "/":
        return home()
    if path in ("/sales-agent", "/education-agent", "/media-agent",
                "/sdr-agent", "/recruiting-agent"):
        page = agent(path[1:])
        return page if page else not_found()
    if path == "/integrations":
        return integrations()
    if path.startswith("/integration/"):
        page = integration_detail(path[len("/integration/"):])
        return page if page else not_found()
    if path == "/blog":
        return blog()
    if path.startswith("/blog/"):
        page = article_detail(path[len("/blog/"):])
        return page if page else not_found()
    if path == "/press":
        return press()
    if path == "/resources":
        return resources()
    if path == "/careers":
        return careers()
    if path == "/partner-program":
        return partner_program()
    if path == "/review":
        return review()
    if path == "/favicon.ico":
        return b"", 404
    return not_found()
