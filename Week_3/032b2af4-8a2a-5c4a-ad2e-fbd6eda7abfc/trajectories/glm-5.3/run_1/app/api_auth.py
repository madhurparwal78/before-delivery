"""Sign up, log in, log out, and the athlete's own account."""
import zoneinfo

from lib import security, store
from lib.errors import ApiError
from web import json_response, route, athlete_self


@route("POST", "/api/auth/signup")
def auth_signup(handler, body, me):
    fields = {}
    email = body.get("email")
    name = body.get("name")
    password = body.get("password")
    if not isinstance(email, str) or "@" not in email or email.startswith("@") \
            or email.endswith("@") or "." not in email.split("@")[-1]:
        fields["email"] = "invalid"
    else:
        email = email.strip().lower()
    if not isinstance(name, str) or not (1 <= len(name.strip()) <= 80):
        fields["name"] = "invalid"
    else:
        name = name.strip()
    if not isinstance(password, str) or len(password) < 8:
        fields["password"] = "invalid"
    if fields:
        raise ApiError(400, "validation", fields)
    if store.one("SELECT 1 AS ok FROM athletes WHERE email=%s", (email,)):
        raise ApiError(409, "email_taken")
    aid = security.new_id("ath")
    with store.conn() as c:
        c.execute(
            """INSERT INTO athletes (id, email, name, password_hash, time_zone)
               VALUES (%s,%s,%s,%s,'UTC')""",
            (aid, email, name, security.hash_password(password)))
        token = security.new_token()
        c.execute("INSERT INTO sessions (token, athlete_id) VALUES (%s,%s)", (token, aid))
    return json_response({"token": token,
                          "athlete": athlete_self(store.one("SELECT * FROM athletes WHERE id=%s", (aid,)))},
                         201)


@route("POST", "/api/auth/login")
def auth_login(handler, body, me):
    email = (body.get("email") or "").strip().lower() if isinstance(body.get("email"), str) else ""
    password = body.get("password")
    row = store.one("SELECT * FROM athletes WHERE email=%s", (email,)) if email else None
    if not row or not isinstance(password, str) or not security.check_password(password, row["password_hash"]):
        raise ApiError(401, "unauthorized")
    token = security.new_token()
    store.execute("INSERT INTO sessions (token, athlete_id) VALUES (%s,%s)", (token, row["id"]))
    return json_response({"token": token, "athlete": athlete_self(row)})


@route("POST", "/api/auth/logout")
def auth_logout(handler, body, me):
    auth = handler.headers.get("Authorization", "")
    token = auth[7:].strip() if auth.startswith("Bearer ") else ""
    if token:
        store.execute("DELETE FROM sessions WHERE token=%s", (token,))
    return 204, [], b""


@route("GET", "/api/me")
def me_get(handler, body, me):
    return json_response({"athlete": athlete_self(me)})


@route("PATCH", "/api/me")
def me_patch(handler, body, me):
    fields = {}
    updates = {}
    if "name" in body:
        name = body.get("name")
        if not isinstance(name, str) or not (1 <= len(name.strip()) <= 80):
            fields["name"] = "invalid"
        else:
            updates["name"] = name.strip()
    if "time_zone" in body:
        tz = body.get("time_zone")
        try:
            zoneinfo.ZoneInfo(tz)
            updates["time_zone"] = tz
        except Exception:
            fields["time_zone"] = "invalid"
    if fields:
        raise ApiError(400, "validation", fields)
    if updates:
        sets = ", ".join(f"{k}=%s" for k in updates)
        store.execute(f"UPDATE athletes SET {sets} WHERE id=%s", (*updates.values(), me["id"]))
    return json_response({"athlete": athlete_self(store.one("SELECT * FROM athletes WHERE id=%s", (me["id"],)))})


@route("DELETE", "/api/me")
def me_delete(handler, body, me):
    password = body.get("password")
    if not isinstance(password, str) or not security.check_password(password, me["password_hash"]):
        raise ApiError(403, "wrong_password")
    store.execute("DELETE FROM athletes WHERE id=%s", (me["id"],))
    return 204, [], b""
