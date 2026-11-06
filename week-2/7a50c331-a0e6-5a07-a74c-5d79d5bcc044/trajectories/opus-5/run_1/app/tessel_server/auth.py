"""Credentials: passwords, session tokens, API keys and the sign-in pause."""
import datetime
import hashlib
import hmac
import secrets

from . import db, textutil
from .errors import TesselError

ROLE_ORDER = {"viewer": 0, "editor": 1, "owner": 2}
PBKDF2_ROUNDS = 120_000
SIGN_IN_WINDOW = datetime.timedelta(minutes=15)
SIGN_IN_LIMIT = 10


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return "pbkdf2_sha256$%d$%s$%s" % (PBKDF2_ROUNDS, salt.hex(), digest.hex())


def verify_password(password, stored):
    try:
        _, rounds, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_session_token():
    return secrets.token_hex(32)


def new_key_secret():
    return "tsl_" + secrets.token_hex(20)


def new_reset_token():
    return secrets.token_hex(32)


def new_recovery_code():
    return "%04x-%04x" % (secrets.randbelow(0x10000), secrets.randbelow(0x10000))


def issue_session(cur, member_id):
    token = new_session_token()
    cur.execute(
        "INSERT INTO sessions (member_id, token_digest, created_at) VALUES (%s, %s, %s)",
        (member_id, digest(token), textutil.now()),
    )
    return token


class Actor:
    """The caller of a signed-in route: a member session or an API key."""

    def __init__(self, kind, role, organization, member=None, key=None, scope=None):
        self.kind = kind
        self.role = role
        self.organization = organization
        self.member = member
        self.key = key
        self.scope = scope

    @property
    def is_key(self):
        return self.kind == "key"

    @property
    def organization_id(self):
        return self.organization["id"]

    @property
    def email(self):
        return self.member["email"] if self.member else None

    def at_least(self, role):
        return ROLE_ORDER[self.role] >= ROLE_ORDER[role]


def _organization(cur, organization_id):
    return cur.one(
        "SELECT id, name, plan, created_at FROM organizations WHERE id = %s",
        (organization_id,),
    )


def resolve_session(token):
    """Look up a live session by its token, or return None."""
    with db.tx() as cur:
        row = cur.one(
            """
            SELECT m.id AS member_id, m.email, m.role, m.organization_id, s.id AS session_id
              FROM sessions s JOIN members m ON m.id = s.member_id
             WHERE s.token_digest = %s AND s.revoked_at IS NULL
            """,
            (digest(token),),
        )
        if row is None:
            return None
        organization = _organization(cur, row["organization_id"])
    return Actor(
        "session",
        row["role"],
        organization,
        member={
            "id": row["member_id"],
            "email": row["email"],
            "role": row["role"],
            "session_id": row["session_id"],
        },
    )


def resolve_key(secret):
    """Look up a live API key by its secret, or return None."""
    with db.tx() as cur:
        row = cur.one(
            """
            SELECT id, organization_id, name, role, prefix, scope_all, revoked_at
              FROM api_keys WHERE secret_digest = %s
            """,
            (digest(secret),),
        )
        if row is None or row["revoked_at"] is not None:
            return None
        organization = _organization(cur, row["organization_id"])
        scope = None
        if not row["scope_all"]:
            scope = [
                item["database_id"]
                for item in cur.all(
                    "SELECT database_id FROM api_key_databases WHERE key_id = %s",
                    (row["id"],),
                )
            ]
        cur.execute(
            "UPDATE api_keys SET last_used_at = %s WHERE id = %s",
            (textutil.now(), row["id"]),
        )
    return Actor("key", row["role"], organization, key=row, scope=scope)


def resolve_credential(request):
    """Resolve the Authorization header, refusing an absent or dead credential."""
    header = request.header("Authorization") or ""
    if not header.startswith("Bearer "):
        raise TesselError("UNAUTHENTICATED")
    token = header[len("Bearer ") :].strip()
    if not token:
        raise TesselError("UNAUTHENTICATED")
    actor = resolve_key(token) if token.startswith("tsl_") else resolve_session(token)
    if actor is None:
        raise TesselError("INVALID_API_KEY")
    return actor


def require_role(actor, role, session_only=False):
    if session_only and actor.is_key:
        raise TesselError("FORBIDDEN_ROLE")
    if not actor.at_least(role):
        raise TesselError("FORBIDDEN_ROLE")


def sign_in_pause_seconds(cur, email):
    """Seconds left of this email's sign-in pause, or 0."""
    since = textutil.now() - SIGN_IN_WINDOW
    rows = cur.all(
        "SELECT at FROM sign_in_attempts WHERE email = %s AND at > %s ORDER BY at",
        (email, since),
    )
    if len(rows) < SIGN_IN_LIMIT:
        return 0
    oldest = rows[-SIGN_IN_LIMIT]["at"]
    remaining = (oldest + SIGN_IN_WINDOW - textutil.now()).total_seconds()
    return max(1, min(900, int(remaining) + 1))


def record_failed_sign_in(cur, email):
    cur.execute(
        "INSERT INTO sign_in_attempts (email, at) VALUES (%s, %s)",
        (email, textutil.now()),
    )


def clear_sign_in_attempts(cur, email):
    cur.execute("DELETE FROM sign_in_attempts WHERE email = %s", (email,))
