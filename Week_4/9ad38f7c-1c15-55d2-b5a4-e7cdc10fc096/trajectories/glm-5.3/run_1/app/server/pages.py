"""The pages. Markup is built with escaping by default; no user text is ever
joined into markup by hand."""

import datetime
import mimetypes
import os
import re
from html import escape
from urllib.parse import unquote

SSE_HEARTBEAT = 13.0
STATIC_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
MEDIA_DIR = "/app/assets"
VTT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "media", "briefing.vtt")
ASSET_FILM = "/app/assets/moths-drawn-to-park-lights-246f8064.webm"
ASSET_SOUND = "/app/assets/john-bartmann-breathing-down-my-neck-master-90c3b95a.ogg"

PLATFORM_PAGES = {
    "/": ("Anyone can learn cyber security with NightWard",
          "Hands-on cyber security training through real-world scenarios"),
    "/hacktivities": ("Hacktivities", None),
    "/aisecurity": ("AI Security", None),
    "/classrooms": ("Classrooms", None),
    "/pricing": ("Pricing", None),
    "/business": ("Business", None),
    "/certifications": ("Certifications", None),
    "/about": ("About Us", None),
    "/glossary": ("Glossary", None),
    "/cyber-security-careers": ("Careers in Cyber", None),
    "/community": ("Community", None),
}

NAV_ITEMS = [
    ("Learn", "/hacktivities"),
    ("Practice", "/classrooms"),
    ("Compete", "/hacktivities"),
    ("AI Upskilling", "/aisecurity"),
    ("Education", "/classrooms"),
    ("Business", "/business"),
    ("Pricing", "/pricing"),
    ("Downtime", "/downtime"),
    ("Certifications", "/certifications"),
]

FOOTER_COLUMNS = [
    ("Learning", [("Hands-on labs", "/hacktivities"), ("For Business", "/business"),
                  ("For Education", "/classrooms"), ("Competitive Hacking", "/hacktivities"),
                  ("Certifications", "/certifications")]),
    ("Resources", [("About Us", "/about"), ("Newsroom", "/about"), ("Blog", "/about"),
                   ("Glossary", "/glossary"), ("Work at NightWard", "/about"),
                   ("Careers in Cyber", "/cyber-security-careers"), ("Swag Shop", "/community"),
                   ("Community", "/community")]),
    ("Privacy & Legal", [("Privacy Policy", "/about"), ("Terms of Use", "/about"),
                         ("AI Terms of Use", "/about"), ("Acceptable Use Policy", "/about"),
                         ("Cookie Policy", "/about")]),
    ("Get in touch", [("Contact Us", "/community"), ("Affiliates", "/community"),
                      ("Student Discount", "/pricing")]),
]

FAQ_ITEMS = [
    ("What is Strange & Unusual Activity?",
     "It's NightWard's free, five-day Downtime CTF event. A crew called Velvet Moth "
     "has broken into the network of the game studio Gravelight Studios, taken the "
     "unreleased build and stayed. Your team works eight defensive scenarios to "
     "find out what's really going on."),
    ("When does it run?",
     "The event opens on Thursday 22 October 2026 at 4:00 PM UTC and closes on Monday "
     "26 October 2026 at 11:59 PM UTC. You can join on any day and play at your own pace."),
    ("How long does it take?",
     "Each team plays at its own pace. Most teams finish in a few hours; you can "
     "spread the eight scenarios across the five days."),
    ("How can I prepare for the simulators?",
     "Sign up for a free NightWard account and try the alert triage, threat hunting "
     "and incident response rooms beforehand. All you need is a browser."),
    ("How much does it cost?",
     "Nothing. Downtime is free to join for individuals and teams."),
    ("How does scoring work?",
     "Points are fixed per scenario: 500 for each of the SOC simulator, the threat "
     "hunting simulator and the tabletop, and 60, 80, 90, 100 and 120 for the five "
     "challenges. A team's score is the sum of the points of its team solves."),
    ("How do raffle tickets work?",
     "You earn one raffle ticket for every scenario you complete yourself, wherever "
     "your team ranks. Claiming the webinar bonus adds 2 more tickets."),
    ("How is the winner decided?",
     "The team with the highest score when the event closes on Monday 26 October "
     "wins. If two teams tie, the one that completed first ranks higher. There are "
     "no first-blood bonuses."),
    ("What can we win?",
     "Leaderboard prizes go to the top three teams, and raffle prizes are drawn "
     "from individual tickets. Over $40,000 in prizes."),
    ("Do I get a certificate?",
     "Yes. Once your team has solved all eight scenarios, every current member can "
     "download a certificate of completion."),
    ("Who is it for?",
     "Blue team defensive practitioners of any level, from junior to manager. "
     "Well-rounded professional teams have the advantage."),
    ("Do I need a team?",
     "No. Solo players can enter as a team of one."),
    ("How big can a team be?",
     "Up to twenty players."),
    ("Can I be in more than one team?",
     "No. A player is in one team at a time, but you can leave one team and join "
     "another during the event."),
    ("Can colleagues from other companies or regions join my team?",
     "Yes. Anyone with the invite code can join your team, up to twenty members."),
    ("Will my company's name be on the leaderboard?",
     "The leaderboard shows team names only. No email address ever appears on it."),
    ("When are winners announced?",
     "After the event closes on Monday 26 October 2026 at 11:59 PM UTC."),
]

SCENARIO_KIND_LABELS = {
    "soc-sim": "SOC Sim Scenario",
    "th-sim": "Threat Hunting Sim Scenario",
    "tabletop": "Tabletop Exercise",
    "challenge": "Challenge",
}

UTC_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
              "August", "September", "October", "November", "December"]


def utc_text(iso_text):
    """Every time shown on a page, in UTC: day, month name, year and a
    24-hour time followed by "UTC"."""
    try:
        moment = datetime.datetime.strptime(iso_text, "%Y-%m-%dT%H:%M:%SZ")
    except (ValueError, TypeError):
        return iso_text
    return "%d %s %d, %02d:%02d UTC" % (moment.day, UTC_MONTHS[moment.month - 1],
                                        moment.year, moment.hour, moment.minute)


def esc(value):
    return escape(str(value), quote=True)


def safe_redirect(raw):
    """The return-address check, in one place. The browser follows the value
    only when it names a same-origin path: it begins with exactly one /,
    holds no backslash, no scheme, no control character or whitespace, and
    stays on the page's own origin. Anything else lands on /downtime."""
    if not raw or not raw.startswith("/"):
        return "/downtime"
    if raw.startswith("//") or (len(raw) > 1 and raw[1] in ("/", "\\")):
        return "/downtime"
    if "\\" in raw:
        return "/downtime"
    if re.search(r"[a-zA-Z][a-zA-Z0-9+.-]*:", raw):
        return "/downtime"
    for char in raw:
        if ord(char) < 0x21 or ord(char) == 0x7f:
            return "/downtime"
    return raw


def page_for_path(path, query, outage=False):
    """Every page route. Returns (status, body, extra headers, kind)."""
    if path == "/downtime":
        return 200, event_page().encode(), [], "html"
    if path == "/downtime/team":
        return 200, team_room_page().encode(), [], "html"
    if path.startswith("/downtime/scenarios/"):
        slug = unquote(path[len("/downtime/scenarios/"):])
        return 200, scenario_page(slug).encode(), [], "html"
    if path == "/downtime/certificate":
        return 200, certificate_page().encode(), [], "html"
    if path == "/signup":
        return 200, account_page("signup").encode(), [], "html"
    if path == "/login":
        return 200, account_page("login").encode(), [], "html"
    if path in PLATFORM_PAGES:
        return 200, platform_page(path).encode(), [], "html"
    return 404, not_found_page().encode(), [], "html"


def static_bytes(path):
    name = os.path.normpath(path[len("/static/"):])
    if name.startswith(".") or name.startswith("/"):
        return None
    full = os.path.join(STATIC_ROOT, name)
    if not os.path.isfile(full):
        return None
    with open(full, "rb") as handle:
        return handle.read(), mimetypes.guess_type(full)[0] or "application/octet-stream"


def media_bytes(path):
    if path == "/assets/moths-drawn-to-park-lights-246f8064.webm":
        return _file(ASSET_FILM, "video/webm")
    if path == "/assets/john-bartmann-breathing-down-my-neck-master-90c3b95a.ogg":
        return _file(ASSET_SOUND, "audio/ogg")
    if path == "/media/briefing.vtt":
        return _file(VTT, "text/vtt")
    return None


def _file(full, ctype):
    if not os.path.isfile(full):
        return None
    with open(full, "rb") as handle:
        return handle.read(), ctype, [("Accept-Ranges", "bytes")]


FAVICON_SVG = (
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\">"
    "<rect width=\"32\" height=\"32\" rx=\"7\" fill=\"#0a0e1a\"/>"
    "<path d=\"M8 21a4 4 0 013-5 5 5 0 019-1 4 4 0 016 2 3 3 0 010 6H10a3 3 0 01-2-2z\" "
    "fill=\"none\" stroke=\"#7ee787\" stroke-width=\"1.6\"/>"
    "</svg>")


def certificate_svg(record):
    """A well-formed SVG document. Its only variable text is the four
    certificate values, each as literal escaped text, and no attribute or
    element is built from user text."""
    from xml.sax.saxutils import escape as xml_escape
    name = xml_escape(record["display_name"], {'"': "&quot;"})
    team = xml_escape(record["team_name"], {'"': "&quot;"})
    event = xml_escape(record["event_name"], {'"': "&quot;"})
    issued = xml_escape(record["issued_on"], {'"': "&quot;"})
    issued_text = xml_escape(utc_text(record["issued_on"]), {'"': "&quot;"})
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="840" height="594" '
        'viewBox="0 0 840 594" role="img" aria-label="Certificate of completion">'
        '<rect width="840" height="594" fill="#0b0f1c"/>'
        '<rect x="14" y="14" width="812" height="566" rx="18" fill="#101728" '
        'stroke="#2c3a55" stroke-width="2"/>'
        '<rect x="34" y="34" width="772" height="526" rx="12" fill="none" '
        'stroke="#7ee787" stroke-width="1.5" stroke-dasharray="6 5"/>'
        '<text x="420" y="120" font-family="sans-serif" font-size="26" '
        'fill="#e9eefb" text-anchor="middle">Certificate of completion</text>'
        '<text x="420" y="200" font-family="sans-serif" font-size="34" '
        'fill="#e9eefb" text-anchor="middle">' + name + '</text>'
        '<text x="420" y="240" font-family="sans-serif" font-size="18" '
        'fill="#aab6d3" text-anchor="middle">' + team + '</text>'
        '<text x="420" y="300" font-family="sans-serif" font-size="22" '
        'fill="#7ee787" text-anchor="middle">' + event + '</text>'
        '<text x="420" y="340" font-family="sans-serif" font-size="18" '
        'fill="#aab6d3" text-anchor="middle">22 to 26 October 2026</text>'
        '<text x="420" y="400" font-family="sans-serif" font-size="16" '
        'fill="#aab6d3" text-anchor="middle">Completed ' + issued_text + '</text>'
        '<path d="M400 440 l10 -18 l10 18 l8 -18 l10 26 l8 -22 l10 14 l6 -8" '
        'fill="none" stroke="#7ee787" stroke-width="2"/>'
        '</svg>')


def _shell(title, body, extra_head=""):
    return ("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            "<title>" + esc(title) + "</title>"
            "<link rel=\"stylesheet\" href=\"/static/style.css\">"
            "<link rel=\"preload\" href=\"/static/core.js\" as=\"script\">"
            + extra_head +
            "</head><body>"
            + body +
            "<script src=\"/static/core.js\" defer></script></body></html>")


# --- shared chrome -----------------------------------------------------------

_ICONS = {
    "learn": "M4 7h16v10H4z", "practice": "M12 3l9 18H3z", "compete": "M6 4h12v6H6z",
    "ai": "M12 2l2 5 5 2-5 2-2 5-2-5-5-2 5-2z", "education": "M12 4l10 5-10 5-10-5z",
    "business": "M3 6h18v12H3z", "pricing": "M12 3a9 9 0 100 18 9 9 0 000-18z",
    "downtime": "M5 3v18M12 3v18M19 3v18M5 21h14", "certifications": "M12 2l8 4v6c0 5-4 8-8 10-4-2-8-5-8-10V6z",
    "search": "M10 4a6 6 0 104 10l4 4", "menu": "M4 6h16M4 12h16M4 18h16",
    "sound": "M4 9v6h4l5 4V5L8 9H4z", "flag": "M6 3v18M6 4h11l-2 4 2 4H6",
    "trophy": "M7 4h10v4a5 5 0 01-10 0V4z M9 20h6M12 13v7",
    "tick": "M4 12l5 5 11-11", "cross": "M6 6l12 12M18 6L6 18",
    "arrow-left": "M15 5l-7 7 7 7", "arrow-right": "M9 5l7 7-7 7",
    "shield": "M12 2l8 4v6c0 5-4 8-8 10-4-2-8-5-8-10V6z",
}


def _icon(name, cls="icon"):
    return ("<svg class=\"" + cls + "\" aria-hidden=\"true\" focusable=\"false\" "
            "viewBox=\"0 0 24 24\"><path d=\"" + _ICONS[name] + "\" fill=\"none\" "
            "stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" "
            "stroke-linejoin=\"round\"/></svg>")


def _skip_link():
    return ("<a class=\"skip-link\" href=\"#main\" id=\"skip-link\">Skip to main content</a>")


def _header(active="downtime"):
    nav = ""
    for label, href in NAV_ITEMS:
        current = " aria-current=\"page\"" if href == active else ""
        nav += ("<li><a class=\"nav-item" +
                (" nav-flag" if href == "/downtime" else "") +
                "\" href=\"" + href + "\"" + current + ">" + _icon(_nav_icon(href)) +
                "<span>" + esc(label) + "</span></a></li>")
    return ("<header class=\"site-header\"><div class=\"header-inner\">"
            "<a class=\"brand\" href=\"/\">" + _logo() + "</a>"
            "<button class=\"menu-toggle\" aria-expanded=\"false\" aria-controls=\"site-nav\">"
            + _icon("menu") + "<span>Menu</span></button>"
            "<nav id=\"site-nav\" class=\"site-nav\" aria-label=\"Primary\"><ul>" + nav + "</ul></nav>"
            "<div class=\"header-actions\">"
            "<button class=\"icon-button search-button\" type=\"button\" "
            "title=\"Search is not part of this event\" aria-label=\"Search\">"
            + _icon("search") + "</button>"
            "<a class=\"btn btn-outline nav-auth login-link\" href=\"/login\">Log In</a>"
            "<a class=\"btn btn-lime nav-auth join-link\" href=\"/signup\">Join for FREE</a>"
            "<a class=\"nav-auth account-name\" href=\"/downtime/team\" hidden></a>"
            "<button class=\"btn btn-outline nav-auth logout-button\" type=\"button\" "
            "hidden>Log out</button>"
            "<button class=\"icon-button sound-toggle\" type=\"button\" "
            "aria-pressed=\"false\" aria-label=\"Sound off\">" + _icon("sound") + "</button>"
            "</div></div></header>")


def _nav_icon(href):
    return {
        "/hacktivities": "learn", "/classrooms": "education",
        "/aisecurity": "ai", "/business": "business", "/pricing": "pricing",
        "/downtime": "downtime", "/certifications": "certifications",
    }.get(href, "learn")


def _logo():
    return ("<svg class=\"logo-mark\" viewBox=\"0 0 44 30\" aria-hidden=\"true\" "
            "focusable=\"false\"><path d=\"M6 20a5 5 0 015-7 7 7 0 0113-2 6 6 0 018 3 "
            "4 4 0 010 8H10a4 4 0 01-4-2z\" fill=\"none\" stroke=\"currentColor\" "
            "stroke-width=\"1.6\"/>"
            "<text x=\"12\" y=\"19\" font-size=\"5\" fill=\"currentColor\" "
            "font-family=\"monospace\">0</text>"
            "<text x=\"19\" y=\"16\" font-size=\"5\" fill=\"currentColor\" "
            "font-family=\"monospace\">1</text>"
            "<text x=\"26\" y=\"19\" font-size=\"5\" fill=\"currentColor\" "
            "font-family=\"monospace\">1</text></svg>"
            "<span class=\"logo-word\"><b>Night</b><b>Ward</b></span>")


def _footer():
    columns = ""
    for title, links in FOOTER_COLUMNS:
        items = "".join("<li><a href=\"" + href + "\">" + esc(label) + "</a></li>"
                        for label, href in links)
        columns += ("<div class=\"footer-col\"><h2 class=\"footer-title\">" + esc(title) +
                    "</h2><ul>" + items + "</ul></div>")
    return ("<footer class=\"site-footer\"><div class=\"footer-grid\">" + columns + "</div>"
            "<div class=\"footer-badges\"><svg class=\"iso-badge\" viewBox=\"0 0 24 24\" "
            "aria-label=\"ISO27001 compliance badge\"><circle cx=\"12\" cy=\"12\" r=\"11\" "
            "fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\"/><text x=\"12\" "
            "y=\"10\" text-anchor=\"middle\" font-size=\"4.4\" fill=\"currentColor\" "
            "font-family=\"sans-serif\">ISO</text><text x=\"12\" y=\"17\" "
            "text-anchor=\"middle\" font-size=\"4.2\" fill=\"currentColor\" "
            "font-family=\"sans-serif\">27001</text></svg>"
            "<p class=\"footer-line\">We're a gamified, hands-on cyber security training "
            "platform that you can access through your browser.</p>"
            "<p class=\"footer-line\">© 2026 NightWard. All rights reserved.</p></div></footer>")


def _live_regions():
    return ("<p id=\"flag-result\" class=\"live-region\" role=\"status\" "
            "aria-live=\"polite\"></p>"
            "<p id=\"team-messages\" class=\"live-region\" role=\"status\" "
            "aria-live=\"polite\"></p>"
            "<p id=\"webinar-messages\" class=\"live-region\" role=\"status\" "
            "aria-live=\"polite\"></p>"
            "<p id=\"account-messages\" class=\"live-region\" role=\"status\" "
            "aria-live=\"polite\"></p>"
            "<p id=\"leaderboard-updates\" class=\"live-region\" role=\"status\" "
            "aria-live=\"polite\"></p>"
            "<p id=\"certificate-status\" class=\"live-region\" role=\"status\" "
            "aria-live=\"polite\"></p>")


def _consent_panel():
    return ("<aside class=\"consent-panel\" data-consent-panel hidden>"
            "<p>We use cookies to ensure you get the best user experience. "
            "For more information see our cookie policy.</p>"
            "<div class=\"consent-buttons\">"
            "<button type=\"button\" class=\"btn btn-outline\" data-cookie-settings>"
            "Cookie Settings</button>"
            "<button type=\"button\" class=\"btn btn-lime\" data-allow-all>Allow All</button>"
            "</div></aside>")


def _dialog(id_name, title, body, labelledby=None):
    return ("<div class=\"dialog-backdrop\" data-dialog-for=\"" + id_name + "\" hidden>"
            "<div class=\"dialog\" role=\"dialog\" aria-modal=\"true\" id=\"" + id_name +
            "-dialog\"" + (" aria-labelledby=\"" + labelledby + "\"" if labelledby else "") + ">"
            "<h2 id=\"" + id_name + "-title\">" + esc(title) + "</h2>"
            "<button type=\"button\" class=\"dialog-close\" data-close-dialog "
            "aria-label=\"Close dialog\">" + _icon("cross") + "</button>"
            + body + "</div></div>")


# --- the event page ----------------------------------------------------------

def event_page():
    body = (_skip_link() + _header() + "<main id=\"main\" data-page=\"event\">"
            + _event_bar() + _hero() + _case_file() + _perks() + _team_band()
            + _scenario_trail() + _webinar_section() + _leaderboard_section()
            + _closing_sections() + _faq_section() + "</main>" + _footer()
            + _live_regions() + _consent_panel() + _event_dialogs())
    return _shell("Downtime — Strange & Unusual Activity", body)


def _event_bar():
    return ("<div class=\"event-bar\" id=\"event-bar\" role=\"region\" "
            "aria-label=\"Event bar\" hidden>"
            "<p class=\"event-bar-title\">It's Downtime!</p>"
            "<div class=\"event-bar-actions\">"
            "<a class=\"btn btn-lime\" href=\"/signup?redirect=%2Fdowntime\" data-hero-signup>"
            "Join event</a>"
            "<button class=\"btn btn-outline\" type=\"button\" data-open-team-create>"
            "Create a team</button>"
            "<button class=\"icon-button sound-toggle\" type=\"button\" "
            "aria-pressed=\"false\" aria-label=\"Sound off\">" + _icon("sound") + "</button>"
            "</div></div>")


def _hero():
    dots = "".join("<span class=\"dot\" style=\"--i:%d\"></span>" % i for i in range(22))
    return ("<section class=\"hero\" data-hero aria-labelledby=\"hero-title\">"
            "<div class=\"hero-glow floor-glow\" aria-hidden=\"true\"></div>"
            "<h1 id=\"hero-title\">It's Downtime!"
            "<span class=\"hero-visual\" aria-hidden=\"true\">"
            "<span class=\"hero-line\">IT'S <span class=\"show-word\">SHOW<svg class=\"scribble\" "
            "viewBox=\"0 0 220 30\" preserveAspectRatio=\"none\"><path d=\"M4 18 C30 6 48 26 "
            "76 12 S124 24 152 10 S196 22 216 12\"/></svg></span>TIME!</span>"
            "<span class=\"down-word\">DOWN</span>"
            "</span></h1>"
            "<p class=\"eyebrow\">Thu 22nd to Mon 26th Oct. Join any day. "
            "Simulator-Led CTF Event.</p>"
            "<p class=\"tagline\">Bring a team, or brave it solo, to find out what's really "
            "going on inside a haunted network. Built for blue team defensive practitioners "
            "of any level, with prizes for top players.</p>"
            "<div class=\"hero-actions\">"
            "<a class=\"btn btn-lime cta-primary\" href=\"/signup?redirect=%2Fdowntime\" "
            "data-hero-signup>Join event<span class=\"cta-sheen\" aria-hidden=\"true\"></span>"
            "<span class=\"cta-glow\" aria-hidden=\"true\"></span></a>"
            "<button class=\"btn btn-outline cta-secondary\" type=\"button\" "
            "data-open-team-create>Create a team<span class=\"cta-sheen dark\" "
            "aria-hidden=\"true\"></span></button></div>"
            "<div class=\"dot-field\" aria-hidden=\"true\">" + dots + "</div>"
            "<p class=\"chant\" aria-label=\"Strange and Unusual Activity\">"
            "<span>Strange &amp; Unusual Activity</span><span class=\"bullet\">•</span>"
            "<span>Strange &amp; Unusual Activity</span><span class=\"bullet\">•</span>"
            "<span class=\"chant-lime\">Strange &amp; Unusual Activity</span></p>"
            "<p class=\"chant-hint\">say it three times and it shows up in your logs</p>"
            "<canvas class=\"hero-tail\" data-hero-tail aria-hidden=\"true\"></canvas>"
            "<div class=\"spotlight\" aria-hidden=\"true\"></div></section>")


def _case_file():
    return ("<section class=\"case-file panel\" aria-labelledby=\"case-heading\">"
            "<div class=\"case-grid\">"
            "<div class=\"case-copy\">"
            "<h2 id=\"case-heading\">Strange &amp; Unusual Activity "
            "<span class=\"lime\">Detected</span></h2>"
            "<p class=\"case-story\">Congratulations, you've been assigned the case! A crew "
            "called Velvet Moth has crashed a game studio's network, swiped the unreleased "
            "build and moved in. The help desk has filed it under "
            "&#8220;paranormal&#8221;.</p>"
            "<p class=\"case-window\">The event is open from Thursday 22 to Monday 26 October. "
            "No waiting room, no taking a number, join the challenge at any time and play at "
            "your own pace.</p>"
            "<p class=\"case-raffle\">Leaderboard prizes go to the top-scoring teams, while "
            "raffle prizes are drawn from individual tickets: you earn one for every "
            "challenge you complete, wherever your team ranks.</p>"
            "<ul class=\"topic-pills\" role=\"list\">"
            "<li class=\"pill\">Alert Triaging</li><li class=\"pill\">Digital Forensics</li>"
            "<li class=\"pill\">Threat Hunting</li><li class=\"pill\">Malware Analysis</li></ul>"
            "<button class=\"btn btn-outline\" type=\"button\" data-open-prizes>" + _icon("trophy") +
            " View prizes</button>"
            "</div>"
            "<div class=\"case-media\">"
            "<video class=\"briefing-film\" data-briefing-film muted loop playsinline "
            "preload=\"none\" poster=\"/static/briefing-poster.svg\">"
            "<source src=\"/assets/moths-drawn-to-park-lights-246f8064.webm\" type=\"video/webm\">"
            "<track kind=\"captions\" srclang=\"en\" label=\"English\" src=\"/media/briefing.vtt\" "
            "default></video>"
            "<button class=\"btn btn-outline briefing-toggle\" type=\"button\" "
            "data-briefing-toggle aria-label=\"Pause briefing\">Pause briefing</button>"
            "</div></div>"
            "<div class=\"details-card panel\" aria-label=\"Event details\">"
            "<p class=\"details-dates\">Thursday 22nd to Monday 26th October 2026</p>"
            "<p class=\"details-times\">Starts 4:00 PM UTC · Ends 11:59 PM UTC</p>"
            "<h3>How to enter</h3><ol class=\"how-to-enter\">"
            "<li>Register an account on NightWard</li>"
            "<li>Tell your manager and colleagues</li>"
            "<li>Choose any one day between Thursday 22nd and Monday 26th October</li>"
            "<li>Complete in a few hours, or spread it across the 5 days!</li></ol>"
            "<p class=\"details-calendar\">Can't wait? Add it to your calendar and assemble "
            "the crew.</p>"
            "<a class=\"btn btn-lime\" href=\"/api/event/calendar.ics\" download=\"downtime.ics\" "
            "data-calendar>Add to calendar</a></div></section>")


def _perks():
    perks = [("Join for FREE", "Junior to manager, anyone can join!"),
             ("Real-world Simulators", "Put your defensive skills to the test"),
             ("Rewards", "Win prizes worth over $40,000"),
             ("Certificate", "Earn an official proof of your skill set")]
    cards = "".join("<li class=\"perk-card panel reveal\"><h3>" + esc(title) + "</h3><p>" +
                    esc(line) + "</p></li>" for title, line in perks)
    return ("<section class=\"perks\" aria-labelledby=\"perks-heading\">"
            "<h2 id=\"perks-heading\">Why join</h2>"
            "<ul class=\"perk-grid\" role=\"list\">" + cards + "</ul></section>")


def _team_band():
    return ("<section class=\"team-band panel\" id=\"registration\" "
            "aria-labelledby=\"team-heading\">"
            "<h2 id=\"team-heading\">Form your team</h2>"
            "<p>Nobody likes checking the attic alone!</p>"
            "<p>Prizes go to the teams at the top of the leaderboard, and because every "
            "challenge tests a different skill set, well-rounded professional teams have "
            "the advantage. Solo players can enter as a team of one.</p>"
            "<p>Raffle tickets are individual: you earn one for every challenge you "
            "complete, wherever your team ranks.</p>"
            "<div class=\"team-band-actions\">"
            "<button class=\"btn btn-lime\" type=\"button\" data-open-team-create "
            "data-signed-in-show>Create a team</button>"
            "<button class=\"btn btn-outline\" type=\"button\" data-open-team-join "
            "data-signed-in-show>Join an existing team</button>"
            "<a class=\"btn btn-lime\" href=\"/login?redirect=%2Fdowntime%23registration\" "
            "data-signed-out-show>Create a team</a>"
            "<a class=\"btn btn-outline\" href=\"/login?redirect=%2Fdowntime%23registration\" "
            "data-signed-out-show>Join an existing team</a></div></section>")


def _prop(name):
    paths = {
        "skull": "M10 22V14a10 10 0 0120 0v8M12 22v4h16v-4",
        "lily": "M20 4c6 0 10 5 10 10s-6 6-10 6-10-1-10-6 4-10 10-10zM20 20v14M14 30h12",
        "computer": "M6 8h28v16H6z M14 30h12M20 24v6",
        "ghost": "M12 30V14a8 8 0 0116 0v16l-4-3-4 3-4-3z",
    }
    return ("<svg viewBox=\"0 0 40 36\" aria-hidden=\"true\" focusable=\"false\">"
            "<path d=\"" + paths[name] + "\" fill=\"none\" stroke=\"currentColor\" "
            "stroke-width=\"1.8\" stroke-linejoin=\"round\"/></svg>")


def _scenario_trail():
    from .seed import SCENARIOS
    blocks = ""
    for index, (slug, number, title, kind, points, description, flag) in enumerate(SCENARIOS):
        side = "left" if index % 2 == 0 else "right"
        prop = ["skull", "lily", "computer", "ghost"][index % 4]
        blocks += ("<li class=\"trail-block " + side + " reveal\" data-scenario-block="
                   "\"" + esc(slug) + "\">"
                   "<span class=\"trail-orb\" aria-hidden=\"true\">" + str(number).zfill(2) +
                   "</span>"
                   "<span class=\"prop prop-" + prop + "\" aria-hidden=\"true\">" +
                   _prop(prop) + "</span>"
                   "<span class=\"dashes\" aria-hidden=\"true\">-----</span>"
                   "<h3><a href=\"/downtime/scenarios/" + esc(slug) + "\">" + esc(title) +
                   "</a></h3>"
                   "<p class=\"kind-label\">" + esc(SCENARIO_KIND_LABELS[kind]) + "</p>"
                   "<p class=\"trail-desc\">" + esc(description) + "</p>"
                   "<span class=\"state state-" + esc(slug) +
                   "\" data-state-for=\"" + esc(slug) + "\" hidden></span>"
                   "</li>")
    return ("<section class=\"scenario-trail\" aria-labelledby=\"trail-heading\">"
            "<h2 id=\"trail-heading\">Things are about to get strange. Here's what's "
            "waiting for you inside the SOC</h2>"
            "<p class=\"trail-line\">Every room is a mission. Every mission builds a skill.</p>"
            "<p class=\"trail-line\">Complete all and go from padawan to cyber operative.</p>"
            "<div class=\"trail-wrap\"><ol class=\"trail-list\" role=\"list\">" + blocks +
            "</ol><div class=\"trail-path\" aria-hidden=\"true\"><svg class=\"trail-svg\" "
            "preserveAspectRatio=\"none\"><path d=\"\" data-trail-path/></svg></div></div></section>")


def _webinar_section():
    return ("<section class=\"webinar panel\" id=\"webinar\" aria-labelledby=\"webinar-heading\">"
            "<p class=\"webinar-tag\">Exclusive bonus</p>"
            "<h2 id=\"webinar-heading\">Invite your manager to our exclusive webinar. "
            "They get the readiness playbook, you get +2 raffle tickets.</h2>"
            "<div class=\"webinar-card\">"
            "<p class=\"webinar-eyebrow\">FREE LIVE WEBINAR FOR MANAGERS</p>"
            "<h3 class=\"webinar-title\">Beyond the Comfort Zone</h3>"
            "<p class=\"webinar-sub\">How mature security teams build readiness</p>"
            "<p class=\"webinar-desc\">Built for security managers, this session maps the five "
            "habits that move a SOC team from scrambling in the dark to compounding "
            "capability.</p>"
            "<p class=\"webinar-meta\">Monday 26 October • 3:00 PM GMT</p>"
            "<p class=\"webinar-meta\">30 minutes</p>"
            "<p class=\"webinar-meta\">Online • Virtual Classroom</p>"
            "<p class=\"webinar-speaker\">Speaker: Ilse Varga, Head of Content Engineering at "
            "NightWard</p></div>"
            "<p class=\"webinar-share\">Share the webinar with your manager</p>"
            "<div class=\"webinar-share-row\">"
            "<button class=\"btn btn-outline\" type=\"button\" data-copy-link>Copy link</button>"
            "<p class=\"hint\">Copy the link or post it wherever they'll see it</p></div>"
            "<p class=\"webinar-claim-line\">Enter the flag shared during the webinar to claim "
            "2 extra raffle tickets.</p>"
            "<form class=\"webinar-form\" data-signed-in-show data-webinar-form>"
            "<label for=\"webinar-flag\">Webinar flag</label>"
            "<input id=\"webinar-flag\" name=\"flag\" type=\"text\" autocomplete=\"off\">"
            "<button class=\"btn btn-lime\" type=\"submit\">Claim tickets</button></form>"
            "<p class=\"webinar-signedout\" data-signed-out-show><a href=\"/login?redirect="
            "%2Fdowntime%23webinar\">Log in to submit flag</a></p></section>")


def _leaderboard_section():
    return ("<section class=\"leaderboard\" aria-labelledby=\"board-heading\">"
            "<h2 id=\"board-heading\">Live Leaderboard</h2>"
            "<p class=\"board-lede\">See who's making moves while everyone else waits.</p>"
            "<div class=\"board-layout\">"
            "<div class=\"board-table-wrap panel\">"
            "<table class=\"board-table\"><caption>Live Leaderboard</caption>"
            "<thead><tr><th scope=\"col\">Rank</th><th scope=\"col\">Team</th>"
            "<th scope=\"col\" class=\"col-sim\">SOC Simulator</th>"
            "<th scope=\"col\" class=\"col-sim\">TH Simulator</th>"
            "<th scope=\"col\" class=\"col-sim\">Tabletop</th>"
            "<th scope=\"col\">Challenges</th><th scope=\"col\">Points</th></tr></thead>"
            "<tbody data-board-body><tr><td colspan=\"7\">Loading leaderboard…</td></tr>"
            "</tbody></table>"
            "<nav class=\"board-pages\" aria-label=\"Leaderboard pages\" data-board-pages>"
            "<button type=\"button\" class=\"page-btn\" data-prev>" + _icon("arrow-left") +
            " Previous</button><span class=\"page-numbers\" data-page-numbers></span>"
            "<button type=\"button\" class=\"page-btn\" data-next>Next " +
            _icon("arrow-right") + "</button></nav>"
            "<p class=\"board-count\" data-board-count></p></div>"
            "<div class=\"board-feed panel\">"
            "<h3>Activity feed</h3><ul class=\"feed-list\" data-feed-list "
            "aria-label=\"Activity feed\"></ul></div></div></section>")


def _closing_sections():
    pixels = "".join("<span class=\"pixel\"></span>" for _ in range(40))
    business_cards = "".join(
        "<li class=\"business-card panel\"><a href=\"/business\">" + esc(title) + "</a>"
        "<p>" + esc(line) + "</p></li>"
        for title, line in [("Breach Range Simulator",
                             "Practise incident response against a live breach."),
                            ("Tailored CTFs",
                             "Scenarios built around your stack and your team."),
                            ("Tabletops & Simulators",
                             "Run the whole incident, from triage to report.")])
    marquee = "".join("<span>" + esc(name) + "</span>" for name in
                      ["Gravelight Studios", "Velvet Labs", "Pale Signal Group",
                       "Bone Orchard Trust", "Night Ledger Co", "Quiet Hours Ltd",
                       "Hollow Port Works", "Moth Light Media"])
    return ("<section class=\"count-band\" aria-label=\"Event popularity\">"
            "<div class=\"pixel-band\" aria-hidden=\"true\">" + pixels + "</div>"
            "<h2>1,384+ security teams already signed up</h2>"
            "<p class=\"count-question\">What are you waiting for?</p></section>"
            "<section class=\"business-band\" aria-labelledby=\"business-heading\">"
            "<h2 id=\"business-heading\">Dig up your team's capability gaps before something "
            "darker does</h2><ul class=\"business-grid\" role=\"list\">" + business_cards +
            "</ul></section>"
            "<section class=\"trust-marquee\" aria-label=\"Trusted by\">"
            "<div class=\"marquee-track\" aria-hidden=\"true\">" + marquee + "</div></section>")


def _faq_section():
    items = ""
    for index, (question, answer) in enumerate(FAQ_ITEMS):
        items += ("<li class=\"faq-item\">"
                  "<h3 class=\"faq-q\"><button type=\"button\" class=\"faq-btn\" "
                  "aria-expanded=\"false\" aria-controls=\"faq-a-" + str(index) + "\" "
                  "id=\"faq-q-" + str(index) + "\">" + esc(question) + "</button></h3>"
                  "<div class=\"faq-a\" id=\"faq-a-" + str(index) + "\" role=\"region\" "
                  "aria-labelledby=\"faq-q-" + str(index) + "\" hidden><p>" + esc(answer) +
                  "</p></div></li>")
    return ("<section class=\"faq\" aria-labelledby=\"faq-heading\">"
            "<h2 id=\"faq-heading\">FAQs</h2><ol class=\"faq-list\" role=\"list\">" + items +
            "</ol></section>")


def _event_dialogs():
    prizes = ("<ul class=\"prize-list\">"
              "<li><h3>Leaderboard prizes</h3><p>1st place team — $1,000</p>"
              "<p>2nd place team — $500</p><p>3rd place team — $250</p></li>"
              "<li><h3>Raffle prizes</h3><p>Drawn from individual tickets after the event "
              "closes: training vouchers, swag packs and NightWard merch.</p></li></ul>"
              "<p class=\"prizes-total\">Over $40,000 in prizes</p>")
    return (_dialog("prizes", "Prizes", prizes, "prizes-title")
            + _team_create_dialog() + _team_join_dialog() + _leave_dialog()
            + _remove_dialog() + _cookie_dialog())


def _team_create_dialog():
    return _dialog("create-team", "Create a team",
                   "<form data-team-create-form novalidate>"
                   "<label for=\"team-name\">Team name</label>"
                   "<input id=\"team-name\" name=\"name\" type=\"text\" autocomplete=\"off\" "
                   "aria-describedby=\"team-name-error\">"
                   "<p class=\"field-error\" id=\"team-name-error\" hidden></p>"
                   "<button class=\"btn btn-lime\" type=\"submit\">Create team</button></form>",
                   "create-team-title")


def _team_join_dialog():
    return _dialog("join-team", "Join an existing team",
                   "<form data-team-join-form novalidate>"
                   "<label for=\"invite-code\">Invite code</label>"
                   "<input id=\"invite-code\" name=\"invite_code\" type=\"text\" "
                   "autocomplete=\"off\" aria-describedby=\"invite-code-error\">"
                   "<p class=\"field-error\" id=\"invite-code-error\" hidden></p>"
                   "<button class=\"btn btn-lime\" type=\"submit\">Join team</button></form>",
                   "join-team-title")


def _leave_dialog():
    return _dialog("leave-team", "Leave team",
                   "<p>Are you sure you want to leave the team? The team keeps every point.</p>"
                   "<div class=\"dialog-actions\">"
                   "<button class=\"btn btn-lime\" type=\"button\" data-confirm-leave>Leave</button>"
                   "<button class=\"btn btn-outline\" type=\"button\" data-close-dialog>"
                   "Cancel</button></div>", "leave-team-title")


def _remove_dialog():
    return _dialog("remove-member", "Remove member",
                   "<p data-remove-target-text></p>"
                   "<div class=\"dialog-actions\">"
                   "<button class=\"btn btn-lime\" type=\"button\" data-confirm-remove>"
                   "Remove</button>"
                   "<button class=\"btn btn-outline\" type=\"button\" data-close-dialog>"
                   "Cancel</button></div>", "remove-member-title")


def _cookie_dialog():
    return _dialog("cookie-settings", "Cookie settings",
                   "<p>We use cookies for the essentials: your session, your consent choice "
                   "and your sound choice. Nothing nonessential is stored.</p>"
                   "<div class=\"dialog-actions\">"
                   "<button class=\"btn btn-lime\" type=\"button\" data-essential-only>"
                   "Essential only</button>"
                   "<button class=\"btn btn-outline\" type=\"button\" data-close-dialog>"
                   "Cancel</button></div>", "cookie-settings-title")


# --- the team room -----------------------------------------------------------

def team_room_page():
    states = "".join(
        "<li class=\"room-state\" data-room-state=\"" + esc(row[0]) + "\">"
        "<span class=\"room-state-slug\">" + esc(row[0]) + "</span>"
        "<span class=\"room-state-label\" data-state-label>Not attempted</span></li>"
        for row in _scenario_rows())
    return _shell("Team room — Downtime",
                  _skip_link() + _header() +
                  "<main id=\"main\" data-page=\"team\">"
                  "<h1 class=\"page-title\">Team room</h1>"
                  "<p class=\"outage-copy\" data-outage hidden>The event server is not "
                  "answering. Try again in a moment.</p>"
                  "<div data-team-room data-signed-in-show>"
                  "<p class=\"team-name\" data-team-name hidden></p>"
                  "<p class=\"invite-line\">Invite code <span class=\"invite-code\" "
                  "data-invite-code></span>"
                  "<button class=\"btn btn-outline\" type=\"button\" data-copy-code>Copy code"
                  "</button>"
                  "<button class=\"btn btn-outline\" type=\"button\" data-copy-invite-link>"
                  "Copy invite link</button>"
                  "<button class=\"btn btn-outline\" type=\"button\" data-new-invite-code "
                  "hidden>New invite code</button></p>"
                  "<p class=\"score-line\">Team score <span class=\"team-score\" "
                  "data-team-score>0</span> XP</p>"
                  "<h2>Members</h2>"
                  "<ul class=\"member-list\" data-member-list></ul>"
                  "<button class=\"btn btn-outline\" type=\"button\" data-open-leave>Leave team"
                  "</button>"
                  "<p class=\"cert-link-row\" hidden data-certificate-row><a class=\"btn "
                  "btn-lime\" href=\"/downtime/certificate\">Collect your certificate</a></p>"
                  "<h2>Scenarios</h2><ol class=\"room-states\" data-room-states>" + states +
                  "</ol></div>"
                  "<div data-teamless data-signed-out-or-teamless hidden>"
                  "<p>You are not in a team yet. Create one or join an existing team.</p>"
                  "<div class=\"team-band-actions\">"
                  "<button class=\"btn btn-lime\" type=\"button\" data-open-team-create>"
                  "Create a team</button>"
                  "<button class=\"btn btn-outline\" type=\"button\" data-open-team-join>"
                  "Join an existing team</button></div></div>"
                  "</main>" + _footer() + _live_regions() + _consent_panel()
                  + _team_create_dialog() + _team_join_dialog() + _leave_dialog()
                  + _remove_dialog() + _cookie_dialog())


def _scenario_rows():
    from .seed import SCENARIOS
    return [(row[0],) for row in SCENARIOS]


# --- the scenario page -------------------------------------------------------

def scenario_page(slug):
    from .seed import SCENARIOS
    index = next((i for i, row in enumerate(SCENARIOS) if row[0] == slug), None)
    if index is None:
        return not_found_page()
    row = SCENARIOS[index]
    prev_slug = SCENARIOS[index - 1][0] if index > 0 else None
    next_slug = SCENARIOS[index + 1][0] if index < len(SCENARIOS) - 1 else None
    return _shell(row[2] + " — Downtime",
                  _skip_link() + _header() +
                  "<main id=\"main\" data-page=\"scenario\" data-scenario-slug=\"" +
                  esc(slug) + "\">"
                  "<article class=\"scenario-detail panel\">"
                  "<p class=\"scenario-number\">" + str(row[1]).zfill(2) + "</p>"
                  "<h1 class=\"page-title\">" + esc(row[2]) + "</h1>"
                  "<p class=\"kind-label\">" + esc(SCENARIO_KIND_LABELS[row[3]]) + "</p>"
                  "<p class=\"scenario-points\">" + str(row[4]) + " XP</p>"
                  "<p class=\"scenario-desc\">" + esc(row[5]) + "</p>"
                  "<p class=\"my-state\" data-my-state></p>"
                  "<p class=\"solved-badge\" data-solved-badge hidden>" + _icon("tick") +
                  " Solved</p>"
                  "<form class=\"flag-form\" data-flag-form novalidate>"
                  "<label for=\"flag\">Flag</label>"
                  "<input id=\"flag\" name=\"flag\" type=\"text\" autocomplete=\"off\">"
                  "<button class=\"btn btn-lime\" type=\"submit\">" + _icon("flag") +
                  " Submit flag</button></form>"
                  "<nav class=\"scenario-steps\" aria-label=\"Scenario steps\">"
                  "<button class=\"btn btn-outline\" type=\"button\" data-prev-scenario" +
                  ("" if prev_slug else " disabled") + " data-prev-slug=\"" +
                  esc(prev_slug or "") + "\">" + _icon("arrow-left") + " Previous scenario"
                  "</button>"
                  "<button class=\"btn btn-outline\" type=\"button\" data-next-scenario" +
                  ("" if next_slug else " disabled") + " data-next-slug=\"" +
                  esc(next_slug or "") + "\">Next scenario " + _icon("arrow-right") +
                  "</button></nav></article></main>" + _footer() + _live_regions()
                  + _consent_panel() + _cookie_dialog())


# --- the certificate page ----------------------------------------------------

def certificate_page():
    return _shell("Certificate — Downtime",
                  _skip_link() + _header() +
                  "<main id=\"main\" data-page=\"certificate\">"
                  "<h1 class=\"page-title\">Certificate of completion</h1>"
                  "<p class=\"outage-copy\" data-outage hidden>The event server is not "
                  "answering. Try again in a moment.</p>"
                  "<div data-certificate-body hidden>"
                  "<p class=\"cert-name\" data-cert-name></p>"
                  "<p class=\"cert-team\" data-cert-team></p>"
                  "<p class=\"cert-event\">Strange &amp; Unusual Activity</p>"
                  "<p class=\"cert-dates\">22 to 26 October 2026</p>"
                  "<p class=\"cert-issued\">Completed <span data-cert-issued></span></p>"
                  "<svg class=\"shield-glyph\" viewBox=\"0 0 24 24\" aria-hidden=\"true\">"
                  "<path d=\"M12 2l8 4v6c0 5-4 8-8 10-4-2-8-5-8-10V6z\" fill=\"none\" "
                  "stroke=\"currentColor\" stroke-width=\"1.6\"/></svg>"
                  "<p><button class=\"btn btn-lime\" type=\"button\" data-download-certificate>"
                  "Download certificate</button></p></div>"
                  "<p class=\"not-complete\" data-not-complete hidden>"
                  "Your team has not completed the event yet <span data-remaining></span></p>"
                  "</main>" + _footer() + _live_regions() + _consent_panel()
                  + _cookie_dialog())


# --- account pages -----------------------------------------------------------

def account_page(kind):
    if kind == "signup":
        title = "Create account"
        form = ("<form data-account-form data-kind=\"signup\" novalidate>"
                "<label for=\"email\">Email</label>"
                "<input id=\"email\" name=\"email\" type=\"email\" autocomplete=\"email\">"
                "<p class=\"field-error\" data-field-error=\"email\" hidden></p>"
                "<label for=\"display_name\">Display name</label>"
                "<input id=\"display_name\" name=\"display_name\" type=\"text\" "
                "autocomplete=\"nickname\">"
                "<p class=\"field-error\" data-field-error=\"display_name\" hidden></p>"
                "<label for=\"password\">Password</label>"
                "<input id=\"password\" name=\"password\" type=\"password\" "
                "autocomplete=\"new-password\">"
                "<p class=\"field-error\" data-field-error=\"password\" hidden></p>"
                "<button class=\"btn btn-lime\" type=\"submit\">Create account</button>"
                "<p class=\"cross-link\">Already have an account? <a href=\"/login\" "
                "data-cross-link>Log in</a></p></form>")
    else:
        title = "Log in"
        form = ("<form data-account-form data-kind=\"login\" novalidate>"
                "<label for=\"email\">Email</label>"
                "<input id=\"email\" name=\"email\" type=\"email\" autocomplete=\"email\">"
                "<p class=\"field-error\" data-field-error=\"email\" hidden></p>"
                "<label for=\"password\">Password</label>"
                "<input id=\"password\" name=\"password\" type=\"password\" "
                "autocomplete=\"current-password\">"
                "<p class=\"field-error\" data-field-error=\"password\" hidden></p>"
                "<button class=\"btn btn-lime\" type=\"submit\">Log in</button>"
                "<p class=\"cross-link\">New to NightWard? <a href=\"/signup\" "
                "data-cross-link>Create account</a></p></form>")
    return _shell(title + " — NightWard",
                  _skip_link() + _header(active="") +
                  "<main id=\"main\" data-page=\"account\" data-account-kind=\"" + kind + "\">"
                  "<h1 class=\"page-title\">" + esc(title) + "</h1>"
                  "<div class=\"error-summary\" role=\"region\" aria-label=\"Errors\" "
                  "data-error-summary hidden><p>Fix the highlighted fields:</p>"
                  "<ul data-error-summary-links></ul></div>"
                  + form + "</main>" + _footer() + _live_regions() + _consent_panel())


# --- platform pages ----------------------------------------------------------

def platform_page(path):
    title, subtitle = PLATFORM_PAGES[path]
    if path == "/":
        body = ("<p class=\"platform-sub\">" + esc(subtitle) + "</p>"
                "<p><a class=\"btn btn-lime\" href=\"/signup\">Join for FREE</a></p>"
                "<p><a href=\"/downtime\">See the Downtime event</a></p>")
    elif path == "/community":
        body = ("<p>Connect with 8+ million learners online or in person</p>"
                "<p><a href=\"/downtime\">Back to Downtime</a></p>")
    else:
        body = ("<p>Learn more about " + esc(title) + " on NightWard.</p>"
                "<p><a href=\"/downtime\">Back to Downtime</a></p>")
    return _shell(title + " — NightWard",
                  _skip_link() + _header() +
                  "<main id=\"main\" data-page=\"platform\"><h1 class=\"page-title\">" +
                  esc(title) + "</h1>" + body + "</main>" + _footer()
                  + _live_regions() + _consent_panel())


def not_found_page():
    return _shell("Page not found — NightWard",
                  _skip_link() + _header() +
                  "<main id=\"main\" data-page=\"not-found\">"
                  "<h1 class=\"page-title\">Page not found</h1>"
                  "<p>The page you're after does not exist.</p>"
                  "<p><a href=\"/downtime\">Go to the event page</a></p></main>"
                  + _footer() + _live_regions() + _consent_panel())

