"""Sessions of the app's own making, and the sign-in sequence."""
import secrets

from . import config, errors, identity
from .db import row, value
from .errors import Refusal


def account_by_email(conn, email):
    return row(
        conn,
        "select id, email, name, role from accounts where lower(email) = lower(%s)",
        (email,),
    )


def account_for_token(conn, token):
    if not token:
        return None
    return row(
        conn,
        "select a.id, a.email, a.name, a.role from sessions s"
        " join accounts a on a.id = s.account_id where s.token = %s",
        (token,),
    )


def issue_session(conn, account_id):
    token = secrets.token_urlsafe(32)
    conn.execute(
        "insert into sessions (token, account_id) values (%s, %s)", (token, account_id)
    )
    return token


def revoke_session(conn, token):
    conn.execute("delete from sessions where token = %s", (token,))


def _locked_out(conn, email):
    recent = value(
        conn,
        "select count(*) from login_failures where email = %s"
        " and created_at > now() - make_interval(secs => %s)",
        (email, config.LOGIN_LOCKOUT_SECONDS),
    )
    return recent >= 5


def sign_in(conn, email, password):
    """Returns a session token, or raises the refusal the rules name."""
    if not isinstance(email, str) or not email.strip():
        raise Refusal(400, "Enter your work email", field="email")
    if not isinstance(password, str) or not password:
        raise Refusal(400, "Enter your passphrase", field="password")
    normalised = email.strip().lower()
    if _locked_out(conn, normalised):
        raise Refusal(429, errors.LOCKED_OUT)
    if identity.monitor.is_up() and not identity.monitor.ensured():
        identity.monitor.ensure_accounts()
    try:
        claims = identity.exchange(normalised, password)
    except identity.Unreachable:
        raise Refusal(503, errors.IDENTITY_DOWN)
    account = None
    if claims is not None:
        account = account_by_email(conn, claims.get("email") or claims.get("preferred_username") or "")
    if account is None:
        conn.execute("insert into login_failures (email) values (%s)", (normalised,))
        raise Refusal(401, errors.BAD_CREDENTIALS)
    conn.execute("delete from login_failures where email = %s", (normalised,))
    return issue_session(conn, account["id"]), account


def safe_next(target):
    """A same-origin path beginning with a single slash, or the queue."""
    if (
        isinstance(target, str)
        and target.startswith("/")
        and not target.startswith("//")
        and "\\" not in target
    ):
        return target
    return "/"
