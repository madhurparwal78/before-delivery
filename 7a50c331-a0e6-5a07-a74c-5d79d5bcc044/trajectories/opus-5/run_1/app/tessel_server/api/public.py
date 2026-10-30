"""Health, sign in, the member's own security controls and public forms."""
import datetime
import json
import os

from .. import audit, auth, config, db, mailer, textutil, totp, validate
from ..domain import contact
from ..errors import TesselError, validation_error
from .registry import Route

RESET_EMAIL_WINDOW = datetime.timedelta(minutes=60)
RESET_EMAIL_QUOTA = 3

LOGIN_SPEC = {
    "email": validate.ANY,
    "password": validate.ANY,
    "totp": validate.ANY,
    "recovery_code": validate.ANY,
}


def health(ctx):
    return 200, {"status": "ok"}


def code_host_repo(ctx):
    path = os.path.join(config.FIXTURES_DIR, "code-host-repo.json")
    with open(path, "r", encoding="utf-8") as handle:
        saved = json.load(handle)
    return 200, {
        "full_name": saved["full_name"],
        "stargazers_count": saved["stargazers_count"],
    }


def _member_answer(member, organization):
    return {
        "email": member["email"],
        "role": member["role"],
        "organization": {"name": organization["name"], "plan": organization["plan"]},
    }


def _spend_recovery_code(cur, member_id, code):
    rows = cur.all(
        "SELECT id, code_digest FROM recovery_codes WHERE member_id = %s AND used_at IS NULL",
        (member_id,),
    )
    wanted = auth.digest(code)
    for row in rows:
        if row["code_digest"] == wanted:
            cur.execute(
                "UPDATE recovery_codes SET used_at = %s WHERE id = %s",
                (textutil.now(), row["id"]),
            )
            return True
    return False


def _fail_sign_in(email, code, **parts):
    with db.tx() as cur:
        auth.record_failed_sign_in(cur, email)
    raise TesselError(code, **parts)


def sign_in(email, password, code, recovery_code):
    """The one sign-in path, shared by the API and the sign-in page."""
    email = email.lower()
    with db.tx() as cur:
        pause = auth.sign_in_pause_seconds(cur, email)
    if pause:
        raise TesselError(
            "SIGN_IN_THROTTLED", seconds=pause, headers={"Retry-After": str(pause)}
        )
    with db.tx() as cur:
        member = cur.one(
            """
            SELECT id, email, role, organization_id, password_hash,
                   totp_enabled, totp_secret, totp_last_step
              FROM members WHERE email = %s
            """,
            (email,),
        )
    if member is None or not auth.verify_password(password, member["password_hash"]):
        _fail_sign_in(email, "BAD_CREDENTIALS")
    if member["totp_enabled"]:
        if code is None and recovery_code is None:
            raise TesselError("TOTP_REQUIRED")
        if recovery_code is not None:
            with db.tx() as cur:
                spent = _spend_recovery_code(cur, member["id"], recovery_code)
            if not spent:
                _fail_sign_in(email, "BAD_TOTP")
        else:
            step = totp.matching_step(
                member["totp_secret"], code, member["totp_last_step"]
            )
            if step is None:
                _fail_sign_in(email, "BAD_TOTP")
            with db.tx() as cur:
                cur.execute(
                    "UPDATE members SET totp_last_step = %s WHERE id = %s",
                    (step, member["id"]),
                )
    with db.tx() as cur:
        auth.clear_sign_in_attempts(cur, email)
        token = auth.issue_session(cur, member["id"])
        organization = cur.one(
            "SELECT name, plan FROM organizations WHERE id = %s",
            (member["organization_id"],),
        )
        answer = {"token": token, "member": _member_answer(member, organization)}
    return answer


def login(ctx):
    body = ctx.body
    validate.scan_unknown(body, LOGIN_SPEC)
    validate.scan_unstorable(body)
    email = validate.string(body, "email", "email", 1, 254)
    password = validate.string(body, "password", "password", 1, 200)
    code = validate.string(body, "totp", "totp", 1, 20, required=False)
    recovery = validate.string(
        body, "recovery_code", "recovery_code", 1, 40, required=False
    )
    return 200, sign_in(email, password, code, recovery)


def logout(ctx):
    with db.tx() as cur:
        cur.execute(
            "UPDATE sessions SET revoked_at = %s WHERE id = %s AND revoked_at IS NULL",
            (textutil.now(), ctx.actor.member["session_id"]),
        )
    return 200, {}


def logout_all(ctx):
    with db.tx() as cur:
        rows = cur.all(
            """
            UPDATE sessions SET revoked_at = %s
             WHERE member_id = %s AND revoked_at IS NULL RETURNING id
            """,
            (textutil.now(), ctx.actor.member["id"]),
        )
        audit.write(
            cur,
            ctx.actor.organization_id,
            ctx.actor.email,
            "session.logout_all",
            ctx.actor.email,
            str(len(rows)),
        )
    return 200, {"revoked_sessions": len(rows)}


def change_password(ctx):
    validate.scan_unknown(
        ctx.body, {"current_password": validate.ANY, "new_password": validate.ANY}
    )
    validate.scan_unstorable(ctx.body)
    current = validate.string(
        ctx.body, "current_password", "current_password", 1, 200
    )
    fresh = validate.password(ctx.body, "new_password", "new_password")
    with db.tx() as cur:
        member = cur.one(
            "SELECT id, email, password_hash FROM members WHERE id = %s",
            (ctx.actor.member["id"],),
        )
    if not auth.verify_password(current, member["password_hash"]):
        raise TesselError("BAD_CREDENTIALS")
    if auth.verify_password(fresh, member["password_hash"]):
        raise validation_error("new_password", "Choose a password you have not used")
    with db.tx() as cur:
        cur.execute(
            "UPDATE members SET password_hash = %s WHERE id = %s",
            (auth.hash_password(fresh), member["id"]),
        )
        rows = cur.all(
            """
            UPDATE sessions SET revoked_at = %s
             WHERE member_id = %s AND revoked_at IS NULL AND id <> %s RETURNING id
            """,
            (textutil.now(), member["id"], ctx.actor.member["session_id"]),
        )
        cur.execute(
            """
            UPDATE reset_tokens SET cancelled_at = %s
             WHERE member_id = %s AND used_at IS NULL AND cancelled_at IS NULL
            """,
            (textutil.now(), member["id"]),
        )
        audit.write(
            cur,
            ctx.actor.organization_id,
            ctx.actor.email,
            "member.password",
            ctx.actor.email,
        )
    return 200, {"changed": True, "revoked_sessions": len(rows)}


def request_reset(email):
    """Create and email a reset link for a member, silently otherwise."""
    token = None
    with db.tx() as cur:
        member = cur.one("SELECT id FROM members WHERE email = %s", (email,))
        if member is not None:
            recent = cur.value(
                "SELECT count(*) FROM reset_emails WHERE member_id = %s AND at > %s",
                (member["id"], textutil.now() - RESET_EMAIL_WINDOW),
            )
            if recent < RESET_EMAIL_QUOTA:
                token = auth.new_reset_token()
                cur.execute(
                    """
                    UPDATE reset_tokens SET cancelled_at = %s
                     WHERE member_id = %s AND used_at IS NULL AND cancelled_at IS NULL
                    """,
                    (textutil.now(), member["id"]),
                )
                cur.execute(
                    """
                    INSERT INTO reset_tokens (member_id, token_digest, created_at)
                    VALUES (%s, %s, %s)
                    """,
                    (member["id"], auth.digest(token), textutil.now()),
                )
                cur.execute(
                    "INSERT INTO reset_emails (member_id, at) VALUES (%s, %s)",
                    (member["id"], textutil.now()),
                )
    if token:
        mailer.password_reset_link(email, token)


def forgot(ctx):
    validate.scan_unknown(ctx.body, {"email": validate.ANY})
    validate.scan_unstorable(ctx.body)
    request_reset(validate.email(ctx.body, "email", "email"))
    return 200, {"sent": True}


def apply_reset(token, fresh):
    """Set the password from a live reset token, ending every session."""
    with db.tx() as cur:
        row = cur.one(
            """
            SELECT t.id, t.member_id, m.email, m.organization_id
              FROM reset_tokens t JOIN members m ON m.id = t.member_id
             WHERE t.token_digest = %s AND t.used_at IS NULL AND t.cancelled_at IS NULL
            """,
            (auth.digest(token),),
        )
    if row is None:
        raise TesselError("RESET_TOKEN_INVALID")
    with db.tx() as cur:
        cur.execute(
            "UPDATE reset_tokens SET used_at = %s WHERE id = %s",
            (textutil.now(), row["id"]),
        )
        cur.execute(
            "UPDATE members SET password_hash = %s WHERE id = %s",
            (auth.hash_password(fresh), row["member_id"]),
        )
        cur.execute(
            """
            UPDATE sessions SET revoked_at = %s
             WHERE member_id = %s AND revoked_at IS NULL
            """,
            (textutil.now(), row["member_id"]),
        )
        auth.clear_sign_in_attempts(cur, row["email"])
        audit.write(
            cur,
            row["organization_id"],
            row["email"],
            "member.password_reset",
            row["email"],
        )
    mailer.password_was_reset(row["email"])


def reset(ctx):
    validate.scan_unknown(ctx.body, {"token": validate.ANY, "password": validate.ANY})
    validate.scan_unstorable(ctx.body)
    token = validate.string(ctx.body, "token", "token", 1, 200)
    fresh = validate.password(ctx.body, "password", "password")
    apply_reset(token, fresh)
    return 200, {"reset": True}


def totp_setup(ctx):
    with db.tx() as cur:
        enabled = cur.value(
            "SELECT totp_enabled FROM members WHERE id = %s", (ctx.actor.member["id"],)
        )
        if enabled:
            raise TesselError("TOTP_ALREADY_ON")
        secret = totp.new_secret()
        cur.execute(
            "UPDATE members SET totp_pending_secret = %s WHERE id = %s",
            (secret, ctx.actor.member["id"]),
        )
    return 200, {
        "secret": secret,
        "otpauth_uri": totp.otpauth_uri(ctx.actor.email, secret),
    }


def totp_enable(ctx):
    validate.scan_unknown(ctx.body, {"code": validate.ANY})
    validate.scan_unstorable(ctx.body)
    code = validate.string(ctx.body, "code", "code", 1, 20)
    with db.tx() as cur:
        member = cur.one(
            """
            SELECT id, totp_enabled, totp_pending_secret, totp_last_step
              FROM members WHERE id = %s FOR UPDATE
            """,
            (ctx.actor.member["id"],),
        )
        if member["totp_enabled"]:
            raise TesselError("TOTP_ALREADY_ON")
        secret = member["totp_pending_secret"]
        step = totp.matching_step(secret, code, member["totp_last_step"]) if secret else None
        if step is None:
            raise TesselError("BAD_TOTP")
        cur.execute(
            """
            UPDATE members
               SET totp_enabled = true, totp_secret = %s, totp_pending_secret = NULL,
                   totp_last_step = %s
             WHERE id = %s
            """,
            (secret, step, member["id"]),
        )
        cur.execute("DELETE FROM recovery_codes WHERE member_id = %s", (member["id"],))
        codes = [auth.new_recovery_code() for _ in range(totp.RECOVERY_CODE_COUNT)]
        for value in codes:
            cur.execute(
                "INSERT INTO recovery_codes (member_id, code_digest) VALUES (%s, %s)",
                (member["id"], auth.digest(value)),
            )
        audit.write(
            cur,
            ctx.actor.organization_id,
            ctx.actor.email,
            "member.totp_on",
            ctx.actor.email,
        )
    return 200, {"enabled": True, "recovery_codes": codes}


def totp_disable(ctx):
    validate.scan_unknown(ctx.body, {"code": validate.ANY})
    validate.scan_unstorable(ctx.body)
    code = validate.string(ctx.body, "code", "code", 1, 40)
    with db.tx() as cur:
        member = cur.one(
            """
            SELECT id, totp_enabled, totp_secret, totp_last_step
              FROM members WHERE id = %s FOR UPDATE
            """,
            (ctx.actor.member["id"],),
        )
        if not member["totp_enabled"]:
            raise TesselError("TOTP_NOT_ON")
        step = totp.matching_step(member["totp_secret"], code, member["totp_last_step"])
        if step is None and not _spend_recovery_code(cur, member["id"], code):
            raise TesselError("BAD_TOTP")
        cur.execute(
            """
            UPDATE members
               SET totp_enabled = false, totp_secret = NULL, totp_pending_secret = NULL,
                   totp_last_step = NULL
             WHERE id = %s
            """,
            (member["id"],),
        )
        cur.execute("DELETE FROM recovery_codes WHERE member_id = %s", (member["id"],))
        audit.write(
            cur,
            ctx.actor.organization_id,
            ctx.actor.email,
            "member.totp_off",
            ctx.actor.email,
        )
    return 200, {"enabled": False}


def me(ctx):
    return 200, {
        "email": ctx.actor.email,
        "role": ctx.actor.role,
        "organization": {
            "name": ctx.organization["name"],
            "plan": ctx.organization["plan"],
        },
    }


def contact_message(ctx):
    validate.scan_unknown(ctx.body, contact.SPEC)
    validate.scan_unstorable(ctx.body)
    email, message, website = contact.validate_body(ctx.body)
    with db.tx() as cur:
        contact.store(cur, email, message, website)
    return 201, {"received": True}


def routes():
    return [
        Route("/api/health", "GET", health),
        Route("/api/code-host/repo", "GET", code_host_repo),
        Route("/api/contact", "POST", contact_message, reads_body=True),
        Route("/api/auth/login", "POST", login, reads_body=True),
        Route("/api/auth/logout", "POST", logout, role="viewer", session_only=True),
        Route(
            "/api/auth/logout-all", "POST", logout_all, role="viewer", session_only=True
        ),
        Route(
            "/api/auth/password",
            "POST",
            change_password,
            role="viewer",
            session_only=True,
            reads_body=True,
        ),
        Route("/api/auth/forgot", "POST", forgot, reads_body=True),
        Route("/api/auth/reset", "POST", reset, reads_body=True),
        Route(
            "/api/auth/totp/setup", "POST", totp_setup, role="viewer", session_only=True
        ),
        Route(
            "/api/auth/totp/enable",
            "POST",
            totp_enable,
            role="viewer",
            session_only=True,
            reads_body=True,
        ),
        Route(
            "/api/auth/totp/disable",
            "POST",
            totp_disable,
            role="viewer",
            session_only=True,
            reads_body=True,
        ),
        Route("/api/me", "GET", me, role="viewer", session_only=True),
    ]
