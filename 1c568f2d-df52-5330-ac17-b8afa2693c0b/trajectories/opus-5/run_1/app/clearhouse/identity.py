"""The identity provider: credential exchange, seeded registration and status."""
import base64
import http.cookiejar
import json
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config
from .seed import ACCOUNTS

TOKEN_URL = "{}/realms/{}/protocol/openid-connect/token".format(
    config.KEYCLOAK_URL, config.KEYCLOAK_REALM
)
AUTH_URL = "{}/realms/{}/protocol/openid-connect/auth".format(
    config.KEYCLOAK_URL, config.KEYCLOAK_REALM
)
STATUS_URL = "{}/realms/{}/.well-known/openid-configuration".format(
    config.KEYCLOAK_URL, config.KEYCLOAK_REALM
)
EXCHANGE_TIMEOUT = 10
POLL_SECONDS = 4
STALE_SECONDS = 10


class Unreachable(Exception):
    pass


def _post_form(url, fields, timeout, opener=None):
    data = urllib.parse.urlencode(fields).encode("utf-8")
    request = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    try:
        open_it = opener.open if opener else urllib.request.urlopen
        with open_it(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as err:
        if err.code >= 500:
            raise Unreachable(str(err))
        return err.code, err.read()
    except Exception as err:
        raise Unreachable(str(err))


def _claims(token):
    body = token.split(".")[1]
    body += "=" * (-len(body) % 4)
    return json.loads(base64.urlsafe_b64decode(body.encode("ascii")))


def exchange(email, password):
    """Swap credentials for the provider's own claims. None when refused."""
    status, body = _post_form(
        TOKEN_URL,
        {
            "grant_type": "password",
            "client_id": config.AUTH_CLIENT_ID,
            "client_secret": config.AUTH_CLIENT_SECRET,
            "username": email,
            "password": password,
            "scope": "openid",
        },
        EXCHANGE_TIMEOUT,
    )
    if status != 200:
        return None
    payload = json.loads(body)
    return _claims(payload.get("id_token") or payload["access_token"])


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _register(email, name, password):
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar), _NoRedirect
    )
    query = urllib.parse.urlencode(
        {
            "client_id": config.AUTH_CLIENT_ID,
            "response_type": "code",
            "scope": "openid",
            "redirect_uri": (config.APP_PUBLIC_URL or "http://localhost") + "/login",
            "state": secrets.token_urlsafe(8),
        }
    )
    try:
        with opener.open(AUTH_URL + "?" + query, timeout=EXCHANGE_TIMEOUT) as response:
            page = response.read().decode("utf-8", "replace")
        link = re.search(r'href="(/realms/[^"]*login-actions/registration[^"]*)"', page)
        if not link:
            return
        start = config.KEYCLOAK_URL + link.group(1).replace("&amp;", "&")
        with opener.open(start, timeout=EXCHANGE_TIMEOUT) as response:
            form = response.read().decode("utf-8", "replace")
        action = re.search(r'action="([^"]+)"', form)
        if not action:
            return
    except Exception:
        return
    first, _, last = name.partition(" ")
    _post_form(
        action.group(1).replace("&amp;", "&"),
        {
            "username": email,
            "email": email,
            "firstName": first,
            "lastName": last or first,
            "password": password,
            "password-confirm": password,
        },
        EXCHANGE_TIMEOUT,
        opener,
    )


class Monitor:
    """Keeps the provider's reachability fresh and the realm seeded."""

    def __init__(self):
        self._up = False
        self._checked = 0.0
        self._was_up = False
        self._ensured = threading.Event()
        self._lock = threading.Lock()

    def _probe(self):
        try:
            with urllib.request.urlopen(STATUS_URL, timeout=2) as response:
                return response.status == 200
        except Exception:
            return False

    def _refresh(self):
        up = self._probe()
        self._up = up
        self._checked = time.monotonic()
        if up and not self._was_up:
            self._was_up = True
            self._ensured.clear()
            self.ensure_accounts()
        elif not up:
            self._was_up = False

    def status(self):
        if time.monotonic() - self._checked > STALE_SECONDS:
            self._refresh()
        return "up" if self._up else "down"

    def is_up(self):
        return self.status() == "up"

    def ensure_accounts(self):
        """Register any seeded account the realm does not hold."""
        from .db import tx, value

        with self._lock:
            if self._ensured.is_set():
                return
            with tx() as conn:
                # One worker registers at a time; the others wait, then confirm.
                value(conn, "select pg_advisory_xact_lock(%s)", (913377,))
                for _, email, name, _role in ACCOUNTS:
                    try:
                        if exchange(email, config.SEED_PASSPHRASE) is None:
                            _register(email, name, config.SEED_PASSPHRASE)
                    except Unreachable:
                        return
            self._ensured.set()

    def ensured(self):
        return self._ensured.is_set()

    def run(self):
        while True:
            try:
                self._refresh()
            except Exception:
                pass
            time.sleep(POLL_SECONDS)


monitor = Monitor()


def start_monitor():
    thread = threading.Thread(target=monitor.run, name="identity", daemon=True)
    thread.start()
