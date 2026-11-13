"""A developer check of the clock, concurrency, slug and recovery rules."""

from __future__ import annotations

import concurrent.futures as futures
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row

from northfall.config import settings

BASE = os.environ.get("APP_PUBLIC_URL", "http://127.0.0.1:4173")
PASSWORD = "deku-demo-pw-2026"
HELSINKI = ZoneInfo("Europe/Helsinki")
failures: list[str] = []


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


opener = urllib.request.build_opener(NoRedirects)


def call(method, path, body=None, token=None, headers=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    request = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with opener.open(request, timeout=20) as response:
            return response.status, _body(response.read()), dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, _body(error.read()), dict(error.headers)
    except Exception as error:  # a stopped database shows up as a transport failure
        return 0, {"message": str(error)}, {}


def _body(payload):
    try:
        return json.loads(payload)
    except ValueError:
        return payload


def check(label, got, want):
    if got != want:
        failures.append(f"{label}: got {got!r}, wanted {want!r}")


def login(email):
    status, payload, _ = call("POST", "/api/auth/login", {"email": email, "password": PASSWORD})
    check(f"login {email}", status, 200)
    return payload["token"]


def held(email):
    return sessions[email]


def connect():
    return psycopg.connect(settings.database_url, row_factory=dict_row, autocommit=True)


sessions: dict[str, str] = {}


def set_clock(offset_seconds: int) -> None:
    """Move the rehearsal clock, then sign the checking accounts in again."""
    with connect() as conn:
        conn.execute("UPDATE service_clock SET offset_seconds = %s WHERE id = 1", (offset_seconds,))
    for email in list(sessions):
        sessions[email] = login(email)


def set_clock_at(target: dt.datetime) -> None:
    """Move the rehearsal clock so that the service second is exactly target."""
    now = dt.datetime.now(tz=dt.timezone.utc)
    time.sleep(1.05 - now.microsecond / 1e6)
    now = dt.datetime.now(tz=dt.timezone.utc)
    set_clock(round((target - now.replace(microsecond=0)).total_seconds()))


def today_offset(days: int) -> int:
    return days * 86400


def main() -> int:
    sessions["curator@example.com"] = login("curator@example.com")
    sessions["steward@example.com"] = login("steward@example.com")

    # ---- no stored account holds a password in the clear
    with connect() as conn:
        rows = conn.execute("SELECT password_hash FROM account").fetchall()
    check("passwords are hashed", any(PASSWORD in row["password_hash"] for row in rows), False)
    check("hash form", all(row["password_hash"].startswith("pbkdf2_sha256$") for row in rows), True)

    # ---- the seed is in place exactly once
    with connect() as conn:
        counts = {
            table: conn.execute(f"SELECT count(*) AS n FROM {table}").fetchone()["n"]
            for table in (
                "programme",
                "account",
                "reference_entry",
                "figure",
                "note",
                "preview_link",
                "slug_redirect",
                "service_clock",
            )
        }
    check(
        "seed row counts",
        counts,
        {
            "programme": 2,
            "account": 3,
            "reference_entry": 6,
            "figure": 15,
            "note": 3,
            "preview_link": 0,
            "slug_redirect": 0,
            "service_clock": 1,
        },
    )

    # ---- window edges, judged by Helsinki calendar dates, inclusive
    today = dt.datetime.now(tz=HELSINKI).date()
    call(
        "PUT",
        "/api/desk/references/quarry-conveyor-upgrade/clearance",
        {"clearance_from": today.isoformat(), "clearance_until": today.isoformat()},
        token=held("steward@example.com"),
    )
    call(
        "PATCH",
        "/api/desk/references/quarry-conveyor-upgrade",
        {"figures": [{"label": "Idlers instrumented", "value": "184"}]},
        token=held("curator@example.com"),
    )
    call(
        "PUT",
        "/api/desk/references/quarry-conveyor-upgrade/clearance",
        {"clearance_from": today.isoformat(), "clearance_until": today.isoformat()},
        token=held("steward@example.com"),
    )
    status, payload, _ = call(
        "POST", "/api/desk/references/quarry-conveyor-upgrade/publish", token=held("curator@example.com")
    )
    check("a one-day window starting today publishes live", (status, payload["ordinal"]), (200, 4))

    for bad in ("20260203", "2026-W01-1", "2026-02-30", "2026-2-3"):
        status, payload, _ = call(
            "PUT",
            "/api/desk/references/dairy-line-rebuild/clearance",
            {"clearance_from": bad, "clearance_until": "2027-01-01"},
            token=held("steward@example.com"),
        )
        check(f"loose date {bad}", (status, list(payload["errors"])), (422, ["clearance_from"]))
    status, payload, _ = call(
        "PUT",
        "/api/desk/references/dairy-line-rebuild/clearance",
        {"clearance_from": "2027-01-02", "clearance_until": "2027-01-01"},
        token=held("steward@example.com"),
    )
    check("inverted window", (status, list(payload["errors"])), (422, ["clearance_until"]))

    # ---- rollover: the last day passes
    set_clock(today_offset(1))
    status, payload, _ = call("GET", "/api/references")
    check(
        "the reference leaves at the next request",
        [row["slug"] for row in payload],
        ["harbour-crane-retrofit", "dairy-line-rebuild", "paper-mill-drive-swap"],
    )
    check("the run closes up", [row["ordinal"] for row in payload], [1, 2, 3])
    status, payload, _ = call("GET", "/api/references/quarry-conveyor-upgrade")
    check("its address answers not found", (status, payload), (404, {"message": "Not found"}))
    status, payload, _ = call("GET", "/api/desk/references/quarry-conveyor-upgrade", token=held("curator@example.com"))
    check("the desk reports it withheld", payload["state"], "withheld")

    # ---- a future window is withheld exactly the same way
    ahead = (today + dt.timedelta(days=30)).isoformat()
    further = (today + dt.timedelta(days=60)).isoformat()
    call(
        "PUT",
        "/api/desk/references/quarry-conveyor-upgrade/clearance",
        {"clearance_from": ahead, "clearance_until": further},
        token=held("steward@example.com"),
    )
    status, payload, _ = call("GET", "/api/desk/references/quarry-conveyor-upgrade", token=held("curator@example.com"))
    check("a future window withholds", (payload["state"], payload["ordinal"]), ("withheld", None))
    status, payload, _ = call("GET", "/api/sectors")
    check("the sector list drops it", payload, ["food", "ports", "pulp"])

    # ---- rollover by several days, under simultaneous mixed requests
    set_clock(today_offset(31))

    def mixed(index):
        if index % 3 == 0:
            return call("GET", "/api/references")[0]
        if index % 3 == 1:
            return call("GET", "/api/desk/references", token=held("curator@example.com"))[0]
        return call("GET", "/fi/references")[0]

    with futures.ThreadPoolExecutor(max_workers=12) as pool:
        statuses = list(pool.map(mixed, range(24)))
    check("every request through a rollover answers", sorted(set(statuses)), [200])
    status, payload, _ = call("GET", "/api/references")
    check(
        "the reopened reference joins the end",
        [(row["slug"], row["ordinal"]) for row in payload][-1],
        ("quarry-conveyor-upgrade", 4),
    )
    set_clock(0)

    # ---- the service clock governs preview expiry across a daylight-saving change
    set_clock_at(dt.datetime(2026, 10, 22, 12, 0, 0, tzinfo=HELSINKI))
    call("POST", "/api/desk/references/quarry-conveyor-upgrade/retire", token=held("curator@example.com"))
    status, payload, _ = call(
        "POST", "/api/desk/references/quarry-conveyor-upgrade/preview", token=held("curator@example.com")
    )
    check("the default expiry crosses the clock change", payload["expires_at"], "2026-10-29T11:00:00+02:00")
    token = payload["token"]
    check("the token holds no slug", "quarry-conveyor-upgrade" in token, False)

    set_clock_at(dt.datetime(2026, 10, 22, 12, 0, 0, tzinfo=HELSINKI))
    status, payload, _ = call(
        "POST",
        "/api/desk/references/quarry-conveyor-upgrade/preview",
        {"expires_at": "2026-11-21T11:00:01+02:00"},
        token=held("curator@example.com"),
    )
    check("a second past thirty days is refused", (status, list(payload["errors"])), (422, ["expires_at"]))
    status, payload, _ = call(
        "POST",
        "/api/desk/references/quarry-conveyor-upgrade/preview",
        {"expires_at": "2026-11-21T11:00:00"},
        token=held("curator@example.com"),
    )
    check("an expiry with no offset is refused", status, 422)
    status, payload, _ = call(
        "POST",
        "/api/desk/references/quarry-conveyor-upgrade/preview",
        {"expires_at": "2026-10-22T12:00:00+03:00"},
        token=held("curator@example.com"),
    )
    check("an expiry that is not after now is refused", status, 422)

    set_clock_at(dt.datetime(2026, 10, 22, 12, 0, 0, tzinfo=HELSINKI))
    status, payload, _ = call(
        "POST",
        "/api/desk/references/quarry-conveyor-upgrade/preview",
        {"expires_at": "2026-11-21T11:00:00+02:00"},
        token=held("curator@example.com"),
    )
    check("exactly thirty days is allowed", status, 201)
    token = payload["token"]

    set_clock_at(dt.datetime(2026, 11, 21, 11, 0, 0, tzinfo=HELSINKI))
    status, _, _ = call("GET", f"/api/references/quarry-conveyor-upgrade?preview={token}")
    check("a link is valid at its expiry second", status, 200)
    set_clock_at(dt.datetime(2026, 11, 21, 11, 0, 1, tzinfo=HELSINKI))
    status, payload, _ = call("GET", f"/api/references/quarry-conveyor-upgrade?preview={token}")
    check("and refused one second later", (status, payload), (404, {"message": "Not found"}))

    # ---- a refused preview is indistinguishable from a missing address
    missing = call("GET", "/api/references/no-such-slug")
    refused = call("GET", f"/api/references/quarry-conveyor-upgrade?preview={token}")
    check("refused previews match in status", refused[0], missing[0])
    check("refused previews match in body", refused[1], missing[1])
    for header in ("Cache-Control", "X-Robots-Tag", "Content-Type"):
        check(f"refused previews match in {header}", refused[2].get(header), missing[2].get(header))
    set_clock(0)

    # ---- sessions last eight hours on the service clock
    fresh = login("curator@example.com")
    with connect() as conn:
        started = conn.execute(
            "SELECT created_at FROM desk_session ORDER BY id DESC LIMIT 1"
        ).fetchone()["created_at"]
    set_clock_at(started + dt.timedelta(seconds=28800))
    status, _, _ = call("GET", "/api/desk/references", token=fresh)
    check("a session is valid at exactly eight hours", status, 200)
    set_clock_at(started + dt.timedelta(seconds=28801))
    status, payload, _ = call("GET", "/api/desk/references", token=fresh)
    check("and ended one second later", (status, payload), (401, {"message": "Sign in to use the desk"}))
    set_clock(0)

    # ---- authority is read from the stored account on every request
    moving = login("curator@example.com")
    with connect() as conn:
        conn.execute("UPDATE account SET role = 'steward' WHERE email = 'curator@example.com'")
    status, _, _ = call(
        "PUT",
        "/api/desk/references/dairy-line-rebuild/clearance",
        {"clearance_from": "2026-01-01", "clearance_until": "2027-12-31"},
        token=moving,
    )
    check("a changed role applies on the next request", status, 200)
    with connect() as conn:
        conn.execute("UPDATE account SET role = 'curator' WHERE email = 'curator@example.com'")
        westhall = conn.execute("SELECT id FROM programme WHERE slug = 'westhall'").fetchone()["id"]
        conn.execute(
            "UPDATE account SET programme_id = %s WHERE email = 'curator@example.com'", (westhall,)
        )
    status, payload, _ = call("GET", "/api/desk/references", token=moving)
    check("a changed programme applies too", [row["slug"] for row in payload], ["cold-store-automation"])
    with connect() as conn:
        northfall = conn.execute("SELECT id FROM programme WHERE slug = 'northfall'").fetchone()["id"]
        conn.execute(
            "UPDATE account SET programme_id = %s WHERE email = 'curator@example.com'", (northfall,)
        )

    with connect() as conn:
        conn.execute(
            """INSERT INTO account (email, password_hash, role, programme_id)
               SELECT 'temporary@example.com', password_hash, 'curator', programme_id
                 FROM account WHERE email = 'curator@example.com'"""
        )
    temporary = login("temporary@example.com")
    with connect() as conn:
        conn.execute("DELETE FROM account WHERE email = 'temporary@example.com'")
    status, payload, _ = call("GET", "/api/desk/references", token=temporary)
    check("a deleted account's token is refused", (status, payload), (401, {"message": "Sign in to use the desk"}))

    # ---- slugs from real text
    decomposed = "A\u0308ljy ha\u0308mma\u0308stys"
    status, payload, _ = call(
        "POST",
        "/api/desk/references",
        {
            "title": decomposed,
            "sector": "metals",
            "customer": "Test",
            "summary": "s",
            "challenge": "c",
            "work": "w",
        },
        token=held("curator@example.com"),
    )
    check("a decomposed title slugs as composed", (status, payload), (201, {"slug": "aljy-hammastys"}))

    status, payload, _ = call("GET", "/api/desk/references/aljy-hammastys", token=held("curator@example.com"))
    version = payload["version"]
    status, payload, _ = call(
        "PATCH", "/api/desk/references/aljy-hammastys", {"title": "ALJY HAMMASTYS"}, token=held("curator@example.com")
    )
    check("a change of case keeps the slug", payload["slug"], "aljy-hammastys")
    check("a change of case still counts as a write", payload["version"], version + 1)
    with connect() as conn:
        history = conn.execute("SELECT count(*) AS n FROM slug_redirect").fetchone()["n"]
    check("a change of case writes no history", history, 0)

    status, payload, _ = call(
        "PATCH", "/api/desk/references/aljy-hammastys", {"title": "Renamed once"}, token=held("curator@example.com")
    )
    check("renaming moves the slug", payload["slug"], "renamed-once")
    status, payload, _ = call(
        "POST",
        "/api/desk/references",
        {
            "title": "Aljy hammastys",
            "sector": "metals",
            "customer": "Test",
            "summary": "s",
            "challenge": "c",
            "work": "w",
        },
        token=held("curator@example.com"),
    )
    check("an earlier slug is still taken", payload["slug"], "aljy-hammastys-2")

    # ---- simultaneous creates with one title
    def create(index):
        return call(
            "POST",
            "/api/desk/references",
            {
                "title": "Race condition works",
                "sector": "metals",
                "customer": "Test",
                "summary": "s",
                "challenge": "c",
                "work": "w",
            },
            token=held("curator@example.com"),
        )

    with futures.ThreadPoolExecutor(max_workers=5) as pool:
        made = list(pool.map(create, range(5)))
    check("every create answers 201", sorted({row[0] for row in made}), [201])
    slugs = sorted(row[1]["slug"] for row in made)
    check("the slugs are distinct", len(set(slugs)), 5)

    # ---- simultaneous publishes of one reference
    call(
        "PUT",
        "/api/desk/references/renamed-once/clearance",
        {"clearance_from": "2026-01-01", "clearance_until": "2099-12-31"},
        token=held("steward@example.com"),
    )
    call(
        "PATCH",
        "/api/desk/references/renamed-once",
        {"figures": [{"label": "Checks", "value": "1"}]},
        token=held("curator@example.com"),
    )
    call(
        "PUT",
        "/api/desk/references/renamed-once/clearance",
        {"clearance_from": "2026-01-01", "clearance_until": "2099-12-31"},
        token=held("steward@example.com"),
    )

    def publish_once(_index):
        return call("POST", "/api/desk/references/renamed-once/publish", token=held("curator@example.com"))[0]

    with futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(publish_once, range(6)))
    check("exactly one publish succeeds", sorted(results), [200, 409, 409, 409, 409, 409])
    status, payload, _ = call("GET", "/api/references")
    ordinals = [row["ordinal"] for row in payload]
    check("the run stays contiguous", ordinals, list(range(1, len(ordinals) + 1)))

    # ---- simultaneous publishes of different references
    others = []
    for number in range(3):
        status, payload, _ = call(
            "POST",
            "/api/desk/references",
            {
                "title": f"Parallel publish {number}",
                "sector": "metals",
                "customer": "Test",
                "summary": "s",
                "challenge": "c",
                "work": "w",
                "figures": [{"label": "Checks", "value": "1"}],
            },
            token=held("curator@example.com"),
        )
        slug = payload["slug"]
        call(
            "PUT",
            f"/api/desk/references/{slug}/clearance",
            {"clearance_from": "2026-01-01", "clearance_until": "2099-12-31"},
            token=held("steward@example.com"),
        )
        others.append(slug)

    with futures.ThreadPoolExecutor(max_workers=3) as pool:
        published = list(
            pool.map(
                lambda slug: call("POST", f"/api/desk/references/{slug}/publish", token=held("curator@example.com")),
                others,
            )
        )
    check("all three publish", sorted(row[0] for row in published), [200, 200, 200])
    awarded = sorted(row[1]["ordinal"] for row in published)
    check("the ordinals are contiguous and distinct", awarded, list(range(awarded[0], awarded[0] + 3)))

    # ---- simultaneous edits with If-Match
    status, payload, _ = call("GET", "/api/desk/references/renamed-once", token=held("curator@example.com"))
    version_held = payload["version"]

    def edit(index):
        return call(
            "PATCH",
            "/api/desk/references/renamed-once",
            {"summary": f"Edited by writer {index}."},
            token=held("curator@example.com"),
            headers={"If-Match": f'"{version_held}"'},
        )[0]

    with futures.ThreadPoolExecutor(max_workers=5) as pool:
        edits = list(pool.map(edit, range(5)))
    check("one edit wins", (edits.count(200), edits.count(412)), (1, 4))

    status, payload, _ = call(
        "PATCH",
        "/api/desk/references/renamed-once",
        {"summary": "Edited with a wildcard."},
        token=held("curator@example.com"),
        headers={"If-Match": "*"},
    )
    check("a wildcard matches any version", status, 200)
    status, payload, _ = call(
        "PATCH",
        "/api/desk/references/renamed-once",
        {"summary": "Edited with a bare version."},
        token=held("curator@example.com"),
        headers={"If-Match": "7"},
    )
    check("an unquoted version is refused", status, 412)

    # ---- an edit that changes nothing
    status, payload, _ = call("GET", "/api/desk/references/renamed-once", token=held("curator@example.com"))
    settled = payload["version"]
    status, payload, _ = call(
        "PATCH", "/api/desk/references/renamed-once", {"summary": payload["summary"]}, token=held("curator@example.com")
    )
    check("resubmitting the same value changes nothing", (status, payload["version"]), (200, settled))
    status, payload, _ = call("PATCH", "/api/desk/references/renamed-once", {}, token=held("curator@example.com"))
    check("an empty edit answers 200", (status, payload["version"]), (200, settled))
    status, payload, _ = call(
        "PATCH",
        "/api/desk/references/renamed-once",
        {"figures": [{"label": "Checks", "value": "1", "position": 9}]},
        token=held("curator@example.com"),
    )
    check("an extra key inside a figure is no change", payload["clearance_voided"], False)

    # ---- simultaneous enquiries from one address
    def enquire(_index):
        return call("POST", "/api/enquiries", {"email": "race@example.com", "agreed": True})

    with futures.ThreadPoolExecutor(max_workers=6) as pool:
        sent = list(pool.map(enquire, range(6)))
    check("every repeat answers 201", sorted({row[0] for row in sent}), [201])
    check("they share one record", len({row[1]["id"] for row in sent}), 1)
    with connect() as conn:
        rows = conn.execute(
            "SELECT count(*) AS n FROM enquiry WHERE lower(btrim(email)) = 'race@example.com'"
        ).fetchone()
    check("exactly one row is written", rows["n"], 1)

    # ---- redirect fidelity
    status, _, headers = call(
        "GET",
        "/references/aljy-hammastys?sector=food&x=a%20b",
        headers={"Host": "evil.example.com", "X-Forwarded-Host": "evil.example.com"},
    )
    check("the redirect is one permanent hop", status, 308)
    check(
        "it stays on the configured origin and keeps the query",
        headers.get("Location"),
        "/references/renamed-once?sector=food&x=a%20b",
    )

    # ---- a retired reference answers not found at every address it has held
    call("POST", "/api/desk/references/renamed-once/retire", token=held("curator@example.com"))
    for path in (
        "/references/aljy-hammastys",
        "/fi/references/aljy-hammastys",
        "/api/references/aljy-hammastys",
        "/api/fi/references/aljy-hammastys",
        "/references/renamed-once",
        "/api/references/renamed-once",
    ):
        status, _, _ = call("GET", path)
        check(f"retired address {path}", status, 404)

    status, payload, _ = call("POST", "/api/desk/references/renamed-once/publish", token=held("curator@example.com"))
    check("a restore lands last", status, 200)
    status, _, headers = call("GET", "/api/references/aljy-hammastys")
    check("earlier slugs redirect again", (status, headers.get("Location")), (308, "/api/references/renamed-once"))

    if failures:
        print("\n".join(failures))
        print(f"\n{len(failures)} check(s) failed")
        return 1
    print("all rule checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
