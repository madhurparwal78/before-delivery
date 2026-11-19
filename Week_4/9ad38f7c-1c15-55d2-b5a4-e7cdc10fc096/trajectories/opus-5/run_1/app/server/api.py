"""The published JSON interface, its routing table and its error precedence."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from . import accounts, certificates, flags, leaderboard, scenarios, teams
from .db import DATABASE, DatabaseUnavailable, Transaction
from .errors import ApiError, unauthenticated
from .event import CALENDAR_FILENAME, calendar_file, event_payload
from .http import (
    Request,
    Response,
    error_response,
    json_response,
    require_body_within_limit,
    require_json_content_type,
)
from .jsonio import read_json_object
from .schema import is_seeded
from .validation import leaderboard_paging

NO_STORE = ("Cache-Control", "no-store")


@dataclass
class Call:
    request: Request
    tx: Transaction
    caller: accounts.Caller | None
    body: dict[str, Any]
    params: dict[str, str]

    @property
    def player(self) -> accounts.Caller:
        return self.caller


@dataclass(frozen=True)
class Endpoint:
    handler: Callable[[Call], Response | "EventStream"] | None = None
    auth: bool = False
    body_route: bool = False


@dataclass(frozen=True)
class Route:
    pattern: tuple[str, ...]
    methods: dict[str, Endpoint]
    health: bool = False

    def allow_header(self) -> str:
        names = list(self.methods)
        if "GET" in names:
            names.append("HEAD")
        return ", ".join(names)


@dataclass(frozen=True)
class EventStream:
    """Marker for the live stream, which app.py sends as text/event-stream."""


def _segments(path: str) -> tuple[str, ...]:
    """The published addresses are matched exactly, with no slash forgiveness."""
    return tuple(path.split("/"))[1:]


# -- handlers -------------------------------------------------------------
def _sign_up(call: Call) -> Response:
    return json_response(accounts.sign_up(call.tx, call.body), 201)


def _sign_in(call: Call) -> Response:
    outcome = accounts.sign_in(call.tx, call.body)
    if isinstance(outcome, ApiError):
        return error_response(outcome)
    return json_response(outcome)


def _sign_out(call: Call) -> Response:
    accounts.end_session(call.tx, call.request.bearer_token)
    return Response(status=204, content_type="")


def _me(call: Call) -> Response:
    return json_response(accounts.me_payload(call.tx, call.player))


def _event(call: Call) -> Response:
    return json_response(event_payload(call.tx.now()))


def _calendar(call: Call) -> Response:
    return Response(
        body=calendar_file(call.tx.now()),
        content_type="text/calendar; charset=utf-8",
        headers=[
            (
                "Content-Disposition",
                f'attachment; filename="{CALENDAR_FILENAME}"',
            )
        ],
    )


def _scenarios(call: Call) -> Response:
    return json_response({"scenarios": scenarios.list_scenarios(call.tx)})


def _scenario(call: Call) -> Response:
    scenario = scenarios.load_scenario(call.tx, call.params["slug"])
    caller = call.caller
    state = scenarios.state_for(
        call.tx,
        scenario["slug"],
        caller.team_id if caller else None,
        caller.user_id if caller else None,
    )
    return json_response({"scenario": scenario, **state})


def _submit_flag(call: Call) -> Response:
    return json_response(
        flags.submit_flag(call.tx, call.player, call.params["slug"], call.body)
    )


def _claim_webinar(call: Call) -> Response:
    return json_response(flags.claim_webinar(call.tx, call.player, call.body))


def _create_team(call: Call) -> Response:
    return json_response(teams.create_team(call.tx, call.player, call.body), 201)


def _join_team(call: Call) -> Response:
    return json_response(teams.join_team(call.tx, call.player, call.body))


def _leave_team(call: Call) -> Response:
    teams.leave_team(call.tx, call.player)
    return Response(status=204, content_type="")


def _my_team(call: Call) -> Response:
    return json_response(teams.room_payload(call.tx, call.player))


def _remove_member(call: Call) -> Response:
    teams.remove_member(call.tx, call.player, call.params["user_id"])
    return Response(status=204, content_type="")


def _issue_invite_code(call: Call) -> Response:
    return json_response(teams.issue_invite_code(call.tx, call.player))


def _leaderboard(call: Call) -> Response:
    page, limit, include_feed = leaderboard_paging(call.request.query)
    return json_response(leaderboard.page(call.tx, page, limit, include_feed))


def _stream(call: Call) -> EventStream:
    call.tx.value("SELECT 1")
    return EventStream()


def _certificate(call: Call) -> Response:
    return json_response(certificates.certificate(call.tx, call.player))


def _certificate_image(call: Call) -> Response:
    body = certificates.certificate(call.tx, call.player)
    return Response(
        body=certificates.certificate_image(body).encode("utf-8"),
        content_type="image/svg+xml",
        headers=[
            (
                "Content-Disposition",
                'attachment; filename="downtime-certificate.svg"',
            )
        ],
    )


ROUTES: tuple[Route, ...] = (
    Route(("api", "health"), {"GET": Endpoint()}, health=True),
    Route(
        ("api", "auth", "signup"),
        {"POST": Endpoint(_sign_up, body_route=True)},
    ),
    Route(
        ("api", "auth", "login"),
        {"POST": Endpoint(_sign_in, body_route=True)},
    ),
    Route(("api", "auth", "logout"), {"POST": Endpoint(_sign_out)}),
    Route(("api", "me"), {"GET": Endpoint(_me, auth=True)}),
    Route(("api", "event"), {"GET": Endpoint(_event)}),
    Route(("api", "event", "calendar.ics"), {"GET": Endpoint(_calendar)}),
    Route(("api", "scenarios"), {"GET": Endpoint(_scenarios)}),
    Route(("api", "scenarios", "{slug}"), {"GET": Endpoint(_scenario)}),
    Route(
        ("api", "scenarios", "{slug}", "flag"),
        {"POST": Endpoint(_submit_flag, auth=True, body_route=True)},
    ),
    Route(
        ("api", "webinar", "flag"),
        {"POST": Endpoint(_claim_webinar, auth=True, body_route=True)},
    ),
    Route(
        ("api", "teams"),
        {"POST": Endpoint(_create_team, auth=True, body_route=True)},
    ),
    Route(
        ("api", "teams", "join"),
        {"POST": Endpoint(_join_team, auth=True, body_route=True)},
    ),
    Route(("api", "teams", "leave"), {"POST": Endpoint(_leave_team, auth=True)}),
    Route(("api", "teams", "mine"), {"GET": Endpoint(_my_team, auth=True)}),
    Route(
        ("api", "teams", "mine", "members", "{user_id}", "remove"),
        {"POST": Endpoint(_remove_member, auth=True)},
    ),
    Route(
        ("api", "teams", "mine", "invite-code"),
        {"POST": Endpoint(_issue_invite_code, auth=True)},
    ),
    Route(("api", "leaderboard"), {"GET": Endpoint(_leaderboard)}),
    Route(("api", "stream"), {"GET": Endpoint(_stream)}),
    Route(("api", "me", "certificate"), {"GET": Endpoint(_certificate, auth=True)}),
    Route(
        ("api", "me", "certificate", "image"),
        {"GET": Endpoint(_certificate_image, auth=True)},
    ),
)


def match_route(path: str) -> tuple[Route, dict[str, str]] | None:
    parts = _segments(path)
    for route in ROUTES:
        if len(route.pattern) != len(parts):
            continue
        params: dict[str, str] = {}
        for expected, actual in zip(route.pattern, parts, strict=True):
            if expected.startswith("{"):
                if not actual:
                    break
                params[expected[1:-1]] = actual
            elif expected != actual:
                break
        else:
            return route, params
    return None


async def dispatch(request: Request) -> Response | EventStream:
    """The error precedence, applied in one place for every API route."""
    found = match_route(request.path)
    if found is None:
        raise ApiError(404, "not_found")
    route, params = found

    method = "GET" if request.method == "HEAD" else request.method
    endpoint = route.methods.get(method)
    if endpoint is None:
        raise ApiError(
            405,
            "method_not_allowed",
            headers=[("Allow", route.allow_header())],
        )

    require_body_within_limit(request)
    body: dict[str, Any] = {}
    if endpoint.body_route:
        require_json_content_type(request)
        body = read_json_object(request.body)

    if route.health:
        return await health_response()

    def work(tx: Transaction) -> Response:
        caller = accounts.resolve_caller(tx, request.bearer_token)
        if endpoint.auth and caller is None:
            raise unauthenticated()
        return endpoint.handler(Call(request, tx, caller, body, params))

    return await DATABASE.call(work)


async def health_response() -> Response:
    """Checks the database on every call, and the seed with it."""
    try:
        complete = await DATABASE.call(is_seeded)
    except DatabaseUnavailable:
        if not DATABASE.seeded:
            return json_response({"error": "starting"}, 503)
        return json_response({"error": "unavailable"}, 503)
    if not complete:
        return json_response({"error": "starting"}, 503)
    return json_response({"status": "ok"})
