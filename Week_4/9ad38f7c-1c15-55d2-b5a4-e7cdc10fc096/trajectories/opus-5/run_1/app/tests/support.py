"""Test support: a tiny HTTP client, a database reset and a check recorder."""

from __future__ import annotations

import json
import os
import threading
import urllib.error
import urllib.request
from urllib.parse import urlparse

BASE = os.environ.get("TEST_BASE", "http://127.0.0.1:4173")
SEED_PASSWORD = "deku-demo-pw-2026"

TABLES = (
    "live_events",
    "flag_attempts",
    "completions",
    "team_solves",
    "webinar_claims",
    "memberships",
    "sessions",
    "login_attempts",
    "teams",
    "users",
    "scenarios",
)

_FAILURES: list[str] = []
_PASSES = [0]
_LOCK = threading.Lock()


class Answer:
    def __init__(self, status: int, headers: dict[str, str], body: bytes) -> None:
        self.status = status
        self.headers = {name.lower(): value for name, value in headers.items()}
        self.raw = body

    def header(self, name: str) -> str:
        return self.headers.get(name.lower(), "")

    @property
    def json(self):
        try:
            return json.loads(self.raw.decode("utf-8"))
        except Exception:
            return None

    @property
    def text(self) -> str:
        return self.raw.decode("utf-8", "replace")

    def __repr__(self) -> str:
        return f"<{self.status} {self.raw[:200]!r}>"


def call(
    method: str,
    path: str,
    body=None,
    token: str | None = None,
    raw: bytes | None = None,
    content_type: str | None = "application/json",
    base: str | None = None,
    headers: dict[str, str] | None = None,
) -> Answer:
    url = (base or BASE) + path
    data = (
        raw
        if raw is not None
        else (json.dumps(body).encode() if body is not None else None)
    )
    request = urllib.request.Request(url, data=data, method=method)
    if data is not None and content_type:
        request.add_header("Content-Type", content_type)
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=20) as answer:
            return Answer(answer.status, dict(answer.headers.items()), answer.read())
    except urllib.error.HTTPError as error:
        return Answer(error.code, dict(error.headers.items()), error.read())
    except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
        return Answer(0, {}, str(error).encode())


def signup(
    email: str, name: str = "Test Player", password: str = "sturdy-pw-2026"
) -> str:
    answer = call(
        "POST",
        "/api/auth/signup",
        {"email": email, "display_name": name, "password": password},
    )
    assert answer.status == 201, answer
    return answer.json["token"]


def login(email: str, password: str = SEED_PASSWORD) -> str:
    answer = call("POST", "/api/auth/login", {"email": email, "password": password})
    assert answer.status == 200, answer
    return answer.json["token"]


def check(name: str, condition, detail: object = "") -> None:
    with _LOCK:
        if condition:
            _PASSES[0] += 1
        else:
            _FAILURES.append(f"{name}: {detail}")
            print(f"FAIL {name}: {detail}")


def report() -> int:
    print(f"\n{_PASSES[0]} checks passed, {len(_FAILURES)} failed")
    for failure in _FAILURES:
        print(f"  - {failure}")
    return 1 if _FAILURES else 0


def database():
    import pg8000.dbapi

    parsed = urlparse(os.environ["DATABASE_URL"])
    return pg8000.dbapi.connect(
        user=parsed.username,
        password=parsed.password,
        host=parsed.hostname,
        port=parsed.port or 5432,
        database=parsed.path.lstrip("/"),
    )


def reset_database() -> None:
    connection = database()
    cursor = connection.cursor()
    for table in TABLES:
        cursor.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    connection.commit()
    connection.close()
