"""HTML pages: public marketing, directory, trending, safety, support, account and error pages.

Pages render the shell and the copy; live data is read from the API in the browser so one rule
decides every answer. The server decides only what must be right in the first response: titles,
headings, the not-found page and which records exist.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from flask import Flask, Response, make_response, render_template, request, send_from_directory

from . import catalog, communities, counts, db, safety_data, trending as trending_api, trending_data

LOCALES = [("en-US", "English (US)"), ("en-GB", "English (UK)"), ("de-DE", "Deutsch"), ("nl-NL", "Nederlands")]
STATIC = Path(__file__).resolve().parent.parent / "static"
STATIC_VERSION = str(max((int(p.stat().st_mtime) for p in STATIC.rglob("*") if p.is_file()), default=0))

PLATFORMS = ["Windows", "macOS", "Linux", "Android", "iOS"]

TRACKS = [
    {"title": "Night Shift Lo-fi", "file": "night-shift-lofi.ogg",
     "blurb": "Soft keys and tape hiss for the last hour before the raid."},
    {"title": "Aurora Drift", "file": "aurora-drift.ogg",
     "blurb": "Slow synth swells that follow the northern lights across the lobby."},
    {"title": "Ronin Rain", "file": "ronin-rain.ogg",
     "blurb": "Plucked strings and distant thunder for a quiet tactics night."},
]

SAFETY_PAGES: dict[str, dict[str, Any]] = {
    "/safety-family-center": {
        "title": "Family Center", "slug": "family-center",
        "summary": "Tools that help families set up healthy habits together.",
        "sections": [
            ("Start with a conversation", "Talk about who your teen chats with and which communities they join. Community Hub keeps every community's rules in plain view."),
            ("Know the controls", "Members can mute a community, leave at any time and report a message. Owners decide who can see and say what in each channel."),
            ("Stay in touch", "Reach out to our support team at any time. We answer every safety request and never ask for a password."),
        ]},
    "/safety-library": {
        "title": "Safety Library", "slug": "library",
        "summary": "Search guides on reporting, privacy and wellbeing.", "sections": []},
    "/safety-news": {
        "title": "Safety News", "slug": "news",
        "summary": "Updates about how we keep communities welcoming.",
        "sections": [
            ("Clearer roles for moderators", "Moderators now act only on members ranked below them, so a ban can never be turned against the person who gave the role."),
            ("Time-outs follow the server clock", "A time-out ends when the server says it ends, whatever a device clock reads."),
            ("Invites that expire on time", "An invite link stops working at the exact second its owner promised."),
        ]},
    "/safety-teen-charter": {
        "title": "Teen Charter", "slug": "teen-charter",
        "summary": "Five promises we make to every member under eighteen.", "sections": []},
    "/safety-players-guide": {
        "title": "Player's Guide", "slug": "players-guide",
        "summary": "Good habits for every crew, from first message to last call.",
        "sections": [
            ("Be kind in the lobby", "Treat every channel like a room full of people you want to see again. Mention only the people who need to hear from you."),
            ("Protect your account", "Use a password you use nowhere else. Change it if you suspect someone else knows it; every other session signs out at once."),
            ("Report what breaks the rules", "Use Report on any message. Moderators see it first, and Support follows up when you ask."),
        ]},
    "/safety-parents": {
        "title": "Parents' Guide", "slug": "parents",
        "summary": "What parents should know before a child joins a community.",
        "sections": [
            ("Communities are opt-in", "Nobody is added to a community without joining it. Invites expire and can be revoked by their owner."),
            ("Private by default", "Other members see only a public name and picture. Email addresses never appear in a channel or a live update."),
            ("You can always ask", "Submit a request from the Support page and a person will reply by email."),
        ]},
}

CHARTER = [
    ("You choose who sees you", "Other members see only your public name and picture. Switch to invisible whenever you like."),
    ("You can leave any time", "Leaving a community takes one press and keeps your account untouched."),
    ("Reports get read", "Every report reaches a person. Support answers by email."),
    ("Rules are visible", "Each community's roles and channel rules are set by its owner and applied by the server on every message."),
    ("Your data stays yours", "We store only what the product needs and never sell it."),
]

TRENDING_CATEGORIES = [("all", "All"), ("adventure", "Adventure"), ("indie", "Indie"), ("simulation", "Simulation"),
                       ("rpg", "RPG"), ("shooter", "Shooter"), ("fantasy", "Fantasy")]

NEWS_DATES = ["October 20, 2026", "October 13, 2026", "October 6, 2026"]


def _locale() -> str:
    value = request.cookies.get("hub_locale", "en-US")
    return value if value in dict(LOCALES) else "en-US"


def render_page(template: str, title: str, *, field: str = "dark", status: int = 200, **context: Any) -> Response:
    consent = request.cookies.get("hub_consent", "")
    html = render_template(template, title=f"{title} - Community Hub", field=field, locale=_locale(), locales=LOCALES,
                           consent_cookie=consent, version=STATIC_VERSION, **context)
    response = make_response(html, status)
    response.headers["Content-Type"] = "text/html; charset=utf-8"
    return response


def _directory_initial() -> dict[str, Any] | None:
    """The answer for the address the visitor opened, so the first paint already holds the grid; None when the
    address holds a value the API would refuse, and the page then asks the API and shows its answer."""
    q = request.args.get("q", "").strip()
    category = request.args.get("category", "all")
    page = request.args.get("page", "1")
    if len(q) > 100 or "\x00" in q or "\ufffd" in q or category not in catalog.CATEGORY_IDS:
        return None
    if not re.fullmatch(r"[0-9]{1,4}", page) or not 1 <= int(page) <= 1000:
        return None
    return {"q": q, "category": category, "page": int(page),
            "answer": communities.directory_listing(q, category, int(page), 12)}


def not_found_page(status: int = 404) -> Response:
    return render_page("not_found.html", "Page not found", status=status)


def _detect_platform() -> str:
    agent = request.headers.get("User-Agent", "")
    if re.search(r"Android", agent):
        return "Android"
    if re.search(r"iPhone|iPad|iPod", agent):
        return "iOS"
    if re.search(r"Windows", agent):
        return "Windows"
    if re.search(r"Macintosh|Mac OS X", agent):
        return "macOS"
    if re.search(r"Linux|X11|CrOS", agent):
        return "Linux"
    return "Windows"


@lru_cache(maxsize=None)
def _track_seconds(filename: str) -> int:
    """Length of an Ogg Opus file in whole seconds, read from the last page's granule position."""
    data = (STATIC / "media" / filename).read_bytes()
    head = data.find(b"OpusHead")
    pre_skip = int.from_bytes(data[head + 10:head + 12], "little") if head >= 0 else 0
    last = data.rfind(b"OggS")
    granule = int.from_bytes(data[last + 6:last + 14], "little")
    return (granule - pre_skip) // 48000


def _clock(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def _community(slug: str) -> dict[str, Any] | None:
    return db.one_row(
        f"SELECT k.id, k.slug, k.name, k.description, k.icon, k.banner, k.verified, k.partnered, "
        f"{counts.MEMBER_COUNT} AS member_count, {counts.PRESENCE_COUNT} AS presence_count "
        "FROM communities k WHERE k.slug = %s AND k.published", (slug,))


def _price(cents: int) -> str:
    return f"${cents // 100}.{cents % 100:02d} / MONTH"


def register(app: Flask) -> None:
    @app.get("/")
    def home() -> Response:
        return render_page("home.html", "Home")

    @app.get("/download")
    def download() -> Response:
        mine = _detect_platform()
        return render_page("download.html", "Download", platform=mine, others=[p for p in PLATFORMS if p != mine])

    @app.get("/membership")
    def membership() -> Response:
        perks = [("Custom emoji anywhere", "custom_emoji"), ("Larger uploads", "larger_uploads"),
                 ("Custom app icons", "custom_app_icons"), ("Longer messages", "longer_messages")]
        tiers = [{"id": t, "name": catalog.TIER_NAMES[t], "perks": [e in catalog.ENTITLEMENTS[t] for _, e in perks]}
                 for t in ("free", "basic", "max")]
        prices = {t: _price(c) for t, c in catalog.TIER_PRICES.items()}
        faq = [("When do my perks start?", "Perks switch on the moment checkout succeeds, on every device you sign in to."),
               ("Can I change tiers later?", "Yes. Move between Basic and Max at any time from this page; the new perks apply at once."),
               ("What happens if I cancel?", "You return to the free tier straight away and keep every community and message.")]
        return render_page("membership.html", "Membership", perks=[p for p, _ in perks], tiers=tiers, prices=prices, faq=faq)

    @app.get("/servers")
    def directory() -> Response:
        return render_page("servers.html", "Discover communities", field="light", categories=catalog.CATEGORIES,
                           initial=_directory_initial(), counts=communities.category_counts())

    @app.get("/servers/<slug>")
    def community(slug: str) -> Response:
        row = _community(slug)
        if row is None:
            return not_found_page()
        return render_page("server_detail.html", row["name"], field="light", community=row)

    @app.get("/trending-games")
    def trending() -> Response:
        return render_page("trending.html", "Trending games", categories=TRENDING_CATEGORIES,
                           initial=trending_api.initial_chart(request.args.get("week"), request.args.get("category")))

    @app.get("/game/<slug>")
    def game(slug: str) -> Response:
        entry = trending_data.GAMES.get(slug)
        if entry is None:
            return not_found_page()
        return render_page("game.html", entry["name"], slug=slug, name=entry["name"])

    @app.get("/listening-room")
    def listening() -> Response:
        tracks = [{**t, "length": _clock(_track_seconds(t["file"])), "src": f"/static/media/{t['file']}"} for t in TRACKS]
        return render_page("listening_room.html", "Listening room", tracks=tracks)

    @app.get("/support")
    def support() -> Response:
        return render_page("support.html", "Support")

    @app.get("/support/new")
    def support_new() -> Response:
        return render_page("support_new.html", "Submit a request")

    @app.get("/safety")
    def safety() -> Response:
        cards = [(path, page["title"], page["summary"]) for path, page in SAFETY_PAGES.items()]
        return render_page("safety.html", "Safety Center", cards=cards)

    def safety_view(path: str) -> Any:
        page = SAFETY_PAGES[path]

        def view() -> Response:
            if path == "/safety-library":
                listed = [{key: article[key] for key in ("slug", "title", "category", "topic", "summary")}
                          for article in safety_data.ARTICLES]
                return render_page("safety_library.html", page["title"], page=page, categories=safety_data.CATEGORIES,
                                   topics=safety_data.TOPICS, initial={"data": listed})
            if path == "/safety-teen-charter":
                return render_page("safety_charter.html", page["title"], page=page, cards=CHARTER)
            news = list(zip(NEWS_DATES, page["sections"])) if path == "/safety-news" else None
            return render_page("safety_page.html", page["title"], page=page, news=news)

        return view

    for path in SAFETY_PAGES:
        app.add_url_rule(path, "safety_" + SAFETY_PAGES[path]["slug"], safety_view(path), methods=["GET"])

    @app.get("/safety-library/<slug>")
    def safety_article(slug: str) -> Response:
        article = next((a for a in safety_data.ARTICLES if a["slug"] == slug), None)
        if article is None:
            return not_found_page()
        return render_page("safety_article.html", article["title"], article=article)

    @app.get("/login")
    def login() -> Response:
        return render_page("login.html", "Log in")

    @app.get("/register")
    def register_page() -> Response:
        return render_page("register.html", "Create an account")

    @app.get("/verify-email")
    def verify_email() -> Response:
        response = render_page("verify_email.html", "Confirm your email")
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.get("/settings")
    def settings() -> Response:
        return render_page("settings.html", "Settings")

    @app.get("/favicon.ico")
    def favicon() -> Response:
        return send_from_directory(STATIC, "favicon.svg", mimetype="image/svg+xml")

