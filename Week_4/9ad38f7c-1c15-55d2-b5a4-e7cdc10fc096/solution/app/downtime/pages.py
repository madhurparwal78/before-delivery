"""Server-rendered pages. Templates autoescape; user text is only ever written by the browser as text nodes."""

from dataclasses import dataclass
from importlib import resources

from jinja2 import Environment, FileSystemLoader, select_autoescape
from starlette.requests import Request
from starlette.responses import HTMLResponse, Response

from .seed import KIND_LABELS, SCENARIOS, SCENARIOS_BY_SLUG

TEMPLATES = Environment(loader=FileSystemLoader(str(resources.files(__package__).joinpath("templates"))),
                        autoescape=select_autoescape(default=True), trim_blocks=True, lstrip_blocks=True)
TEMPLATES.globals.update(kind_labels=KIND_LABELS, scenarios=SCENARIOS)


@dataclass(frozen=True, slots=True)
class PlatformPage:
    title: str
    heading: str
    lede: str
    points: tuple[str, ...]


PLATFORM_PAGES = {
    "/hacktivities": PlatformPage(
        "Hacktivities", "Hacktivities", "Browse hands-on labs and competitive rooms, from first steps to red-team "
        "drills.", ("Guided labs that run in your browser", "Weekly challenges ranked by difficulty",
                    "Downtime is this season's featured event")),
    "/aisecurity": PlatformPage(
        "AI Security", "AI Upskilling", "Learn how attackers use AI, and how defenders can use it back.",
        ("Prompt injection and model abuse labs", "Detection engineering with AI assistants",
         "Responsible use for security teams")),
    "/classrooms": PlatformPage(
        "Classrooms", "NightWard for Education", "Run cyber security classes with ready-made labs and progress "
        "tracking.", ("Course paths for schools and universities", "Assign rooms and follow progress",
                      "Free seats for teachers")),
    "/pricing": PlatformPage(
        "Pricing", "Pricing", "Start free and keep learning; Downtime itself costs nothing to enter.",
        ("Free: hundreds of beginner labs", "Premium: every path and room", "Teams: shared progress for "
         "organisations")),
    "/business": PlatformPage(
        "NightWard for Business", "NightWard for Business", "Find your team's capability gaps before something "
        "darker does.", ("Breach Range Simulator: rehearse a live intrusion",
                         "Tailored CTFs built around your own stack",
                         "Tabletops & Simulators for leaders and responders")),
    "/certifications": PlatformPage(
        "Certifications", "Certifications", "Prove practical skill with hands-on, scenario-based certifications.",
        ("Security analyst foundations", "Incident response practitioner", "Threat hunting specialist")),
    "/about": PlatformPage(
        "About NightWard", "About NightWard", "We're a gamified, hands-on cyber security training platform that "
        "you can access through your browser.", ("Founded by defenders, for defenders",
                                                 "Labs written by working practitioners",
                                                 "Policies, terms and newsroom live here too")),
    "/glossary": PlatformPage(
        "Glossary", "Cyber Security Glossary", "Plain-language definitions for the words you'll meet in the "
        "SOC.", ("SIEM: the console where logs become alerts", "Threat hunting: looking for attackers before "
                 "an alert fires", "Triage: deciding which alerts matter first")),
    "/cyber-security-careers": PlatformPage(
        "Careers in Cyber", "Cyber Security Careers", "See where hands-on skills can take you, from analyst to "
        "manager.", ("SOC analyst", "Incident responder", "Security engineering manager")),
    "/community": PlatformPage(
        "Community", "Community", "Connect with 8+ million learners online or in person",
        ("Discussion boards for every room", "Local meetups and study groups", "Swag shop and seasonal events")),
}


def _page(template: str, status: int = 200, **context: object) -> HTMLResponse:
    return HTMLResponse(TEMPLATES.get_template(template).render(**context), status_code=status,
                        headers={"Cache-Control": "no-cache"})


async def page(request: Request) -> Response:
    path = request.scope["path"]
    if path == "/downtime":
        return _page("event.html")
    if path == "/downtime/team":
        return _page("team.html")
    if path == "/downtime/certificate":
        return _page("certificate.html")
    if path in ("/signup", "/login"):
        return _page("account.html", mode=path[1:])
    if path == "/":
        return _page("home.html")
    if path in PLATFORM_PAGES:
        return _page("platform.html", platform=PLATFORM_PAGES[path])
    prefix = "/downtime/scenarios/"
    if path.startswith(prefix) and (scenario := SCENARIOS_BY_SLUG.get(path.removeprefix(prefix))):
        return _page("scenario.html", scenario=scenario)
    return _page("notfound.html", status=404)
