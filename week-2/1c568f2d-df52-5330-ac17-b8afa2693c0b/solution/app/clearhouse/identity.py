"""The identity provider: the server-side password exchange, the reachability watcher behind `identity` in
health, and the registration of the seeded accounts through the realm's own registration form."""

import base64
import html
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from .config import settings
from .db import transaction
from .seed import ACCOUNTS, PASSPHRASE

CONTACT_TIMEOUT = 10
WATCH_INTERVAL = 4


class Unreachable(Exception):
    """The provider did not answer within the time limit."""


def _post_form(url: str, form: dict, cookie: str = "") -> tuple[int, bytes]:
    headers = {"Content-Type": "application/x-www-form-urlencoded"} | ({"Cookie": cookie} if cookie else {})
    request = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode(), method="POST", headers=headers)
    try:
        with _opener.open(request, timeout=CONTACT_TIMEOUT) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    except (urllib.error.URLError, OSError) as error:
        raise Unreachable(str(error)) from error


def exchange(email: str, password: str) -> str | None:
    """The email the provider vouches for, or None when it rejects the credentials."""
    status, raw = _post_form(f"{settings.issuer_url}/protocol/openid-connect/token", {
        "grant_type": "password", "client_id": settings.client_id, "client_secret": settings.client_secret,
        "username": email, "password": password, "scope": "openid email profile"})
    watcher.observe(up=status < 500)
    if status >= 500:
        raise Unreachable(f"provider answered {status}")
    if status != 200:
        return None
    token = json.loads(raw)["access_token"]
    payload = token.split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    return (claims.get("email") or claims.get("preferred_username") or "").lower() or None


def register(email: str, name: str) -> None:
    """Create the account through the realm's self-registration form, as a person would. The provider marks its
    session cookie Secure even on plain http, so the cookie is carried by hand rather than by a cookie jar."""
    query = urllib.parse.urlencode({"client_id": settings.client_id, "response_type": "code", "scope": "openid",
                                    "redirect_uri": f"{settings.public_url}/login"})
    try:
        with _opener.open(f"{settings.issuer_url}/protocol/openid-connect/registrations?{query}",
                          timeout=CONTACT_TIMEOUT) as response:
            page = response.read().decode()
            cookie = "; ".join(c.split(";", 1)[0] for c in response.headers.get_all("Set-Cookie") or [])
    except (urllib.error.URLError, OSError) as error:
        raise Unreachable(str(error)) from error
    action = re.search(r'<form[^>]*id="kc-register-form"[^>]*action="([^"]+)"', page)
    if not action:
        return
    first, _, last = name.partition(" ")
    _post_form(html.unescape(action[1]), {
        "firstName": first, "lastName": last, "email": email, "username": email,
        "password": PASSPHRASE, "password-confirm": PASSPHRASE}, cookie)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # the registration finishes by redirecting to the app
        return None


_opener = urllib.request.build_opener(_NoRedirect())


def ensure_accounts() -> None:
    """Every seeded account exists in the realm; serialised across workers and instances."""
    with transaction() as tx:
        tx.run("SELECT pg_advisory_xact_lock(hashtext('clearhouse:realm-accounts'))")
        for email, name, _ in ACCOUNTS:
            if exchange(email, PASSPHRASE) is None:
                register(email, name)


class Watcher:
    """Keeps a fresh answer to "is the provider reachable", and re-registers accounts after each outage."""

    def __init__(self) -> None:
        self.up = False
        self.checked = 0.0
        self.synced = False
        self.lock = threading.Lock()

    def observe(self, *, up: bool) -> None:
        with self.lock:
            if not up:
                self.synced = False
            self.up, self.checked = up, time.monotonic()

    def status(self) -> str:
        return "up" if self.up and time.monotonic() - self.checked <= 10 else "down"

    def probe(self) -> None:
        try:
            with urllib.request.urlopen(f"{settings.issuer_url}/.well-known/openid-configuration",
                                        timeout=3) as response:
                self.observe(up=response.status == 200)
        except (urllib.error.URLError, OSError):
            self.observe(up=False)
        if self.up and not self.synced:
            try:
                ensure_accounts()
                self.synced = True
            except Unreachable:
                self.observe(up=False)

    def run(self) -> None:
        while True:
            try:
                self.probe()
            except Exception as error:  # the watcher must outlive any single failed round
                print(f"[clearhouse] identity watcher: {error}", flush=True)
            time.sleep(WATCH_INTERVAL)

    def start(self) -> None:
        threading.Thread(target=self.run, name="identity-watcher", daemon=True).start()


watcher = Watcher()
