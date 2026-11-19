"""Multi-instance, seeding and database outage checks."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

from support import SEED_PASSWORD, call, check, database, report, reset_database

FIRST = "http://127.0.0.1:4181"
SECOND = "http://127.0.0.1:4182"
OUTAGE = "http://127.0.0.1:4183"
PROXY_PORT = 5441

COUNTS = {
    "scenarios": 8,
    "teams": 16,
    "users": 55,
    "memberships": 54,
    "team_solves": 41,
    "completions": 41,
    "webinar_claims": 0,
    "login_attempts": 0,
    "flag_attempts": 0,
}


def kill_leftovers() -> None:
    """Stop any instance left behind by an earlier run."""
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            with open(f"/proc/{entry}/cmdline", "rb") as handle:
                command = handle.read().decode("utf-8", "replace").split("\x00")
        except OSError:
            continue
        if "server" in command and "-m" in command:
            try:
                os.kill(int(entry), 15)
            except OSError:
                pass
    time.sleep(1.0)


def start_instance(port: int, database_url: str | None = None) -> subprocess.Popen:
    environment = dict(os.environ)
    if database_url:
        environment["DATABASE_URL"] = database_url
    return subprocess.Popen(
        [
            ".venv/bin/python",
            "-m",
            "server",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd="/app",
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def wait_healthy(base: str, timeout: float = 25.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        answer = call("GET", "/api/health", base=base)
        if answer.status == 200:
            return True
        time.sleep(0.25)
    return False


def row_counts() -> dict[str, int]:
    connection = database()
    cursor = connection.cursor()
    counts = {}
    for table in COUNTS:
        cursor.execute(f"SELECT count(*) FROM {table}")
        counts[table] = cursor.fetchone()[0]
    connection.close()
    return counts


def email(label: str) -> str:
    return f"{label}-{uuid.uuid4().hex[:8]}@example.com"


def seeding_checks() -> tuple[subprocess.Popen, subprocess.Popen]:
    kill_leftovers()
    reset_database()
    first = start_instance(4181)
    second = start_instance(4182)
    check("first instance becomes healthy", wait_healthy(FIRST), "timeout")
    check("second instance becomes healthy", wait_healthy(SECOND), "timeout")
    check("the seed is written exactly once", row_counts() == COUNTS, row_counts())
    return first, second


def shared_state_checks() -> None:
    address = email("shared")
    answer = call(
        "POST",
        "/api/auth/signup",
        {"email": address, "display_name": "Shared", "password": "sturdy-pw-2026"},
        base=FIRST,
    )
    token = answer.json["token"]
    check(
        "a token from one instance works on the other",
        call("GET", "/api/me", token=token, base=SECOND).status == 200,
    )
    call("POST", "/api/auth/logout", token=token, base=SECOND)
    check(
        "signing out ends the session on every instance",
        call("GET", "/api/me", token=token, base=FIRST).status == 401,
    )

    locked = email("locked-cluster")
    call(
        "POST",
        "/api/auth/signup",
        {"email": locked, "display_name": "Locked", "password": "sturdy-pw-2026"},
        base=FIRST,
    )
    for index in range(10):
        base = FIRST if index % 2 else SECOND
        call(
            "POST",
            "/api/auth/login",
            {"email": locked, "password": "wrong-pw"},
            base=base,
        )
    answer = call(
        "POST",
        "/api/auth/login",
        {"email": locked, "password": "sturdy-pw-2026"},
        base=SECOND,
    )
    check(
        "a sign-in lockout holds on every instance",
        answer.status == 429 and answer.header("Retry-After").isdigit(),
        answer,
    )

    race_email = email("cluster-race")
    forms = [
        (
            FIRST,
            {"email": race_email, "display_name": "A", "password": "sturdy-pw-2026"},
        ),
        (
            SECOND,
            {
                "email": race_email.upper(),
                "display_name": "B",
                "password": "sturdy-pw-2026",
            },
        ),
        (
            FIRST,
            {
                "email": f" {race_email} ",
                "display_name": "C",
                "password": "sturdy-pw-2026",
            },
        ),
        (
            SECOND,
            {"email": race_email, "display_name": "D", "password": "sturdy-pw-2026"},
        ),
    ]
    with ThreadPoolExecutor(max_workers=4) as pool:
        answers = list(
            pool.map(
                lambda form: call("POST", "/api/auth/signup", form[1], base=form[0]),
                forms,
            )
        )
    created = [answer for answer in answers if answer.status == 201]
    check(
        "sign-ups across instances create one account",
        len(created) == 1
        and all(
            answer.json == {"error": "email_taken"}
            for answer in answers
            if answer.status != 201
        ),
        [answer.status for answer in answers],
    )

    player_token = created[0].json["token"]
    answer = call(
        "POST",
        "/api/teams",
        {"name": f"Cluster {uuid.uuid4().hex[:6]}"},
        token=player_token,
        base=FIRST,
    )
    code = answer.json["team"]["invite_code"]
    team_id = answer.json["team"]["id"]
    joiners = []
    for index in range(4):
        base = FIRST if index % 2 else SECOND
        answer = call(
            "POST",
            "/api/auth/signup",
            {
                "email": email(f"cluster-join-{index}"),
                "display_name": f"J{index}",
                "password": "sturdy-pw-2026",
            },
            base=base,
        )
        joiners.append((base, answer.json["token"]))
    with ThreadPoolExecutor(max_workers=4) as pool:
        answers = list(
            pool.map(
                lambda pair: call(
                    "POST",
                    "/api/teams/join",
                    {"invite_code": code},
                    token=pair[1],
                    base=pair[0],
                ),
                joiners,
            )
        )
    check(
        "joins across instances all succeed on a free team",
        all(answer.status == 200 for answer in answers),
        [answer.status for answer in answers],
    )
    room = call("GET", "/api/teams/mine", token=player_token, base=SECOND).json
    check("the team holds five members", len(room["members"]) == 5, room["members"])

    for index in range(5):
        call(
            "POST",
            "/api/scenarios/day-o/flag",
            {"flag": f"flag{{no{index}}}"},
            token=joiners[0][1],
            base=FIRST,
        )
    answer = call(
        "POST",
        "/api/scenarios/day-o/flag",
        {"flag": "flag{payload_unpacked}"},
        token=joiners[0][1],
        base=SECOND,
    )
    check(
        "a wrong-flag lock holds on every instance",
        answer.status == 429 and 1 <= int(answer.header("Retry-After")) <= 60,
        answer,
    )

    lines: list[str] = []
    request = urllib.request.Request(f"{SECOND}/api/stream")
    stream = urllib.request.urlopen(request, timeout=20)

    def read_stream() -> None:
        try:
            while True:
                line = stream.readline()
                if not line:
                    return
                lines.append(line.decode().rstrip("\n"))
        except (OSError, AttributeError, ValueError):
            return

    import threading

    threading.Thread(target=read_stream, daemon=True).start()
    time.sleep(0.5)
    call(
        "POST",
        "/api/scenarios/repossessed/flag",
        {"flag": "flag{nine_alerts_one_build}"},
        token=player_token,
        base=FIRST,
    )
    time.sleep(2.0)
    scores = [
        json.loads(lines[index + 1].removeprefix("data: "))
        for index, line in enumerate(lines)
        if line == "event: score" and index + 1 < len(lines)
    ]
    check(
        "a solve on one instance reaches the stream on the other",
        any(event["team_id"] == team_id for event in scores),
        scores,
    )
    stream.close()


def restart_checks(first: subprocess.Popen) -> subprocess.Popen:
    token = call(
        "POST",
        "/api/auth/login",
        {"email": "captain@example.com", "password": SEED_PASSWORD},
        base=FIRST,
    ).json["token"]
    rotated = call("POST", "/api/teams/mine/invite-code", token=token, base=FIRST).json[
        "invite_code"
    ]
    counts = row_counts()
    first.terminate()
    first.wait(timeout=10)
    replacement = start_instance(4181)
    check("the instance comes back healthy", wait_healthy(FIRST), "timeout")
    check(
        "a restart duplicates nothing",
        row_counts() == counts,
        (row_counts(), counts),
    )
    check(
        "a restart keeps a rotated invite code",
        call("GET", "/api/teams/mine", token=token, base=FIRST).json["team"][
            "invite_code"
        ]
        == rotated,
    )
    check(
        "sessions survive a restart",
        call("GET", "/api/me", token=token, base=FIRST).status == 200,
    )
    return replacement


def start_proxy(parsed) -> subprocess.Popen:
    proxy = subprocess.Popen(
        [
            ".venv/bin/python",
            "tests/proxy.py",
            str(PROXY_PORT),
            parsed.hostname,
            str(parsed.port or 5432),
        ],
        cwd="/app",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(0.6)
    return proxy


def outage_checks() -> None:
    parsed = urlparse(os.environ["DATABASE_URL"])
    proxy = start_proxy(parsed)
    proxied = (
        f"postgresql://{parsed.username}:{parsed.password}"
        f"@127.0.0.1:{PROXY_PORT}{parsed.path}"
    )
    instance = start_instance(4183, proxied)
    try:
        check("the proxied instance starts healthy", wait_healthy(OUTAGE), "timeout")
        token = call(
            "POST",
            "/api/auth/login",
            {"email": "captain@example.com", "password": SEED_PASSWORD},
            base=OUTAGE,
        ).json["token"]
        stream = urllib.request.urlopen(
            urllib.request.Request(f"{OUTAGE}/api/stream"), timeout=10
        )
        check("the stream opens", stream.readline().startswith(b":"))

        proxy.terminate()
        proxy.wait(timeout=10)
        time.sleep(0.5)
        started = time.monotonic()
        answer = call("GET", "/api/event", base=OUTAGE)
        elapsed = time.monotonic() - started
        check(
            "routes answer 503 unavailable during an outage",
            answer.status == 503
            and answer.json == {"error": "unavailable"}
            and elapsed < 5.0,
            (answer, elapsed),
        )
        answer = call("GET", "/api/health", base=OUTAGE)
        check(
            "health reports unavailable during an outage",
            answer.status == 503 and answer.json == {"error": "unavailable"},
            answer,
        )
        answer = call("GET", "/api/leaderboard", base=OUTAGE)
        check("the leaderboard is unavailable", answer.status == 503, answer)
        answer = call("GET", "/api/me", token=token, base=OUTAGE)
        check("personal reads are unavailable", answer.status == 503, answer)
        answer = call("GET", "/downtime", base=OUTAGE)
        check(
            "the event page still answers",
            answer.status == 200 and b"It's Downtime!" in answer.raw,
            answer.status,
        )
        check("the process is still running", instance.poll() is None)
        check("the open stream closed", stream.read() is not None)

        proxy = start_proxy(parsed)
        deadline = time.monotonic() + 5.0
        recovered = False
        while time.monotonic() < deadline:
            if call("GET", "/api/health", base=OUTAGE).status == 200:
                recovered = True
                break
            time.sleep(0.25)
        check("the instance recovers within five seconds", recovered, "timeout")
        check(
            "sessions from before the outage still work",
            call("GET", "/api/me", token=token, base=OUTAGE).status == 200,
        )
        stream = urllib.request.urlopen(
            urllib.request.Request(f"{OUTAGE}/api/stream"), timeout=10
        )
        check("the stream opens again", stream.readline().startswith(b":"))
        stream.close()
    finally:
        instance.terminate()
        instance.wait(timeout=10)
        proxy.terminate()
        proxy.wait(timeout=10)


def cold_start_checks() -> None:
    instance = start_instance(4183, "postgresql://nobody:nothing@127.0.0.1:5999/none")
    try:
        time.sleep(3)
        answer = call("GET", "/api/health", base=OUTAGE)
        check(
            "health reports starting without a database",
            answer.status == 503 and answer.json == {"error": "starting"},
            answer,
        )
        started = time.monotonic()
        answer = call("GET", "/api/scenarios", base=OUTAGE)
        elapsed = time.monotonic() - started
        check(
            "routes are unavailable without a database",
            answer.status == 503
            and answer.json == {"error": "unavailable"}
            and elapsed < 5.0,
            (answer, elapsed),
        )
        answer = call("GET", "/downtime", base=OUTAGE)
        check(
            "the event page answers without a database",
            answer.status == 200,
            answer.status,
        )
        check("the process stays up", instance.poll() is None)
    finally:
        instance.terminate()
        instance.wait(timeout=10)


def main() -> int:
    first, second = seeding_checks()
    try:
        shared_state_checks()
        first = restart_checks(first)
    finally:
        for instance in (first, second):
            instance.terminate()
            instance.wait(timeout=10)
    outage_checks()
    cold_start_checks()
    return report()


if __name__ == "__main__":
    sys.exit(main())
