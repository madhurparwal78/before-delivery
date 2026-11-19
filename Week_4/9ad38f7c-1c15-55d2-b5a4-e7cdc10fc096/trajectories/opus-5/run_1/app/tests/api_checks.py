"""API checks for the Downtime event server. Run against a live instance."""

from __future__ import annotations

import re
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from support import BASE, call, check, report, signup

UNIQUE = uuid.uuid4().hex[:8]


def fresh_email(label: str) -> str:
    return f"{label}-{UNIQUE}-{uuid.uuid4().hex[:6]}@example.com"


def fresh_team(label: str) -> str:
    return f"{label}-{uuid.uuid4().hex[:6]}"


# -- published surface ----------------------------------------------------
def surface_checks() -> None:
    answer = call("GET", "/api/health")
    check("health ok", answer.status == 200 and answer.json == {"status": "ok"}, answer)

    answer = call("GET", "/api/nope")
    check(
        "unpublished path",
        answer.status == 404 and answer.json == {"error": "not_found"},
        answer,
    )
    answer = call("GET", "/api/teams/xyz/abc")
    check("deep unpublished path", answer.status == 404, answer)

    answer = call("DELETE", "/api/scenarios")
    check(
        "unpublished method",
        answer.status == 405
        and answer.json == {"error": "method_not_allowed"}
        and "GET" in answer.header("Allow"),
        answer,
    )
    answer = call("GET", "/api/teams/join")
    check(
        "join allow header",
        answer.status == 405 and answer.header("Allow") == "POST",
        answer,
    )

    answer = call("POST", "/api/auth/login", raw=b"{}", content_type="text/plain")
    check(
        "wrong content type",
        answer.status == 415 and answer.json == {"error": "unsupported_media_type"},
        answer,
    )
    answer = call("POST", "/api/auth/login", raw=b"{}", content_type=None)
    check("missing content type", answer.status == 415, answer)
    answer = call(
        "POST",
        "/api/auth/login",
        raw=b"{}",
        content_type="application/json; charset=utf-16",
    )
    check("wrong charset", answer.status == 415, answer)

    big = b'{"email":"' + b"a" * 17000 + b'"}'
    answer = call("POST", "/api/auth/signup", raw=big)
    check(
        "oversized body",
        answer.status == 413 and answer.json == {"error": "payload_too_large"},
        answer,
    )
    exact = b'{"email":"' + b"a" * (16384 - 13) + b'"}'
    answer = call("POST", "/api/auth/signup", raw=exact)
    check("exact limit body allowed", answer.status == 400, answer)

    for label, raw in (
        ("nan", b'{"flag": NaN}'),
        ("infinity", b'{"flag": Infinity}'),
        ("duplicate keys", b'{"flag": "a", "flag": "b"}'),
        ("lone surrogate", b'{"flag": "\\ud800"}'),
        ("invalid utf-8", b'{"flag": "\xff\xfe"}'),
        ("array top level", b"[1,2,3]"),
        ("string top level", b'"hello"'),
        ("not json", b"{nope"),
        ("deep nesting", b'{"a":' + b"[" * 33 + b"]" * 33 + b"}"),
    ):
        started = time.monotonic()
        answer = call("POST", "/api/auth/login", raw=raw)
        elapsed = time.monotonic() - started
        check(
            f"strict json {label}",
            answer.status == 400
            and answer.json == {"error": "invalid_json"}
            and elapsed < 1.0,
            (answer, elapsed),
        )
    answer = call(
        "POST", "/api/auth/login", raw=b'{"a":' + b"[" * 31 + b"]" * 31 + b"}"
    )
    check(
        "depth 32 allowed",
        answer.status == 400 and answer.json["error"] == "validation",
        answer,
    )


def account_checks() -> None:
    email = fresh_email("player")
    answer = call(
        "POST",
        "/api/auth/signup",
        {
            "email": email.upper(),
            "display_name": "  Ada Moth  ",
            "password": "sturdy-pw-2026",
        },
    )
    check("signup created", answer.status == 201, answer)
    body = answer.json
    check(
        "signup user shape",
        set(body) == {"token", "user"}
        and set(body["user"]) == {"id", "email", "display_name"}
        and body["user"]["email"] == email.lower()
        and body["user"]["display_name"] == "Ada Moth",
        body,
    )
    check(
        "signup no-store", answer.header("Cache-Control") == "no-store", answer.headers
    )
    token = body["token"]

    answer = call(
        "POST",
        "/api/auth/signup",
        {
            "email": f"  {email.title()}  ",
            "display_name": "Twin",
            "password": "sturdy-pw-2026",
        },
    )
    check(
        "email taken in any case",
        answer.status == 409 and answer.json == {"error": "email_taken"},
        answer,
    )

    for label, payload, field in (
        (
            "bad email",
            {"email": "nope", "display_name": "A", "password": "sturdy-pw-2026"},
            "email",
        ),
        (
            "short password",
            {"email": fresh_email("x"), "display_name": "A", "password": "short"},
            "password",
        ),
        (
            "long display name",
            {
                "email": fresh_email("x"),
                "display_name": "n" * 41,
                "password": "sturdy-pw-2026",
            },
            "display_name",
        ),
        (
            "control display name",
            {
                "email": fresh_email("x"),
                "display_name": "Ada\u0085",
                "password": "sturdy-pw-2026",
            },
            "display_name",
        ),
        (
            "direction display name",
            {
                "email": fresh_email("x"),
                "display_name": "Ada\u202e",
                "password": "sturdy-pw-2026",
            },
            "display_name",
        ),
        ("missing email", {"display_name": "A", "password": "sturdy-pw-2026"}, "email"),
        (
            "blank email",
            {"email": "   ", "display_name": "A", "password": "sturdy-pw-2026"},
            "email",
        ),
        (
            "nul password",
            {
                "email": fresh_email("x"),
                "display_name": "A",
                "password": "abc\u0000defgh",
            },
            "password",
        ),
        (
            "non string email",
            {"email": 42, "display_name": "A", "password": "sturdy-pw-2026"},
            "email",
        ),
    ):
        answer = call("POST", "/api/auth/signup", payload)
        check(
            f"signup refuses {label}",
            answer.status == 400
            and answer.json["error"] == "validation"
            and field in answer.json.get("fields", {}),
            answer,
        )

    emoji_email = fresh_email("bat")
    answer = call(
        "POST",
        "/api/auth/signup",
        {
            "email": emoji_email,
            "display_name": "\U0001f987" * 40,
            "password": "p" * 128,
        },
    )
    check("40 emoji name and 128 password accepted", answer.status == 201, answer)

    long_password = "x" * 70 + "A" + "y" * 40
    other_password = "x" * 70 + "B" + "y" * 40
    long_email = fresh_email("long")
    call(
        "POST",
        "/api/auth/signup",
        {"email": long_email, "display_name": "Long", "password": long_password},
    )
    answer = call(
        "POST", "/api/auth/login", {"email": long_email, "password": other_password}
    )
    check("passwords are not truncated", answer.status == 401, answer)
    answer = call(
        "POST", "/api/auth/login", {"email": long_email, "password": long_password}
    )
    check("exact long password signs in", answer.status == 200, answer)

    answer = call("GET", "/api/me", token=token)
    check(
        "me shape",
        answer.status == 200
        and set(answer.json)
        == {"user", "team", "tickets", "completions", "webinar_claimed"}
        and answer.json["team"] is None
        and answer.json["tickets"] == 0
        and answer.json["completions"] == []
        and answer.json["webinar_claimed"] is False,
        answer,
    )
    check("me no-store", answer.header("Cache-Control") == "no-store", answer.headers)
    check("me needs a session", call("GET", "/api/me").status == 401)
    check(
        "me refuses an unknown token",
        call("GET", "/api/me", token="nope").status == 401,
    )

    answer = call("POST", "/api/auth/logout", token=token)
    check("logout", answer.status == 204 and answer.raw == b"", answer)
    check("token ended", call("GET", "/api/me", token=token).status == 401)

    answer = call("POST", "/api/auth/login", {"email": email, "password": "wrong-pw"})
    check(
        "wrong password",
        answer.status == 401 and answer.json == {"error": "invalid_credentials"},
        answer,
    )
    unknown = call(
        "POST",
        "/api/auth/login",
        {"email": fresh_email("ghost"), "password": "wrong-pw"},
    )
    check(
        "unknown email answers alike",
        unknown.status == 401 and unknown.json == answer.json,
        unknown,
    )
    answer = call("POST", "/api/auth/login", {"email": email})
    check(
        "login needs a password",
        answer.status == 400 and answer.json["error"] == "validation",
        answer,
    )


def simultaneous_signup_checks() -> None:
    email = fresh_email("race")
    forms = [
        {"email": email, "display_name": "One", "password": "sturdy-pw-2026"},
        {"email": email.upper(), "display_name": "Two", "password": "sturdy-pw-2026"},
        {
            "email": f"  {email}  ",
            "display_name": "Three",
            "password": "sturdy-pw-2026",
        },
        {"email": email.title(), "display_name": "Four", "password": "sturdy-pw-2026"},
        {"email": email, "display_name": "Five", "password": "sturdy-pw-2026"},
        {"email": email, "display_name": "Six", "password": "sturdy-pw-2026"},
    ]
    with ThreadPoolExecutor(max_workers=len(forms)) as pool:
        answers = list(
            pool.map(lambda form: call("POST", "/api/auth/signup", form), forms)
        )
    created = [answer for answer in answers if answer.status == 201]
    taken = [answer for answer in answers if answer.status == 409]
    check(
        "one account from simultaneous sign-ups",
        len(created) == 1 and len(taken) == len(forms) - 1,
        [answer.status for answer in answers],
    )
    check(
        "losers answer email_taken",
        all(answer.json == {"error": "email_taken"} for answer in taken),
        [answer.json for answer in taken],
    )
    token = created[0].json["token"]
    check("winner token works", call("GET", "/api/me", token=token).status == 200)


def throttle_checks() -> None:
    email = fresh_email("locked")
    signup(email, "Locked Out")
    answers = [
        call("POST", "/api/auth/login", {"email": email, "password": "wrong-pw"})
        for _ in range(10)
    ]
    check(
        "ten failures answer 401",
        all(answer.status == 401 for answer in answers),
        [answer.status for answer in answers],
    )
    answer = call(
        "POST", "/api/auth/login", {"email": email, "password": "sturdy-pw-2026"}
    )
    retry = answer.header("Retry-After")
    check(
        "eleventh sign-in is locked out",
        answer.status == 429
        and answer.json == {"error": "too_many_attempts"}
        and retry.isdigit()
        and 1 <= int(retry) <= 900,
        (answer, retry),
    )
    answer = call("POST", "/api/auth/login", {"email": email})
    check(
        "a missing password is refused before the throttle",
        answer.status == 400,
        answer,
    )
    other = fresh_email("other")
    signup(other, "Other")
    check(
        "other emails are unaffected",
        call(
            "POST", "/api/auth/login", {"email": other, "password": "sturdy-pw-2026"}
        ).status
        == 200,
    )

    ghost = fresh_email("ghost")
    for _ in range(10):
        call("POST", "/api/auth/login", {"email": ghost, "password": "wrong-pw"})
    answer = call("POST", "/api/auth/login", {"email": ghost, "password": "wrong-pw"})
    check(
        "unknown emails are throttled alike",
        answer.status == 429 and answer.json == {"error": "too_many_attempts"},
        answer,
    )

    burst_email = fresh_email("burst")
    with ThreadPoolExecutor(max_workers=16) as pool:
        burst = list(
            pool.map(
                lambda _: call(
                    "POST",
                    "/api/auth/login",
                    {"email": burst_email, "password": "nope-nope"},
                ),
                range(16),
            )
        )
    refused = sum(1 for answer in burst if answer.status == 401)
    locked = sum(1 for answer in burst if answer.status == 429)
    check(
        "exactly ten failures are stored under a burst",
        refused == 10 and locked == 6,
        (refused, locked),
    )
    success_reset = fresh_email("reset")
    signup(success_reset, "Reset")
    for _ in range(9):
        call(
            "POST", "/api/auth/login", {"email": success_reset, "password": "wrong-pw"}
        )
    check(
        "a success before the tenth failure resets the count",
        call(
            "POST",
            "/api/auth/login",
            {"email": success_reset, "password": "sturdy-pw-2026"},
        ).status
        == 200,
    )
    for _ in range(9):
        call(
            "POST", "/api/auth/login", {"email": success_reset, "password": "wrong-pw"}
        )
    check(
        "the count starts again after a success",
        call(
            "POST",
            "/api/auth/login",
            {"email": success_reset, "password": "sturdy-pw-2026"},
        ).status
        == 200,
    )


def event_checks() -> None:
    answer = call("GET", "/api/event")
    body = answer.json
    check(
        "event fields",
        answer.status == 200
        and set(body)
        == {
            "name",
            "start",
            "end",
            "live_windows",
            "calendar_title",
            "calendar_description",
            "certificate_enabled",
            "server_time",
        }
        and body["name"] == "Strange & Unusual Activity"
        and body["start"] == "2026-10-22T16:00:00Z"
        and body["end"] == "2026-10-26T23:59:00Z"
        and body["live_windows"]
        == [{"start": "2026-10-22T16:00:00Z", "end": "2026-10-26T23:59:00Z"}]
        and body["certificate_enabled"] is True
        and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", body["server_time"]),
        body,
    )

    answer = call("GET", "/api/event/calendar.ics")
    text = answer.raw.decode("utf-8")
    lines = text.split("\r\n")
    check(
        "calendar headers",
        answer.header("Content-Type") == "text/calendar; charset=utf-8"
        and "downtime.ics" in answer.header("Content-Disposition"),
        answer.headers,
    )
    check("calendar crlf", text.count("\n") == text.count("\r\n"), text[:200])
    check(
        "calendar envelope",
        lines[0] == "BEGIN:VCALENDAR"
        and "VERSION:2.0" in lines
        and any(line.startswith("PRODID:") for line in lines)
        and lines.count("BEGIN:VEVENT") == 1
        and "DTSTART:20261022T160000Z" in lines
        and "DTEND:20261026T235900Z" in lines,
        lines,
    )
    check(
        "calendar stamp",
        any(re.fullmatch(r"DTSTAMP:\d{8}T\d{6}Z", line) for line in lines),
        lines,
    )
    check(
        "calendar escapes commas",
        any(line.startswith("SUMMARY:") and "\\," in line for line in lines),
        [line for line in lines if line.startswith("SUMMARY")],
    )
    check(
        "calendar folds long lines",
        all(len(line.encode()) <= 75 for line in lines),
        [line for line in lines if len(line.encode()) > 75],
    )
    second = call("GET", "/api/event/calendar.ics").raw.decode()
    check(
        "calendar uid is stable",
        [line for line in lines if line.startswith("UID:")]
        == [line for line in second.split("\r\n") if line.startswith("UID:")],
    )


def scenario_checks() -> None:
    answer = call("GET", "/api/scenarios")
    scenarios = answer.json["scenarios"]
    check(
        "eight scenarios in number order",
        len(scenarios) == 8
        and [scenario["number"] for scenario in scenarios] == list(range(1, 9))
        and [scenario["points"] for scenario in scenarios]
        == [500, 500, 500, 60, 80, 90, 100, 120]
        and [scenario["kind"] for scenario in scenarios]
        == ["soc-sim", "th-sim", "tabletop"] + ["challenge"] * 5,
        scenarios,
    )
    check(
        "scenario fields",
        all(
            set(scenario)
            == {"slug", "number", "title", "kind", "points", "description"}
            for scenario in scenarios
        ),
        scenarios[0],
    )
    check("no flag in the list", "flag{" not in answer.text)

    answer = call("GET", "/api/scenarios/repossessed")
    check(
        "scenario detail for a visitor",
        answer.status == 200
        and set(answer.json)
        == {"scenario", "team_solved", "solved_by_me", "attempted_by_me"}
        and answer.json["team_solved"] is False
        and answer.json["solved_by_me"] is False
        and answer.json["attempted_by_me"] is False,
        answer,
    )
    for label, slug in (
        ("unknown", "nope"),
        ("nul", "repossessed%00"),
        ("non ascii", "repossess%C3%A9d"),
        ("too long", "a" * 65),
    ):
        answer = call("GET", f"/api/scenarios/{slug}")
        check(
            f"scenario {label} slug",
            answer.status == 404 and answer.json == {"error": "unknown_scenario"},
            answer,
        )


def main() -> int:
    print(f"checking {BASE}")
    surface_checks()
    account_checks()
    simultaneous_signup_checks()
    throttle_checks()
    event_checks()
    scenario_checks()
    return report()


if __name__ == "__main__":
    sys.exit(main())
