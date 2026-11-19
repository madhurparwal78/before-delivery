"""Page routing. Pages never need the database, so they answer at once."""

from __future__ import annotations

from ..http import Request, Response, html_response
from ..seed_data import SCENARIOS_BY_SLUG
from . import account, certificate, event, platform, scenario, team

SCENARIO_PREFIX = "/downtime/scenarios/"
NO_STORE = ("Cache-Control", "no-store")


def render_page(request: Request) -> Response:
    path = request.path.rstrip("/") or "/"
    markup = _markup(path, request)
    if markup is None:
        return html_response(platform.not_found(), 404, [NO_STORE])
    return html_response(markup, 200, [NO_STORE])


def _markup(path: str, request: Request) -> str | None:
    if path == "/":
        return platform.home()
    if path == "/downtime":
        return event.render()
    if path == "/downtime/team":
        return team.render()
    if path == "/downtime/certificate":
        return certificate.render()
    if path in ("/signup", "/login"):
        return account.render(path.lstrip("/"), request.query.get("redirect"))
    if path in platform.PLATFORM_PAGES:
        return platform.platform_page(path)
    if path.startswith(SCENARIO_PREFIX):
        found = SCENARIOS_BY_SLUG.get(path.removeprefix(SCENARIO_PREFIX))
        if found is not None:
            return scenario.render(found)
    return None
