import json
import os
import re
import shlex
import signal
import socket
import subprocess
import tempfile
import threading
import time
import unicodedata
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (
    DEPLOYED_APP,
    advance,
    animations,
    axe,
    click,
    held,
    layout,
    open_app,
    same_origin,
    select,
    settle,
    state_styles,
    tab_order,
    unique,
)

PASSWORD = "deku-demo-pw-2026"
CURATOR = "curator@example.com"
STEWARD = "steward@example.com"
WESTHALL = "curator.westhall@example.com"
HARBOUR, DAIRY, PAPER = "harbour-crane-retrofit", "dairy-line-rebuild", "paper-mill-drive-swap"
RAIL, QUARRY, COLD = "rail-depot-signalling", "quarry-conveyor-upgrade", "cold-store-automation"
HARBOUR_T, DAIRY_T, PAPER_T = "Harbour crane retrofit", "Dairy line rebuild", "Paper mill drive swap"
QUARRY_T = "Quarry conveyor upgrade"
NOT_FOUND = b'{"message":"Not found"}'
OUTAGE = "The reference desk is unavailable right now"
OUTAGE_FI = "Referenssitoimisto ei ole juuri nyt käytettävissä"
DESK_401 = {"message": "Sign in to use the desk"}
ROUTES = ["/", "/references", f"/references/{HARBOUR}", "/programme", "/story", "/notes", "/contact"]
CHAPTERS = {"nomination": "Nomination", "clearance": "Clearance",
            "duration": "How long a clearance lasts", "changes": "Changes and removal"}
SESSION_SECONDS = 28800
DEFAULT_PREVIEW_SECONDS = 604800
MAX_PREVIEW_SECONDS = 2592000
BODY_LIMIT = 65536
DEEP_NESTING = 60000
OUTAGE_SECONDS = 5
COPY_MIN_MS = 1500
COPY_MAX_MS = 2500
PHONE_MIN_TARGET = 24
WIDE, MIDDLE_LOW, NARROW_HIGH, MIDDLE_HIGH = 1100, 640, 639, 1099
PHONE_W, PHONE_H, DESK_W, DESK_H, REFLOW_W = 375, 812, 1280, 800, 320
PROMISE_MIN, PROMISE_MAX = 0.2, 0.3
HTTP_TIMEOUT = 30
BOOT_DEADLINE = 120
POLL_PAUSE = 0.1
EXACT_ATTEMPTS = 30
ALIGN_FRACTION = 0.2
SETTLE_READS = 8
SETTLE_EPSILON = 0.5
THREADS = 24
COLD_T = COLD.replace("-", " ").capitalize()
RAIL_T = RAIL.replace("-", " ").capitalize()
SLUG_FOLD = str.maketrans("äåö", "aao")
PHONE_INPUT = "+358400000000"
HOSTILE_SECTOR = "<b>x"
CORS_HEADER = "access-control-allow-origin"
SPOOF_HOST = "evil.example"
DRAFT_SUMMARY = "A summary."
NEW_WORK = "New work"
FUTURE_TITLE = "Future installation"
FUTURE_SECTOR = "future-sector"
FIFTH_TITLE = "Fifth installation"
EDITED_SUMMARY = "Edited summary"
BANNER_TITLE = "Bannered draft"
PREVIEW_TITLE = "Previewed draft"
STATE_TITLE = "State machine probe"
RENAME_ONE = "Dairy plant rebuild"
RENAME_TWO = "Creamery rebuild"
PAPER_RENAME = "Paper mill drives"
DECOMPOSED_TITLE = "Ma\u0308ki A\u030aland O\u0308ljy"
ALPHA_TITLE = "Alpha name"
BETA_TITLE = "Beta name"
TYPED_WORDS = "Typed and unsaved words"
NEVER_WRITTEN = "Must never be written"
HALL_TITLE = "Dairy hall rebuild"
FOLLOW_UP_WORK = "Follow-up work"
HOIST_TITLE = "Harbour hoist retrofit"
TAB_STOPS = 30
RING_STOPS = 12
BASE_NOW = "2026-11-03T10:00:00Z"
STALE_LAST_EVENING = "2026-11-05T18:00:00Z"
STALE_PAST_MIDNIGHT = "2026-11-05T22:30:00Z"
FAR = ("2000-01-01", "2099-12-31")
PAST = ("2000-01-01", "2000-01-02")
FUTURE = ("2098-01-01", "2099-12-31")
ABSENT = object()

FI_NAV = ["Referenssit", "Ohjelma", "Tarina", "Muistiinpanot"]
FI_ERRORS = {"email": "Anna työosoite, johon toimisto voi vastata",
             "agreed": "Hyväksy tietosuojaseloste valitsemalla ruutu",
             "phone": "Anna vähintään kymmenen merkin puhelinnumero"}
FI_REF_ERROR = "Valitse referenssi kirjastosta"


def _epoch(iso):
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def _wait(predicate, seconds=BOOT_DEADLINE, what="condition"):
    deadline = time.monotonic() + seconds
    event = threading.Event()
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        event.wait(POLL_PAUSE)
    pytest.fail(f"{what} not reached within {seconds} s")


def _call(base, method, path, body=ABSENT, token=None, raw=None, headers=None):
    head = dict(headers or {})
    if token:
        head["Authorization"] = f"Bearer {token}"
    content = raw
    if body is not ABSENT:
        content = json.dumps(body)
        head.setdefault("Content-Type", "application/json")
    with httpx.Client(timeout=HTTP_TIMEOUT, follow_redirects=False) as client:
        return client.request(method, base + path, content=content, headers=head)


def _get(base, path, **headers):
    return _call(base, "GET", path, headers=headers)


def _addr():
    found = next((part for part in unique("prospect") if "@" in part), None)
    return found or f"p{uuid.uuid4().hex[:12]}@example.com"


def _title(word="Probe"):
    return f"{word} {uuid.uuid4().hex[:10]}"


def _slug_of(title):
    folded = unicodedata.normalize("NFC", title).lower().translate(SLUG_FOLD)
    return re.sub(r"[^a-z0-9]+", "-", folded).strip("-")


def _count_en(count, sector=None):
    noun = "cleared reference" if count == 1 else "cleared references"
    line = f"{count} {noun}"
    return line if sector is None else f"{line} in {sector}".strip()


def _count_fi(count, sector=None):
    noun = "hyväksytty referenssi" if count == 1 else "hyväksyttyä referenssiä"
    line = f"{count} {noun}"
    return line if sector is None else f"{line} toimialalla {sector}"


def _totals(live, withheld, drafts, retired):
    return f"{live} live, {withheld} withheld, {drafts} drafts, {retired} retired"


def _draft(title, **extra):
    return {"title": title, "summary": DRAFT_SUMMARY, "challenge": "A challenge.", "work": "The work.",
            "sector": "probe-sector", "customer": "Probe Oy", **extra}


FIGS = [{"label": "Uptime", "value": "99 %"}]


class Desk:
    def __init__(self, base, email):
        self.base = base
        response = _call(base, "POST", "/api/auth/login", {"email": email, "password": PASSWORD})
        assert response.status_code == 200, response.text
        self.token, self.role = response.json()["token"], response.json()["role"]

    def call(self, method, path, body=ABSENT, **kw):
        return _call(self.base, method, path, body, token=self.token, **kw)

    def create(self, title=None, **extra):
        response = self.call("POST", "/api/desk/references", _draft(title or _title(), **extra))
        assert response.status_code == 201, response.text
        return response.json()["slug"]

    def patch(self, slug, body, **headers):
        return self.call("PATCH", f"/api/desk/references/{slug}", body, headers=headers)

    def publish(self, slug):
        return self.call("POST", f"/api/desk/references/{slug}/publish")

    def retire(self, slug):
        return self.call("POST", f"/api/desk/references/{slug}/retire")

    def window(self, slug, span):
        return self.call("PUT", f"/api/desk/references/{slug}/clearance",
                         {"clearance_from": span[0], "clearance_until": span[1]})

    def preview(self, slug, body=ABSENT):
        return self.call("POST", f"/api/desk/references/{slug}/preview", body)

    def order(self, slug, ordinal):
        return self.call("PUT", "/api/desk/order", {"slug": slug, "ordinal": ordinal})

    def detail(self, slug):
        return self.call("GET", f"/api/desk/references/{slug}").json()

    def rows(self):
        return self.call("GET", "/api/desk/references").json()

    def row(self, slug):
        return next(r for r in self.rows() if r["slug"] == slug)

    def queue(self):
        return self.call("GET", "/api/desk/enquiries").json()


class Relay:

    def __init__(self, host, port):
        self.target, self.conns, self.listener = (host, port), [], None
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        self.port = probe.getsockname()[1]
        probe.close()

    def start(self):
        self.listener = socket.socket()
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", self.port))
        self.listener.listen(64)
        threading.Thread(target=self._accept, args=(self.listener,), daemon=True).start()

    def stop(self):
        if self.listener is None:
            return
        try:
            self.listener.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.listener.close()
        self.listener = None
        for conn in self.conns:
            try:
                conn.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            conn.close()
        self.conns = []

    def _accept(self, listener):
        while True:
            try:
                near, _ = listener.accept()
                far = socket.create_connection(self.target)
            except OSError:
                return
            self.conns += [near, far]
            for src, dst in ((near, far), (far, near)):
                threading.Thread(target=self._pump, args=(src, dst), daemon=True).start()

    @staticmethod
    def _pump(src, dst):
        try:
            while data := src.recv(65536):
                dst.sendall(data)
        except OSError:
            pass
        for sock in (src, dst):
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


class Stack:

    def __init__(self, db_url, app_db_url):
        self.db_url, self.app_db_url = db_url, app_db_url
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        self.port = probe.getsockname()[1]
        probe.close()
        self.url = f"http://127.0.0.1:{self.port}"
        self.log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
        serve = json.loads((Path(str(DEPLOYED_APP)) / "run.json").read_text())["serve"]
        env = {**os.environ, "DATABASE_URL": app_db_url, "APP_PUBLIC_PORT": str(self.port),
               "APP_PUBLIC_URL": self.url}
        self.proc = subprocess.Popen(serve, shell=True, cwd=str(DEPLOYED_APP), env=env,
                                     stdout=self.log, stderr=self.log, start_new_session=True)
        self._curator = self._steward = None

    def tail(self):
        return Path(self.log.name).read_bytes()[-2000:].decode("utf-8", "replace")

    def ready(self):
        def healthy():
            assert self.proc.poll() is None, f"app exited: {self.tail()}"
            try:
                return _get(self.url, "/api/health").status_code == 200
            except httpx.HTTPError:
                return False
        _wait(healthy, what="health")

    def stop(self):
        try:
            os.killpg(self.proc.pid, signal.SIGTERM)
            self.proc.wait(timeout=HTTP_TIMEOUT)
        except subprocess.TimeoutExpired:
            os.killpg(self.proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def run(self, statement):
        return _psql(self.db_url, statement)

    def sql(self, select_sql):
        out = _psql(self.db_url, f"SELECT coalesce(json_agg(t), '[]') FROM ({select_sql}) t")
        return json.loads(out)

    def clock(self, when):
        target = _epoch(when) if isinstance(when, str) else when
        self.run(f"UPDATE service_clock SET offset_seconds = {target - int(time.time())}")
        self._curator = self._steward = None

    def exact(self, target, action):
        for _ in range(EXACT_ATTEMPTS):
            while time.time() % 1 > ALIGN_FRACTION:
                pass
            second = int(time.time())
            self.run(f"UPDATE service_clock SET offset_seconds = {target - second}")
            result = action()
            if int(time.time()) == second:
                return result
        pytest.fail("could not fit the call inside one clock second")

    @property
    def curator(self):
        self._curator = self._curator or Desk(self.url, CURATOR)
        return self._curator

    @property
    def steward(self):
        self._steward = self._steward or Desk(self.url, STEWARD)
        return self._steward

    def live(self, title=None, sector="probe-sector", span=FAR):
        slug = self.curator.create(title, sector=sector, figures=FIGS)
        assert self.steward.window(slug, span).status_code == 200
        assert self.curator.publish(slug).status_code == 200
        return slug

    def run_slugs(self):
        return [r["slug"] for r in _get(self.url, "/api/references").json()]


def _psql(url, statement):
    done = subprocess.run(["psql", url, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", statement],
                          capture_output=True, text=True, timeout=HTTP_TIMEOUT)
    assert done.returncode == 0, done.stderr
    return done.stdout.strip()


@contextmanager
def _scratch(relayed=False, relay_up=True):
    admin = os.environ["DATABASE_URL"]
    parts = urlsplit(admin)
    name = f"{parts.path.lstrip('/')}_t{uuid.uuid4().hex[:10]}"
    _psql(admin, f'CREATE DATABASE "{name}"')
    db_url = urlunsplit(parts._replace(path=f"/{name}"))
    relay, app_url = None, db_url
    if relayed:
        relay = Relay(parts.hostname, parts.port or 5432)
        if relay_up:
            relay.start()
        auth = parts.netloc.rsplit("@", 1)[0]
        app_url = urlunsplit(parts._replace(netloc=f"{auth}@127.0.0.1:{relay.port}", path=f"/{name}"))
    stack = Stack(db_url, app_url)
    stack.relay = relay
    try:
        yield stack
    finally:
        stack.stop()
        if relay:
            relay.stop()
        _psql(admin, f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


@pytest.fixture
def first_boot():
    with _scratch() as stack:
        stack.ready()
        yield stack


@pytest.fixture
def stack():
    with _scratch() as made:
        made.ready()
        made.clock(BASE_NOW)
        yield made


@pytest.fixture
def relayed():
    with _scratch(relayed=True) as made:
        made.ready()
        made.clock(BASE_NOW)
        yield made


def _together(calls):
    barrier = threading.Barrier(len(calls))

    def fire(call):
        barrier.wait()
        return call()
    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return list(pool.map(fire, calls))


class _Tags(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, {k: v or "" for k, v in attrs}))


def _tags(html, name):
    parser = _Tags()
    parser.feed(html)
    return [attrs for tag, attrs in parser.tags if tag == name]


def _text(html):
    html = re.sub(r"<(script|style)\b.*?</\1>", " ", html, flags=re.S | re.I)
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", html))).strip()


def _main(html):
    match = re.search(r"<main\b.*?</main>", html, re.S | re.I)
    assert match, "page has no main region"
    return match.group(0)


def _anchor_href(html, name):
    for attrs, inner in re.findall(r"<a\b([^>]*)>(.*?)</a>", html, re.S | re.I):
        if _text(inner) == name:
            return _tags(f"<a {attrs}>", "a")[0].get("href", "")
    pytest.fail(f"no link named {name}")


def _alternate(html, lang):
    for attrs in _tags(html, "link"):
        if attrs.get("rel") == "alternate" and attrs.get("hreflang") == lang:
            return attrs.get("href", "")
    pytest.fail(f"no alternate {lang}")


def _local(href, base):
    return href[len(base):] if href.startswith(base) else href


@contextmanager
def _live(browser, url, width=DESK_W, height=DESK_H, reduced="no-preference"):
    with open_app(browser, url, reduced_motion=reduced) as page:
        page.clock.resume()
        page.set_viewport_size({"width": width, "height": height})
        yield page


def _moving(locator):
    return [a for a in animations(locator) if a["playState"] == "running"]


def _a_frame(page):
    page.evaluate("() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))")


def _no_cookie(page):
    close = page.get_by_role("button", name=re.compile(r"^(Close the cookie notice|Sulje evästeilmoitus)$"))
    close.click()
    expect(close).to_have_count(0)


def _sign_in(page, email=CURATOR, password=PASSWORD):
    form = page.get_by_role("form", name="Sign in")
    form.get_by_label("Email").fill(email)
    form.get_by_label("Password").fill(password)
    form.get_by_role("button", name="Sign in").click()


def _desk(page, email=CURATOR):
    _sign_in(page, email)
    expect(page.get_by_role("heading", level=2, name="References", exact=True)).to_be_visible()


def _btn(page, name):
    return page.get_by_role("button", name=name, exact=True)


def _press(page, name, key="Enter"):
    button = _btn(page, name)
    button.focus()
    button.press(key)


def _editor(page):
    return page.get_by_role("form", name="Reference editor")


def _box(page, label):
    return _editor(page).get_by_role("textbox", name=label, exact=True)


def _msg(page):
    return page.get_by_role("status", name="Desk messages")


def _rows_text(page):
    return page.get_by_role("list", name="References").get_by_role("listitem").all_inner_texts()


def _order_in_ui(page, titles):
    texts = _rows_text(page)
    positions = [next(i for i, t in enumerate(texts) if title in t) for title in titles]
    return positions == sorted(positions)


def _focus_settled_y(page, locator):
    previous = None
    for _ in range(SETTLE_READS):
        page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
        current = locator.bounding_box()["y"]
        if previous is not None and abs(current - previous) <= SETTLE_EPSILON:
            return current
        previous = current
    return previous


def _scroll(page, top):
    page.evaluate("t => window.scrollTo({top: t, behavior: 'instant'})", top)


def test_health_and_one_origin(app_url):
    health = _get(app_url, "/api/health")
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    assert health.headers["content-type"].startswith("application/json")
    home = _get(app_url, "/")
    assert home.status_code == 200
    assert "References you can check, from installations we actually finished" in _text(home.text)
    assert HARBOUR in [r["slug"] for r in _get(app_url, "/api/references").json()]
    assert CORS_HEADER not in {k.lower() for k in health.headers}


def test_seed_first_boot(first_boot):
    db = first_boot
    assert sorted((p["slug"], p["name"], p["default_locale"]) for p in
                  db.sql("SELECT slug, name, default_locale FROM programme")) == [
        ("northfall", "Northfall Reference Programme", "en"),
        ("westhall", "Westhall Reference Programme", "en")]
    accounts = db.sql("SELECT a.email, a.role, p.slug FROM account a JOIN programme p ON p.id = a.programme_id")
    assert sorted((a["email"], a["role"], a["slug"]) for a in accounts) == [
        (WESTHALL, "curator", "westhall"), (CURATOR, "curator", "northfall"), (STEWARD, "steward", "northfall")]
    refs = db.sql("SELECT r.slug, r.title, r.sector, r.customer, r.published, r.ordinal, r.version, r.retired_at,"
                  " r.clearance_from::text AS f, r.clearance_until::text AS u, r.title_fi, r.body_fi, r.quote,"
                  " r.quote_speaker, r.quote_role, p.slug AS prog FROM reference_entry r"
                  " JOIN programme p ON p.id = r.programme_id")
    by_slug = {r["slug"]: r for r in refs}
    expected = {
        HARBOUR: ("northfall", "ports", "Kiela Terminals", True, "2026-01-01", "2027-12-31", 1),
        DAIRY: ("northfall", "food", "Vuono Dairy", True, "2026-01-01", "2027-12-31", 2),
        PAPER: ("northfall", "pulp", "Aspen Mills", True, "2026-01-01", "2027-12-31", 3),
        RAIL: ("northfall", "rail", "Northline Rail", True, "2025-01-01", "2026-01-31", None),
        QUARRY: ("northfall", "mining", "Stonebeck Quarry", False, None, None, None),
        COLD: ("westhall", "cold-chain", "Pakkas Logistics", True, "2026-01-01", "2027-12-31", 1),
    }
    assert set(by_slug) == set(expected) and len(refs) == len(expected)
    for slug, (prog, sector, customer, published, start, end, ordinal) in expected.items():
        row = by_slug[slug]
        assert (row["prog"], row["sector"], row["customer"], row["published"], row["ordinal"]) == (
            prog, sector, customer, published, ordinal)
        assert (row["f"] or "")[:10] == (start or "") and (row["u"] or "")[:10] == (end or "")
        assert row["version"] == 1 and row["retired_at"] is None
        assert row["title"] == slug.replace("-", " ").capitalize()
    assert by_slug[HARBOUR]["title_fi"] == "Satamanosturin modernisointi" and by_slug[HARBOUR]["body_fi"]
    assert [r["slug"] for r in refs if r["title_fi"] or r["body_fi"]] == [HARBOUR]
    assert [r["slug"] for r in refs if r["quote"]] == [PAPER]
    paper = by_slug[PAPER]
    assert paper["quote"] == ("We switched forty-eight drives during two planned shutdowns and lost no "
                              "production day to it.")
    assert paper["quote_speaker"] == "Hanna Lehto" and paper["quote_role"] == "Maintenance manager, Aspen Mills"
    figures = db.sql("SELECT r.slug, f.label, f.value, f.position FROM figure f"
                     " JOIN reference_entry r ON r.id = f.reference_id ORDER BY r.slug, f.position")
    grouped = {}
    for row in figures:
        grouped.setdefault(row["slug"], []).append((row["position"], row["label"], row["value"]))
    assert grouped == {
        HARBOUR: [(1, "Crane availability", "99.2 %"), (2, "Retrofit downtime", "11 days"),
                  (3, "Energy per container move", "-18 %")],
        DAIRY: [(1, "Line output", "+34 %"), (2, "Changeover time", "22 min"), (3, "Unplanned stops per month", "3")],
        PAPER: [(1, "Drive energy saved", "2.1 GWh a year"), (2, "Payback", "26 months"), (3, "Drives replaced", "48")],
        RAIL: [(1, "Points converted", "64"), (2, "Depot throughput", "+12 %"), (3, "Commissioning nights", "9")],
        COLD: [(1, "Pallet moves per hour", "410"), (2, "Picking errors", "-61 %"), (3, "Store temperature", "-25 °C")],
    }
    notes = db.sql("SELECT slug, title, preview, published_on::text AS d, body FROM note")
    assert {n["slug"]: (n["title"], n["preview"], (n["d"] or "")[:10]) for n in notes} == {
        "what-a-clearance-covers": ("What a clearance covers",
                                    "A customer clears the story, its figures and its quote together.", "2026-09-14"),
        "why-we-number-the-library": ("Why we number the library",
                                      "Each cleared reference takes the next number, and the numbers never skip.",
                                      "2026-06-02"),
        "translating-the-library": ("Translating the library",
                                    "Finnish versions arrive one reference at a time.", ""),
    }
    assert all(n["body"] for n in notes)
    enquiries = db.sql("SELECT e.email, e.reference, e.phone, e.open, e.agreed, p.slug AS prog"
                       " FROM enquiry e JOIN programme p ON p.id = e.programme_id")
    assert sorted((e["email"], e["reference"], e["prog"]) for e in enquiries) == [
        ("cold.buyer@example.com", COLD, "westhall"), ("prospect@example.com", DAIRY, "northfall")]
    assert all(e["open"] and e["agreed"] and not e["phone"] for e in enquiries)
    arrived = Desk(db.url, CURATOR).queue()[0]["created_at"]
    assert _epoch(arrived) == _epoch("2026-10-01T06:00:00Z")
    assert db.sql("SELECT id FROM preview_link") == [] and db.sql("SELECT id FROM slug_redirect") == []
    assert [c["offset_seconds"] for c in db.sql("SELECT offset_seconds FROM service_clock")] == [0]


def test_stored_entities(first_boot):
    tables = {
        "programme": "name slug default_locale",
        "account": "email password_hash role programme_id",
        "reference_entry": ("programme_id slug ordinal sector customer title summary challenge work title_fi "
                            "body_fi published retired_at version clearance_from clearance_until quote "
                            "quote_speaker quote_role"),
        "figure": "reference_id label value position",
        "note": "programme_id slug title preview body published_on",
        "enquiry": "programme_id email phone reference created_at agreed open",
        "preview_link": "token reference_id expires_at",
        "slug_redirect": "programme_id slug reference_id",
        "service_clock": "offset_seconds",
    }
    for table, columns in tables.items():
        found = {c["column_name"]: c["data_type"] for c in first_boot.sql(
            "SELECT column_name, data_type FROM information_schema.columns"
            f" WHERE table_schema = current_schema() AND table_name = '{table}'")}
        assert set(columns.split()) <= set(found), table
        assert "int" in found["id"], table


def test_no_video_no_foreign_files(browser, app_url):
    with _live(browser, app_url) as page:
        seen = []
        page.on("request", lambda r: seen.append(r.url))
        for route in ROUTES + ["/fi", "/desk"]:
            page.goto(app_url + route, wait_until="load")
            count = page.evaluate("() => document.getElementsByTagName('video').length")
            assert count == 0, route
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        assert len(seen) >= len(ROUTES)
        foreign = [u for u in seen if u.startswith("http") and not same_origin(u, app_url)]
        assert foreign == []


def test_nothing_sold_no_comments(app_url):
    for path in ("/api/auth/signup", "/api/signup", "/api/search", "/api/checkout", "/api/comments",
                 "/api/notes/comments", "/api/reactions"):
        for method in ("GET", "POST"):
            response = _call(app_url, method, path, {"email": "x@example.com"})
            assert response.status_code == 404 and response.content == NOT_FOUND, path


def test_only_published_surface(app_url):
    for path in ("/api/no-such-thing", "/api/docs", "/api/openapi.json", "/api/schema", "/api/debug"):
        response = _get(app_url, path)
        assert response.status_code == 404 and response.content == NOT_FOUND, path
        assert response.headers["content-type"].startswith("application/json")
    for path in ("/docs", "/redoc", "/openapi.json", "/swagger", "/admin", "/run.json", "/requirements.txt",
                 "/.env", "/.git/config", "/USER_README.md"):
        response = _get(app_url, path)
        assert response.status_code == 404 and "That page is not here" in _text(response.text), path
    allowed = {"/api/health": ("POST", {"GET"}), "/api/references": ("DELETE", {"GET"}),
               "/api/enquiries": ("GET", {"POST"}), "/api/auth/login": ("GET", {"POST"}),
               "/api/desk/order": ("GET", {"PUT"}), "/api/desk/references": ("PUT", {"GET", "POST"}),
               f"/api/desk/references/{QUARRY}": ("POST", {"GET", "PATCH"}),
               f"/api/desk/references/{QUARRY}/publish": ("GET", {"POST"}),
               f"/api/desk/references/{QUARRY}/clearance": ("GET", {"PUT"}),
               "/api/desk/enquiries": ("POST", {"GET"}), "/api/desk/enquiries/1": ("GET", {"DELETE"})}
    for path, (method, methods) in allowed.items():
        response = _call(app_url, method, path)
        assert response.status_code == 405, path
        assert response.json() == {"message": "Method not allowed"}
        assert {m.strip() for m in response.headers["allow"].split(",")} - {"HEAD"} == methods
    page_post = _call(app_url, "POST", "/references")
    assert page_post.status_code == 405
    assert {m.strip() for m in page_post.headers["allow"].split(",")} == {"GET", "HEAD"}
    for raw in (b"[]", b'"text"', b"1", b"{broken"):
        response = _call(app_url, "POST", "/api/enquiries", raw=raw)
        assert response.status_code == 422 and response.json() == {"errors": {"body": "Send a JSON object"}}
    empty = _call(app_url, "POST", "/api/enquiries", raw=b"")
    assert empty.status_code == 422 and "email" in empty.json()["errors"] and "body" not in empty.json()["errors"]
    big = _call(app_url, "POST", "/api/enquiries", raw=b" " * (BODY_LIMIT + 1))
    assert big.status_code == 413 and big.json() == {"message": "Request body too large"}
    at_limit = _call(app_url, "POST", "/api/enquiries", raw=b"{}" + b" " * (BODY_LIMIT - 2))
    assert at_limit.status_code == 422
    head = _call(app_url, "HEAD", "/api/references")
    assert head.status_code == 200 and head.content == b""


def test_service_clock_every_surface(first_boot):
    db = first_boot
    start = "2031-06-15T09:00:00Z"
    second = "2033-06-15T09:00:00Z"
    for when, year in ((start, "2031"), (second, "2033")):
        db.clock(when)
        assert f"{year}" in _text(_get(db.url, "/programme").text)
        address = _addr()
        response = _call(db.url, "POST", "/api/enquiries", {"email": address, "agreed": True})
        assert response.status_code == 201
        desk = Desk(db.url, CURATOR)
        row = next(e for e in desk.queue() if e["email"] == address)
        assert abs(_epoch(row["created_at"]) - _epoch(when)) <= HTTP_TIMEOUT
        minted = desk.preview(desk.create(), ABSENT).json()
        assert abs(_epoch(minted["expires_at"]) - (_epoch(when) + DEFAULT_PREVIEW_SECONDS)) <= HTTP_TIMEOUT
    offset = str(db.sql("SELECT offset_seconds FROM service_clock")[0]["offset_seconds"])
    for path in ("/api/health", "/api/references", "/api/notes", "/", "/references"):
        body = _get(db.url, path).text
        assert offset not in body and "offset_seconds" not in body


def test_outage_runtime_recovery(relayed):
    stack, relay = relayed, relayed.relay
    pid_alive = stack.proc.poll() is None
    relay.stop()

    def timed(method, path, **kw):
        started = time.monotonic()
        response = _call(stack.url, method, path, **kw)
        assert time.monotonic() - started <= OUTAGE_SECONDS, path
        return response
    _wait(lambda: timed("GET", "/api/health").status_code == 503, OUTAGE_SECONDS, "health outage")
    assert timed("GET", "/api/health").json() == {"status": "starting"}
    for path in ("/api/references", "/api/notes", f"/api/references/{HARBOUR}", "/api/fi/sectors"):
        response = timed("GET", path)
        assert response.status_code == 503 and response.json() == {"message": OUTAGE}, path
    assert timed("POST", "/api/enquiries", body={"email": "x@example.com", "agreed": True}).status_code == 503
    assert timed("POST", "/api/auth/login", body={}).status_code == 503
    for path in ("/", "/references", "/programme", "/story", "/contact"):
        response = timed("GET", path)
        assert response.status_code == 503 and OUTAGE in _text(response.text), path
    fi_page = timed("GET", "/fi/contact")
    assert fi_page.status_code == 503 and OUTAGE_FI in _text(fi_page.text)
    assert timed("GET", "/api/no-such-thing").status_code == 404
    assert timed("POST", "/api/references").status_code == 405
    assert timed("GET", "/no-such-address-here").status_code == 404
    assert timed("GET", "/desk").status_code == 200
    relay.start()
    _wait(lambda: _get(stack.url, "/api/health").status_code == 200, what="recovery")
    assert pid_alive and stack.proc.poll() is None
    first = _get(stack.url, "/api/references")
    assert first.status_code == 200 and HARBOUR in [r["slug"] for r in first.json()]
    address = _addr()
    assert _call(stack.url, "POST", "/api/enquiries", {"email": address, "agreed": True}).status_code == 201


def test_outage_boot_retries_then_seeds_once():
    with _scratch(relayed=True, relay_up=False) as stack:
        def starting():
            try:
                response = _get(stack.url, "/api/health")
            except httpx.HTTPError:
                return False
            return response.status_code == 503 and response.json() == {"status": "starting"}
        _wait(starting, what="starting health")
        stack.relay.start()
        stack.ready()
        assert len(stack.sql("SELECT id FROM programme")) == 2
        assert len(stack.sql("SELECT id FROM reference_entry")) == 6
        assert len(stack.sql("SELECT id FROM service_clock")) == 1


HOSTILE = {
    "enquiry_nul_email": ("POST", "/api/enquiries", None, br'{"email":"a\u0000@example.com","agreed":true}', 422, "email"),
    "enquiry_surrogate_phone": ("POST", "/api/enquiries", None,
                                br'{"email":"h@example.com","phone":"\ud800\ud800\ud800\ud800\ud800\ud800","agreed":true}',
                                422, "phone"),
    "figure_nul": ("POST", "/api/desk/references", CURATOR,
                   br'{"title":"x","summary":"s","challenge":"c","work":"w","sector":"a","customer":"c",'
                   br'"figures":[{"label":"\u0000","value":"v"}]}', 422, "figures"),
    "title_surrogate": ("PATCH", f"/api/desk/references/{QUARRY}", CURATOR, br'{"title":"\ud800"}', 422, "title"),
    "ordinal_true": ("PUT", "/api/desk/order", CURATOR, b'{"slug":"%s","ordinal":true}' % HARBOUR.encode(), 422, "ordinal"),
    "ordinal_float": ("PUT", "/api/desk/order", CURATOR, b'{"slug":"%s","ordinal":2.0}' % HARBOUR.encode(), 422, "ordinal"),
    "ordinal_fraction": ("PUT", "/api/desk/order", CURATOR, b'{"slug":"%s","ordinal":2.5}' % HARBOUR.encode(), 422, "ordinal"),
    "ordinal_string": ("PUT", "/api/desk/order", CURATOR, b'{"slug":"%s","ordinal":"2"}' % HARBOUR.encode(), 422, "ordinal"),
    "ordinal_zero": ("PUT", "/api/desk/order", CURATOR, b'{"slug":"%s","ordinal":0}' % HARBOUR.encode(), 422, "ordinal"),
    "ordinal_missing": ("PUT", "/api/desk/order", CURATOR, b'{"slug":"%s"}' % HARBOUR.encode(), 422, "ordinal"),
    "order_slug_nul": ("PUT", "/api/desk/order", CURATOR, br'{"slug":"\u0000","ordinal":1}', 422, "slug"),
    "date_compact": ("PUT", f"/api/desk/references/{QUARRY}/clearance", STEWARD,
                     b'{"clearance_from":"20260203","clearance_until":"2026-12-31"}', 422, "clearance_from"),
    "date_week": ("PUT", f"/api/desk/references/{QUARRY}/clearance", STEWARD,
                  b'{"clearance_from":"2026-W01-1","clearance_until":"2026-12-31"}', 422, "clearance_from"),
    "date_impossible": ("PUT", f"/api/desk/references/{QUARRY}/clearance", STEWARD,
                        b'{"clearance_from":"2026-02-30","clearance_until":"2026-12-31"}', 422, "clearance_from"),
    "nan": ("POST", "/api/enquiries", None, b'{"email":"h@example.com","agreed":NaN}', 422, "body"),
    "infinity": ("POST", "/api/enquiries", None, b'{"junk":-Infinity}', 422, "body"),
    "deep_nesting": ("POST", "/api/enquiries", None, b"[" * DEEP_NESTING, 422, "body"),
    "bad_utf8": ("POST", "/api/enquiries", None, b'{"email":"\xff"}', 422, "body"),
    "login_nul": ("POST", "/api/auth/login", None, br'{"email":"\u0000","password":"\u0000"}', 401, None),
    "enquiry_id_text": ("DELETE", "/api/desk/enquiries/abc", STEWARD, None, 404, None),
    "enquiry_id_huge": ("DELETE", "/api/desk/enquiries/" + "9" * 30, STEWARD, None, 404, None),
    "ignored_key": ("PATCH", f"/api/desk/references/{QUARRY}", CURATOR, br'{"junk":"\u0000"}', 200, None),
    "page_nul": ("GET", "/references/%00", None, None, 404, None),
    "page_surrogate": ("GET", "/references/%ED%A0%80", None, None, 404, None),
    "sector_nul": ("GET", "/references?sector=%00", None, None, 200, None),
    "api_sector_nul": ("GET", "/api/references?sector=%00", None, None, 200, None),
    "preview_nul": ("GET", f"/api/references/{QUARRY}?preview=%00", None, None, 404, None),
}


HOSTILE_IDS = ["enquiry_nul_email", "enquiry_surrogate_phone", "figure_nul", "title_surrogate", "ordinal_true",
               "ordinal_float", "ordinal_fraction", "ordinal_string", "ordinal_zero", "ordinal_missing",
               "order_slug_nul", "date_compact", "date_week", "date_impossible", "nan", "infinity", "deep_nesting",
               "bad_utf8", "login_nul", "enquiry_id_text", "enquiry_id_huge", "ignored_key", "page_nul",
               "page_surrogate", "sector_nul", "api_sector_nul", "preview_nul"]


@pytest.mark.parametrize("case", [HOSTILE[name] for name in HOSTILE_IDS], ids=HOSTILE_IDS)
def test_hostile_input(app_url, case):
    method, path, account, raw, status, key = case
    token = Desk(app_url, account).token if account else None
    response = _call(app_url, method, path, raw=raw, token=token)
    assert response.status_code == status, response.text
    if key:
        assert key in response.json()["errors"]
    if key == "body":
        assert response.json() == {"errors": {"body": "Send a JSON object"}}
    if path == "/api/auth/login":
        assert response.json() == {"message": "The address or password is not right"}
    if status == 404 and path.startswith("/api"):
        assert response.content == NOT_FOUND
    if path == "/api/references?sector=%00":
        assert response.json() == []


def test_wf_platform_first_boot_read(first_boot, browser):
    db = first_boot
    db.clock(BASE_NOW)
    with _live(browser, db.url) as page:
        expect(page.get_by_role("heading", level=1)).to_have_text(
            re.compile(r"References\s+you\s+can\s+check"))
        page.get_by_role("link", name="Read the references").click()
        expect(page).to_have_url(re.compile(r"/references$"))
        expect(page.get_by_text(_count_en(3), exact=True)).to_be_visible()
    live = db.sql("SELECT slug FROM reference_entry WHERE ordinal IS NOT NULL AND programme_id ="
                  " (SELECT id FROM programme WHERE slug = 'northfall') ORDER BY ordinal")
    assert [r["slug"] for r in live] == [HARBOUR, DAIRY, PAPER]


def test_wf_platform_outage_visitor(relayed, browser):
    with _live(browser, relayed.url) as page:
        relayed.relay.stop()
        _wait(lambda: _get(relayed.url, "/api/health").status_code == 503, OUTAGE_SECONDS, "outage")
        response = page.goto(relayed.url + "/programme")
        assert response.status == 503
        expect(page.get_by_text(OUTAGE)).to_be_visible()
        relayed.relay.start()
        _wait(lambda: _get(relayed.url, "/api/health").status_code == 200, what="recovery")
        response = page.goto(relayed.url + "/programme")
        assert response.status == 200
        expect(page.get_by_role("heading", level=1, name="How the programme works")).to_be_visible()


def test_live_set_every_public_read(app_url):
    hidden = [QUARRY, RAIL, COLD]
    words = ["Quarry conveyor upgrade", "Rail depot signalling", "Cold store automation",
             "Stonebeck Quarry", "Northline Rail", "Pakkas Logistics"]
    for path in ("/api/references", "/api/fi/references"):
        assert [r["slug"] for r in _get(app_url, path).json()] == [HARBOUR, DAIRY, PAPER]
    for path in ("/api/sectors", "/api/fi/sectors"):
        assert _get(app_url, path).json() == ["food", "ports", "pulp"]
    for path in ("/", "/references", "/contact", "/fi", "/fi/references", "/fi/contact"):
        body = _get(app_url, path).text
        for term in hidden + words:
            assert term not in body, (path, term)
    for slug in hidden:
        for prefix in ("/api/references/", "/api/fi/references/"):
            assert _get(app_url, prefix + slug).content == NOT_FOUND


def test_index_api(app_url):
    rows = _get(app_url, "/api/references").json()
    assert [r["ordinal"] for r in rows] == [1, 2, 3]
    assert all(set(r) == {"slug", "ordinal", "sector", "title", "result"} for r in rows)
    assert rows[0] == {"slug": HARBOUR, "ordinal": 1, "sector": "ports", "title": HARBOUR_T,
                       "result": {"label": "Crane availability", "value": "99.2 %"}}
    assert rows[2]["result"] == {"label": "Drive energy saved", "value": "2.1 GWh a year"}
    assert [(r["slug"], r["ordinal"]) for r in _get(app_url, "/api/references?sector=food").json()] == [(DAIRY, 2)]


def test_detail_api(app_url):
    harbour = _get(app_url, f"/api/references/{HARBOUR}").json()
    assert set(harbour) == {"slug", "ordinal", "sector", "customer", "title", "summary", "challenge", "work",
                            "figures", "quote"}
    assert harbour["customer"] == "Kiela Terminals" and harbour["quote"] is None
    assert harbour["summary"] and harbour["challenge"] and harbour["work"]
    assert harbour["figures"] == [{"label": "Crane availability", "value": "99.2 %"},
                                  {"label": "Retrofit downtime", "value": "11 days"},
                                  {"label": "Energy per container move", "value": "-18 %"}]
    paper = _get(app_url, f"/api/references/{PAPER}").json()
    assert paper["quote"]["speaker"] == "Hanna Lehto" and paper["quote"]["role"] == "Maintenance manager, Aspen Mills"
    assert _get(app_url, "/api/references/no-such-slug").content == NOT_FOUND


def test_reference_index_page(app_url, browser):
    html = _get(app_url, "/references").text
    text = _text(_main(html))
    assert "The reference library" in text and "3 cleared references" in text
    for title, slug in ((HARBOUR_T, HARBOUR), (DAIRY_T, DAIRY), (PAPER_T, PAPER)):
        assert title in text and any(_local(a.get("href", ""), app_url) == f"/references/{slug}"
                                     for a in _tags(html, "a"))
    assert "99.2 %" in text and "+34 %" in text
    with _live(browser, app_url + "/references") as page:
        sectors = page.get_by_role("navigation", name="Sectors").get_by_role("link")
        assert [t.strip() for t in sectors.all_inner_texts()] == ["All sectors", "food", "ports", "pulp"]
        for title in (HARBOUR_T, DAIRY_T, PAPER_T):
            expect(page.get_by_role("main").get_by_role("link", name=title)).to_have_count(1)


def test_empty_index(stack):
    for slug in (HARBOUR, DAIRY, PAPER):
        assert stack.curator.retire(slug).status_code == 200
    html = _get(stack.url, "/references").text
    main = _main(html)
    assert "No reference is cleared for publication at the moment" in _text(main)
    assert _count_en(0) in _text(main)
    assert "/contact" in [_local(a.get("href", ""), stack.url) for a in _tags(main, "a")]
    finnish = _main(_get(stack.url, "/fi/references").text)
    assert "Yksikään referenssi ei ole tällä hetkellä hyväksytty julkaistavaksi" in _text(finnish)
    assert "/fi/contact" in [_local(a.get("href", ""), stack.url) for a in _tags(finnish, "a")]


def test_detail_page(app_url):
    api = _get(app_url, f"/api/references/{PAPER}").json()
    html = _get(app_url, f"/references/{PAPER}").text
    text = _text(_main(html))
    for part in (api["title"], api["customer"], api["summary"], api["challenge"], api["work"]):
        assert _text(part) in text
    for figure in api["figures"]:
        assert figure["label"] in text and figure["value"] in text
    assert api["quote"]["text"] in text and "Hanna Lehto" in text
    assert "Ask about this reference" in text
    titles = re.findall(r"<title[^>]*>(.*?)</title>", html, re.S)
    assert titles and api["title"] in unescape(titles[0])
    metas = _tags(html, "meta")
    description = next(m["content"] for m in metas if m.get("name") == "description")
    assert description and description[:20] in api["summary"]
    image = next(m["content"] for m in metas
                 if m.get("property") == "og:image" or m.get("name") == "twitter:image")
    assert same_origin(image, app_url) or image.startswith("/")
    fetched = _get(app_url, _local(image, app_url))
    assert fetched.status_code == 200 and fetched.headers["content-type"].startswith("image/")


def test_home_page(stack):
    assert stack.curator.order(DAIRY, 1).status_code == 200
    stack.curator.retire(HARBOUR)
    fourth = stack.live("Fourth installation")
    fifth = stack.live(FIFTH_TITLE)
    assert stack.run_slugs() == [DAIRY, PAPER, fourth, fifth]
    html = _get(stack.url, "/").text
    main = _main(html)
    text = _text(html)
    assert "References you can check, from installations we actually finished" in text
    assert "Every story here is published with the customer's written agreement" in unescape(text)
    links = [_local(a.get("href", ""), stack.url) for a in _tags(main, "a")]
    assert "/contact" in links and "/references" in links
    strip = [lnk for lnk in links if lnk.startswith("/references/")]
    assert list(dict.fromkeys(strip)) == [f"/references/{s}" for s in (DAIRY, PAPER, fourth)]
    assert FIFTH_TITLE not in _text(main)
    assert "Hanna Lehto" in text or re.search(r"manager", text, re.I)
    for keyword in ("nominat", "clear", "reference call"):
        assert re.search(keyword, text, re.I), keyword


def test_reading_routes(app_url, browser):
    programme = _text(_main(_get(app_url, "/programme").text))
    assert "How the programme works" in programme
    for heading in CHAPTERS.values():
        assert heading in programme
    story_html = _main(_get(app_url, "/story").text)
    story = _text(story_html)
    spans = ["2014–2016", "2017–2019", "2020–2022", "2023–2026"]
    positions = [story.index(s) for s in spans]
    assert positions == sorted(positions)
    described = [i for i in _tags(story_html, "img") if i.get("alt", "").strip()]
    assert len(described) >= len(spans)
    assert len({i["alt"] for i in described}) >= len(spans)
    notes = _text(_main(_get(app_url, "/notes").text))
    assert notes.index("What a clearance covers") < notes.index("Why we number the library")
    assert "Translating the library" not in notes and "2" in notes
    assert "A customer clears the story, its figures and its quote together." in notes
    assert [n["slug"] for n in _get(app_url, "/api/notes").json()] == ["what-a-clearance-covers",
                                                                       "why-we-number-the-library"]
    with _live(browser, app_url + "/programme") as page:
        chapters = page.get_by_role("navigation", name="Chapters").get_by_role("link")
        hrefs = chapters.evaluate_all("els => els.map(e => e.getAttribute('href'))")
        assert [h[h.index("#") + 1:] for h in hrefs] == list(CHAPTERS)


def test_unknown_address(app_url):
    for path in ("/no-such-address-here", "/references/%00", "/references/%ED%A0%80", f"/references/{QUARRY}"):
        response = _get(app_url, path)
        assert response.status_code == 404, path
        main_text = _text(response.text)
        assert "That page is not here" in main_text
        links = [_local(a.get("href", ""), app_url) for a in _tags(response.text, "a")]
        assert "/" in links and "/references" in links
    finnish = _get(app_url, "/fi/no-such-address-here")
    assert finnish.status_code == 404 and "Sivua ei löydy" in _text(finnish.text)
    links = [_local(a.get("href", ""), app_url) for a in _tags(finnish.text, "a")]
    assert "/fi" in links or "/fi/" in links
    assert "/fi/references" in links


def test_filter_state_in_address(stack):
    base = stack.url
    food = _get(base, "/references?sector=food").text
    text = _text(_main(food))
    assert _count_en(1, "food") in text and DAIRY_T in text and HARBOUR_T not in text
    current = [a for a in _tags(_main(food), "a") if a.get("aria-current") == "true"]
    assert len(current) == 1 and "sector=food" in current[0]["href"]
    unfiltered = _main(_get(base, "/references").text)
    current = [a for a in _tags(unfiltered, "a") if a.get("aria-current") == "true"]
    assert len(current) == 1 and "sector" not in current[0]["href"]
    assert _count_en(3) in _text(_main(_get(base, "/references?sector=").text))
    repeated = _text(_main(_get(base, "/references?sector=food&sector=ports").text))
    assert _count_en(1, "food") in repeated
    assert _get(base, "/api/references?sector=Food").json() == []
    mains = {}
    for sector in ("rail", "mining", "cold-chain", "nosuch"):
        response = _get(base, f"/references?sector={sector}")
        assert response.status_code == 200
        main = _main(response.text)
        assert _count_en(0, sector) in _text(main)
        assert not [a for a in _tags(main, "a") if a.get("aria-current") == "true"]
        mains[sector] = re.sub(rf"\b{sector}\b", "", main)
        assert _get(base, f"/api/references?sector={sector}").json() == []
    assert len(set(mains.values())) == 1
    nul = _get(base, "/references?sector=%00")
    assert nul.status_code == 200 and _count_en(0, "") in _text(_main(nul.text))
    escaped = _main(_get(base, "/references?sector=%3Cb%3Ex").text)
    assert HOSTILE_SECTOR not in escaped
    switch = _anchor_href(food, "Suomi")
    assert _local(switch, base) == "/fi/references?sector=food"
    assert _local(_alternate(food, "fi"), base) == "/fi/references?sector=food"
    assert _count_fi(1, "food") in _text(_get(base, "/fi/references?sector=food").text)


def test_exact_breakpoints(browser, app_url):
    def columns(page):
        boxes = [b.bounding_box() for b in page.get_by_role("button", name="Click to copy address").all()]
        return len({round(b["x"]) for b in boxes})
    with _live(browser, app_url + "/contact", reduced="reduce") as page:
        for width, cards, menu in ((WIDE, 3, 0), (MIDDLE_HIGH, 2, 0), (MIDDLE_LOW, 2, 0), (NARROW_HIGH, 1, 1)):
            page.set_viewport_size({"width": width, "height": DESK_H})
            expect(page.get_by_role("button", name="Menu")).to_have_count(menu)
            assert columns(page) == cards, width
            field = page.get_by_role("textbox", name="Work address").bounding_box()
            copy = page.get_by_role("button", name="Click to copy address").first.bounding_box()
            if width >= WIDE:
                assert field["x"] < copy["x"] and field["x"] + field["width"] <= copy["x"]
            else:
                assert field["y"] < copy["y"]
        page.set_viewport_size({"width": PHONE_W, "height": PHONE_H})
        menu = page.get_by_role("button", name="Menu")
        menu.click()
        expect(menu).to_have_attribute("aria-expanded", "true")
        page.set_viewport_size({"width": WIDE, "height": DESK_H})
        primary = page.get_by_role("navigation", name="Primary")
        expect(primary.get_by_role("link", name="References")).to_be_visible()
        expect(page.get_by_role("button", name="Menu")).to_have_count(0)
        page.set_viewport_size({"width": PHONE_W, "height": PHONE_H})
        expect(menu).to_have_attribute("aria-expanded", "false")
        expect(primary.get_by_role("link", name="Story", exact=True)).to_have_count(0)


def test_collapsed_means_unavailable(browser, app_url):
    with open_app(browser, app_url + "/programme") as page:
        close = page.get_by_role("button", name="Close the cookie notice")
        close.focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("region", name="Cookie notice")).to_have_count(0)
        expect(close).to_have_count(0)
        first = page.get_by_role("button", name="Nomination")
        expect(first).to_have_attribute("aria-expanded", "true")
        first.focus()
        assert tab_order(page, 1) != ["Clearance"]
        first.focus()
        page.keyboard.press("Enter")
        expect(first).to_have_attribute("aria-expanded", "false")
        assert tab_order(page, 1) == ["Clearance"]
        first.focus()
        page.keyboard.press("Enter")
        expect(first).to_have_attribute("aria-expanded", "true")
        advance(page, COPY_MAX_MS)
        first.focus()
        assert tab_order(page, 1) != ["Clearance"]
    with open_app(browser, app_url + "/references") as page:
        page.set_viewport_size({"width": PHONE_W, "height": PHONE_H})
        menu = page.get_by_role("button", name="Menu")
        primary = page.get_by_role("navigation", name="Primary")
        expect(primary.get_by_role("link", name="Story", exact=True)).to_have_count(0)
        menu.focus()
        page.keyboard.press("Enter")
        expect(primary.get_by_role("link", name="Story", exact=True)).to_be_visible()
        page.keyboard.press("Escape")
        expect(menu).to_have_attribute("aria-expanded", "false")
        expect(menu).to_be_focused()
        expect(primary.get_by_role("link", name="Story", exact=True)).to_have_count(0)
        footer = page.get_by_role("contentinfo").element_handle()
        for _ in range(TAB_STOPS):
            page.keyboard.press("Tab")
            assert page.evaluate("""f => { const a = document.activeElement;
                return a.textContent.trim() !== 'Story' || f.contains(a); }""", footer), "folded link took focus"


def test_chapter_addresses(browser, app_url):
    def below_header(page, name):
        header = page.get_by_role("banner")
        button = page.get_by_role("button", name=name, exact=True)
        expect(button).to_have_attribute("aria-expanded", "true")

        def clear():
            return button.bounding_box()["y"] >= header.bounding_box()["y"] + header.bounding_box()["height"] - 1
        _wait(clear, HTTP_TIMEOUT, f"{name} below header")

    with _live(browser, app_url + "/programme#clearance") as page:
        below_header(page, "Clearance")
        expect(page.get_by_role("button", name="Nomination")).to_have_attribute("aria-expanded", "true")
        expect(page.get_by_role("button", name="Changes and removal")).to_have_attribute("aria-expanded", "false")
        page.get_by_role("navigation", name="Chapters").get_by_role("link", name="How long a clearance lasts").click()
        expect(page).to_have_url(re.compile("#duration$"))
        below_header(page, "How long a clearance lasts")
        expect(page.get_by_role("button", name="How long a clearance lasts")).to_be_focused()
        expect(page.get_by_role("link", name="Suomi")).to_have_attribute(
            "href", re.compile(r"/fi/programme#duration$"))
        page.get_by_role("button", name="Clearance", exact=True).click()
        expect(page.get_by_role("button", name="Clearance", exact=True)).to_have_attribute("aria-expanded", "false")
        page.go_back()
        expect(page).to_have_url(re.compile("#clearance$"))
        below_header(page, "Clearance")
        expect(page.get_by_role("link", name="Suomi")).to_have_attribute(
            "href", re.compile(r"/fi/programme#clearance$"))


def test_wf_library_prospect_reads(browser, app_url):
    with _live(browser, app_url) as page:
        _no_cookie(page)
        page.get_by_role("link", name="Read the references").click()
        page.get_by_role("navigation", name="Sectors").get_by_role("link", name="food").click()
        expect(page).to_have_url(re.compile(r"/references\?sector=food$"))
        page.get_by_role("link", name="Suomi").click()
        expect(page).to_have_url(re.compile(r"/fi/references\?sector=food$"))
        expect(page.get_by_text(_count_fi(1, "food"))).to_be_visible()
        api = _get(app_url, f"/api/fi/references/{DAIRY}").json()
        page.get_by_role("main").get_by_role("link", name=DAIRY_T).click()
        expect(page.get_by_role("main")).to_contain_text(api["challenge"])
        expect(page.get_by_role("main")).to_contain_text(api["figures"][0]["value"])
        page.goto(app_url + "/programme#clearance")
        expect(page.get_by_role("button", name="Clearance", exact=True)).to_have_attribute("aria-expanded", "true")
        expect(page).to_have_url(re.compile("/programme#clearance$"))


def test_wf_library_empty_filter_back(browser, app_url):
    with _live(browser, app_url + "/references?sector=food") as page:
        _no_cookie(page)
        page.goto(app_url + "/references?sector=nosuch")
        expect(page.get_by_text("No reference is cleared for publication at the moment")).to_be_visible()
        page.go_back()
        expect(page.get_by_role("main").get_by_role("link", name=DAIRY_T)).to_be_visible()
        page.get_by_role("navigation", name="Sectors").get_by_role("link", name="All sectors").click()
        expect(page.get_by_text(_count_en(3), exact=True)).to_be_visible()
    assert len(_get(app_url, "/api/references?sector=nosuch").json()) == 0


def test_withheld_everywhere(stack):
    assert DAIRY in stack.run_slugs()
    answer = stack.steward.window(DAIRY, PAST)
    assert answer.status_code == 200 and answer.json()["live"] is False
    assert stack.run_slugs() == [HARBOUR, PAPER]
    assert "food" not in _get(stack.url, "/api/sectors").json()
    for path in ("/", "/references", "/contact", "/fi", "/fi/references", "/fi/contact"):
        assert DAIRY_T not in _get(stack.url, path).text and DAIRY not in _get(stack.url, path).text, path
    for path in (f"/references/{DAIRY}", f"/fi/references/{DAIRY}", f"/api/references/{DAIRY}",
                 f"/api/fi/references/{DAIRY}"):
        assert _get(stack.url, path).status_code == 404, path
    refused = _call(stack.url, "POST", "/api/enquiries", {"email": _addr(), "agreed": True, "reference": DAIRY})
    assert refused.status_code == 422 and "reference" in refused.json()["errors"]


def test_future_window_withheld(stack):
    slug = stack.curator.create(FUTURE_TITLE, figures=FIGS, sector=FUTURE_SECTOR)
    stack.steward.window(slug, ("2026-11-10", "2099-12-31"))
    published = stack.curator.publish(slug)
    assert published.status_code == 200 and published.json()["ordinal"] is None
    assert stack.curator.row(slug)["state"] == "withheld"
    assert slug not in stack.run_slugs()
    assert FUTURE_SECTOR not in _get(stack.url, "/api/sectors").json()
    assert _get(stack.url, f"/references/{slug}").status_code == 404
    assert FUTURE_TITLE not in _get(stack.url, "/references").text
    stack.clock("2026-11-10T10:00:00Z")
    assert stack.run_slugs()[-1] == slug
    assert stack.curator.row(slug)["state"] == "live"


def test_window_edges(stack):
    summer = stack.curator.create("Summer edge", figures=FIGS)
    stack.clock("2026-07-10T12:00:00Z")
    assert stack.steward.window(summer, ("2026-07-10", "2026-07-10")).status_code == 200
    assert stack.curator.publish(summer).status_code == 200
    stack.clock("2026-07-10T20:59:30Z")
    assert summer in stack.run_slugs()
    stack.clock("2026-07-10T21:00:10Z")
    assert summer not in stack.run_slugs()
    stack.clock("2026-07-09T21:00:10Z")
    assert summer in stack.run_slugs()
    stack.clock("2026-07-09T20:59:30Z")
    assert summer not in stack.run_slugs()
    stack.clock("2026-12-10T12:00:00Z")
    winter = stack.live("Winter edge", span=("2026-12-10", "2026-12-10"))
    stack.clock("2026-12-10T21:59:30Z")
    assert winter in stack.run_slugs()
    stack.clock("2026-12-10T22:00:10Z")
    assert winter not in stack.run_slugs()
    stack.clock(BASE_NOW)
    stored = stack.curator.detail(QUARRY)
    for span, key in ((("2026-02-30", "2026-03-01"), "clearance_from"), (("2026-03-01", "2026-02-30"), "clearance_until"),
                      (("20260203", "2026-03-01"), "clearance_from"), (("2026-05-01", "2026-04-01"), "clearance_until")):
        refused = stack.steward.window(QUARRY, span)
        assert refused.status_code == 422 and key in refused.json()["errors"], span
    missing = stack.steward.call("PUT", f"/api/desk/references/{QUARRY}/clearance", {"clearance_from": "2026-01-01"})
    assert missing.status_code == 422 and "clearance_until" in missing.json()["errors"]
    assert stack.curator.detail(QUARRY)["clearance_from"] == stored["clearance_from"]
    ended = stack.curator.create("Ended window", figures=FIGS)
    stack.steward.window(ended, PAST)
    refused = stack.curator.publish(ended)
    assert refused.status_code == 409 and refused.json() == {"message": "The clearance window has ended"}
    assert stack.steward.window(HARBOUR, ("2026-01-01", "2026-11-02")).json()["live"] is False
    assert HARBOUR not in stack.run_slugs()
    assert stack.steward.window(HARBOUR, FAR).json()["live"] is True
    assert stack.run_slugs()[-1] == HARBOUR
    live_before = _get(stack.url, f"/api/references/{DAIRY}").json()["ordinal"]
    stack.steward.window(DAIRY, FAR)
    assert _get(stack.url, f"/api/references/{DAIRY}").json()["ordinal"] == live_before


def test_rollover_under_load(stack):
    leaving = stack.live("Leaving installation", span=("2026-01-01", "2026-11-05"))
    joins = {}
    for title, start in (("Bravo joining", "2026-11-04"), ("Alpha joining", "2026-11-04"),
                         ("Later joining", "2026-11-05")):
        slug = stack.curator.create(title, figures=FIGS)
        stack.steward.window(slug, (start, "2099-12-31"))
        stack.curator.publish(slug)
        joins[title] = slug
    assert stack.run_slugs() == [HARBOUR, DAIRY, PAPER, leaving]
    forward = [HARBOUR, DAIRY, PAPER, joins["Alpha joining"], joins["Bravo joining"], joins["Later joining"]]

    def burst(expected):
        def api():
            response = _get(stack.url, "/api/references")
            assert response.status_code == 200
            return [r["slug"] for r in response.json()]

        def fi_api():
            response = _get(stack.url, "/api/fi/references")
            assert response.status_code == 200
            return [r["slug"] for r in response.json()]

        def desk():
            response = Desk(stack.url, CURATOR).call("GET", "/api/desk/references")
            assert response.status_code == 200
            return [r["slug"] for r in response.json() if r["live"]]

        def page():
            assert _get(stack.url, "/references").status_code == 200
            return expected
        calls = [api, fi_api, desk, page] * (THREADS // 4)
        assert all(result == expected for result in _together(calls))
        stored = stack.sql("SELECT slug FROM reference_entry WHERE ordinal IS NOT NULL AND programme_id ="
                           " (SELECT id FROM programme WHERE slug = 'northfall') ORDER BY ordinal")
        assert [r["slug"] for r in stored] == expected
    stack.clock("2026-11-06T10:00:00Z")
    burst(forward)
    stack.clock(BASE_NOW)
    burst([HARBOUR, DAIRY, PAPER, leaving])
    assert stack.sql(f"SELECT ordinal FROM reference_entry WHERE slug = '{COLD}'") == [{"ordinal": 1}]


def test_clearance_covers_content(stack):
    desk = stack.curator
    slug = stack.live("Cleared content", span=FAR)
    identical = desk.patch(slug, {"figures": [{**FIGS[0], "note": "ignored"}], "quote": "", "customer": "Probe Oy"})
    assert identical.status_code == 200 and identical.json()["clearance_voided"] is False
    assert slug in stack.run_slugs()
    other = desk.patch(slug, {"summary": "Changed", "challenge": "Changed", "work": "Changed", "title_fi": "Otsikko",
                              "body_fi": "Runko", "sector": "other-sector"})
    assert other.json()["clearance_voided"] is False and slug in stack.run_slugs()
    for change in ({"figures": [{"label": "Uptime", "value": "98 %"}]}, {"quote": "New words"},
                   {"quote_speaker": "A Person"}, {"quote_role": "A role"}, {"customer": "Other Oy"}):
        voided = desk.patch(slug, change)
        assert voided.status_code == 200 and voided.json()["clearance_voided"] is True, change
        row = stack.sql(f"SELECT clearance_from, clearance_until, ordinal FROM reference_entry WHERE slug = '{slug}'")[0]
        assert row == {"clearance_from": None, "clearance_until": None, "ordinal": None}
        assert desk.row(slug)["state"] == "withheld" and slug not in stack.run_slugs()
        assert _get(stack.url, f"/references/{slug}").status_code == 404
        unvoided = desk.patch(slug, {"customer": "No window Oy"})
        assert unvoided.json()["clearance_voided"] is False
        assert stack.steward.window(slug, FAR).status_code == 200
        assert stack.run_slugs()[-1] == slug


def test_wf_clearance_window_steward_withdraws_reopens(stack, browser):
    before = stack.curator.detail(DAIRY)
    with _live(browser, stack.url + "/desk") as page:
        _desk(page)
        _btn(page, f"Edit {DAIRY_T}").click()
        expect(_box(page, "Title")).to_be_visible()
        expect(_box(page, "Cleared from")).to_have_count(0)
        expect(_box(page, "Cleared until")).to_have_count(0)
        expect(_btn(page, "Save the clearance window")).to_have_count(0)
    refused = stack.curator.window(DAIRY, PAST)
    assert refused.status_code == 403 and refused.json() == {"message": "Your account cannot do this"}
    after = stack.curator.detail(DAIRY)
    for key in ("clearance_from", "clearance_until", "version", "state", "ordinal"):
        assert after[key] == before[key], key
    assert stack.run_slugs() == [HARBOUR, DAIRY, PAPER]
    with _live(browser, stack.url + "/desk") as page:
        _desk(page, STEWARD)
        _btn(page, f"Edit {DAIRY_T}").click()
        _box(page, "Cleared from").fill(PAST[0])
        _box(page, "Cleared until").fill(PAST[1])
        _btn(page, "Save the clearance window").click()
        expect(_msg(page)).to_have_text(f"Clearance window saved for {DAIRY_T}")
        expect(_btn(page, "Save the clearance window")).to_be_focused()
        assert stack.run_slugs() == [HARBOUR, PAPER]
        expect(page.get_by_text(_totals(2, 2, 1, 0))).to_be_visible()
        _box(page, "Cleared from").fill(FAR[0])
        _box(page, "Cleared until").fill(FAR[1])
        _btn(page, "Save the clearance window").click()
        expect(page.get_by_text("3 live, 1 withheld, 1 drafts, 0 retired")).to_be_visible()
    assert stack.run_slugs() == [HARBOUR, PAPER, DAIRY]


def test_wf_clearance_window_stale_desk(stack, browser):
    stack.clock(STALE_LAST_EVENING)
    slug = stack.live("Closing installation", span=("2026-01-01", "2026-11-05"))
    title = "Closing installation"
    assert slug in stack.run_slugs()
    with _live(browser, stack.url + "/desk") as page:
        page.clock.set_fixed_time(datetime.fromisoformat("2030-01-01T00:00:00+00:00"))
        page.reload()
        _desk(page)
        row = page.get_by_role("list", name="References").get_by_role("listitem").filter(has_text=title)
        expect(row).to_contain_text("live")
        expect(_btn(page, f"Move {title} up")).to_be_visible()
        expect(page.get_by_text(_totals(4, 1, 1, 0))).to_be_visible()
        stack.clock(STALE_PAST_MIDNIGHT)
        _press(page, f"Move {title} up")
        expect(_msg(page)).to_have_text("The order could not be changed")
        expect(_btn(page, f"Move {title} up")).to_have_count(0)
        expect(_btn(page, f"Edit {title}")).to_be_focused()
        expect(row).to_contain_text("withheld")
        expect(page.get_by_text(_totals(3, 2, 1, 0))).to_be_visible()
    assert slug not in stack.run_slugs()


def test_enquiry_accepted(stack):
    address = _addr()
    response = _call(stack.url, "POST", "/api/enquiries",
                     raw=json.dumps({"email": address, "phone": "+358400000000", "reference": DAIRY, "agreed": True}),
                     headers={"Content-Type": "text/plain"})
    assert response.status_code == 201
    assert response.json()["reply_to"] == "hello@example.com"
    row = stack.sql(f"SELECT e.id, e.email, e.phone, e.reference, e.agreed, e.open, p.slug AS prog FROM enquiry e"
                    f" JOIN programme p ON p.id = e.programme_id WHERE e.email = '{address}'")
    assert row == [{"id": response.json()["id"], "email": address, "phone": "+358400000000", "reference": DAIRY,
                    "agreed": True, "open": True, "prog": "northfall"}]
    queue = stack.curator.queue()
    assert queue[0]["email"] == address and queue[0]["reference"] == DAIRY and queue[0]["agreed"] is True
    assert set(queue[0]) == {"id", "email", "phone", "reference", "created_at", "agreed"}
    assert queue[1]["email"] == "prospect@example.com"
    westhall = Desk(stack.url, WESTHALL).queue()
    assert [e["email"] for e in westhall] == ["cold.buyer@example.com"]
    plain = _call(stack.url, "POST", "/api/enquiries", {"email": _addr(), "agreed": True, "reference": ""})
    assert plain.status_code == 201


REFUSED = {
    "missing_address": ({"agreed": True}, {"email": "Enter a work address the desk can reply to"}),
    "malformed_address": ({"email": "no-at-sign", "agreed": True}, {"email": "Enter a work address the desk can reply to"}),
    "no_dot_domain": ({"email": "a@example", "agreed": True}, {"email": "Enter a work address the desk can reply to"}),
    "long_address": ({"email": "a" * 250 + "@example.com", "agreed": True},
                     {"email": "Enter a work address the desk can reply to"}),
    "no_agreement": ({"EMAIL": True}, {"agreed": "Tick the box to agree to the privacy statement"}),
    "agreement_string": ({"EMAIL": True, "agreed": "true"}, {"agreed": "Tick the box to agree to the privacy statement"}),
    "short_phone": ({"EMAIL": True, "agreed": True, "phone": "123456789"},
                    {"phone": "Enter a telephone number of at least ten characters"}),
    "withheld_reference": ({"EMAIL": True, "agreed": True, "reference": RAIL},
                           {"reference": "Choose a reference from the library"}),
    "draft_reference": ({"EMAIL": True, "agreed": True, "reference": QUARRY},
                        {"reference": "Choose a reference from the library"}),
    "foreign_reference": ({"EMAIL": True, "agreed": True, "reference": COLD},
                          {"reference": "Choose a reference from the library"}),
    "every_field": ({"email": "bad", "phone": "1", "reference": "none"},
                    {"email": "Enter a work address the desk can reply to",
                     "agreed": "Tick the box to agree to the privacy statement",
                     "phone": "Enter a telephone number of at least ten characters",
                     "reference": "Choose a reference from the library"}),
}


REFUSED_IDS = ["missing_address", "malformed_address", "no_dot_domain", "long_address", "no_agreement",
               "agreement_string", "short_phone", "withheld_reference", "draft_reference", "foreign_reference",
               "every_field"]


@pytest.mark.parametrize("case", [REFUSED[name] for name in REFUSED_IDS], ids=REFUSED_IDS)
def test_enquiry_refused(app_url, case):
    body, errors = dict(case[0]), case[1]
    address = _addr()
    if body.pop("EMAIL", None):
        body["email"] = address
    response = _call(app_url, "POST", "/api/enquiries", body)
    assert response.status_code == 422 and response.json() == {"errors": errors}
    queue = Desk(app_url, CURATOR).queue()
    assert address not in [e["email"] for e in queue]
    assert body.get("email", "") not in [e["email"] for e in queue]


def test_one_open_enquiry_per_address(stack):
    address = _addr()
    first = _call(stack.url, "POST", "/api/enquiries", {"email": address, "agreed": True, "reference": DAIRY})
    before = next(e for e in stack.curator.queue() if e["email"] == address)
    stack.clock("2026-11-04T10:00:00Z")
    repeat = _call(stack.url, "POST", "/api/enquiries",
                   {"email": f"  {address.upper()} ", "agreed": True, "phone": "+358400000000"})
    assert repeat.status_code == 201 and repeat.json()["id"] == first.json()["id"]
    assert next(e for e in stack.curator.queue() if e["email"] == address) == before
    racer = _addr()
    results = _together([lambda: _call(stack.url, "POST", "/api/enquiries", {"email": racer, "agreed": True})] * THREADS)
    assert {r.status_code for r in results} == {201} and len({r.json()["id"] for r in results}) == 1
    assert len(stack.sql(f"SELECT id FROM enquiry WHERE lower(email) = '{racer.lower()}'")) == 1
    assert stack.steward.call("DELETE", f"/api/desk/enquiries/{first.json()['id']}").status_code == 204
    again = _call(stack.url, "POST", "/api/enquiries", {"email": address, "agreed": True})
    assert again.status_code == 201 and again.json()["id"] != first.json()["id"]
    assert len(stack.sql(f"SELECT id FROM enquiry WHERE lower(email) = '{address.lower()}'")) == 2


def test_contact_route(browser, app_url):
    raw = _get(app_url, "/contact").text
    for name, role, address, line in (
        ("Aino Rask", "Reference manager, ports and logistics", "aino.rask@example.com", "+358 40 000 0101"),
        ("Mikael Söderholm", "Reference manager, food and beverage", "mikael.soderholm@example.com", "+358 40 000 0102"),
        ("Leena Varjo", "Reference manager, pulp and paper", "leena.varjo@example.com", "+358 40 000 0103"),
        ("Tomas Brandt", "Reference manager, rail", "tomas.brandt@example.com", "+358 40 000 0104"),
        ("Iiris Kallio", "Reference manager, mining and minerals", "iiris.kallio@example.com", "+358 40 000 0105"),
        ("Joonas Hirvi", "Head of the reference programme", "joonas.hirvi@example.com", "+358 40 000 0106"),
    ):
        text = _text(raw)
        for part in (name, role, address, line):
            assert part in text
    with _live(browser, app_url + "/contact") as page:
        expect(page.get_by_role("heading", level=1, name="Talk to the reference desk")).to_be_visible()
        expect(page.get_by_role("button", name="Click to copy address")).to_have_count(6)
        required = page.get_by_role("textbox", name="Work address")
        assert required.evaluate("e => e.required || e.getAttribute('aria-required') === 'true'")
        phone = page.get_by_role("textbox", name="Telephone")
        assert not phone.evaluate("e => e.required || e.getAttribute('aria-required') === 'true'")
        agree = page.get_by_role("checkbox", name="I agree to the privacy statement")
        assert agree.evaluate("e => e.required || e.getAttribute('aria-required') === 'true'")
        choices = page.get_by_role("combobox", name="Reference of interest").evaluate(
            "e => [...e.options].map(o => o.textContent.trim())")
        assert choices == ["No particular reference", HARBOUR_T, DAIRY_T, PAPER_T]
        expect(page.get_by_role("button", name="Send the enquiry")).to_be_visible()


def _card_address(button):
    return button.evaluate(
        r"""e => { let n = e; while (n && !/@/.test(n.textContent)) n = n.parentElement;
        const holding = [...n.querySelectorAll('*')].filter(x => /@example\.com/.test(x.textContent));
        const line = holding.length ? holding[holding.length - 1] : n;
        return line.textContent.trim().match(/[\w.+-]+@example\.com/)[0]; }""")


def _label(handle):
    return handle.evaluate("e => (e.getAttribute('aria-label') || e.textContent).trim()")


def test_copy_address_control(browser, app_url):
    with _live(browser, app_url + "/contact") as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
        _no_cookie(page)
        handles = [b.element_handle() for b in page.get_by_role("button", name="Click to copy address").all()]
        seen = set()
        for index, handle in enumerate(handles):
            expected = _card_address(handle)
            if index % 3 == 2:
                handle.click()
            else:
                handle.focus()
                page.keyboard.press("Enter" if index % 3 == 0 else "Space")
            _wait(lambda h=handle: _label(h) == "Copied to the clipboard", HTTP_TIMEOUT, "confirmation")
            assert page.evaluate("() => navigator.clipboard.readText()") == expected
            seen.add(expected)
        assert len(seen) == 6


def test_copy_timer(browser, app_url):
    with open_app(browser, app_url + "/contact") as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
        first, second = [b.element_handle() for b in
                         page.get_by_role("button", name="Click to copy address").all()[:2]]
        first.focus()
        page.keyboard.press("Enter")
        _wait(lambda: _label(first) == "Copied to the clipboard", HTTP_TIMEOUT, "first confirmation")
        advance(page, COPY_MIN_MS - 500)
        page.keyboard.press("Enter")
        second_pressed_at = 0
        second.click()
        _wait(lambda: _label(second) == "Copied to the clipboard", HTTP_TIMEOUT, "second confirmation")
        first.focus()
        advance(page, COPY_MIN_MS - 100)
        assert _label(first) == "Copied to the clipboard", "restart ignored the latest activation"
        assert page.evaluate("e => document.activeElement === e", first)
        advance(page, COPY_MAX_MS - COPY_MIN_MS + 200 + second_pressed_at)
        assert _label(first) == "Click to copy address"
        assert _label(second) == "Click to copy address"
        page.evaluate("""() => {
            navigator.clipboard.writeText = () => Promise.reject(new DOMException('refused', 'NotAllowedError'));
            document.execCommand = () => false; }""")
        expected = _card_address(first)
        first.focus()
        page.keyboard.press("Enter")
        _wait(lambda: _label(first) == "Copy not available", HTTP_TIMEOUT, "refusal label")
        assert page.evaluate("() => window.getSelection().toString()").strip() == expected
        assert page.evaluate("e => document.activeElement === e", first)
        advance(page, COPY_MAX_MS + 100)
        assert _label(first) == "Click to copy address"


def _fill_enquiry(page, address, agree=True):
    page.get_by_role("textbox", name="Work address").fill(address)
    if agree:
        page.get_by_role("checkbox", name="I agree to the privacy statement").check()


def test_announced_enquiry_results(relayed, browser):
    raw = _get(relayed.url, "/contact").text
    assert any(a.get("role") == "status" or a.get("role") == "alert" for tag in ("div", "p", "section", "span")
               for a in _tags(raw, tag)) or _tags(raw, "output")
    with _live(browser, relayed.url + "/contact") as page:
        status, alert = page.get_by_role("status"), page.get_by_role("alert")
        expect(status).to_have_count(1)
        expect(alert).to_have_count(1)
        expect(status).to_have_text("")
        expect(alert).to_have_text("")
        field = page.get_by_role("textbox", name="Work address")
        field.fill("not an address")
        page.get_by_role("button", name="Send the enquiry").click()
        expect(alert).to_have_text("Check the marked fields and send again.")
        expect(field).to_have_attribute("aria-invalid", "true")
        expect(field).to_have_accessible_description("Enter a work address the desk can reply to")
        expect(field).to_be_focused()
        agree = page.get_by_role("checkbox", name="I agree to the privacy statement")
        expect(agree).to_have_accessible_description("Tick the box to agree to the privacy statement")
        address = _addr()
        _fill_enquiry(page, address)
        page.get_by_role("textbox", name="Telephone").fill(PHONE_INPUT)
        relayed.relay.stop()
        _wait(lambda: _get(relayed.url, "/api/health").status_code == 503, OUTAGE_SECONDS, "outage")
        sends = []
        page.on("request", lambda r: sends.append(r.url) if r.method == "POST" else None)
        page.get_by_role("button", name="Send the enquiry").click()
        expect(alert).to_have_text("The desk cannot take enquiries right now. Nothing was sent; please try again shortly.")
        expect(page.get_by_role("button", name="Send the enquiry")).to_be_enabled()
        expect(field).to_have_value(address)
        expect(page.get_by_role("textbox", name="Telephone")).to_have_value(PHONE_INPUT)
        relayed.relay.start()
        _wait(lambda: _get(relayed.url, "/api/health").status_code == 200, what="recovery")
        sends.clear()
        page.get_by_role("button", name="Send the enquiry").click()
        expect(status).to_have_text("Thank you, the desk will reply from hello@example.com")
        assert len(sends) == 1
    rows = relayed.sql(f"SELECT phone FROM enquiry WHERE email = '{address}'")
    assert rows == [{"phone": PHONE_INPUT}]


def test_wf_enquiry_states(stack, browser):
    with _live(browser, stack.url + "/contact") as page:
        _no_cookie(page)
        address = _addr()
        _fill_enquiry(page, address)
        select(page.get_by_role("combobox", name="Reference of interest"), DAIRY_T)
        posts = []
        page.on("request", lambda r: posts.append(r) if r.method == "POST" else None)
        with held(page, "**/api/enquiries") as release:
            send = page.get_by_role("button", name="Send the enquiry")
            send.dblclick()
            pending = page.get_by_role("button", name="Sending…")
            expect(pending).to_be_disabled()
            release()
        status = page.get_by_role("status")
        expect(status).to_have_text("Thank you, the desk will reply from hello@example.com")
        expect(page.get_by_role("button", name="Send the enquiry")).to_have_count(0)
        expect(page.get_by_role("textbox", name="Work address")).to_have_count(0)
        assert status.evaluate("e => e.contains(document.activeElement) || e === document.activeElement")
        assert len(posts) == 1
    rows = stack.sql(f"SELECT reference, agreed FROM enquiry WHERE email = '{address}'")
    assert rows == [{"reference": DAIRY, "agreed": True}]


def test_wf_enquiry_refused_then_repeat(stack, browser):
    address = _addr()
    with _live(browser, stack.url + "/contact") as page:
        _no_cookie(page)
        page.get_by_role("textbox", name="Work address").fill(address)
        page.get_by_role("textbox", name="Telephone").fill("123")
        page.get_by_role("button", name="Send the enquiry").click()
        expect(page.get_by_role("alert")).to_have_text("Check the marked fields and send again.")
        expect(page.get_by_role("textbox", name="Telephone")).to_be_focused()
        expect(page.get_by_role("textbox", name="Work address")).to_have_value(address)
        assert stack.sql(f"SELECT id FROM enquiry WHERE email = '{address}'") == []
        page.get_by_role("textbox", name="Telephone").fill("")
        page.get_by_role("checkbox", name="I agree to the privacy statement").check()
        page.get_by_role("button", name="Send the enquiry").click()
        expect(page.get_by_role("status")).to_have_text("Thank you, the desk will reply from hello@example.com")
        page.reload()
        _fill_enquiry(page, address)
        page.get_by_role("button", name="Send the enquiry").click()
        expect(page.get_by_role("status")).to_have_text("Thank you, the desk will reply from hello@example.com")
    assert len(stack.sql(f"SELECT id FROM enquiry WHERE email = '{address}'")) == 1


def test_sign_in(app_url):
    for email, role in ((CURATOR, "curator"), (STEWARD, "steward"), (WESTHALL, "curator")):
        response = _call(app_url, "POST", "/api/auth/login", {"email": email, "password": PASSWORD})
        assert response.status_code == 200 and response.json()["role"] == role and response.json()["token"]
    bodies = set()
    for body in ({"email": CURATOR, "password": "wrong"}, {"email": "nobody@example.com", "password": PASSWORD},
                 {"email": CURATOR}, {"password": PASSWORD}, {}, {"email": 1, "password": []},
                 {"email": "a\u0000", "password": "b"}):
        response = _call(app_url, "POST", "/api/auth/login", body)
        assert response.status_code == 401, body
        bodies.add(response.content)
    assert len(bodies) == 1
    assert json.loads(bodies.pop()) == {"message": "The address or password is not right"}


def test_hashed_passwords(first_boot):
    rows = first_boot.sql("SELECT password_hash FROM account")
    hashes = [r["password_hash"] for r in rows]
    assert len(hashes) == 3 and len(set(hashes)) == 3
    assert all(h and PASSWORD not in h for h in hashes)


def test_desk_needs_session(stack):
    for method, path in (("GET", "/api/desk/references"), ("POST", "/api/desk/references"),
                         ("GET", "/api/desk/enquiries"), ("PUT", "/api/desk/order"),
                         ("GET", f"/api/desk/references/{QUARRY}"), ("DELETE", "/api/desk/enquiries/1")):
        assert _call(stack.url, method, path).json() == DESK_401, path
        unknown = _call(stack.url, method, path, token="unknown-token")
        assert unknown.status_code == 401 and unknown.json() == DESK_401
    desk = Desk(stack.url, CURATOR)
    assert desk.call("GET", "/api/desk/references").status_code == 200
    stack.clock(_epoch(BASE_NOW) + SESSION_SECONDS + 3600)
    ended = desk.call("GET", "/api/desk/references")
    assert ended.status_code == 401 and ended.json() == DESK_401


def test_steward_only_actions(stack):
    before = stack.sql(f"SELECT clearance_from::text AS f, clearance_until::text AS u, version FROM reference_entry"
                       f" WHERE slug = '{DAIRY}'")
    refused = stack.curator.window(DAIRY, ("2026-01-01", "2026-01-02"))
    assert refused.status_code == 403 and refused.json() == {"message": "Your account cannot do this"}
    assert "2026" not in refused.text and "steward" not in refused.text.lower()
    assert stack.sql(f"SELECT clearance_from::text AS f, clearance_until::text AS u, version FROM reference_entry"
                     f" WHERE slug = '{DAIRY}'") == before
    enquiry = stack.curator.queue()[0]["id"]
    refused = stack.curator.call("DELETE", f"/api/desk/enquiries/{enquiry}")
    assert refused.status_code == 403 and refused.json() == {"message": "Your account cannot do this"}
    assert stack.sql(f"SELECT open FROM enquiry WHERE id = {enquiry}") == [{"open": True}]
    forged = stack.curator.call("PUT", f"/api/desk/references/{DAIRY}/clearance",
                                {"clearance_from": FAR[0], "clearance_until": FAR[1], "role": "steward"})
    assert forged.status_code == 403
    login = _call(stack.url, "POST", "/api/auth/login", {"email": CURATOR, "password": PASSWORD, "role": "steward"})
    assert login.json()["role"] == "curator"
    assert stack.curator.call("POST", f"/api/desk/references/{QUARRY}/publish",
                              {"ordinal": 1, "clearance_from": FAR[0], "clearance_until": FAR[1], "published": True}
                              ).status_code == 409
    assert stack.steward.call("DELETE", f"/api/desk/enquiries/{enquiry}").status_code == 204
    assert stack.steward.call("DELETE", f"/api/desk/enquiries/{enquiry}").content == NOT_FOUND
    assert stack.steward.window(DAIRY, FAR).status_code == 200
    assert stack.sql(f"SELECT clearance_from::text AS f FROM reference_entry WHERE slug = '{DAIRY}'")[0]["f"][:10] == FAR[0]


def test_programme_isolation(stack):
    keep = "SELECT slug, title, version, published, ordinal, clearance_from::text AS f FROM reference_entry WHERE slug = '%s'"
    foreign = keep % COLD
    before = stack.sql(foreign)
    for desk in (stack.curator, stack.steward):
        for call in (lambda d=desk: d.call("GET", f"/api/desk/references/{COLD}"),
                     lambda d=desk: d.patch(COLD, {"title": "Stolen title"}),
                     lambda d=desk: d.publish(COLD), lambda d=desk: d.retire(COLD),
                     lambda d=desk: d.window(COLD, PAST), lambda d=desk: d.preview(COLD),
                     lambda d=desk: d.order(COLD, 1)):
            response = call()
            assert response.status_code == 404 and response.content == NOT_FOUND
    assert stack.sql(foreign) == before
    foreign_enquiry = stack.sql("SELECT id FROM enquiry WHERE email = 'cold.buyer@example.com'")[0]["id"]
    for desk in (stack.curator, stack.steward):
        assert desk.call("DELETE", f"/api/desk/enquiries/{foreign_enquiry}").content == NOT_FOUND
    assert stack.sql(f"SELECT open FROM enquiry WHERE id = {foreign_enquiry}") == [{"open": True}]
    westhall = Desk(stack.url, WESTHALL)
    assert [r["slug"] for r in westhall.rows()] == [COLD]
    assert COLD not in [r["slug"] for r in stack.curator.rows()]
    assert westhall.patch(HARBOUR, {"summary": "Stolen"}).content == NOT_FOUND
    assert westhall.order(HARBOUR, 1).content == NOT_FOUND
    assert westhall.preview(QUARRY).content == NOT_FOUND
    assert stack.sql(f"SELECT id FROM preview_link") == []


def test_only_editable_fields_written(stack):
    extras = {"published": True, "ordinal": 1, "clearance_from": FAR[0], "clearance_until": FAR[1], "programme_id": 2,
              "programme": "westhall", "account_id": 99, "role": "steward", "id": 999, "slug": "chosen-slug",
              "state": "live", "version": 50, "retired_at": BASE_NOW, "created_at": BASE_NOW}
    title = "Mass assignment probe"
    created = stack.curator.call("POST", "/api/desk/references", {**_draft(title), **extras})
    assert created.status_code == 201 and created.json() == {"slug": _slug_of(title)}
    slug = created.json()["slug"]

    def stored():
        return stack.sql("SELECT r.published, r.ordinal, r.clearance_from, r.clearance_until, r.version, r.retired_at,"
                         f" p.slug AS prog FROM reference_entry r JOIN programme p ON p.id = r.programme_id"
                         f" WHERE r.slug = '{slug}'")[0]
    assert stored() == {"published": False, "ordinal": None, "clearance_from": None, "clearance_until": None,
                        "version": 1, "retired_at": None, "prog": "northfall"}
    edited = stack.curator.patch(slug, {**extras, "summary": EDITED_SUMMARY,
                                        "figures": [{"label": "L", "value": "V", "position": 9, "id": 1}]})
    assert edited.status_code == 200 and edited.json()["slug"] == slug
    row = stored()
    assert row["published"] is False and row["ordinal"] is None and row["clearance_from"] is None
    assert row["prog"] == "northfall" and row["version"] == 2
    assert stack.curator.detail(slug)["summary"] == EDITED_SUMMARY
    assert stack.sql(f"SELECT f.label, f.value, f.position FROM figure f JOIN reference_entry r ON r.id = f.reference_id"
                     f" WHERE r.slug = '{slug}'") == [{"label": "L", "value": "V", "position": 1}]
    still = stack.curator.patch(slug, {"published": True, "ordinal": 3})
    assert still.status_code == 200 and still.json()["version"] == 2


def test_authority_read_from_stored_account(stack):
    steward = Desk(stack.url, STEWARD)
    assert steward.window(QUARRY, FAR).status_code == 200
    stack.run(f"UPDATE account SET role = 'curator' WHERE email = '{STEWARD}'")
    assert steward.window(QUARRY, PAST).status_code == 403
    stack.run(f"UPDATE account SET role = 'steward' WHERE email = '{STEWARD}'")
    assert steward.window(QUARRY, PAST).status_code == 200
    moved = Desk(stack.url, CURATOR)
    westhall = Desk(stack.url, WESTHALL)

    def seen(desk):
        return {r["slug"] for r in desk.rows()}
    results = _together(([lambda: seen(moved)] + [lambda: seen(westhall)]) * (THREADS // 2))
    assert all((COLD in s) != (HARBOUR in s) for s in results)
    assert results[0] == seen(moved) and results[1] == {COLD}
    stack.run(f"UPDATE account SET programme_id = (SELECT id FROM programme WHERE slug = 'westhall')"
              f" WHERE email = '{CURATOR}'")
    assert seen(moved) == {COLD}
    assert moved.call("GET", f"/api/desk/references/{HARBOUR}").status_code == 404
    stack.run(f"UPDATE account SET programme_id = (SELECT id FROM programme WHERE slug = 'northfall')"
              f" WHERE email = '{CURATOR}'")
    assert HARBOUR in seen(moved)
    stack.run(f"DELETE FROM account WHERE email = '{WESTHALL}'")
    gone = westhall.call("GET", "/api/desk/references")
    assert gone.status_code == 401 and gone.json() == DESK_401


def test_session_edges(stack):
    signed_at = _epoch(BASE_NOW)
    desk = stack.exact(signed_at, lambda: Desk(stack.url, CURATOR))
    at_end = stack.exact(signed_at + SESSION_SECONDS, lambda: desk.call("GET", "/api/desk/references"))
    assert at_end.status_code == 200
    after = stack.exact(signed_at + SESSION_SECONDS + 1, lambda: desk.call("GET", "/api/desk/references"))
    assert after.status_code == 401 and after.json() == DESK_401


def test_wf_desk_access_session_resume(stack, browser):
    with _live(browser, stack.url + "/desk") as page:
        _desk(page)
        _btn(page, f"Edit {QUARRY_T}").click()
        typed = "Typed during the ending session"
        _box(page, "Summary").fill(typed)
        stack.clock(_epoch(BASE_NOW) + SESSION_SECONDS + 3600)
        patches = []
        page.on("request", lambda r: patches.append(r) if r.method == "PATCH" else None)
        _btn(page, "Save the reference").click()
        expect(_msg(page)).to_have_text("Your session has ended. Sign in to finish.")
        email = page.get_by_role("form", name="Sign in").get_by_label("Email")
        expect(email).to_be_focused()
        expect(_box(page, "Summary")).to_have_value(typed)
        _sign_in(page, CURATOR, "wrong-password")
        expect(page.get_by_role("alert")).to_have_text("The address or password is not right")
        assert stack.curator.detail(QUARRY)["summary"] != typed
        _sign_in(page, CURATOR)
        expect(_msg(page)).to_have_text("Saved")
        expect(_box(page, "Summary")).to_have_value(typed)
        assert len(patches) == 2
    assert stack.curator.detail(QUARRY)["summary"] == typed
    assert stack.curator.detail(QUARRY)["version"] == 2


def test_wf_desk_access_other_account(stack, browser):
    with _live(browser, stack.url + "/desk") as page:
        _desk(page, STEWARD)
        _btn(page, f"Edit {QUARRY_T}").click()
        _box(page, "Cleared from").fill(FAR[0])
        _box(page, "Cleared until").fill(FAR[1])
        stack.clock(_epoch(BASE_NOW) + SESSION_SECONDS + 3600)
        _btn(page, "Save the clearance window").click()
        expect(_msg(page)).to_have_text("Your session has ended. Sign in to finish.")
        _sign_in(page, CURATOR)
        expect(_msg(page)).to_have_text("Your account cannot do this")
        assert stack.sql(f"SELECT clearance_from FROM reference_entry WHERE slug = '{QUARRY}'") == [{"clearance_from": None}]
        _btn(page, f"Edit {QUARRY_T}").click() if not _editor(page).count() else None
        _box(page, "Summary").fill(NEVER_WRITTEN)
        stack.clock(_epoch(BASE_NOW) + 2 * SESSION_SECONDS + 7200)
        _btn(page, "Save the reference").click()
        expect(_msg(page)).to_have_text("Your session has ended. Sign in to finish.")
        _sign_in(page, WESTHALL)
        expect(page.get_by_role("list", name="References")).to_contain_text(COLD_T)
        expect(page.get_by_role("list", name="References")).not_to_contain_text(HARBOUR_T)
        expect(_editor(page)).to_have_count(0)
    assert stack.sql(f"SELECT summary FROM reference_entry WHERE slug = '{QUARRY}'")[0]["summary"] != NEVER_WRITTEN


def test_wf_desk_access_landing(stack, browser):
    with _live(browser, stack.url + "/desk") as page:
        _desk(page)
        expect(page.get_by_role("heading", level=2, name="References", exact=True)).to_be_focused()
        desk_url = re.compile(r"/desk$")
        expect(page).to_have_url(desk_url)
        token_like = page.evaluate("() => document.cookie")
        assert token_like == "" or "token" not in token_like.lower()
        assert all(c["value"] != Desk(stack.url, CURATOR).token for c in page.context.cookies())
        _btn(page, "New reference").click()
        title = _title()
        for label, value in (("Title", title), ("Summary", "S"), ("Challenge", "C"), ("Work", "W"),
                             ("Sector", "probe-sector"), ("Customer", "Probe Oy")):
            _box(page, label).fill(value)
        _btn(page, "Create the draft").click()
        expect(_msg(page)).to_have_text("Saved")
        expect(page).to_have_url(desk_url)
        _btn(page, f"Retire {DAIRY_T}").click()
        expect(_msg(page)).to_have_text(f"{DAIRY_T} is retired")
        expect(page).to_have_url(desk_url)
        _btn(page, f"Publish {DAIRY_T}").click()
        expect(_msg(page)).to_have_text(f"{DAIRY_T} is published")
        expect(page).to_have_url(desk_url)
        page.reload()
        expect(page.get_by_role("list", name="References")).to_contain_text(title)
        expect(page.get_by_role("form", name="Sign in")).to_have_count(0)
        other = page.context.new_page()
        other.goto(stack.url + "/desk")
        expect(other.get_by_role("form", name="Sign in")).to_be_visible()
        other.close()
    assert _slug_of(title) in [r["slug"] for r in stack.curator.rows()]


def test_drafts_and_edits(stack):
    title = _title()
    slug = stack.curator.create(title)
    detail = stack.curator.detail(slug)
    assert detail["state"] == "draft" and detail["published"] is False and detail["live"] is False
    assert detail["ordinal"] is None and detail["clearance_from"] is None and detail["clearance_until"] is None
    assert detail["version"] == 1 and detail["summary"] == DRAFT_SUMMARY
    for key in ("title", "sector", "customer", "summary", "challenge", "work"):
        body = _draft(_title())
        del body[key]
        refused = stack.curator.call("POST", "/api/desk/references", body)
        assert refused.status_code == 422 and key in refused.json()["errors"], key
    assert stack.curator.patch(slug, {"sector": "Bad Sector"}).status_code == 422
    assert stack.curator.patch(slug, {"figures": [{"label": "L", "value": "V"}] * 7}).status_code == 422
    assert stack.curator.patch(slug, {"figures": []}).status_code == 422
    two = [{"label": "One", "value": "1"}, {"label": "Two", "value": "2"}]
    answer = stack.curator.patch(slug, {"figures": two, "quote": "", "work": NEW_WORK})
    assert answer.status_code == 200 and answer.json()["version"] == 2
    assert stack.sql(f"SELECT f.label, f.position FROM figure f JOIN reference_entry r ON r.id = f.reference_id"
                     f" WHERE r.slug = '{slug}' ORDER BY f.position") == [{"label": "One", "position": 1},
                                                                         {"label": "Two", "position": 2}]
    stack.curator.patch(slug, {"figures": [two[1]]})
    edited = stack.curator.detail(slug)
    assert edited["figures"] == [two[1]] and edited["quote"] is None and edited["work"] == NEW_WORK
    assert slug not in stack.run_slugs()


def test_publication(stack):
    title, sector = _title("Published"), "fresh-sector"
    slug = stack.curator.create(title, figures=FIGS, sector=sector)
    assert slug not in stack.run_slugs()
    stack.steward.window(slug, FAR)
    answer = stack.curator.publish(slug)
    assert answer.status_code == 200 and answer.json() == {"slug": slug, "ordinal": 4}
    assert stack.run_slugs()[-1] == slug
    assert [r["slug"] for r in _get(stack.url, "/api/fi/references").json()][-1] == slug
    assert sector in _get(stack.url, "/api/sectors").json()
    assert _get(stack.url, f"/api/references/{slug}").json()["ordinal"] == 4
    assert _get(stack.url, f"/fi/references/{slug}").status_code == 200
    assert title in _get(stack.url, "/references").text and title in _get(stack.url, "/fi/references").text
    assert title in _get(stack.url, "/contact").text
    assert _call(stack.url, "POST", "/api/enquiries", {"email": _addr(), "agreed": True, "reference": slug}).status_code == 201


def test_publication_guards(stack):
    slug = stack.curator.create()

    def refused(message):
        before = stack.run_slugs()
        response = stack.curator.publish(slug)
        assert response.status_code == 409 and response.json() == {"message": message}
        assert stack.run_slugs() == before
    refused("Record a clearance window before publishing")
    stack.steward.window(slug, FAR)
    refused("Add at least one result figure before publishing")
    token = stack.curator.preview(slug).json()["token"]
    links = len(stack.sql("SELECT id FROM preview_link"))
    refused("Add at least one result figure before publishing")
    assert len(stack.sql("SELECT id FROM preview_link")) == links
    assert _get(stack.url, f"/api/references/{slug}?preview={token}").status_code == 200
    stack.curator.patch(slug, {"figures": FIGS})
    stack.steward.window(slug, FAR)
    assert stack.curator.publish(slug).status_code == 200
    refused("This reference is already published")
    stack.steward.window(slug, FUTURE)
    refused("This reference is already published")


def test_ordinal_moves(stack):
    def ordinals():
        return [r["ordinal"] for r in _get(stack.url, "/api/references").json()]
    moved = stack.curator.order(PAPER, 1)
    assert moved.status_code == 200 and moved.json() == [{"slug": PAPER, "ordinal": 1}, {"slug": HARBOUR, "ordinal": 2},
                                                         {"slug": DAIRY, "ordinal": 3}]
    assert stack.run_slugs() == [PAPER, HARBOUR, DAIRY]
    assert stack.curator.order(PAPER, 10 ** 30).status_code == 200
    assert stack.run_slugs() == [HARBOUR, DAIRY, PAPER]
    assert stack.curator.retire(HARBOUR).status_code == 200
    assert stack.run_slugs() == [DAIRY, PAPER] and ordinals() == [1, 2]
    refused = stack.curator.order(HARBOUR, 1)
    assert refused.status_code == 409 and refused.json() == {"message": "Only a live reference can be moved"}
    assert stack.run_slugs() == [DAIRY, PAPER]
    assert stack.curator.publish(HARBOUR).status_code == 200
    assert stack.run_slugs() == [DAIRY, PAPER, HARBOUR] and ordinals() == [1, 2, 3]
    stack.steward.window(DAIRY, PAST)
    assert stack.run_slugs() == [PAPER, HARBOUR] and ordinals() == [1, 2]
    assert stack.curator.order("no-such-reference", 1).content == NOT_FOUND
    stored = stack.sql("SELECT ordinal FROM reference_entry WHERE slug = '%s'" % DAIRY)
    assert stored == [{"ordinal": None}]


def test_concurrent_publishes(stack):
    slug = stack.curator.create(figures=FIGS)
    stack.steward.window(slug, FAR)
    results = _together([lambda: stack.curator.publish(slug)] * THREADS)
    codes = sorted(r.status_code for r in results)
    assert codes == [200] + [409] * (THREADS - 1)
    assert all(r.json() == {"message": "This reference is already published"} for r in results if r.status_code == 409)
    assert stack.run_slugs().count(slug) == 1
    assert [r["ordinal"] for r in _get(stack.url, "/api/references").json()] == [1, 2, 3, 4]
    assert stack.curator.detail(slug)["version"] == 3


def test_live_totals(stack, browser):
    with _live(browser, stack.url + "/desk") as page:
        navigations = []
        page.on("framenavigated", lambda f: navigations.append(f.url))
        _desk(page)
        navigations.clear()
        totals = lambda text: expect(page.get_by_text(text, exact=True)).to_be_visible()
        totals("3 live, 1 withheld, 1 drafts, 0 retired")
        totals("1 open enquiries")
        _btn(page, f"Retire {PAPER_T}").click()
        expect(_msg(page)).to_have_text(f"{PAPER_T} is retired")
        totals("2 live, 1 withheld, 1 drafts, 1 retired")
        _btn(page, f"Publish {QUARRY_T}").click()
        expect(_msg(page)).to_have_text("Record a clearance window before publishing")
        totals("2 live, 1 withheld, 1 drafts, 1 retired")
        _btn(page, f"Edit {QUARRY_T}").click()
        totals("Figures 0 of 6")
        add = _btn(page, "Add a figure")
        for count in range(1, 7):
            add.click()
            totals(f"Figures {count} of 6")
        expect(add).to_be_disabled()
        _btn(page, "Remove figure 6").click()
        totals("Figures 5 of 6")
        _call(stack.url, "POST", "/api/enquiries", {"email": _addr(), "agreed": True})
        _btn(page, f"Publish {PAPER_T}").click()
        expect(_msg(page)).to_have_text(f"{PAPER_T} is published")
        totals("2 open enquiries")
        totals("3 live, 1 withheld, 1 drafts, 0 retired")
        assert navigations == []


def test_lost_updates(stack, browser):
    desk = stack.curator
    slug = desk.create()
    assert desk.patch(slug, {"summary": "One"}, **{"If-Match": '"1"'}).json()["version"] == 2
    for value in ('"1"', "2", "junk"):
        refused = desk.patch(slug, {"summary": "Stale"}, **{"If-Match": value})
        assert refused.status_code == 412, value
        assert refused.json() == {"message": "This reference has changed since you opened it"}
    assert desk.detail(slug)["summary"] == "One" and desk.detail(slug)["version"] == 2
    assert desk.patch(slug, {"summary": "Star"}, **{"If-Match": "*"}).status_code == 200
    assert desk.patch(slug, {"summary": "Free"}).json()["version"] == 4
    assert desk.patch(slug, {"summary": "Free"}).json()["version"] == 4
    results = _together([lambda i=i: desk.patch(slug, {"summary": f"Race {i}"}, **{"If-Match": '"4"'})
                         for i in range(THREADS)])
    assert sorted(r.status_code for r in results) == [200] + [412] * (THREADS - 1)
    with _live(browser, stack.url + "/desk") as page:
        _desk(page)
        _btn(page, f"Edit {QUARRY_T}").click()
        version = desk.detail(QUARRY)["version"]
        typed = "Typing that must survive"
        _box(page, "Summary").fill(typed)
        patches = []
        page.on("request", lambda r: patches.append(r) if r.method == "PATCH" else None)
        desk.patch(QUARRY, {"work": "Changed elsewhere"})
        _btn(page, "Save the reference").click()
        expect(_msg(page)).to_have_text("This reference has changed since you opened it")
        expect(_box(page, "Summary")).to_have_value(typed)
        assert patches[0].headers["if-match"] == f'"{version}"'
    assert desk.detail(QUARRY)["summary"] != typed


def test_wider_concurrency(stack):
    slugs = [stack.curator.create(figures=FIGS) for _ in range(6)]
    for slug in slugs:
        stack.steward.window(slug, FAR)
    results = _together([lambda s=s: stack.curator.publish(s) for s in slugs])
    assert {r.status_code for r in results} == {200}
    assert sorted(r.json()["ordinal"] for r in results) == [4, 5, 6, 7, 8, 9]
    title = _title("Shared")
    created = _together([lambda: stack.curator.call("POST", "/api/desk/references", _draft(title))] * 6)
    assert {r.status_code for r in created} == {201}
    made = {r.json()["slug"] for r in created}
    base = _slug_of(title)
    assert made == {base} | {f"{base}-{n}" for n in range(2, 7)}
    racer = stack.curator.create(figures=FIGS)
    stack.steward.window(racer, FAR)
    stack.curator.publish(racer)
    _together([lambda: stack.curator.retire(racer), lambda: stack.curator.order(racer, 1),
               lambda: stack.curator.retire(slugs[0]), lambda: stack.curator.publish(slugs[0])])
    ordinals = [r["ordinal"] for r in _get(stack.url, "/api/references").json()]
    assert ordinals == list(range(1, len(ordinals) + 1))
    stored = sorted(r["ordinal"] for r in stack.sql(
        "SELECT ordinal FROM reference_entry WHERE ordinal IS NOT NULL AND programme_id ="
        " (SELECT id FROM programme WHERE slug = 'northfall')"))
    assert stored == ordinals


def test_reference_state_machine(stack, browser):
    desk = stack.curator
    slug = desk.create(STATE_TITLE, figures=FIGS)

    def state(expected, published):
        assert desk.row(slug)["state"] == expected and desk.detail(slug)["state"] == expected
        assert stack.sql(f"SELECT published FROM reference_entry WHERE slug = '{slug}'") == [{"published": published}]
    state("draft", False)
    refused = desk.retire(slug)
    assert refused.status_code == 409 and refused.json() == {"message": "This reference is not published"}
    stack.steward.window(slug, FUTURE)
    state("draft", False)
    desk.publish(slug)
    state("withheld", True)
    stack.steward.window(slug, FAR)
    state("live", True)
    stack.steward.window(slug, PAST)
    state("withheld", True)
    stack.steward.window(slug, FAR)
    desk.retire(slug)
    state("retired", False)
    assert stack.sql(f"SELECT retired_at FROM reference_entry WHERE slug = '{slug}'")[0]["retired_at"]
    assert desk.retire(slug).status_code == 409
    stack.steward.window(slug, FAR)
    state("retired", False)
    desk.publish(slug)
    state("live", True)
    assert stack.sql(f"SELECT retired_at FROM reference_entry WHERE slug = '{slug}'") == [{"retired_at": None}]
    desk.retire(slug)
    with _live(browser, stack.url + "/desk") as page:
        _desk(page)
        lists = page.get_by_role("list", name="References").get_by_role("listitem")
        for title, word in ((HARBOUR_T, "live"), (RAIL_T, "withheld"),
                            (QUARRY_T, "draft"), (STATE_TITLE, "retired")):
            expect(lists.filter(has_text=title)).to_contain_text(re.compile(rf"\b{word}\b"))
        expect(_btn(page, f"Publish {HARBOUR_T}")).to_have_count(0)
        expect(_btn(page, f"Retire {QUARRY_T}")).to_have_count(0)
        expect(_btn(page, f"Move {QUARRY_T} up")).to_have_count(0)


def test_keyboard_reorder(stack, browser):
    with _live(browser, stack.url + "/desk") as page:
        _desk(page)
        expect(_btn(page, f"Move {HARBOUR_T} up")).to_be_disabled()
        expect(_btn(page, f"Move {PAPER_T} down")).to_be_disabled()
        _press(page, f"Move {PAPER_T} up", "Space")
        expect(_msg(page)).to_have_text(f"{PAPER_T} moved to position 2 of 3")
        expect(_btn(page, f"Move {PAPER_T} up")).to_be_focused()
        assert stack.run_slugs() == [HARBOUR, PAPER, DAIRY]
        assert _order_in_ui(page, [HARBOUR_T, PAPER_T, DAIRY_T])
        page.keyboard.press("Enter")
        expect(_msg(page)).to_have_text(f"{PAPER_T} moved to position 1 of 3")
        expect(_btn(page, f"Move {PAPER_T} up")).to_be_disabled()
        expect(_btn(page, f"Move {PAPER_T} down")).to_be_focused()
        assert stack.run_slugs() == [PAPER, HARBOUR, DAIRY]
        page.route("**/api/desk/order", lambda r: r.fulfill(
            status=409, content_type="application/json",
            body=json.dumps({"message": "Only a live reference can be moved"})))
        _press(page, f"Move {DAIRY_T} up")
        expect(_msg(page)).to_have_text("The order could not be changed")
        expect(_btn(page, f"Move {DAIRY_T} up")).to_be_focused()
        assert _order_in_ui(page, [PAPER_T, HARBOUR_T, DAIRY_T])
    assert stack.run_slugs() == [PAPER, HARBOUR, DAIRY]


def test_repeated_desk_announcements(stack, browser):
    with _live(browser, stack.url + "/desk") as page:
        _desk(page)
        region = _msg(page).element_handle()
        page.evaluate("""r => { window.__log = [];
            new MutationObserver(list => { for (const m of list) {
                if (m.removedNodes.length && !m.addedNodes.length) window.__log.push('empty');
                else if (m.addedNodes.length) window.__log.push('text');
                else window.__log.push(r.textContent ? 'text' : 'empty');
            } }).observe(r, {childList: true, characterData: true, subtree: true}); }""", region)
        page.route("**/api/desk/order", lambda r: r.fulfill(
            status=409, content_type="application/json",
            body=json.dumps({"message": "Only a live reference can be moved"})))
        for repeated in (False, True):
            page.evaluate("() => { window.__log.length = 0; }")
            _press(page, f"Move {DAIRY_T} up")
            expect(_msg(page)).to_have_text("The order could not be changed")
            _wait(lambda: "text" in page.evaluate("() => window.__log"), HTTP_TIMEOUT, "announcement")
            log = page.evaluate("() => window.__log")
            if repeated:
                assert "empty" in log and log.index("empty") < len(log) - 1 - log[::-1].index("text"), log
        page.unroute("**/api/desk/order")
        moves = []
        page.on("request", lambda r: moves.append(r) if r.method == "PUT" else None)
        button = _btn(page, f"Move {PAPER_T} up")
        with held(page, "**/api/desk/order") as release:
            button.focus()
            page.keyboard.press("Enter")
            page.keyboard.press("Enter")
            inside = page.get_by_role("list", name="References").evaluate(
                "e => e.contains(document.activeElement)")
            assert inside
            release()
        expect(_msg(page)).to_have_text(f"{PAPER_T} moved to position 2 of 3")
        assert len(moves) == 1
    assert stack.run_slugs() == [HARBOUR, PAPER, DAIRY]


def test_wf_authoring_keyboard(stack, browser):
    title = _title("Keyboard")
    slug = _slug_of(title)
    with _live(browser, stack.url + "/desk") as page:
        _desk(page)
        _press(page, "New reference")
        expect(_box(page, "Title")).to_be_focused()
        page.keyboard.press("Escape")
        expect(_btn(page, "New reference")).to_be_focused()
        _press(page, "New reference")
        for label, value in (("Title", title), ("Summary", "S"), ("Challenge", "C"), ("Work", "W"),
                             ("Sector", "keyboard-sector"), ("Customer", "Probe Oy")):
            _box(page, label).focus()
            page.keyboard.type(value)
        _press(page, "Create the draft")
        expect(_btn(page, "Add a figure")).to_be_focused()
        expect(_btn(page, "Save the reference")).to_be_visible()
        page.keyboard.press("Enter")
        expect(_box(page, "Figure 1 label")).to_be_focused()
        page.keyboard.type("Uptime")
        _box(page, "Figure 1 value").focus()
        page.keyboard.type("99 %")
        _press(page, "Add a figure")
        expect(_box(page, "Figure 2 label")).to_be_focused()
        _press(page, "Remove figure 1")
        expect(_btn(page, "Remove figure 1")).to_be_focused()
        _press(page, "Remove figure 1")
        expect(_btn(page, "Add a figure")).to_be_focused()
        page.keyboard.press("Enter")
        page.keyboard.type("Uptime")
        _box(page, "Figure 1 value").focus()
        page.keyboard.type("99 %")
        _press(page, "Save the reference")
        expect(_msg(page)).to_have_text("Saved")
        expect(_btn(page, "Save the reference")).to_be_focused()
        _press(page, f"Publish {title}")
        expect(_msg(page)).to_have_text("Record a clearance window before publishing")
        expect(_btn(page, f"Publish {title}")).to_be_focused()
        assert stack.steward.window(slug, FAR).status_code == 200
        _press(page, f"Publish {title}")
        expect(_msg(page)).to_have_text(f"{title} is published")
        expect(_btn(page, f"Retire {title}")).to_be_focused()
        assert stack.run_slugs()[-1] == slug
        page.keyboard.press("Enter")
        expect(_msg(page)).to_have_text(f"{title} is retired")
        expect(_btn(page, f"Publish {title}")).to_be_focused()
        assert slug not in stack.run_slugs()
        _box(page, "Summary").focus()
        page.keyboard.type(" more")
        page.keyboard.press("Escape")
        expect(_msg(page)).to_have_text("Unsaved changes. Press Escape again to discard.")
        expect(_box(page, "Summary")).to_be_focused()
        page.keyboard.press("Escape")
        expect(_editor(page)).to_have_count(0)
        expect(_btn(page, f"Edit {title}")).to_be_focused()
    assert stack.curator.detail(slug)["figures"] == FIGS


@pytest.mark.parametrize("width", [DESK_W, PHONE_W], ids=["wide", "narrow"])
def test_wf_authoring_editor_survives(stack, browser, width):
    with _live(browser, stack.url + "/desk", width=width, height=DESK_H) as page:
        _desk(page)
        _btn(page, f"Edit {QUARRY_T}").click()
        summary = _box(page, "Summary")
        summary.fill(TYPED_WORDS)
        summary.evaluate("e => e.setSelectionRange(5, 5)")
        _btn(page, f"Retire {DAIRY_T}").click()
        expect(_msg(page)).to_have_text(f"{DAIRY_T} is retired")
        expect(page.get_by_text(_totals(2, 1, 1, 1))).to_be_visible()
        expect(summary).to_have_value(TYPED_WORDS)
        assert summary.evaluate("e => e.selectionStart") == 5
        expect(_msg(page)).to_have_text(f"{DAIRY_T} is retired")
        _btn(page, "Save the reference").click()
        expect(_msg(page)).to_have_text("Saved")
    assert stack.curator.detail(QUARRY)["summary"] == TYPED_WORDS
    assert stack.curator.detail(DAIRY)["summary"] != TYPED_WORDS


def test_preview_links(stack):
    desk = stack.curator
    slug = desk.create(PREVIEW_TITLE, figures=FIGS)
    other = desk.create("Sibling draft", figures=FIGS)
    minted = desk.preview(slug)
    assert minted.status_code == 201
    token = minted.json()["token"]
    assert len(token) >= 32 and re.fullmatch(r"[A-Za-z0-9_-]+", token) and slug not in token
    assert re.search(r"(Z|[+-]\d\d:\d\d)$", minted.json()["expires_at"])
    for path in (f"/api/references/{slug}", f"/api/fi/references/{slug}"):
        response = _get(stack.url, f"{path}?preview={token}")
        assert response.status_code == 200 and response.json()["title"] == PREVIEW_TITLE
    for path in (f"/references/{slug}", f"/fi/references/{slug}"):
        assert _get(stack.url, f"{path}?preview={token}").status_code == 200
    for path in (f"/api/references/{other}?preview={token}", f"/api/references/{HARBOUR}x?preview={token}",
                 f"/references/{other}?preview={token}"):
        assert _get(stack.url, path).status_code == 404
    assert slug not in stack.run_slugs()
    assert PREVIEW_TITLE not in _get(stack.url, f"/references?preview={token}").text
    assert _call(stack.url, "POST", f"/api/references/{slug}?preview={token}", {}).status_code == 405
    replaced = desk.preview(slug).json()["token"]
    assert replaced != token
    assert _get(stack.url, f"/api/references/{slug}?preview={token}").content == NOT_FOUND
    assert _get(stack.url, f"/api/references/{slug}?preview={replaced}").status_code == 200
    stack.clock(_epoch(BASE_NOW) + DEFAULT_PREVIEW_SECONDS + 3600)
    assert _get(stack.url, f"/api/references/{slug}?preview={replaced}").content == NOT_FOUND
    live = stack.curator.preview(HARBOUR)
    assert live.status_code == 409 and live.json() == {"message": "This reference is already published"}


def test_preview_retired_by_publication(stack):
    slug = stack.curator.create(figures=FIGS)
    token = stack.curator.preview(slug).json()["token"]
    stack.steward.window(slug, FAR)
    stack.curator.publish(slug)
    live = _get(stack.url, f"/api/references/{slug}?preview={token}")
    assert live.status_code == 200 and "preview" not in live.headers.get("x-robots-tag", "")
    stack.curator.retire(slug)
    assert _get(stack.url, f"/api/references/{slug}?preview={token}").content == NOT_FOUND
    assert _get(stack.url, f"/references/{slug}?preview={token}").status_code == 404
    stack.curator.patch(slug, {"summary": "Edited while retired"})
    assert _get(stack.url, f"/api/references/{slug}?preview={token}").content == NOT_FOUND


def test_preview_banner(stack):
    desk = stack.curator
    slug = desk.create(BANNER_TITLE, figures=FIGS, title_fi="Otsikko", body_fi="Suomenkielinen runko")
    token = desk.preview(slug).json()["token"]
    english = _text(_main(_get(stack.url, f"/references/{slug}?preview={token}").text))
    page_text = _text(_get(stack.url, f"/references/{slug}?preview={token}").text)
    assert "Preview: the reference is not published" in page_text
    assert BANNER_TITLE in english and FIGS[0]["label"] in english
    assert "Ask about this reference" not in english
    finnish = _text(_get(stack.url, f"/fi/references/{slug}?preview={token}").text)
    assert "Esikatselu: referenssiä ei ole julkaistu" in finnish and "Kysy tästä referenssistä" not in finnish
    normal = _text(_get(stack.url, f"/references/{HARBOUR}").text)
    assert "Preview: the reference is not published" not in normal and "Ask about this reference" in normal
    ignored = _text(_get(stack.url, f"/references/{HARBOUR}?preview={token}").text)
    assert "Preview: the reference is not published" not in ignored
    bare = desk.create("Figureless draft")
    bare_token = desk.preview(bare).json()["token"]
    assert _get(stack.url, f"/api/references/{bare}?preview={bare_token}").json()["figures"] == []


def test_preview_refusals(stack):
    desk = stack.curator
    slug = desk.create(figures=FIGS)
    good = desk.preview(slug).json()["token"]
    for refused in (f"?preview=unknown-token-value", "?preview=%00", ""):
        api = _get(stack.url, f"/api/references/{slug}{refused}")
        assert api.status_code == 404 and api.content == NOT_FOUND
        assert _main(_get(stack.url, f"/references/{slug}{refused}").text) == _main(
            _get(stack.url, "/no-such-address-here").text)
    valid = _get(stack.url, f"/references/{slug}?preview={good}")
    assert valid.headers["cache-control"] == "private, no-store"
    assert valid.headers["x-robots-tag"] == "noindex" and valid.headers["referrer-policy"] == "no-referrer"
    assert any(m.get("name") == "robots" and m.get("content") == "noindex" for m in _tags(valid.text, "meta"))
    api = _get(stack.url, f"/api/references/{slug}?preview={good}")
    assert api.headers["cache-control"] == "private, no-store" and api.headers["x-robots-tag"] == "noindex"
    before = len(stack.sql("SELECT id FROM preview_link"))
    for value in ("2026-11-03T09:00:00Z", "2030-01-01T00:00:00Z", "2026-11-04T10:00:00", "2026-11-04", "tomorrow", 7):
        refused = desk.preview(slug, {"expires_at": value})
        assert refused.status_code == 422 and "expires_at" in refused.json()["errors"], value
    assert len(stack.sql("SELECT id FROM preview_link")) == before
    assert _get(stack.url, f"/api/references/{slug}?preview={good}").status_code == 200


def test_elapsed_expiry(stack, browser):
    slug = stack.curator.create("Clock change draft", figures=FIGS)
    minted_at = _epoch("2026-10-22T09:00:00Z")
    minted = stack.exact(minted_at, lambda: stack.curator.preview(slug))
    assert minted.status_code == 201
    expires = _epoch(minted.json()["expires_at"])
    assert expires == minted_at + DEFAULT_PREVIEW_SECONDS == _epoch("2026-10-29T09:00:00Z")
    path = f"/api/references/{slug}?preview={minted.json()['token']}"
    assert stack.exact(expires, lambda: _get(stack.url, path)).status_code == 200
    assert stack.exact(expires + 1, lambda: _get(stack.url, path)).content == NOT_FOUND
    limit = stack.exact(minted_at, lambda: stack.curator.preview(
        slug, {"expires_at": datetime.utcfromtimestamp(minted_at + MAX_PREVIEW_SECONDS).strftime("%Y-%m-%dT%H:%M:%SZ")}))
    assert limit.status_code == 201
    over = stack.exact(minted_at, lambda: stack.curator.preview(
        slug, {"expires_at": datetime.utcfromtimestamp(minted_at + MAX_PREVIEW_SECONDS + 1).strftime("%Y-%m-%dT%H:%M:%SZ")}))
    assert over.status_code == 422 and "expires_at" in over.json()["errors"]
    stack.clock(minted_at)
    with _live(browser, stack.url + "/desk") as page:
        _desk(page)
        page.clock.set_fixed_time(datetime.fromisoformat("2031-03-01T00:00:00+00:00"))
        _btn(page, "Make a preview link for Clock change draft").click()
        expect(_msg(page)).to_contain_text("29.10.2026 11:00")
        expect(_msg(page)).to_contain_text(f"Preview link ready: {stack.url}/")
        expect(_btn(page, "Make a preview link for Clock change draft")).to_be_focused()


def test_previews_leak_nothing(stack):
    desk = stack.curator
    slug = desk.create("Leak probe", figures=FIGS)
    token = desk.preview(slug).json()["token"]
    missing = _get(stack.url, "/api/references/no-such-slug")
    other = desk.create(figures=FIGS)
    variants = [f"/api/references/{slug}?preview=unknown", f"/api/references/{other}?preview={token}",
                f"/api/references/{RAIL}", f"/api/references/{slug}"]
    for path in variants:
        refused = _get(stack.url, path)
        assert refused.status_code == missing.status_code and refused.content == missing.content
        for header in ("cache-control", "x-robots-tag", "referrer-policy", "content-type"):
            assert refused.headers.get(header) == missing.headers.get(header), (path, header)
    page_missing = _get(stack.url, "/no-such-address-here")
    refused_page = _get(stack.url, f"/references/{other}?preview={token}")
    for word in ("expired", "invalid", "preview", "Leak probe"):
        assert word.lower() not in _main(refused_page.text).lower() and word.lower() not in refused.text.lower()
    assert refused_page.headers.get("cache-control") == page_missing.headers.get("cache-control")
    assert refused_page.headers.get("x-robots-tag") == page_missing.headers.get("x-robots-tag")
    valid = _get(stack.url, f"/references/{slug}?preview={token}").text
    with_token = []
    for tag in ("a", "link", "meta"):
        for attrs in _tags(valid, tag):
            if token in " ".join(attrs.values()):
                with_token.append(attrs)
    assert len(with_token) == 2, with_token
    assert any(a.get("hreflang") == "fi" for a in with_token)
    assert _local(_anchor_href(valid, "Suomi"), stack.url) == f"/fi/references/{slug}?preview={token}"
    renamed = desk.patch(slug, {"title": "Leak probe renamed"}).json()["slug"]
    old = _get(stack.url, f"/api/references/{slug}?preview={token}")
    assert old.status_code == 404 and old.content == NOT_FOUND
    assert _get(stack.url, f"/references/{slug}?preview={token}").status_code == 404
    assert _get(stack.url, f"/api/references/{renamed}?preview={token}").status_code == 200


def test_wf_preview_customer_review(stack, browser):
    with _live(browser, stack.url + "/desk") as page:
        _desk(page)
        _btn(page, f"Make a preview link for {QUARRY_T}").click()
        expect(_msg(page)).to_contain_text("Preview link ready:")
        announced = _msg(page).inner_text()
    link = re.search(r"Preview link ready: (\S+) \(expires", announced).group(1)
    with _live(browser, link) as customer:
        expect(customer.get_by_text("Preview: the reference is not published")).to_be_visible()
        expect(customer.get_by_role("heading", level=1)).to_contain_text(QUARRY_T)
        expect(customer.get_by_role("link", name="Ask about this reference")).to_have_count(0)
        assert customer.get_by_role("link", name=QUARRY_T).count() == 0
    assert QUARRY not in stack.run_slugs()
    assert stack.sql(f"SELECT published FROM reference_entry WHERE slug = '{QUARRY}'") == [{"published": False}]


def test_wf_preview_expired_reads_missing(stack, browser):
    token = stack.curator.preview(QUARRY).json()["token"]
    stack.clock(_epoch(BASE_NOW) + DEFAULT_PREVIEW_SECONDS + 3600)
    with _live(browser, stack.url + f"/references/{QUARRY}?preview={token}") as page:
        expect(page.get_by_role("heading", level=1, name="That page is not here")).to_be_visible()
        expect(page.get_by_text("Preview: the reference is not published")).to_have_count(0)
    assert _get(stack.url, f"/api/references/{QUARRY}?preview={token}").content == NOT_FOUND


def _redirects(base, old, new, query=""):
    for prefix in ("/references/", "/fi/references/", "/api/references/", "/api/fi/references/"):
        response = _get(base, f"{prefix}{old}{query}")
        assert response.status_code in (301, 308), prefix
        location = _local(response.headers["location"], base)
        assert location == f"{prefix}{new}{query}", prefix
        assert _get(base, location).status_code == 200


def test_renames_redirect(stack):
    desk = stack.curator
    first, second = _slug_of(RENAME_ONE), _slug_of(RENAME_TWO)
    answer = desk.patch(DAIRY, {"title": RENAME_ONE})
    assert answer.json()["slug"] == first
    assert _get(stack.url, f"/api/references/{first}").json()["title"] == RENAME_ONE
    assert RENAME_ONE in _get(stack.url, "/references").text
    _redirects(stack.url, DAIRY, first)
    assert desk.patch(first, {"title": RENAME_TWO}).json()["slug"] == second
    _redirects(stack.url, DAIRY, second)
    _redirects(stack.url, first, second)
    assert desk.call("GET", f"/api/desk/references/{DAIRY}").content == NOT_FOUND
    assert stack.run_slugs() == [HARBOUR, second, PAPER]
    history = {r["slug"] for r in stack.sql("SELECT slug FROM slug_redirect")}
    assert history == {DAIRY, first}


def test_retired_addresses(stack):
    desk = stack.curator
    current = desk.patch(PAPER, {"title": PAPER_RENAME}).json()["slug"]
    assert desk.retire(current).status_code == 200
    for slug in (PAPER, current):
        for prefix in ("/references/", "/fi/references/", "/api/references/", "/api/fi/references/"):
            response = _get(stack.url, prefix + slug)
            assert response.status_code == 404, prefix + slug
            if prefix.startswith("/api"):
                assert response.content == NOT_FOUND
    assert current not in stack.run_slugs() and "pulp" not in _get(stack.url, "/api/sectors").json()
    for path in ("/references", "/", "/contact", "/fi/references"):
        assert PAPER_RENAME not in _get(stack.url, path).text


def test_exact_restore(stack):
    desk = stack.curator
    slug = desk.create("Restore probe", figures=FIGS, quote="Said once", title_fi="Palautus", body_fi="Runko")
    stack.steward.window(slug, FAR)
    held_token = desk.preview(slug).json()["token"]
    desk.publish(slug)
    renamed = desk.patch(slug, {"title": "Restore probe two"}).json()["slug"]
    before = _get(stack.url, f"/api/references/{renamed}").json()
    desk.order(renamed, 1)
    before_detail = desk.detail(renamed)
    desk.retire(renamed)
    retired_token = desk.preview(renamed).json()["token"]
    during = desk.patch(renamed, {"title": "Restore probe three"}).json()["slug"]
    assert _get(stack.url, f"/references/{renamed}").status_code == 404
    answer = desk.publish(during)
    assert answer.status_code == 200 and stack.run_slugs()[-1] == during
    assert answer.json()["ordinal"] == len(stack.run_slugs())
    after = desk.detail(during)
    for key in ("summary", "challenge", "work", "sector", "customer", "figures", "quote", "title_fi", "body_fi",
                "clearance_from", "clearance_until"):
        assert after[key] == before_detail[key], key
    public = _get(stack.url, f"/api/references/{during}").json()
    assert public["figures"] == before["figures"] and public["quote"] == before["quote"]
    _redirects(stack.url, slug, during)
    _redirects(stack.url, renamed, during)
    for token in (held_token, retired_token):
        desk.retire(during)
        assert _get(stack.url, f"/api/references/{during}?preview={token}").content == NOT_FOUND
        desk.publish(during)


def test_redirect_fidelity(stack):
    new = stack.curator.patch(DAIRY, {"title": "Fidelity rebuild"}).json()["slug"]
    query = "?a=%20b&c=%C3%A4&d=x+y&a=2"
    _redirects(stack.url, DAIRY, new, query)
    spoofed = _get(stack.url, f"/references/{DAIRY}", **{"Host": SPOOF_HOST, "X-Forwarded-Host": SPOOF_HOST})
    assert spoofed.status_code in (301, 308)
    location = spoofed.headers["location"]
    assert location.startswith("/") or location.startswith(stack.url + "/")
    assert SPOOF_HOST not in location
    hop = _get(stack.url, _local(location, stack.url))
    assert hop.status_code == 200
    stack.steward.window(new, PAST)
    for path in (f"/references/{DAIRY}", f"/fi/references/{DAIRY}", f"/api/references/{DAIRY}",
                 f"/api/fi/references/{DAIRY}", f"/references/{DAIRY}?preview=any"):
        assert _get(stack.url, path).status_code == 404, path
    stack.steward.window(new, FAR)
    assert _get(stack.url, f"/references/{DAIRY}").status_code in (301, 308)
    stack.curator.retire(new)
    assert _get(stack.url, f"/references/{DAIRY}").status_code == 404


def test_slugs_from_real_text(stack):
    desk = stack.curator
    slug = desk.create(DECOMPOSED_TITLE)
    assert slug == _slug_of(DECOMPOSED_TITLE) and slug.isascii()
    composed = unicodedata.normalize("NFC", DECOMPOSED_TITLE)
    assert stack.sql(f"SELECT title FROM reference_entry WHERE slug = '{slug}'") == [{"title": composed}]
    for body in (_draft("!!!"),):
        refused = desk.call("POST", "/api/desk/references", body)
        assert refused.status_code == 422 and "title" in refused.json()["errors"]
    refused = desk.patch(slug, {"title": "!!!"})
    assert refused.status_code == 422 and "title" in refused.json()["errors"]
    assert desk.create(HARBOUR_T) == f"{HARBOUR}-2"
    assert desk.create(HARBOUR_T) == f"{HARBOUR}-3"
    alpha, beta = _slug_of(ALPHA_TITLE), _slug_of(BETA_TITLE)
    a = desk.create(ALPHA_TITLE)
    b = desk.patch(a, {"title": BETA_TITLE}).json()["slug"]
    assert b == beta
    assert desk.create(ALPHA_TITLE) == f"{alpha}-2", "an earlier slug must stay reserved"
    assert desk.patch(b, {"title": BETA_TITLE.upper()}).json()["slug"] == b
    assert stack.sql(f"SELECT slug FROM slug_redirect WHERE slug = '{b}'") == []
    back = desk.patch(b, {"title": ALPHA_TITLE}).json()["slug"]
    assert back == alpha
    history = {r["slug"] for r in stack.sql("SELECT slug FROM slug_redirect")}
    assert alpha not in history and beta in history
    assert desk.create(BETA_TITLE) == f"{beta}-2"


def test_wf_slug_history_rename_on_desk(stack, browser):
    with _live(browser, stack.url + "/desk") as page:
        _desk(page)
        _btn(page, f"Edit {DAIRY_T}").click()
        _box(page, "Title").fill(HALL_TITLE)
        _btn(page, "Save the reference").click()
        expect(_msg(page)).to_have_text("Saved")
        _box(page, "Work").fill(FOLLOW_UP_WORK)
        _btn(page, "Save the reference").click()
        expect(_msg(page)).to_have_text("Saved")
        expect(_btn(page, f"Edit {HALL_TITLE}")).to_be_visible()
        visitor = page.context.new_page()
        visitor.goto(f"{stack.url}/references/{DAIRY}")
        expect(visitor).to_have_url(re.compile(rf"/references/{_slug_of(HALL_TITLE)}$"))
        expect(visitor.get_by_role("heading", level=1)).to_contain_text(HALL_TITLE)
        visitor.close()
    assert stack.curator.detail(_slug_of(HALL_TITLE))["work"] == FOLLOW_UP_WORK


def test_wf_slug_history_retire_restore_on_desk(stack, browser):
    stack.curator.patch(HARBOUR, {"title": HOIST_TITLE})
    current = _slug_of(HOIST_TITLE)
    with _live(browser, stack.url + "/desk") as page:
        _desk(page)
        _btn(page, f"Retire {HOIST_TITLE}").click()
        expect(_msg(page)).to_have_text(f"{HOIST_TITLE} is retired")
        assert stack.run_slugs() == [DAIRY, PAPER]
        assert _get(stack.url, f"/references/{HARBOUR}").status_code == 404
        _btn(page, f"Publish {HOIST_TITLE}").click()
        expect(_msg(page)).to_have_text(f"{HOIST_TITLE} is published")
    assert stack.run_slugs() == [DAIRY, PAPER, current]
    assert _get(stack.url, f"/references/{HARBOUR}").status_code in (301, 308)


def test_finnish_mirror(app_url):
    for route in ("/fi", "/fi/", "/fi/references", f"/fi/references/{HARBOUR}", f"/fi/references/{DAIRY}",
                  "/fi/programme", "/fi/story", "/fi/notes", "/fi/contact"):
        response = _get(app_url, route)
        assert response.status_code == 200, route
        assert _tags(response.text, "html")[0]["lang"] == "fi"
    english = _get(app_url, "/api/references").json()
    finnish = _get(app_url, "/api/fi/references").json()
    assert [(r["slug"], r["ordinal"]) for r in english] == [(r["slug"], r["ordinal"]) for r in finnish]
    assert finnish[0]["title"] == "Satamanosturin modernisointi"
    assert finnish[1]["title"] == DAIRY_T
    for row in finnish:
        assert _get(app_url, f"/api/fi/references/{row['slug']}").status_code == 200
    harbour = _get(app_url, f"/api/fi/references/{HARBOUR}").json()
    assert harbour["translated"] is True and len(harbour["body"]) > 0
    dairy = _get(app_url, f"/api/fi/references/{DAIRY}").json()
    assert dairy["translated"] is False and dairy["body"] is None
    assert _get(app_url, "/api/fi/references?sector=food").json()[0]["slug"] == DAIRY
    assert _get(app_url, f"/api/fi/references/{QUARRY}").content == NOT_FOUND
    assert [n["slug"] for n in _get(app_url, "/api/fi/notes").json()] == [n["slug"] for n in _get(app_url, "/api/notes").json()]


def test_finnish_copy(app_url):
    translated = _get(app_url, f"/fi/references/{HARBOUR}").text
    text = _text(translated)
    api = _get(app_url, f"/api/fi/references/{HARBOUR}").json()
    english = _get(app_url, f"/api/references/{HARBOUR}").json()
    assert "Tämä tarina on vielä kääntämättä" not in text
    assert "Satamanosturin modernisointi" in text
    assert _text(api["body"])[:30] in text and english["challenge"] not in text
    pending = _text(_get(app_url, f"/fi/references/{DAIRY}").text)
    dairy = _get(app_url, f"/api/references/{DAIRY}").json()
    assert "Tämä tarina on vielä kääntämättä" in pending and _text(dairy["challenge"]) in pending
    assert "Sivua ei löydy" in _text(_get(app_url, "/fi/no-such-address-here").text)
    assert "That page is not here" not in _text(_get(app_url, "/fi/no-such-address-here").text)


def test_language_switch(app_url):
    for route in ROUTES:
        query = "?sector=food" if route == "/references" else ""
        html = _get(app_url, route + query).text
        assert _tags(html, "html")[0]["lang"] == "en"
        target = "/fi" if route == "/" else f"/fi{route}"
        assert _local(_anchor_href(html, "Suomi"), app_url).rstrip("/") == target + query
        assert _local(_alternate(html, "fi"), app_url).rstrip("/") == target + query
        fi_html = _get(app_url, target + query).text
        back = route + query
        assert _tags(fi_html, "html")[0]["lang"] == "fi"
        assert (_local(_anchor_href(fi_html, "English"), app_url) or "/") == back
        assert (_local(_alternate(fi_html, "en"), app_url) or "/") == back


def test_published_finnish_wording(stack, browser):
    base = stack.url
    expected = {
        "/fi": ["Siirry sisältöön", "Tiedustele", "Referenssejä, jotka voit tarkistaa, toimituksista, jotka todella saimme valmiiksi",
                "Jokainen tarina julkaistaan asiakkaan kirjallisella suostumuksella", "Aloita tiedustelu",
                "Lue referenssit"] + FI_NAV,
        "/fi/references": ["Referenssikirjasto", _count_fi(3), "Kaikki toimialat"],
        "/fi/references?sector=food": [_count_fi(1, "food")],
        "/fi/references?sector=nosuch": [_count_fi(0, "nosuch"),
                                         "Yksikään referenssi ei ole tällä hetkellä hyväksytty julkaistavaksi"],
        f"/fi/references/{DAIRY}": ["Kysy tästä referenssistä", "Tämä tarina on vielä kääntämättä"],
        "/fi/programme": ["Näin ohjelma toimii", "Nimeäminen", "Hyväksyntä", "Hyväksynnän kesto", "Muutokset ja poistaminen"],
        "/fi/story": ["Ohjelman vaiheet"],
        "/fi/notes": ["Muistiinpanot"],
        "/fi/contact": ["Keskustele referenssitoimiston kanssa", "Työosoite", "Puhelin", "Kiinnostava referenssi",
                        "Hyväksyn tietosuojaselosteen", "Ei mitään tiettyä referenssiä", "Lähetä tiedustelu", "Kopioi osoite"],
        "/fi/no-such-address-here": ["Sivua ei löydy", "Etusivu", "Referenssit"],
    }
    for route, strings in expected.items():
        text = _text(_get(base, route).text)
        for string in strings:
            assert string in text, (route, string)
    with _live(browser, base + "/fi/programme") as page:
        expect(page.get_by_role("navigation", name="Luvut")).to_be_visible()
        region = page.get_by_role("region", name="Evästeilmoitus")
        expect(region).to_contain_text("Northfall käyttää evästeitä ja vastaavia tekniikoita liikenteen ymmärtämiseen")
        expect(region.get_by_role("button", name="Hyväksy")).to_be_visible()
        expect(region.get_by_role("button", name="Sulje evästeilmoitus")).to_be_visible()
        page.goto(base + "/fi/references")
        expect(page.get_by_role("navigation", name="Toimialat")).to_be_visible()
        page.set_viewport_size({"width": PHONE_W, "height": PHONE_H})
        expect(page.get_by_role("button", name="Valikko")).to_be_visible()
        page.set_viewport_size({"width": DESK_W, "height": DESK_H})
        page.goto(base + "/fi/contact")
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
        copy = page.get_by_role("button", name="Kopioi osoite").first.element_handle()
        copy.click()
        _wait(lambda: _label(copy) == "Kopioitu leikepöydälle", HTTP_TIMEOUT, "fi confirmation")
        page.evaluate("""() => {
            navigator.clipboard.writeText = () => Promise.reject(new DOMException('refused', 'NotAllowedError'));
            document.execCommand = () => false; }""")
        copy.click()
        _wait(lambda: _label(copy) == "Kopiointi ei onnistu", HTTP_TIMEOUT, "fi refusal")
        page.get_by_role("textbox", name="Työosoite").fill(_addr())
        page.get_by_role("checkbox", name="Hyväksyn tietosuojaselosteen").check()
        page.route("**/api/enquiries", lambda r: r.fulfill(status=503, content_type="application/json",
                                                          body=json.dumps({"message": OUTAGE})))
        page.get_by_role("button", name="Lähetä tiedustelu").click()
        expect(page.get_by_role("alert")).to_have_text(
            "Toimisto ei voi juuri nyt ottaa vastaan tiedusteluja. Mitään ei lähetetty; yritä pian uudelleen.")
        page.unroute("**/api/enquiries")
        with held(page, "**/api/enquiries") as release:
            page.get_by_role("button", name="Lähetä tiedustelu").click()
            expect(page.get_by_role("button", name="Lähetetään…")).to_be_disabled()
            release()
        expect(page.get_by_role("status")).to_have_text("Kiitos, toimisto vastaa osoitteesta hello@example.com")
    token = stack.curator.preview(QUARRY).json()["token"]
    assert "Esikatselu: referenssiä ei ole julkaistu" in _text(_get(base, f"/fi/references/{QUARRY}?preview={token}").text)


def test_language_of_parts_and_dates(browser, app_url):
    english = _text(_get(app_url, "/notes").text)
    assert "14 September 2026" in english
    finnish = _text(_get(app_url, "/fi/notes").text)
    assert "14.9.2026" in finnish and "14 September 2026" not in finnish
    for note in _get(app_url, "/api/notes").json():
        day = datetime.fromisoformat(note["published_on"])
        assert f"{day.day} {day:%B} {day.year}" in english
        assert f"{day.day}.{day.month}.{day.year}" in finnish
    lang_of = "e => e.closest('[lang]').getAttribute('lang')"
    with _live(browser, app_url + "/fi/notes") as page:
        assert page.get_by_text("What a clearance covers").first.evaluate(lang_of) == "en"
        assert page.get_by_text("A customer clears the story").first.evaluate(lang_of) == "en"
        assert page.get_by_role("link", name="English").evaluate(lang_of) == "en"
        page.goto(f"{app_url}/fi/references/{DAIRY}")
        api = _get(app_url, f"/api/references/{DAIRY}").json()
        assert page.get_by_text(api["challenge"][:40]).first.evaluate(lang_of) == "en"
        assert page.get_by_text("Line output").first.evaluate(lang_of) == "en"
        assert page.get_by_text("Tämä tarina on vielä kääntämättä").evaluate(lang_of) == "fi"
        page.goto(app_url + "/notes")
        assert page.get_by_role("link", name="Suomi").evaluate(lang_of) == "fi"


def test_address_fidelity_and_finnish_order(stack):
    query = "?sector=food&x=a%20b&y=%C3%A4"
    pages = {f"/references{query}": f"/fi/references{query}", f"/no-such-address-here{query}": f"/fi/no-such-address-here{query}",
             f"/references/{QUARRY}{query}": f"/fi/references/{QUARRY}{query}", f"/story{query}": f"/fi/story{query}"}
    for english, finnish in pages.items():
        html = _get(stack.url, english).text
        assert _local(_anchor_href(html, "Suomi"), stack.url) == finnish, english
        assert _local(_alternate(html, "fi"), stack.url) == finnish, english
        fi_html = _get(stack.url, finnish).text
        assert _local(_anchor_href(fi_html, "English"), stack.url) == english, finnish
    for path in ("/fi/fi/references", "/fi/desk"):
        response = _get(stack.url, path)
        assert response.status_code == 404 and "Sivua ei löydy" in _text(response.text), path
    names = ["Zinc", "abc", "Åland", "Ämmä", "Öljy", "Ankkuri"]
    for name in names:
        stack.curator.create(name)
    rows = stack.curator.rows()
    non_live = [r["title"] for r in rows if not r["live"]]
    probes = [t for t in non_live if t in names]
    assert probes == ["abc", "Ankkuri", "Zinc", "Åland", "Ämmä", "Öljy"]
    assert [r["live"] for r in rows] == sorted((r["live"] for r in rows), reverse=True)


def test_wf_finnish_reader_browses(browser, app_url):
    with _live(browser, app_url + "/references?sector=ports") as page:
        _no_cookie(page)
        page.get_by_role("link", name="Suomi").click()
        expect(page).to_have_url(re.compile(r"/fi/references\?sector=ports$"))
        primary = page.get_by_role("navigation", name="Primary")
        for name in FI_NAV:
            expect(primary.get_by_role("link", name=name, exact=True)).to_be_visible()
        expect(primary.get_by_role("link", name="Referenssit")).to_have_attribute("aria-current", "page")
        api = _get(app_url, f"/api/fi/references/{HARBOUR}").json()
        page.get_by_role("main").get_by_role("link", name=api["title"]).click()
        expect(page.get_by_role("heading", level=1)).to_contain_text(api["title"])
        expect(page.get_by_text("Tämä tarina on vielä kääntämättä")).to_have_count(0)
        page.get_by_role("link", name="English").click()
        expect(page).to_have_url(re.compile(rf"/references/{HARBOUR}$"))


def test_wf_finnish_refused_enquiry(stack, browser):
    with _live(browser, stack.url + "/fi/contact") as page:
        _no_cookie(page)
        field = page.get_by_role("textbox", name="Työosoite")
        field.fill("väärä")
        phone = page.get_by_role("textbox", name="Puhelin")
        phone.fill("123")
        page.get_by_role("button", name="Lähetä tiedustelu").click()
        expect(page.get_by_role("alert")).to_have_text("Tarkista merkityt kentät ja lähetä uudelleen.")
        expect(field).to_have_accessible_description(FI_ERRORS["email"])
        expect(phone).to_have_accessible_description(FI_ERRORS["phone"])
        agree = page.get_by_role("checkbox", name="Hyväksyn tietosuojaselosteen")
        expect(agree).to_have_accessible_description(FI_ERRORS["agreed"])
        expect(page.get_by_text("Enter a work address the desk can reply to")).to_have_count(0)
        address = _addr()
        field.fill(address)
        phone.fill("")
        agree.check()
        page.route("**/api/enquiries", lambda r: r.fulfill(
            status=422, content_type="application/json",
            body=json.dumps({"errors": {"reference": "Choose a reference from the library"}})))
        page.get_by_role("button", name="Lähetä tiedustelu").click()
        expect(page.get_by_text(FI_REF_ERROR)).to_be_visible()
        page.unroute("**/api/enquiries")
        page.get_by_role("button", name="Lähetä tiedustelu").click()
        expect(page.get_by_role("status")).to_have_text("Kiitos, toimisto vastaa osoitteesta hello@example.com")
    assert len(stack.sql(f"SELECT id FROM enquiry WHERE email = '{address}'")) == 1


def test_global_chrome(browser, app_url):
    current = {"/references": "References", "/programme": "Programme", "/story": "Story", "/notes": "Notes"}
    with _live(browser, app_url) as page:
        for route in ROUTES:
            page.goto(app_url + route)
            expect(page.get_by_role("banner")).to_have_count(1)
            footer = page.get_by_role("contentinfo")
            expect(footer).to_have_count(1)
            hrefs = {_local(h, app_url) for h in footer.get_by_role("link").evaluate_all(
                "els => els.map(e => e.getAttribute('href'))")}
            assert {"/", "/references", "/programme", "/story", "/notes", "/contact"} <= hrefs, route
            text = footer.inner_text()
            assert "Northfall Reference Programme" in text and re.search(r"\b\d{4}\b", text)
            expect(footer.get_by_role("link", name=re.compile("privacy", re.I))).to_have_count(1)
            expect(footer.get_by_role("link", name=re.compile("terms of participation", re.I))).to_have_count(1)
            primary = page.get_by_role("navigation", name="Primary")
            links = primary.get_by_role("link")
            assert [t.strip() for t in links.all_inner_texts()] == ["References", "Programme", "Story", "Notes"]
            marked = links.evaluate_all(
                "els => els.filter(e => e.getAttribute('aria-current') === 'page').map(e => e.textContent.trim())")
            if route in current:
                assert marked == [current[route]], route
            elif route.startswith("/references/"):
                assert marked in ([], ["References"]), route
            else:
                assert marked == [], route


def test_cookie_notice(browser, app_url):
    for answer in ("Accept", "Close the cookie notice"):
        with _live(browser, app_url + "/references") as page:
            region = page.get_by_role("region", name="Cookie notice")
            expect(region).to_contain_text("Northfall uses cookies and similar technologies to understand traffic")
            assert page.context.cookies() == []
            region.get_by_role("button", name=answer).click()
            expect(region).to_have_count(0)
            page.reload()
            expect(page.get_by_role("heading", level=1)).to_be_visible()
            expect(page.get_by_role("region", name="Cookie notice")).to_have_count(0)
            page.goto(app_url + "/story")
            expect(page.get_by_role("region", name="Cookie notice")).to_have_count(0)
    with _live(browser, app_url + "/references") as page:
        close = page.get_by_role("button", name="Close the cookie notice")
        close.focus()
        page.keyboard.press("Escape")
        expect(page.get_by_role("region", name="Cookie notice")).to_have_count(0)
        assert page.evaluate("() => document.activeElement !== document.body")


def test_conformance_desktop(browser, app_url):
    with _live(browser, app_url, reduced="reduce") as page:
        for route in ROUTES:
            page.goto(app_url + route)
            axe(page)


def test_conformance_phone(browser, app_url):
    with _live(browser, app_url, width=PHONE_W, height=PHONE_H, reduced="reduce") as page:
        for route in ("/", "/references"):
            page.goto(app_url + route)
            axe(page)


def test_headings_keyboard_icons(browser, app_url):
    walk = """() => { const out = {levels: [], bad: 0};
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        for (let n = w.currentNode; n; n = w.nextNode()) {
            if (/^H[1-6]$/.test(n.tagName)) out.levels.push(Number(n.tagName[1]));
            if (n.tagName.toLowerCase() === 'svg' && n.getAttribute('aria-hidden') !== 'true'
                && !n.getAttribute('aria-label') && !n.getAttribute('aria-labelledby')) out.bad += 1;
        } return out; }"""
    ring = """() => { const s = getComputedStyle(document.activeElement);
        return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.outlineOffset, s.boxShadow].join('|'); }"""
    with _live(browser, app_url, reduced="reduce") as page:
        for route in ROUTES + ["/fi", "/fi/references"]:
            page.goto(app_url + route)
            found = page.evaluate(walk)
            assert found["levels"].count(1) == 1, route
            assert all(b <= a + 1 for a, b in zip(found["levels"], found["levels"][1:])), (route, found)
            assert found["bad"] == 0, route
        page.goto(app_url + "/references")
        assert tab_order(page, 1) == ["Skip to content"]
        rings = set()
        rings.add(page.evaluate(ring))
        for _ in range(RING_STOPS):
            page.keyboard.press("Tab")
            rings.add(page.evaluate(ring))
        assert len(rings) == 1, rings
        style = rings.pop().split("|")
        assert style[0] != "none" or style[4] != "none"


def test_reflow_at_320(browser, app_url):
    with _live(browser, app_url, width=REFLOW_W, height=PHONE_H, reduced="reduce") as page:
        for route in ("/", "/references", "/programme", "/story", "/contact"):
            page.goto(app_url + route)
            layout(page)


def test_enlarged_targets_images(browser, app_url):
    with _live(browser, app_url + "/references", reduced="reduce") as page:
        _no_cookie(page)
        before = style_size = page.evaluate("() => parseFloat(getComputedStyle(document.documentElement).fontSize)")
        page.evaluate("doubled => { document.documentElement.style.fontSize = doubled + 'px'; }", 2 * before)
        assert page.evaluate("() => parseFloat(getComputedStyle(document.documentElement).fontSize)") == 2 * before
        assert style_size == before
        layout(page)
        for title in (HARBOUR_T, DAIRY_T, PAPER_T):
            link = page.get_by_role("main").get_by_role("link", name=title)
            expect(link).to_be_visible()
            assert link.evaluate("e => e.scrollWidth <= e.clientWidth + 1 || getComputedStyle(e).display === 'inline'")
    targets = """min => { const small = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        for (let n = w.currentNode; n; n = w.nextNode()) {
            if (!['A','BUTTON','INPUT','SELECT','TEXTAREA'].includes(n.tagName)) continue;
            if (n.textContent.trim() === 'Skip to content') continue;
            const s = getComputedStyle(n);
            if (s.display === 'none' || s.visibility === 'hidden') continue;
            const boxes = n.tagName === 'A' ? [...n.getClientRects()] : [n.getBoundingClientRect()];
            const r = n.getBoundingClientRect();
            if (!r.width && !r.height) continue;
            if (boxes.some(b => b.width < min - 0.5 || b.height < min - 0.5))
                small.push(n.textContent.trim() || n.getAttribute('aria-label') || n.tagName);
        } return small; }"""
    with _live(browser, app_url, width=PHONE_W, height=PHONE_H, reduced="reduce") as page:
        for route in ("/", "/references", "/programme", "/story", "/notes", "/contact"):
            page.goto(app_url + route)
            assert page.evaluate(targets, PHONE_MIN_TARGET) == [], route
            missing = page.evaluate("""() => [...document.images].filter(
                i => !i.getAttribute('width') || !i.getAttribute('height')).map(i => i.src)""")
            assert missing == [], route


def _rest_y(page, title, colour):
    seen = []

    def steady():
        _a_frame(page)
        seen.append(title.bounding_box()["y"])
        at_rest = title.evaluate("e => getComputedStyle(e).color") == colour
        return at_rest and len(seen) >= 2 and seen[-1] == seen[-2]
    _wait(steady, HTTP_TIMEOUT, "rest position")
    return seen[-1]


def test_motion_and_reduced_motion(browser, app_url):
    with _live(browser, app_url + "/references") as page:
        _no_cookie(page)
        link = page.get_by_role("main").get_by_role("link", name=DAIRY_T)
        title = link.get_by_text(DAIRY_T)
        if page.evaluate("() => matchMedia('(hover: hover)').matches"):
            rest, hover = state_styles(title, "color")
            assert rest["color"] != hover["color"]
            page.mouse.move(0, 0)
            y_rest = _rest_y(page, title, rest["color"])
            link.hover()
            _wait(lambda: title.bounding_box()["y"] < y_rest, HTTP_TIMEOUT, "row lift")
            assert 0 < y_rest - title.bounding_box()["y"] < link.bounding_box()["height"]
    with _live(browser, app_url, reduced="reduce") as page:
        heading = page.get_by_role("heading", level=1)
        assert _moving(heading) == []
        y0 = heading.bounding_box()["y"]
        _scroll(page, 200)
        assert abs(_focus_settled_y(page, heading) - (y0 - 200)) <= 1
        page.goto(app_url + "/references")
        link = page.get_by_role("main").get_by_role("link", name=DAIRY_T)
        y_before = link.bounding_box()["y"]
        link.hover()
        _a_frame(page)
        assert _moving(link) == []
        assert abs(link.bounding_box()["y"] - y_before) >= 0
        page.goto(app_url + "/programme")
        chapter = page.get_by_role("button", name="Clearance", exact=True)
        below = page.get_by_role("button", name="How long a clearance lasts")
        expect(chapter).to_have_attribute("aria-expanded", "false")

        def gap():
            return below.bounding_box()["y"] - chapter.bounding_box()["y"]
        closed = gap()
        chapter.click()
        expect(chapter).to_have_attribute("aria-expanded", "true")
        opened = gap()
        moving = page.evaluate("""() => document.getAnimations().filter(a => a.playState === 'running'
            && a.effect && a.effect.getKeyframes().some(k => Object.keys(k).some(
                p => /height|transform|translate|scale|top|margin|padding|rows/i.test(p)))).length""")
        assert moving == 0, "the chapter panel still moves under reduced motion"
        assert opened > closed
        settle(page.get_by_role("main"))
        assert abs(gap() - opened) <= 1, "the panel had not reached its end state at once"
        page.goto(app_url + "/references")
        expect(page.get_by_role("region", name="Cookie notice")).to_be_visible()
        assert _moving(page.get_by_role("region", name="Cookie notice")) == []


def test_focus_never_hidden(browser, app_url):
    check = """([header, notice]) => {
        const a = document.activeElement;
        if (!a || a === document.body || header.contains(a) || (notice && notice.contains(a))) return null;
        const r = a.getBoundingClientRect(), h = header.getBoundingClientRect();
        const tall = r.height >= innerHeight / 2;
        const underHeader = r.top < h.bottom - 0.5 && r.bottom > h.top;
        let underNotice = false;
        if (notice && !tall) { const n = notice.getBoundingClientRect();
            underNotice = r.left < n.right && r.right > n.left && r.top < n.bottom && r.bottom > n.top; }
        return underHeader || underNotice ? (a.textContent.trim() || a.tagName) : null; }"""
    sizes = ((DESK_W, DESK_H, False), (PHONE_W, PHONE_H, False), (REFLOW_W, PHONE_H, False), (DESK_W, DESK_H, True))
    for route in ("/references", "/contact"):
        for width, height, doubled in sizes:
            with _live(browser, app_url + route, width=width, height=height, reduced="reduce") as page:
                if doubled:
                    page.evaluate("() => { document.documentElement.style.fontSize = '200%'; }")
                header = page.get_by_role("banner").element_handle()
                notice = page.get_by_role("region", name="Cookie notice").element_handle()
                page.keyboard.press("Tab")
                bad = []
                for _ in range(TAB_STOPS):
                    page.keyboard.press("Tab")
                    hit = page.evaluate(check, [header, notice])
                    if hit:
                        bad.append(hit)
                assert bad == [], (route, width, doubled)
                page.keyboard.press("Shift+Tab")
                page.evaluate("() => { window.scrollTo(0, 0); }")
                page.reload()
                skip_header = page.get_by_role("banner").element_handle()
                page.keyboard.press("Tab")
                page.keyboard.press("Enter")
                assert page.evaluate(
                    "h => document.activeElement === document.body"
                    " || document.activeElement.getBoundingClientRect().top >= h.getBoundingClientRect().bottom - 0.5",
                    skip_header)


def test_live_motion_preference(browser, app_url):
    step = DESK_H

    def travel(page):
        heading = page.get_by_role("heading", level=1)
        strip = page.get_by_role("main").get_by_role("link", name=HARBOUR_T).first
        _scroll(page, 0)
        h0, s0 = _focus_settled_y(page, heading), _focus_settled_y(page, strip)
        most = page.evaluate("() => document.documentElement.scrollHeight - innerHeight")
        distance = min(step, most)
        _scroll(page, distance)
        h1, s1 = _focus_settled_y(page, heading), _focus_settled_y(page, strip)
        return h0 - h1, s0 - s1, distance
    with _live(browser, app_url) as page:
        _no_cookie(page)
        line, strip, _ = travel(page)
        assert strip > 0 and PROMISE_MIN <= line / strip <= PROMISE_MAX, (line, strip)
        heading = page.get_by_role("heading", level=1)
        _scroll(page, step // 2)
        forward = _focus_settled_y(page, heading)
        _scroll(page, 0)
        _focus_settled_y(page, heading)
        _scroll(page, step // 2)
        assert abs(_focus_settled_y(page, heading) - forward) <= 1
        _scroll(page, 0)
        page.evaluate("() => { window.__same = true; }")
        page.emulate_media(reduced_motion="reduce")
        line, _, distance = travel(page)
        assert abs(line - distance) <= 1, "with reduced motion the line sits in the flow"
        assert _moving(heading) == []
        page.emulate_media(reduced_motion="no-preference")
        line, strip, _ = travel(page)
        assert PROMISE_MIN <= line / strip <= PROMISE_MAX
        assert page.evaluate("() => window.__same") is True, "the page reloaded"


def test_wf_cross_cutting_keyboard_start(browser, app_url):
    with _live(browser, app_url + "/references") as page:
        _no_cookie(page)
        page.evaluate("() => { document.activeElement.blur(); }")
        page.reload()
        assert tab_order(page, 1) == ["Skip to content"]
        page.keyboard.press("Enter")
        assert [name.casefold() for name in tab_order(page, 1)] == ["all sectors"]
        marked = page.get_by_role("navigation", name="Sectors").get_by_role("link", name="All sectors")
        expect(marked).to_have_attribute("aria-current", "true")


def test_wf_cross_cutting_narrow_menu(browser, app_url):
    with _live(browser, app_url, width=PHONE_W, height=PHONE_H) as page:
        _no_cookie(page)
        menu = page.get_by_role("button", name="Menu")
        expect(menu).to_have_attribute("aria-expanded", "false")
        menu.click()
        expect(menu).to_have_attribute("aria-expanded", "true")
        layout(page)
        page.get_by_role("navigation", name="Primary").get_by_role("link", name="Notes").click()
        expect(page).to_have_url(re.compile(r"/notes$"))
        expect(page.get_by_role("heading", level=1, name="Notes")).to_be_visible()
        expect(page.get_by_role("button", name="Menu")).to_have_attribute("aria-expanded", "false")
        layout(page)


APP_ROOT = Path("/app")
SKIP_DIRS = {".venv", "node_modules", ".git", "__pycache__"}


def _app_files():
    for path in APP_ROOT.rglob("*"):
        if path.is_file() and not SKIP_DIRS & set(path.relative_to(APP_ROOT).parts):
            yield path


def _shipped_python():
    python = Path(str(DEPLOYED_APP)) / ".venv" / "bin" / "python"
    script = ("import importlib.metadata as m, json;"
              "print(json.dumps([{'name': d.metadata['Name'], 'license': d.metadata.get('License-Expression') or"
              " d.metadata.get('License') or '', 'classifiers': d.metadata.get_all('Classifier') or []}"
              " for d in m.distributions()]))")
    done = subprocess.run([str(python), "-c", script], capture_output=True, text=True, timeout=HTTP_TIMEOUT)
    assert done.returncode == 0, done.stderr
    return [p for p in json.loads(done.stdout) if p["name"].lower() not in {"pip", "setuptools", "wheel"}]


def _norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def test_if_run_manifest():
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert isinstance(manifest["install"], str) and manifest["install"].strip()
    assert isinstance(manifest["serve"], str) and manifest["serve"].strip()
    assert isinstance(manifest["build"], str)


def test_if_user_readme():
    lines = (APP_ROOT / "USER_README.md").read_text().splitlines()
    for email in (CURATOR, STEWARD, WESTHALL):
        index = lines.index(f"Email: {email}")
        assert lines[index + 1] == f"Password: {PASSWORD}"


def test_if_third_party_notices():
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    normalised = _norm(notices)
    for package in _shipped_python():
        assert _norm(package["name"]) in normalised, package["name"]
    assert re.search(r"SIL Open Font License|OFL", notices)


def test_if_licences():
    allowed = re.compile(r"MIT|BSD|Apache|ISC|PSF|Python Software Foundation|MPL|Mozilla Public|LGPL|"
                         r"Lesser General Public", re.I)
    for package in _shipped_python():
        declared = " ".join([package["license"]] + [c for c in package["classifiers"] if c.startswith("License")])
        assert allowed.search(declared), (package["name"], declared)
    assert re.search(r"1\.1", (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text())


def test_if_postgres_only():
    for path in list(_app_files()):
        assert path.suffix not in {".sqlite", ".sqlite3", ".db"}, path
    names = {_norm(p["name"]) for p in _shipped_python()}
    assert not names & {"redis", "pymongo", "memcached", "pymemcache", "mysqlclient", "pymysql"}


def test_if_image_manifest(app_url):
    manifest = (APP_ROOT / "IMAGE_MANIFEST.md").read_text()
    images = {".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg"}
    for path in _app_files():
        if path.suffix.lower() in images:
            assert path.name in manifest, path
    for route in ROUTES:
        for attrs in _tags(_get(app_url, route).text, "img"):
            name = attrs["src"].split("?")[0].rsplit("/", 1)[-1]
            assert name in manifest, name
    assert re.search(r"licen[cs]e", manifest, re.I)


def test_if_postgres_config_unchanged():
    for path in _app_files():
        if re.fullmatch(r"(docker-)?compose.*\.ya?ml", path.name):
            text = path.read_text()
            assert "Postgres".lower() in text.lower(), path
            for forbidden in ("container_name:", "networks:", "volumes:"):
                assert forbidden not in text, (path, forbidden)


def test_if_venv_manifest():
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert ".venv" in manifest["install"]
    assert (Path(str(DEPLOYED_APP)) / ".venv" / "bin" / "python").exists()
    words = shlex.split(manifest["serve"])
    tools = [w for w in words if "=" not in w.split("/")[0]]
    assert tools[0].startswith(".venv/bin/") or re.match(r"(.*/)?python3?$", tools[0]) and "-m" in words
