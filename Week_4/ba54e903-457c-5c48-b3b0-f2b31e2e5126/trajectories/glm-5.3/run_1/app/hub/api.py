"""API endpoints: every path in the endpoint table, sharing one error helper."""
from __future__ import annotations

import asyncio
import datetime as _dt
import hashlib
import urllib.parse
import json
import math
import re
import secrets
import string
import unicodedata
from typing import Any, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse

from . import auth as auth_mod
from .auth import require_member, resolve_bearer
from .config import Config
from .db import Database
from .errors import ApiError, conflict, forbidden, method_not_allowed, not_found, rate_limited, unauthorized, validation, dumps
from .requesthelp import check_origin, check_query_value, field_nul, parse_json_body
from .media_probe import sniff_content_type, png_size, jpeg_size, gif_size, webp_size, webm_size_duration
from .rules import (
    ALL_PERMISSIONS, APP_ICONS, CATEGORIES, DEFAULT_ROLE_PERMISSIONS, GAME_CATEGORIES,
    TIER_ENTITLEMENTS, TIER_MESSAGE_LIMIT, TIER_NAMES, TIER_PRICES, TIER_UPLOAD_LIMITS,
    clean_upload_filename, effective_permissions, has_control_chars, iso_seconds,
    iso_seconds_or_none, normalize_display_name, presence_seen, public_user, self_user,
    validate_community_name, validate_date_of_birth, validate_emoji, validate_email,
    validate_password, validate_slug, validate_username,
)

# ---------------------------------------------------------------------------
# shared response helpers


def api_json(payload, status: int = 200, headers: Optional[dict] = None) -> JSONResponse:
    return JSONResponse(payload, status_code=status, headers=headers or {})


def no_store(resp: JSONResponse) -> JSONResponse:
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Vary"] = "Authorization"
    return resp


def require_session(request: Request) -> dict:
    member = resolve_bearer(request)
    if member is None:
        raise unauthorized()
    return member


def state(request: Request):
    return request.app.state.hub


def db_of(request: Request) -> Database:
    return request.app.state.hub.db


def config_of(request: Request) -> Config:
    return request.app.state.hub.config


async def guard(request: Request, *, write: bool = False) -> None:
    """Route, origin and body-envelope steps of the error precedence."""
    if write or request.method in ("POST", "PUT", "PATCH", "DELETE"):
        check_origin(request, config_of(request).public_origin)


def bool_query(request: Request, name: str, default: Optional[bool] = False) -> Optional[bool]:
    raw = request.query_params.get(name)
    if raw is None or raw == "":
        return default
    if raw == "true":
        return True
    if raw == "false":
        return False
    raise validation(name)


def int_query(request: Request, name: str, default: int, lo: int, hi: int) -> int:
    raw = request.query_params.get(name)
    if raw is None or raw == "":
        return default
    raw = check_query_value(name, raw)
    if not re.fullmatch(r"-?[0-9]+", raw or ""):
        raise validation(name)
    value = int(raw)
    if value < lo or value > hi:
        raise validation(name)
    return value


# ---------------------------------------------------------------------------
# community and permission loading (single source of truth for reads)


def load_community(db: Database, slug: str, *, published_required: bool = False) -> Optional[dict]:
    if not slug or has_control_chars(slug) or "\x00" in slug:
        return None
    return db.one("SELECT * FROM communities WHERE slug = %s", (slug,))


def membership_of(db: Database, member_id: int, community_id: int) -> Optional[dict]:
    return db.one(
        "SELECT * FROM memberships WHERE member_id = %s AND community_id = %s",
        (member_id, community_id),
    )


def is_banned(db: Database, member_id: int, community_id: int) -> bool:
    return db.one(
        "SELECT 1 AS x FROM bans WHERE community_id = %s AND member_id = %s",
        (community_id, member_id),
    ) is not None


def community_permissions(db: Database, member_id: int, community: dict, membership: Optional[dict]) -> set:
    """Union of the default role and every held role; the owner holds every key."""
    if membership is None:
        return set()
    if community["owner_id"] == member_id:
        return set(ALL_PERMISSIONS)
    rows = db.all(
        """SELECT r.permissions FROM member_roles mr
           JOIN roles r ON r.id = mr.role_id
           WHERE mr.member_id = %s AND mr.community_id = %s""",
        (member_id, community["id"]),
    )
    perms = set(DEFAULT_ROLE_PERMISSIONS)
    for row in rows:
        perms |= set(row["permissions"] or [])
    return perms


def rank_of(db: Database, member_id: int, community_id: int, owner_id: Optional[int]) -> int:
    """Highest role position held; the owner ranks above everyone."""
    if owner_id == member_id:
        return 1 << 30
    row = db.one(
        """SELECT COALESCE(MAX(r.position), 0) AS top FROM member_roles mr
           JOIN roles r ON r.id = mr.role_id
           WHERE mr.member_id = %s AND mr.community_id = %s""",
        (member_id, community_id),
    )
    return row["top"] if row else 0


def channel_overwrites_for(db: Database, channel_id: int) -> list:
    return db.all(
        "SELECT * FROM channel_overwrites WHERE channel_id = %s",
        (channel_id),
    )


def channel_effective_permissions(
    db: Database, *, community: dict, channel: dict, member_id: int, now=None
) -> set:
    """Effective permissions as they stand at this moment, in one place (DP-27)."""
    membership = membership_of(db, member_id, community["id"])
    if membership is None:
        return set()
    perms = community_permissions(db, member_id, community, membership)
    if community["owner_id"] == member_id:
        return set(ALL_PERMISSIONS)
    overwrites = channel_overwrites_for(db, channel["id"])
    default_role_id = db.one(
        "SELECT id FROM roles WHERE community_id = %s AND is_default = TRUE", (community["id"],)
    )
    default_over = None
    role_over = []
    member_over = None
    held_role_ids = {
        row["role_id"] for row in db.all(
            "SELECT role_id FROM member_roles WHERE member_id = %s AND community_id = %s",
            (member_id, community["id"]),
        )
    }
    for over in overwrites:
        allow = set(over["allow"] or [])
        deny = set(over["deny"] or [])
        if over["target_type"] == "role" and default_role_id and over["target_id"] == default_role_id["id"]:
            default_over = (deny, allow)
        elif over["target_type"] == "role" and over["target_id"] in held_role_ids:
            role_over.append((deny, allow))
        elif over["target_type"] == "member" and over["target_id"] == member_id:
            member_over = (deny, allow)
    timed_out = False
    disabled = membership.get("communication_disabled_until")
    if disabled is not None and now is not None:
        timed_out = now < disabled
    return effective_permissions(
        is_owner=community["owner_id"] == member_id,
        community_permissions=perms,
        default_role_overwrite=default_over,
        role_overwrites=role_over,
        member_overwrite=member_over,
        timed_out=timed_out,
    )


def viewable_text_channels(db: Database, community: dict, member_id: int) -> list:
    """Channels the caller may view, in position order, with permissions per channel."""
    channels = db.all(
        "SELECT * FROM channels WHERE community_id = %s ORDER BY position ASC, id ASC",
        (community["id"],),
    )
    now = db.one("SELECT now() AS now")["now"]
    out = []
    for channel in channels:
        perms = channel_effective_permissions(db, community=community, channel=channel, member_id=member_id, now=now)
        if channel["type"] == "text" or perms:
            if "view_channel" in perms:
                out.append({**channel, "permissions": perms})
    return out


# ---------------------------------------------------------------------------
# accounts


async def api_health(request: Request) -> Response:
    db = db_of(request)
    if db.ready:
        return api_json({"status": "ok"})
    return api_json({"status": "starting"}, status=503)


async def api_signup(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    cfg = config_of(request)
    body = await parse_json_body(request)
    email = validate_email(body.get("email")) if "email" in body else None
    display_name = normalize_display_name(body.get("display_name")) if "display_name" in body else None
    username = validate_username(body.get("username")) if "username" in body else None
    password = body.get("password")
    dob = body.get("date_of_birth")
    if not email:
        raise validation("email")
    if not display_name:
        raise validation("display_name")
    if not username:
        raise validation("username")
    if not validate_password(password):
        raise validation("password")
    if not validate_date_of_birth(dob):
        raise validation("date_of_birth")
    with db.session() as conn:
        with conn.transaction():
            existing_email = conn.execute("SELECT id FROM members WHERE email = %s", (email,)).fetchone()
            if existing_email:
                raise conflict("email")
            existing_user = conn.execute("SELECT id FROM members WHERE username = %s", (username,)).fetchone()
            if existing_user:
                raise conflict("username")
            row = conn.execute(
                """INSERT INTO members (email, email_verified, username, display_name, avatar_url,
                       password_hash, date_of_birth, status, tier, app_icon)
                   VALUES (%s, FALSE, %s, %s, %s, %s, %s, 'online', 'free', 'classic')
                   RETURNING *""",
                (email, username, display_name, avatar_for(username), hash_password(password), dob),
            ).fetchone()
            token = secrets.token_hex(16) + "-" + secrets.token_hex(16)
            conn.execute(
                "INSERT INTO tokens (token_hash, member_id) VALUES (%s, %s)",
                (sha256_hex(token), row["id"]),
            )
            queue_confirmation_email(conn, cfg, row, new=True)
    resp = api_json({"access_token": token, "token_type": "bearer", "user": self_user(row)}, status=201)
    return no_store(resp)


def avatar_for(username: str) -> str:
    digest = hashlib.sha256(username.encode()).hexdigest()
    return f"/static/gen/avatar-{int(digest[:8], 16) % 4 + 1}.svg"


def sha256_hex(value: str) -> str:
    import hashlib
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    from .secrets import hash_password as hp
    return hp(password)


def queue_confirmation_email(conn, cfg: Config, member: dict, *, new: bool) -> None:
    """Supersede earlier tokens, then queue one confirmation email (DP-03, DP-06)."""
    from .secrets import new_confirmation_token
    token = new_confirmation_token()
    conn.execute(
        "UPDATE email_tokens SET superseded_at = now() WHERE member_id = %s AND superseded_at IS NULL AND used_at IS NULL",
        (member["id"],),
    )
    conn.execute(
        """INSERT INTO email_tokens (member_id, token_digest, expires_at)
           VALUES (%s, %s, now() + (%s * INTERVAL '1 second'))""",
        (member["id"], sha256_hex(token), cfg.email_token_ttl_seconds),
    )
    link = f"{cfg.public_origin}/verify-email?token={token}"
    body = (
        f"Hi {member['display_name']}, confirm your email for @{member['username']}.\n"
        f"Confirm your address: {link}"
    )
    conn.execute(
        "INSERT INTO outbox (recipient, recipient_name, subject, body) VALUES (%s, %s, %s, %s)",
        (member["email"], member["display_name"], "Confirm your Community Hub account", body),
    )


async def api_login(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    cfg = config_of(request)
    body = await parse_json_body(request)
    email_raw = body.get("email")
    password = body.get("password")
    if not isinstance(email_raw, str) or not email_raw.strip():
        raise validation("email")
    if not isinstance(password, str) or not password:
        raise validation("password")
    email = email_raw.strip().lower()
    with db.session() as conn:
        lock_info = check_lockout(conn, email, cfg.login_lockout_seconds)
        if lock_info["locked"]:
            raise rate_limited(lock_info["retry_after"])
        member = conn.execute("SELECT * FROM members WHERE email = %s", (email,)).fetchone()
        if member is None or not verify_password(password, member["password_hash"]):
            record_login_failure(conn, email)
            raise ApiError("invalid_credentials")
        clear_login_failures(conn, email)
        token = secrets.token_hex(16) + "-" + secrets.token_hex(16)
        conn.execute("INSERT INTO tokens (token_hash, member_id) VALUES (%s, %s)",
                     (sha256_hex(token), member["id"]))
    resp = api_json({"access_token": token, "token_type": "bearer", "user": self_user(member)}, status=200)
    return no_store(resp)


def verify_password(password: str, stored: str) -> bool:
    from .secrets import verify_password as vp
    return vp(password, stored)


def check_lockout(conn, email: str, window: int) -> dict:
    row = conn.execute(
        """SELECT COUNT(*) AS n, MAX(failed_at) AS last FROM login_failures
           WHERE email = %s AND failed_at > now() - (%s * INTERVAL '1 second')""",
        (email, window),
    ).fetchone()
    count = row["n"] if row else 0
    if count >= 5:
        fifth = conn.execute(
            """SELECT failed_at FROM login_failures WHERE email = %s
               AND failed_at > now() - (%s * INTERVAL '1 second')
               ORDER BY failed_at ASC OFFSET 4 LIMIT 1""",
            (email, window),
        ).fetchone()
        if fifth is None:
            return {"locked": False, "retry_after": 0}
        end = fifth["failed_at"] + _dt.timedelta(seconds=window)
        now = conn.execute("SELECT now() AS now").fetchone()["now"]
        remaining = (end - now).total_seconds()
        if remaining > 0:
            return {"locked": True, "retry_after": max(1, math.ceil(remaining))}
    return {"locked": False, "retry_after": 0}


def record_login_failure(conn, email: str) -> None:
    conn.execute("INSERT INTO login_failures (email) VALUES (%s)", (email,))


def clear_login_failures(conn, email: str) -> None:
    conn.execute("DELETE FROM login_failures WHERE email = %s", (email,))


async def api_verify_email(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    body = await parse_json_body(request)
    token = body.get("token")
    if not isinstance(token, str) or not token:
        raise validation("token")
    if "\x00" in token:
        raise validation("token")
    with db.session() as conn:
        row = conn.execute(
            """SELECT * FROM email_tokens WHERE token_digest = %s AND used_at IS NULL
               AND superseded_at IS NULL AND expires_at > now()""",
            (sha256_hex(token),),
        ).fetchone()
        if row is None:
            raise validation("token")
        with conn.transaction():
            claimed = conn.execute(
                "UPDATE email_tokens SET used_at = now() WHERE id = %s AND used_at IS NULL RETURNING id",
                (row["id"],),
            ).fetchone()
            if claimed is None:
                raise validation("token")
            conn.execute("UPDATE members SET email_verified = TRUE WHERE id = %s", (row["member_id"],))
    return no_store(api_json({"email_verified": True}))


async def api_resend_confirmation(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    cfg = config_of(request)
    member = require_session(request)
    with db.session() as conn:
        if member["email_verified"]:
            raise conflict()
        with conn.transaction():
            queue_confirmation_email(conn, cfg, member, new=False)
    return Response(status_code=204, headers={"Cache-Control": "no-store", "Vary": "Authorization"})


async def api_logout(request: Request) -> Response:
    await guard(request, write=True)
    member = require_session(request)
    db = db_of(request)
    header = request.headers.get("authorization") or ""
    token = header[7:].strip()
    with db.session() as conn:
        conn.execute("UPDATE tokens SET revoked_at = now() WHERE token_hash = %s", (sha256_hex(token),))
    return Response(status_code=204, headers={"Cache-Control": "no-store", "Vary": "Authorization"})


async def api_me_get(request: Request) -> Response:
    member = require_session(request)
    return no_store(api_json(self_user(member)))


async def api_me_patch(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    body = await parse_json_body(request)
    updates = {}
    if "display_name" in body:
        name = normalize_display_name(body.get("display_name"))
        if not name:
            raise validation("display_name")
        if field_nul(body.get("display_name")):
            raise validation("display_name")
        updates["display_name"] = name
    if "status" in body:
        if body.get("status") not in ("online", "idle", "dnd", "invisible"):
            raise validation("status")
        updates["status"] = body["status"]
    if "app_icon" in body:
        icon = body.get("app_icon")
        if icon not in APP_ICONS:
            raise validation("app_icon")
        if icon != "classic" and "custom_app_icons" not in TIER_ENTITLEMENTS.get(member["tier"], []):
            raise ApiError("entitlement_required")
        updates["app_icon"] = icon
    if updates:
        sets = ", ".join(f"{k} = %s" for k in updates)
        with db.session() as conn:
            row = conn.execute(
                f"UPDATE members SET {sets} WHERE id = %s RETURNING *",
                tuple(updates.values()) + (member["id"],),
            ).fetchone()
        if "status" in updates:
            publish_status_change(db, member["id"], updates["status"])
        member = row
    return no_store(api_json(self_user(member)))


def publish_status_change(db: Database, member_id: int, status: str) -> None:
    """A status change reaches every community the member belongs to (DP-66)."""
    from .rules import public_user
    rows = db.all(
        "SELECT community_id FROM memberships WHERE member_id = %s", (member_id,)
    )
    member = db.one("SELECT * FROM members WHERE id = %s", (member_id,))
    payload = json.dumps({
        "type": "presence_update",
        "data": {"user": public_user(member), "status": presence_seen(status)},
    })
    for row in rows:
        recipients = db.all(
            "SELECT member_id FROM memberships WHERE community_id = %s", (row["community_id"],)
        )
        for r in recipients:
            if r["member_id"] != member_id:
                db.execute(
                    "INSERT INTO live_events (recipient_id, payload) VALUES (%s, %s)",
                    (r["member_id"], payload),
                )


async def api_password_change(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    cfg = config_of(request)
    member = require_session(request)
    body = await parse_json_body(request)
    current = body.get("current_password")
    new = body.get("new_password")
    if not isinstance(current, str):
        raise validation("current_password")
    if not validate_password(new):
        raise validation("new_password")
    if new == current:
        raise validation("new_password")
    with db.session() as conn:
        with conn.transaction():
            if not verify_password(current, member["password_hash"]):
                raise validation("current_password")
            claimed = conn.execute(
                "UPDATE members SET password_hash = %s WHERE id = %s AND password_hash = %s RETURNING id",
                (hash_password(new), member["id"], member["password_hash"]),
            ).fetchone()
            if claimed is None:
                raise validation("current_password")
            header = request.headers.get("authorization") or ""
            token = header[7:].strip()
            conn.execute(
                """UPDATE tokens SET revoked_at = now()
                   WHERE member_id = %s AND token_hash != %s AND revoked_at IS NULL""",
                (member["id"], sha256_hex(token)),
            )
            body_text = "Your Community Hub password was changed. If this was not you, reset it from settings."
            conn.execute(
                "INSERT INTO outbox (recipient, recipient_name, subject, body) VALUES (%s, %s, %s, %s)",
                (member["email"], member["display_name"], "Your Community Hub password was changed", body_text),
            )
    return Response(status_code=204, headers={"Cache-Control": "no-store", "Vary": "Authorization"})


# ---------------------------------------------------------------------------
# directory and communities


def community_counts(db: Database, community_id: int) -> tuple:
    row = db.one(
        """SELECT
             c.member_baseline + (SELECT COUNT(*) FROM memberships ms WHERE ms.community_id = c.id) AS members,
             c.online_baseline + (SELECT COUNT(*) FROM memberships ms JOIN members m ON m.id = ms.member_id
                 WHERE ms.community_id = c.id AND m.status IN ('online','idle','dnd')) AS online
           FROM communities c WHERE c.id = %s""",
        (community_id,),
    )
    return int(row["members"]), int(row["online"])


def community_shape(db: Database, c: dict) -> dict:
    members, online = community_counts(db, c["id"])
    return {
        "id": c["id"],
        "slug": c["slug"],
        "name": c["name"],
        "description": c["description"],
        "icon_url": c["icon_url"],
        "splash_url": c["splash_url"],
        "banner_url": c["banner_url"],
        "category": c["category"],
        "keywords": c["keywords"] or [],
        "verified": c["published"] and c["verified"],
        "partnered": c["published"] and c["partnered"],
        "presence_count": online,
        "member_count": members,
        "owner_id": c["owner_id"],
        "verification_level": c["verification_level"],
    }


def escape_like(text: str) -> str:
    """Literal directory search: %, _ and \\ match only themselves (DP-77)."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def api_servers_list(request: Request) -> Response:
    db = db_of(request)
    q_raw = request.query_params.get("q")
    category = request.query_params.get("category", "all")
    page = int_query(request, "page", 1, 1, 1000)
    per_page = int_query(request, "per_page", 12, 1, 50)
    q = ""
    if q_raw is not None:
        q = check_query_value("q", q_raw)
    if category not in CATEGORIES:
        raise validation("category")
    with db.session() as conn:
        args: list = []
        where = ["published = TRUE"]
        if q.strip():
            trimmed = q.strip()
            if len(trimmed) > 100:
                raise validation("q")
            like = "%" + escape_like(trimmed.lower()) + "%"
            where.append("(LOWER(name) LIKE %s ESCAPE '\\' OR LOWER(description) LIKE %s ESCAPE '\\' OR EXISTS (SELECT 1 FROM unnest(keywords) k WHERE LOWER(k) LIKE %s ESCAPE '\\'))")
            args.extend([like, like, like])
        if category != "all":
            where.append("category = %s")
            args.append(category)
        where_sql = " AND ".join(where)
        total_row = conn.execute(f"SELECT COUNT(*) AS n FROM communities WHERE {where_sql}", tuple(args)).fetchone()
        total = int(total_row["n"])
        offset = (page - 1) * per_page
        rows = conn.execute(
            f"""SELECT * FROM communities WHERE {where_sql}
                ORDER BY (member_baseline + (SELECT COUNT(*) FROM memberships ms WHERE ms.community_id = communities.id)) DESC,
                         slug ASC
                OFFSET %s LIMIT %s""",
            tuple(args) + (offset, per_page),
        ).fetchall()
    data = [community_shape(db, r) for r in rows]
    return api_json({"data": data, "page": page, "per_page": per_page, "total": total})


async def api_server_detail(request: Request) -> Response:
    db = db_of(request)
    slug = request.path_params["slug"]
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    member = resolve_bearer(request)
    membership = membership_of(db, member["id"], c["id"]) if member else None
    if not c["published"] and membership is None:
        raise not_found()
    shape = community_shape(db, c)
    default_role_id = db.one(
        "SELECT id FROM roles WHERE community_id = %s AND is_default = TRUE", (c["id"],)
    )
    now = db.one("SELECT now() AS now")["now"]
    channels_out = []
    for channel in db.all(
        "SELECT * FROM channels WHERE community_id = %s ORDER BY position ASC, id ASC", (c["id"],)
    ):
        if member and membership:
            perms = channel_effective_permissions(db, community=c, channel=channel, member_id=member["id"], now=now)
            viewable = "view_channel" in perms
        else:
            viewable = "view_channel" in DEFAULT_ROLE_PERMISSIONS
        if viewable:
            channels_out.append({
                "id": channel["id"],
                "name": channel["name"],
                "category": channel["category_grouping"] or "",
                "position": channel["position"],
                "topic": channel["topic"],
                "type": channel["type"],
                "slowmode_seconds": channel["slowmode_seconds"],
            })
    me = None
    if member and membership:
        me = {
            "role": membership["role"],
            "muted": membership["muted"],
            "communication_disabled_until": iso_seconds_or_none(membership["communication_disabled_until"]),
        }
    resp = api_json({**shape, "channels": channels_out, "me": me})
    return no_store(resp)


async def api_server_create(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    body = await parse_json_body(request)
    name = body.get("name")
    slug = body.get("slug")
    category = body.get("category")
    description = body.get("description", "")
    if not validate_community_name(name):
        raise validation("name")
    if not validate_slug(slug):
        raise validation("slug")
    if category not in CATEGORIES or category == "all":
        raise validation("category")
    if field_nul(description):
        raise validation("description")
    if not isinstance(description, str) or len(description) > 300:
        raise validation("description")
    with db.session() as conn:
        with conn.transaction():
            if conn.execute("SELECT 1 FROM communities WHERE slug = %s", (slug,)).fetchone():
                raise conflict("slug")
            row = conn.execute(
                """INSERT INTO communities (slug, name, description, icon_url, splash_url, banner_url,
                       category, keywords, published, verification_level, owner_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, TRUE, 'none', %s) RETURNING *""",
                (slug, name, description, f"/static/gen/icon-{slug}.svg",
                 f"/static/gen/splash-{slug}.svg", f"/static/gen/banner-{slug}.svg",
                 category, [], member["id"]),
            ).fetchone()
            conn.execute(
                """INSERT INTO roles (community_id, name, position, permissions, is_default)
                   VALUES (%s, '@everyone', 0, %s, TRUE)""",
                (row["id"], DEFAULT_ROLE_PERMISSIONS),
            )
            conn.execute(
                "INSERT INTO memberships (member_id, community_id, role) VALUES (%s, %s, 'owner')",
                (member["id"], row["id"]),
            )
            channel = conn.execute(
                """INSERT INTO channels (community_id, name, position, type)
                   VALUES (%s, 'general', 0, 'text') RETURNING *""",
                (row["id"],),
            ).fetchone()
    shape = community_shape(db, row)
    channels_out = [{
        "id": channel["id"], "name": channel["name"], "category": channel["category_grouping"] or "",
        "position": channel["position"], "topic": channel["topic"], "type": channel["type"],
        "slowmode_seconds": channel["slowmode_seconds"],
    }]
    resp = api_json({**shape, "channels": channels_out}, status=201)
    return no_store(resp)


async def api_server_patch(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    slug = request.path_params["slug"]
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    if c["owner_id"] != member["id"]:
        raise forbidden()
    body = await parse_json_body(request)
    updates = {}
    if "name" in body:
        if not validate_community_name(body.get("name")) or field_nul(body.get("name")):
            raise validation("name")
        updates["name"] = body["name"]
    if "description" in body:
        desc = body.get("description")
        if field_nul(desc) or not isinstance(desc, str) or len(desc) > 300:
            raise validation("description")
        updates["description"] = desc
    if "published" in body:
        if not isinstance(body.get("published"), bool):
            raise validation("published")
        updates["published"] = body["published"]
    if "verification_level" in body:
        if body.get("verification_level") not in ("none", "email"):
            raise validation("verification_level")
        updates["verification_level"] = body["verification_level"]
    if updates:
        sets = ", ".join(f"{k} = %s" for k in updates)
        with db.session() as conn:
            row = conn.execute(
                f"UPDATE communities SET {sets} WHERE id = %s RETURNING *",
                tuple(updates.values()) + (c["id"],),
            ).fetchone()
        c = row
    return no_store(api_json(community_shape(db, c)))


async def api_server_join(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    slug = request.path_params["slug"]
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    if is_banned(db, member["id"], c["id"]):
        raise forbidden()
    existing = membership_of(db, member["id"], c["id"])
    if existing:
        default_channel = default_channel_of(db, c)
        return no_store(api_json({
            "joined": True, "community_id": c["id"],
            "default_channel_id": default_channel["id"] if default_channel else None,
            "role": existing["role"],
        }))
    with db.session() as conn:
        with conn.transaction():
            inserted = conn.execute(
                """INSERT INTO memberships (member_id, community_id, role)
                   VALUES (%s, %s, 'member')
                   ON CONFLICT (member_id, community_id) DO NOTHING RETURNING id""",
                (member["id"], c["id"]),
            ).fetchone()
            if inserted:
                seed_read_markers(conn, member["id"], c["id"])
    default_channel = default_channel_of(db, c)
    resp = api_json({
        "joined": True, "community_id": c["id"],
        "default_channel_id": default_channel["id"] if default_channel else None,
        "role": "member",
    }, status=201)
    return no_store(resp)


def default_channel_of(db: Database, c: dict) -> Optional[dict]:
    return db.one(
        """SELECT * FROM channels WHERE community_id = %s AND type = 'text'
           ORDER BY position ASC, id ASC LIMIT 1""",
        (c["id"],),
    )


def seed_read_markers(conn, member_id: int, community_id: int) -> None:
    """On joining, each marker starts at that channel's newest message (DP-18)."""
    rows = conn.execute(
        """SELECT ch.id AS channel_id,
                  (SELECT MAX(id) FROM messages m WHERE m.channel_id = ch.id) AS newest
           FROM channels ch WHERE ch.community_id = %s AND ch.type = 'text'""",
        (community_id,),
    ).fetchall()
    for row in rows:
        conn.execute(
            """INSERT INTO read_states (member_id, channel_id, last_read_message_id)
               VALUES (%s, %s, %s) ON CONFLICT (member_id, channel_id) DO NOTHING""",
            (member_id, row["channel_id"], row["newest"]),
        )


async def api_server_leave(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    slug = request.path_params["slug"]
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    if c["owner_id"] == member["id"]:
        raise conflict()
    existing = membership_of(db, member["id"], c["id"])
    if existing is None:
        raise not_found()
    with db.session() as conn:
        conn.execute(
            "DELETE FROM memberships WHERE member_id = %s AND community_id = %s",
            (member["id"], c["id"]),
        )
    publish_member_left(db, c, member)
    return Response(status_code=204, headers={"Cache-Control": "no-store", "Vary": "Authorization"})


async def api_membership_patch(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    slug = request.path_params["slug"]
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    existing = membership_of(db, member["id"], c["id"])
    if existing is None:
        raise not_found()
    body = await parse_json_body(request)
    if not isinstance(body.get("muted"), bool):
        raise validation("muted")
    with db.session() as conn:
        conn.execute(
            "UPDATE memberships SET muted = %s WHERE member_id = %s AND community_id = %s",
            (body["muted"], member["id"], c["id"]),
        )
    return no_store(api_json({"muted": body["muted"]}))


async def api_server_members(request: Request) -> Response:
    db = db_of(request)
    member = require_session(request)
    slug = request.path_params["slug"]
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    if membership_of(db, member["id"], c["id"]) is None:
        raise forbidden()
    rows = db.all(
        """SELECT m.*, ms.role AS membership_role FROM memberships ms
           JOIN members m ON m.id = ms.member_id
           WHERE ms.community_id = %s
           ORDER BY (ms.member_id = %s) DESC, m.username ASC""",
        (c["id"], c["owner_id"]),
    )
    return no_store(api_json({"data": [{"user": public_user(r), "role": r["membership_role"],
                                        "status": presence_seen(r["status"])} for r in rows]}))


async def api_server_bans(request: Request) -> Response:
    db = db_of(request)
    member = require_session(request)
    slug = request.path_params["slug"]
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    if c["owner_id"] != member["id"]:
        raise forbidden()
    rows = db.all(
        """SELECT m.*, b.created_at AS ban_created FROM bans b
           JOIN members m ON m.id = b.member_id
           WHERE b.community_id = %s ORDER BY m.username ASC""",
        (c["id"],),
    )
    return no_store(api_json({"data": [
        {"user": public_user(r), "created_at": iso_seconds(r["ban_created"])} for r in rows
    ]}))


async def api_server_ban(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    caller = require_session(request)
    slug = request.path_params["slug"]
    target_id = parse_id_or_404(request.path_params["user_id"])
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    caller_membership = membership_of(db, caller["id"], c["id"])
    if caller_membership is None:
        raise forbidden()
    caller_is_owner = c["owner_id"] == caller["id"]
    if not caller_is_owner and "ban_members" not in community_permissions(db, caller["id"], c, caller_membership):
        raise forbidden()
    if target_id == c["owner_id"] or target_id == caller["id"]:
        raise forbidden()
    if db.one("SELECT 1 FROM members WHERE id = %s", (target_id,)) is None:
        raise not_found()
    caller_rank = rank_of(db, caller["id"], c["id"], c["owner_id"])
    target_rank = rank_of(db, target_id, c["id"], c["owner_id"])
    if not caller_is_owner and target_rank >= caller_rank:
        raise forbidden()
    with db.session() as conn:
        with conn.transaction():
            target_membership = conn.execute(
                "SELECT 1 FROM memberships WHERE member_id = %s AND community_id = %s",
                (target_id, c["id"]),
            ).fetchone()
            if conn.execute("SELECT 1 FROM bans WHERE community_id = %s AND member_id = %s",
                            (c["id"], target_id)).fetchone():
                conn.execute(
                    "DELETE FROM memberships WHERE member_id = %s AND community_id = %s",
                    (target_id, c["id"]),
                )
            else:
                conn.execute(
                    """INSERT INTO bans (community_id, member_id) VALUES (%s, %s)
                       ON CONFLICT DO NOTHING""",
                    (c["id"], target_id),
                )
                conn.execute(
                    "DELETE FROM memberships WHERE member_id = %s AND community_id = %s",
                    (target_id, c["id"]),
                )
                conn.execute(
                    "DELETE FROM member_roles WHERE member_id = %s AND community_id = %s",
                    (target_id, c["id"]),
                )
                conn.execute(
                    """DELETE FROM channel_overwrites WHERE target_type = 'member' AND target_id = %s
                       AND channel_id IN (SELECT id FROM channels WHERE community_id = %s)""",
                    (target_id, c["id"]),
                )
    target = db.one("SELECT * FROM members WHERE id = %s", (target_id,))
    publish_moderation_event(db, c, "member_banned", target)
    return Response(status_code=204, headers={"Cache-Control": "no-store", "Vary": "Authorization"})


async def api_server_unban(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    caller = require_session(request)
    slug = request.path_params["slug"]
    target_id = parse_id_or_404(request.path_params["user_id"])
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    caller_membership = membership_of(db, caller["id"], c["id"])
    if caller_membership is None:
        raise forbidden()
    if c["owner_id"] != caller["id"] and "ban_members" not in community_permissions(db, caller["id"], c, caller_membership):
        raise forbidden()
    with db.session() as conn:
        removed = conn.execute(
            "DELETE FROM bans WHERE community_id = %s AND member_id = %s RETURNING id",
            (c["id"], target_id),
        ).fetchone()
    if removed is None:
        raise not_found()
    return Response(status_code=204, headers={"Cache-Control": "no-store", "Vary": "Authorization"})


async def api_server_timeout(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    caller = require_session(request)
    slug = request.path_params["slug"]
    target_id = parse_id_or_404(request.path_params["user_id"])
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    body = await parse_json_body(request)
    seconds = body.get("seconds")
    if not isinstance(seconds, int) or isinstance(seconds, bool) or seconds < 0 or seconds > 2419200:
        raise validation("seconds")
    caller_membership = membership_of(db, caller["id"], c["id"])
    if caller_membership is None:
        raise forbidden()
    caller_is_owner = c["owner_id"] == caller["id"]
    if not caller_is_owner and "ban_members" not in community_permissions(db, caller["id"], c, caller_membership):
        raise forbidden()
    if target_id == c["owner_id"] or target_id == caller["id"]:
        raise forbidden()
    target = db.one("SELECT * FROM members WHERE id = %s", (target_id,))
    if target is None:
        raise not_found()
    if membership_of(db, target_id, c["id"]) is None:
        raise not_found()
    caller_rank = rank_of(db, caller["id"], c["id"], c["owner_id"])
    target_rank = rank_of(db, target_id, c["id"], c["owner_id"])
    if not caller_is_owner and target_rank >= caller_rank:
        raise forbidden()
    with db.session() as conn:
        if seconds == 0:
            row = conn.execute(
                """UPDATE memberships SET communication_disabled_until = NULL
                   WHERE member_id = %s AND community_id = %s RETURNING id""",
                (target_id, c["id"]),
            ).fetchone()
            until = None
        else:
            row = conn.execute(
                """UPDATE memberships SET communication_disabled_until = date_trunc('second', now()) + (%s * INTERVAL '1 second')
                   WHERE member_id = %s AND community_id = %s
                   RETURNING communication_disabled_until""",
                (seconds, target_id, c["id"]),
            ).fetchone()
            until = row["communication_disabled_until"]
    publish_moderation_event(db, c, "member_timed_out", target, until=until)
    return no_store(api_json({
        "user_id": target_id,
        "communication_disabled_until": iso_seconds_or_none(until),
    }))


def parse_id_or_404(raw: str) -> int:
    from .app import parse_id
    value = parse_id(raw)
    if value is None:
        raise not_found()
    return value


def publish_member_left(db: Database, c: dict, member: dict) -> None:
    publish_moderation_event(db, c, "member_left", member)


def publish_moderation_event(db: Database, c: dict, kind: str, target: Optional[dict], until=None) -> None:
    """Fan a moderation event out to every other member of the community."""
    if target is None:
        return
    payload = json.dumps({
        "type": kind,
        "data": {"user": public_user(target), "community_id": c["id"],
                 "communication_disabled_until": iso_seconds_or_none(until)},
    })
    for row in db.all("SELECT member_id FROM memberships WHERE community_id = %s", (c["id"],)):
        if row["member_id"] != target["id"]:
            db.execute(
                "INSERT INTO live_events (recipient_id, payload) VALUES (%s, %s)",
                (row["member_id"], payload),
            )


# ---------------------------------------------------------------------------
# roles, assignments and channel overwrites


async def api_roles_list(request: Request) -> Response:
    db = db_of(request)
    member = require_session(request)
    slug = request.path_params["slug"]
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    if membership_of(db, member["id"], c["id"]) is None:
        raise forbidden()
    rows = db.all("SELECT * FROM roles WHERE community_id = %s ORDER BY position ASC, id ASC", (c["id"],))
    return no_store(api_json({"data": [role_shape(r) for r in rows]}))


def role_shape(r: dict) -> dict:
    return {
        "id": r["id"], "name": r["name"], "position": r["position"],
        "permissions": sorted(r["permissions"] or []), "is_default": r["is_default"],
    }


def validate_permission_list(value) -> Optional[list]:
    if not isinstance(value, list):
        return None
    out = []
    for item in value:
        if item not in ALL_PERMISSIONS:
            return None
        if item not in out:
            out.append(item)
    return out


async def api_roles_create(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    slug = request.path_params["slug"]
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    membership = membership_of(db, member["id"], c["id"])
    if membership is None:
        raise forbidden()
    is_owner = c["owner_id"] == member["id"]
    perms = community_permissions(db, member["id"], c, membership)
    if not is_owner and "manage_roles" not in perms:
        raise forbidden()
    body = await parse_json_body(request)
    name = body.get("name")
    raw_name = name.strip() if isinstance(name, str) else None
    if raw_name is None or not raw_name or len(raw_name) > 32 or raw_name.lower() == "@everyone" or field_nul(name):
        raise validation("name")
    permission_list = validate_permission_list(body.get("permissions"))
    if permission_list is None:
        raise validation("permissions")
    if not is_owner:
        missing = [p for p in permission_list if p not in perms]
        if missing:
            raise forbidden()
    with db.session() as conn:
        with conn.transaction():
            if conn.execute(
                "SELECT 1 FROM roles WHERE community_id = %s AND LOWER(name) = %s",
                (c["id"], raw_name.lower()),
            ).fetchone():
                raise conflict("name")
            if is_owner:
                top = conn.execute(
                    "SELECT COALESCE(MAX(position), 0) AS top FROM roles WHERE community_id = %s",
                    (c["id"],),
                ).fetchone()["top"]
                position = top + 1
            else:
                my_rank = rank_of(db, member["id"], c["id"], c["owner_id"])
                position = my_rank
                conn.execute(
                    """UPDATE roles SET position = position + 1
                       WHERE community_id = %s AND position >= %s""",
                    (c["id"], my_rank),
                )
            row = conn.execute(
                """INSERT INTO roles (community_id, name, position, permissions)
                   VALUES (%s, %s, %s, %s) RETURNING *""",
                (c["id"], raw_name, position, permission_list),
            ).fetchone()
    return no_store(api_json(role_shape(row), status=201))


async def api_role_patch(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    role_id = parse_id_or_404(request.path_params["role_id"])
    role = db.one("SELECT * FROM roles WHERE id = %s", (role_id,))
    if role is None:
        raise not_found()
    c = db.one("SELECT * FROM communities WHERE id = %s", (role["community_id"],))
    membership = membership_of(db, member["id"], c["id"])
    if membership is None:
        raise forbidden()
    is_owner = c["owner_id"] == member["id"]
    perms = community_permissions(db, member["id"], c, membership)
    if not is_owner and "manage_roles" not in perms:
        raise forbidden()
    body = await parse_json_body(request)
    updates = {}
    if "name" in body:
        name = body.get("name")
        raw_name = name.strip() if isinstance(name, str) else None
        if raw_name is None or not raw_name or len(raw_name) > 32 or field_nul(name):
            raise validation("name")
        if role["is_default"] and raw_name.lower() != role["name"].lower():
            raise validation("name")
        updates["name"] = raw_name
    if "permissions" in body:
        permission_list = validate_permission_list(body.get("permissions"))
        if permission_list is None:
            raise validation("permissions")
        if not is_owner:
            missing = [p for p in permission_list if p not in perms]
            if missing:
                raise forbidden()
        updates["permissions"] = permission_list
    if not is_owner:
        my_rank = rank_of(db, member["id"], c["id"], c["owner_id"])
        if role["position"] >= my_rank:
            raise forbidden()
    with db.session() as conn:
        if updates:
            sets = ", ".join(f"{k} = %s" for k in updates)
            row = conn.execute(
                f"UPDATE roles SET {sets} WHERE id = %s RETURNING *",
                tuple(updates.values()) + (role_id,),
            ).fetchone()
        else:
            row = role
    publish_role_event(db, c, role)
    return no_store(api_json(role_shape(row)))


async def api_role_delete(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    role_id = parse_id_or_404(request.path_params["role_id"])
    role = db.one("SELECT * FROM roles WHERE id = %s", (role_id,))
    if role is None:
        raise not_found()
    c = db.one("SELECT * FROM communities WHERE id = %s", (role["community_id"],))
    membership = membership_of(db, member["id"], c["id"])
    if membership is None:
        raise forbidden()
    is_owner = c["owner_id"] == member["id"]
    perms = community_permissions(db, member["id"], c, membership)
    if not is_owner and "manage_roles" not in perms:
        raise forbidden()
    if role["is_default"]:
        raise conflict("role_id")
    if not is_owner:
        my_rank = rank_of(db, member["id"], c["id"], c["owner_id"])
        if role["position"] >= my_rank:
            raise forbidden()
    with db.session() as conn:
        with conn.transaction():
            conn.execute("DELETE FROM member_roles WHERE role_id = %s", (role_id,))
            conn.execute("DELETE FROM channel_overwrites WHERE target_type = 'role' AND target_id = %s", (role_id,))
            conn.execute("DELETE FROM roles WHERE id = %s", (role_id,))
    publish_role_event(db, c, role)
    return Response(status_code=204, headers={"Cache-Control": "no-store", "Vary": "Authorization"})


def publish_role_event(db: Database, c: dict, role: dict) -> None:
    payload = json.dumps({"type": "roles_changed", "data": {"community_id": c["id"]}})
    for row in db.all("SELECT member_id FROM memberships WHERE community_id = %s", (c["id"],)):
        db.execute(
            "INSERT INTO live_events (recipient_id, payload) VALUES (%s, %s)",
            (row["member_id"], payload),
        )


async def api_role_assign(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    slug = request.path_params["slug"]
    target_id = parse_id_or_404(request.path_params["user_id"])
    role_id = parse_id_or_404(request.path_params["role_id"])
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    membership = membership_of(db, member["id"], c["id"])
    if membership is None:
        raise forbidden()
    is_owner = c["owner_id"] == member["id"]
    perms = community_permissions(db, member["id"], c, membership)
    if not is_owner and "manage_roles" not in perms:
        raise forbidden()
    role = db.one("SELECT * FROM roles WHERE id = %s AND community_id = %s", (role_id, c["id"]))
    if role is None:
        raise not_found()
    if role["is_default"]:
        raise validation("role_id")
    if membership_of(db, target_id, c["id"]) is None:
        raise not_found()
    if target_id == c["owner_id"]:
        raise forbidden()
    if not is_owner:
        my_rank = rank_of(db, member["id"], c["id"], c["owner_id"])
        if role["position"] >= my_rank:
            raise forbidden()
        if [p for p in (role["permissions"] or []) if p not in perms]:
            raise forbidden()
    with db.session() as conn:
        conn.execute(
            """INSERT INTO member_roles (community_id, member_id, role_id)
               VALUES (%s, %s, %s) ON CONFLICT DO NOTHING""",
            (c["id"], target_id, role_id),
        )
    publish_role_event(db, c, role)
    return Response(status_code=204, headers={"Cache-Control": "no-store", "Vary": "Authorization"})


async def api_role_remove(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    slug = request.path_params["slug"]
    target_id = parse_id_or_404(request.path_params["user_id"])
    role_id = parse_id_or_404(request.path_params["role_id"])
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    membership = membership_of(db, member["id"], c["id"])
    if membership is None:
        raise forbidden()
    is_owner = c["owner_id"] == member["id"]
    perms = community_permissions(db, member["id"], c, membership)
    if not is_owner and "manage_roles" not in perms:
        raise forbidden()
    role = db.one("SELECT * FROM roles WHERE id = %s AND community_id = %s", (role_id, c["id"]))
    if role is None:
        raise not_found()
    if role["is_default"]:
        raise validation("role_id")
    if membership_of(db, target_id, c["id"]) is None:
        raise not_found()
    if target_id == c["owner_id"]:
        raise forbidden()
    if not is_owner:
        my_rank = rank_of(db, member["id"], c["id"], c["owner_id"])
        if role["position"] >= my_rank:
            raise forbidden()
        if [p for p in (role["permissions"] or []) if p not in perms]:
            raise forbidden()
    with db.session() as conn:
        conn.execute(
            "DELETE FROM member_roles WHERE member_id = %s AND role_id = %s",
            (target_id, role_id),
        )
    publish_role_event(db, c, role)
    return Response(status_code=204, headers={"Cache-Control": "no-store", "Vary": "Authorization"})


async def api_overwrites_list(request: Request) -> Response:
    db = db_of(request)
    member = require_session(request)
    channel_id = parse_id_or_404(request.path_params["channel_id"])
    channel = db.one("SELECT * FROM channels WHERE id = %s", (channel_id,))
    if channel is None:
        raise not_found()
    c = db.one("SELECT * FROM communities WHERE id = %s", (channel["community_id"],))
    membership = membership_of(db, member["id"], c["id"])
    if membership is None:
        raise forbidden()
    is_owner = c["owner_id"] == member["id"]
    if not is_owner and "manage_roles" not in community_permissions(db, member["id"], c, membership):
        raise forbidden()
    rows = db.all(
        """SELECT * FROM channel_overwrites WHERE channel_id = %s
           ORDER BY CASE WHEN target_type = 'role' THEN 0 ELSE 1 END,
                    CASE WHEN target_type = 'role' THEN target_id END ASC NULLS LAST,
                    CASE WHEN target_type = 'member' THEN target_id END ASC NULLS LAST""",
        (channel_id,),
    )
    data = []
    for r in rows:
        if r["target_type"] == "role":
            role = db.one("SELECT position FROM roles WHERE id = %s", (r["target_id"],))
            data.append({**r, "sort": (0, role["position"] if role else 0)})
        else:
            data.append({**r, "sort": (1, r["target_id"])})
    data.sort(key=lambda r: r["sort"])
    return no_store(api_json({"data": [
        {"channel_id": r["channel_id"], "target_type": r["target_type"], "target_id": r["target_id"],
         "allow": sorted(r["allow"] or []), "deny": sorted(r["deny"] or [])} for r in data
    ]}))


async def api_overwrite_put(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    channel_id = parse_id_or_404(request.path_params["channel_id"])
    target_type = request.path_params["target_type"]
    target_id = parse_id_or_404(request.path_params["target_id"])
    if target_type not in ("role", "member"):
        raise not_found()
    channel = db.one("SELECT * FROM channels WHERE id = %s", (channel_id,))
    if channel is None:
        raise not_found()
    c = db.one("SELECT * FROM communities WHERE id = %s", (channel["community_id"],))
    membership = membership_of(db, member["id"], c["id"])
    if membership is None:
        raise forbidden()
    is_owner = c["owner_id"] == member["id"]
    perms = community_permissions(db, member["id"], c, membership)
    if not is_owner and "manage_roles" not in perms:
        raise forbidden()
    body = await parse_json_body(request)
    allow = validate_permission_list(body.get("allow"))
    deny = validate_permission_list(body.get("deny"))
    if allow is None or deny is None:
        raise validation("allow")
    overlap = set(allow) & set(deny)
    if overlap:
        raise validation("deny")
    if target_type == "role":
        role = db.one("SELECT * FROM roles WHERE id = %s AND community_id = %s", (target_id, c["id"]))
        if role is None:
            raise not_found()
        if not is_owner:
            if role["position"] >= rank_of(db, member["id"], c["id"], c["owner_id"]):
                raise forbidden()
            if [p for p in allow if p not in perms] or [p for p in deny if p not in perms]:
                raise forbidden()
    else:
        if membership_of(db, target_id, c["id"]) is None:
            raise not_found()
        if target_id == c["owner_id"]:
            raise forbidden()
        if not is_owner:
            if rank_of(db, target_id, c["id"], c["owner_id"]) >= rank_of(db, member["id"], c["id"], c["owner_id"]):
                raise forbidden()
            if [p for p in allow if p not in perms] or [p for p in deny if p not in perms]:
                raise forbidden()
    with db.session() as conn:
        conn.execute(
            """INSERT INTO channel_overwrites (channel_id, target_type, target_id, allow, deny)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (channel_id, target_type, target_id)
               DO UPDATE SET allow = EXCLUDED.allow, deny = EXCLUDED.deny""",
            (channel_id, target_type, target_id, allow, deny),
        )
    publish_channel_change(db, c, channel)
    return no_store(api_json({"channel_id": channel_id, "target_type": target_type,
                              "target_id": target_id, "allow": sorted(allow), "deny": sorted(deny)}))


async def api_overwrite_delete(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    channel_id = parse_id_or_404(request.path_params["channel_id"])
    target_type = request.path_params["target_type"]
    target_id = parse_id_or_404(request.path_params["target_id"])
    if target_type not in ("role", "member"):
        raise not_found()
    channel = db.one("SELECT * FROM channels WHERE id = %s", (channel_id,))
    if channel is None:
        raise not_found()
    c = db.one("SELECT * FROM communities WHERE id = %s", (channel["community_id"],))
    membership = membership_of(db, member["id"], c["id"])
    if membership is None:
        raise forbidden()
    is_owner = c["owner_id"] == member["id"]
    perms = community_permissions(db, member["id"], c, membership)
    if not is_owner and "manage_roles" not in perms:
        raise forbidden()
    with db.session() as conn:
        removed = conn.execute(
            """DELETE FROM channel_overwrites WHERE channel_id = %s AND target_type = %s AND target_id = %s
               RETURNING id""",
            (channel_id, target_type, target_id),
        ).fetchone()
    if removed is None:
        raise not_found()
    publish_channel_change(db, c, channel)
    return Response(status_code=204, headers={"Cache-Control": "no-store", "Vary": "Authorization"})


def publish_channel_change(db: Database, c: dict, channel: dict) -> None:
    payload = json.dumps({"type": "channel_access_changed", "data": {
        "community_id": c["id"], "channel_id": channel["id"]}})
    for row in db.all("SELECT member_id FROM memberships WHERE community_id = %s", (c["id"],)):
        db.execute(
            "INSERT INTO live_events (recipient_id, payload) VALUES (%s, %s)",
            (row["member_id"], payload),
        )


async def api_channel_permissions(request: Request) -> Response:
    db = db_of(request)
    member = require_session(request)
    channel_id = parse_id_or_404(request.path_params["channel_id"])
    channel = db.one("SELECT * FROM channels WHERE id = %s", (channel_id,))
    if channel is None:
        raise not_found()
    c = db.one("SELECT * FROM communities WHERE id = %s", (channel["community_id"],))
    if membership_of(db, member["id"], c["id"]) is None:
        raise forbidden()
    now = db.one("SELECT now() AS now")["now"]
    perms = channel_effective_permissions(db, community=c, channel=channel, member_id=member["id"], now=now)
    return no_store(api_json({"channel_id": channel_id, "permissions": sorted(perms)}))


# ---------------------------------------------------------------------------
# invites


def invite_shape(db: Database, invite: dict) -> dict:
    inviter = db.one("SELECT * FROM members WHERE id = %s", (invite["inviter_id"],))
    c = db.one("SELECT * FROM communities WHERE id = %s", (invite["community_id"],))
    default_channel = default_channel_of(db, c)
    return {
        "code": invite["code"],
        "community_id": invite["community_id"],
        "channel_id": default_channel["id"] if default_channel else None,
        "inviter": public_user(inviter) if inviter else None,
        "uses": invite["uses"],
        "max_uses": invite["max_uses"],
        "max_age_seconds": invite["max_age_seconds"],
        "expires_at": iso_seconds_or_none(invite["expires_at"]),
        "created_at": iso_seconds(invite["created_at"]),
    }


def invite_validity(invite: Optional[dict], now) -> bool:
    """Invite validity decided in one place (DP-17, DP-82)."""
    if invite is None or invite["revoked_at"] is not None:
        return False
    if invite["max_uses"] > 0 and invite["uses"] >= invite["max_uses"]:
        return False
    if invite["expires_at"] is not None and now >= invite["expires_at"]:
        return False
    return True


async def api_invites_create(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    slug = request.path_params["slug"]
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    membership = membership_of(db, member["id"], c["id"])
    if membership is None:
        raise forbidden()
    perms = community_permissions(db, member["id"], c, membership)
    if c["owner_id"] != member["id"] and "create_invite" not in perms:
        raise forbidden()
    body = await parse_json_body(request)
    max_uses = body.get("max_uses", 0)
    max_age = body.get("max_age_seconds", 86400)
    if not isinstance(max_uses, int) or isinstance(max_uses, bool) or not (0 <= max_uses <= 100):
        raise validation("max_uses")
    if not isinstance(max_age, int) or isinstance(max_age, bool) or not (0 <= max_age <= 604800):
        raise validation("max_age_seconds")
    code = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(8))
    with db.session() as conn:
        row = conn.execute(
            """INSERT INTO invites (code, community_id, inviter_id, max_uses, max_age_seconds, expires_at)
               VALUES (%s, %s, %s, %s, %s, CASE WHEN %s = 0 THEN NULL
                     ELSE date_trunc('second', now()) + (%s * INTERVAL '1 second') END)
               RETURNING *""",
            (code, c["id"], member["id"], max_uses, max_age, max_age, max_age),
        ).fetchone()
    return no_store(api_json(invite_shape(db, row), status=201))


async def api_invites_list(request: Request) -> Response:
    db = db_of(request)
    member = require_session(request)
    slug = request.path_params["slug"]
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    if c["owner_id"] != member["id"]:
        raise forbidden()
    now = db.one("SELECT now() AS now")["now"]
    rows = db.all(
        "SELECT * FROM invites WHERE community_id = %s ORDER BY id ASC", (c["id"],)
    )
    data = [invite_shape(db, r) for r in rows if invite_validity(r, now)]
    return no_store(api_json({"data": data}))


async def api_invite_delete(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    code = request.path_params["code"]
    if "\x00" in code:
        raise not_found()
    invite = db.one("SELECT * FROM invites WHERE code = %s", (code,))
    now = db.one("SELECT now() AS now")["now"]
    if not invite_validity(invite, now):
        raise not_found()
    c = db.one("SELECT * FROM communities WHERE id = %s", (invite["community_id"],))
    if member["id"] != invite["inviter_id"] and c["owner_id"] != member["id"]:
        raise forbidden()
    with db.session() as conn:
        conn.execute("UPDATE invites SET revoked_at = now() WHERE code = %s", (code,))
    return Response(status_code=204, headers={"Cache-Control": "no-store", "Vary": "Authorization"})


async def api_invite_get(request: Request) -> Response:
    db = db_of(request)
    code = request.path_params["code"]
    if "\x00" in code:
        raise not_found()
    invite = db.one("SELECT * FROM invites WHERE code = %s", (code,))
    now = db.one("SELECT now() AS now")["now"]
    if not invite_validity(invite, now):
        raise not_found()
    c = db.one("SELECT * FROM communities WHERE id = %s", (invite["community_id"],))
    members, online = community_counts(db, c["id"])
    inviter = db.one("SELECT * FROM members WHERE id = %s", (invite["inviter_id"],))
    return no_store(api_json({
        "code": invite["code"],
        "community": {
            "id": c["id"], "slug": c["slug"], "name": c["name"], "icon_url": c["icon_url"],
            "member_count": members, "presence_count": online,
        },
        "inviter": public_user(inviter) if inviter else None,
        "expires_at": iso_seconds_or_none(invite["expires_at"]),
    }))


async def api_invite_accept(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    code = request.path_params["code"]
    if "\x00" in code:
        raise not_found()
    with db.session() as conn:
        invite = conn.execute("SELECT * FROM invites WHERE code = %s FOR UPDATE", (code,)).fetchone()
        now = conn.execute("SELECT now() AS now").fetchone()["now"]
        if not invite_validity(invite, now):
            raise not_found()
        c = conn.execute("SELECT * FROM communities WHERE id = %s", (invite["community_id"],)).fetchone()
        existing = conn.execute(
            "SELECT * FROM memberships WHERE member_id = %s AND community_id = %s",
            (member["id"], c["id"]),
        ).fetchone()
        if existing:
            default_channel = default_channel_of(db, c)
            return no_store(api_json({
                "joined": True, "community_id": c["id"],
                "default_channel_id": default_channel["id"] if default_channel else None,
                "role": existing["role"],
            }))
        if conn.execute("SELECT 1 FROM bans WHERE community_id = %s AND member_id = %s",
                        (c["id"], member["id"])).fetchone():
            raise forbidden()
        if invite["max_uses"] > 0 and invite["uses"] >= invite["max_uses"]:
            raise not_found()
        with conn.transaction():
            inserted = conn.execute(
                """INSERT INTO memberships (member_id, community_id, role)
                   VALUES (%s, %s, 'member')
                   ON CONFLICT (member_id, community_id) DO NOTHING RETURNING id""",
                (member["id"], c["id"]),
            ).fetchone()
            if inserted is None:
                default_channel = default_channel_of(db, c)
                return no_store(api_json({
                    "joined": True, "community_id": c["id"],
                    "default_channel_id": default_channel["id"] if default_channel else None,
                    "role": "member",
                }))
            if invite["max_uses"] > 0:
                claimed = conn.execute(
                    """UPDATE invites SET uses = uses + 1
                       WHERE code = %s AND uses < max_uses RETURNING uses""",
                    (code,),
                ).fetchone()
                if claimed is None:
                    raise not_found()
            else:
                conn.execute("UPDATE invites SET uses = uses + 1 WHERE code = %s", (code,))
            seed_read_markers(conn, member["id"], c["id"])
    default_channel = default_channel_of(db, c)
    publish_member_joined(db, c, member)
    resp = api_json({
        "joined": True, "community_id": c["id"],
        "default_channel_id": default_channel["id"] if default_channel else None,
        "role": "member",
    }, status=201)
    return no_store(resp)


def publish_member_joined(db: Database, c: dict, member: dict) -> None:
    payload = json.dumps({"type": "member_joined", "data": {
        "user": public_user(member), "community_id": c["id"], "status": presence_seen(member["status"])}})
    for row in db.all("SELECT member_id FROM memberships WHERE community_id = %s", (c["id"],)):
        if row["member_id"] != member["id"]:
            db.execute("INSERT INTO live_events (recipient_id, payload) VALUES (%s, %s)",
                       (row["member_id"], payload))


# ---------------------------------------------------------------------------
# messages


def message_shape(db: Database, m: dict) -> dict:
    """Message shape with the quoted parent as it stands now (DP-76)."""
    author = db.one("SELECT * FROM members WHERE id = %s", (m["author_id"],))
    referenced = None
    reply_count = 0
    if m["reply_to_id"] is not None:
        parent = db.one("SELECT * FROM messages WHERE id = %s", (m["reply_to_id"],))
        if parent is not None:
            p_author = db.one("SELECT * FROM members WHERE id = %s", (parent["author_id"],))
            referenced = {
                "id": parent["id"],
                "author": public_user(p_author),
                "body": parent["body"],
                "edited_at": iso_seconds_or_none(parent["edited_at"]),
            }
        else:
            m = {**m, "reply_to_id": None}
    reply_count = db.one(
        "SELECT COUNT(*) AS n FROM messages WHERE reply_to_id = %s", (m["id"],)
    )["n"]
    reactions = db.all(
        """SELECT emoji, COUNT(*) AS count, BOOL_OR(member_id = %s) AS me
           FROM reactions WHERE message_id = %s GROUP BY emoji ORDER BY MIN(id) ASC""",
        (m["author_id"], m["id"]),
    )
    mention_rows = db.all(
        """SELECT DISTINCT mentioned_id FROM message_mentions WHERE message_id = %s ORDER BY mentioned_id ASC""",
        (m["id"],),
    )
    attachments = db.all(
        "SELECT * FROM attachments WHERE message_id = %s ORDER BY id ASC", (m["id"],)
    )
    return {
        "id": m["id"],
        "channel_id": m["channel_id"],
        "author": public_user(author),
        "body": m["body"],
        "created_at": iso_seconds(m["created_at"]),
        "edited_at": iso_seconds_or_none(m["edited_at"]),
        "reply_to_id": m["reply_to_id"] if referenced is not None else None,
        "referenced_message": referenced,
        "reply_count": int(reply_count),
        "mentions": [r["mentioned_id"] for r in mention_rows],
        "reactions": [
            {"emoji": r["emoji"], "count": int(r["count"]), "me": bool(r["me"])}
            for r in reactions
        ],
        "attachments": [attachment_shape(a) for a in attachments],
    }


def attachment_shape(a: dict) -> dict:
    return {
        "id": a["id"], "filename": a["filename"], "size_bytes": a["size_bytes"],
        "content_type": a["content_type"], "sha256": a["sha256"], "url": f"/media/{a['id']}",
        "width": a["width"], "height": a["height"], "duration_ms": a["duration_ms"],
    }


def compute_mentions(db: Database, body: str, c: dict, channel: dict, author_id: int, perms: set) -> list:
    """Mentions recomputed from the body: code spans never mention (DP-30)."""
    stripped = strip_code_spans(body)
    mentioned = set()
    if "@" in stripped:
        for token in re.findall(r"@[A-Za-z0-9_.]+", stripped):
            username = token[1:]
            row = db.one(
                """SELECT m.id FROM members m JOIN memberships ms ON ms.member_id = m.id
                   WHERE ms.community_id = %s AND LOWER(m.username) = LOWER(%s)""",
                (c["id"], username),
            )
            if row and row["id"] != author_id:
                member_id = row["id"]
                channel2 = channel
                perms2 = channel_effective_permissions(
                    db, community=c, channel=channel2, member_id=member_id,
                    now=db.one("SELECT now() AS now")["now"],
                )
                if "view_channel" in perms2:
                    mentioned.add(member_id)
    if "mention_everyone" in perms:
        for token in ("@everyone", "@here"):
            if token in stripped:
                if token == "@here":
                    rows = db.all(
                        """SELECT ms.member_id FROM memberships ms JOIN members m ON m.id = ms.member_id
                           WHERE ms.community_id = %s AND m.status = 'online' AND ms.member_id != %s""",
                        (c["id"], author_id),
                    )
                else:
                    rows = db.all(
                        """SELECT member_id FROM memberships WHERE community_id = %s AND member_id != %s""",
                        (c["id"], author_id),
                    )
                for r in rows:
                    perms2 = channel_effective_permissions(
                        db, community=c, channel=channel, member_id=r["member_id"],
                        now=db.one("SELECT now() AS now")["now"],
                    )
                    if "view_channel" in perms2:
                        mentioned.add(r["member_id"])
                break
    return sorted(mentioned)


def strip_code_spans(body: str) -> str:
    """Replace inline code spans and fenced blocks with spaces, keeping offsets."""
    out = list(body)
    lines = body.split("\n")
    offset = 0
    in_fence = False
    for line in lines:
        if line.strip().startswith("```"):
            in_fence = not in_fence
            for i in range(offset, offset + len(line)):
                out[i] = " "
        else:
            if in_fence:
                for i in range(offset, offset + len(line)):
                    out[i] = " "
            else:
                j = 0
                while j < len(line):
                    if line[j] == "`":
                        end = line.find("`", j + 1)
                        if end != -1:
                            for k in range(j, end + 1):
                                out[offset + k] = " "
                            j = end + 1
                            continue
                    j += 1
        offset += len(line) + 1
    return "".join(out)


async def api_messages_list(request: Request) -> Response:
    db = db_of(request)
    member = require_session(request)
    channel_id = parse_id_or_404(request.path_params["channel_id"])
    channel = db.one("SELECT * FROM channels WHERE id = %s", (channel_id,))
    if channel is None:
        raise not_found()
    c = db.one("SELECT * FROM communities WHERE id = %s", (channel["community_id"],))
    membership = membership_of(db, member["id"], c["id"])
    if membership is None:
        raise forbidden()
    now = db.one("SELECT now() AS now")["now"]
    perms = channel_effective_permissions(db, community=c, channel=channel, member_id=member["id"], now=now)
    if "view_channel" not in perms:
        raise forbidden()
    limit = int_query(request, "limit", 50, 1, 100)
    before = request.query_params.get("before")
    where = "channel_id = %s"
    args = [channel_id]
    if before:
        before_id = parse_id_or_404(before)
        where += " AND id < %s"
        args.append(before_id)
    rows = db.all(
        f"SELECT * FROM messages WHERE {where} ORDER BY id DESC LIMIT %s",
        tuple(args) + (limit,),
    )
    rows = list(reversed(rows))
    total = db.one(
        f"SELECT COUNT(*) AS n FROM messages WHERE {where}", tuple(args)
    )["n"]
    has_more = total > limit
    return no_store(api_json({"data": [message_shape(db, r) for r in rows], "has_more": has_more}))


async def api_messages_post(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    cfg = config_of(request)
    channel_id = parse_id_or_404(request.path_params["channel_id"])
    channel = db.one("SELECT * FROM channels WHERE id = %s", (channel_id,))
    if channel is None:
        raise not_found()
    c = db.one("SELECT * FROM communities WHERE id = %s", (channel["community_id"],))
    membership = membership_of(db, member["id"], c["id"])
    if membership is None:
        raise forbidden()
    now_row = db.one("SELECT now() AS now")
    now = now_row["now"]
    perms = channel_effective_permissions(db, community=c, channel=channel, member_id=member["id"], now=now)
    if "view_channel" not in perms or "send_messages" not in perms:
        raise forbidden()
    if c["verification_level"] == "email" and not member["email_verified"]:
        raise forbidden()
    body = await parse_json_body(request)
    text = body.get("body")
    reply_to_id = body.get("reply_to_id")
    attachment_ids = body.get("attachment_ids")
    nonce = body.get("nonce")
    if nonce is not None and (not isinstance(nonce, str) or not 1 <= len(nonce) <= 64):
        raise validation("nonce")
    if text is None:
        text = ""
    if not isinstance(text, str):
        raise validation("body")
    if "\x00" in text:
        raise validation("body")
    text = text.strip()
    limit = TIER_MESSAGE_LIMIT.get(member["tier"], 2000)
    if "longer_messages" in TIER_ENTITLEMENTS.get(member["tier"], []):
        limit = 4000
    needs_attachment = bool(attachment_ids)
    if not text and not needs_attachment:
        raise validation("body")
    if len(text) > limit:
        raise validation("body")
    if reply_to_id is not None:
        reply_id = parse_id_or_404(str(reply_to_id))
        parent = db.one(
            "SELECT 1 FROM messages WHERE id = %s AND channel_id = %s", (reply_id, channel_id)
        )
        if parent is None:
            raise validation("reply_to_id")
    else:
        reply_id = None
    if attachment_ids is not None:
        if not isinstance(attachment_ids, list) or len(attachment_ids) > 10:
            raise validation("attachment_ids")
        clean_ids = []
        for aid in attachment_ids:
            aid_int = parse_id_or_404(str(aid))
            a = db.one("SELECT * FROM attachments WHERE id = %s", (aid_int,))
            if a is None or a["uploader_id"] != member["id"] or a["message_id"] is not None:
                raise validation("attachment_ids")
            clean_ids.append(aid_int)
    else:
        clean_ids = []
    if "attach_files" not in perms and clean_ids:
        raise forbidden()
    # nonce replay: the same author, channel and nonce answers the stored message
    if nonce:
        with db.session() as conn:
            replay = conn.execute(
                """SELECT m.* FROM messages m WHERE m.nonce = %s AND m.channel_id = %s AND m.author_id = %s
                   AND m.created_at > now() - (%s * INTERVAL '1 second')""",
                (nonce, channel_id, member["id"], cfg.message_nonce_ttl_seconds),
            ).fetchone()
        if replay is not None:
            return no_store(api_json(message_shape(db, replay)))
    # slowmode: an author without manage_messages who posted recently is refused
    if channel["slowmode_seconds"] > 0 and "manage_messages" not in perms:
        last = db.one(
            """SELECT created_at FROM messages WHERE channel_id = %s AND author_id = %s
               ORDER BY id DESC LIMIT 1""",
            (channel_id, member["id"]),
        )
        if last is not None:
            window = _dt.timedelta(seconds=channel["slowmode_seconds"])
            elapsed = (now - last["created_at"]).total_seconds()
            if elapsed < channel["slowmode_seconds"]:
                raise rate_limited(math.ceil(channel["slowmode_seconds"] - elapsed))
    with db.session() as conn:
        with conn.transaction():
            row = conn.execute(
                """INSERT INTO messages (channel_id, author_id, body, reply_to_id, nonce)
                   VALUES (%s, %s, %s, %s, %s) RETURNING *""",
                (channel_id, member["id"], text, reply_id, nonce),
            ).fetchone()
            mentions = compute_mentions(db, text, c, channel, member["id"], perms)
            for mid in mentions:
                conn.execute(
                    "INSERT INTO message_mentions (message_id, mentioned_id) VALUES (%s, %s)",
                    (row["id"], mid),
                )
            for aid in clean_ids:
                conn.execute(
                    "UPDATE attachments SET message_id = %s WHERE id = %s AND message_id IS NULL",
                    (row["id"], aid),
                )
            # the author's marker moves forward
            conn.execute(
                """INSERT INTO read_states (member_id, channel_id, last_read_message_id)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (member_id, channel_id)
                   DO UPDATE SET last_read_message_id = EXCLUDED.last_read_message_id""",
                (member["id"], channel_id, row["id"]),
            )
            create_notifications(conn, db, c, channel, row, member, mentions)
    shape = message_shape(db, row)
    broadcast_message(db, c, channel, row, kind="message_created")
    resp = api_json(shape, status=201)
    return no_store(resp)


def create_notifications(conn, db: Database, c: dict, channel: dict, message: dict,
                         author: dict, mentions: list) -> None:
    """Exactly one notification per new message for every eligible viewer (DP-28)."""
    recipients = conn.execute(
        "SELECT member_id, muted FROM memberships WHERE community_id = %s AND member_id != %s",
        (c["id"], author["id"]),
    ).fetchall()
    mention_set = set(mentions)
    for r in recipients:
        now = conn.execute("SELECT now() AS now").fetchone()["now"]
        perms = channel_effective_permissions(db, community=c, channel=channel, member_id=r["member_id"], now=now)
        if "view_channel" not in perms:
            continue
        kind = None
        if r["member_id"] in mention_set:
            kind = "mention"
        else:
            parent = message["reply_to_id"]
            if parent is not None:
                parent_row = conn.execute(
                    "SELECT author_id FROM messages WHERE id = %s", (parent,)
                ).fetchone()
                if parent_row and parent_row["author_id"] == r["member_id"]:
                    kind = "reply"
        if kind is None:
            kind = "message" if not r["muted"] else None
        if kind is None:
            continue
        conn.execute(
            """INSERT INTO notifications (recipient_id, message_id, community_id, channel_id, kind)
               VALUES (%s, %s, %s, %s, %s)""",
            (r["member_id"], message["id"], c["id"], channel["id"], kind),
        )


def broadcast_message(db: Database, c: dict, channel: dict, message: dict, kind: str,
                      extra: Optional[dict] = None) -> None:
    """Fan out a live event to every member who may view the channel right now."""
    now = db.one("SELECT now() AS now")["now"]
    shape = message_shape(db, message)
    payload_obj = {"type": kind, "data": {"message": shape, "community_id": c["id"],
                                          "channel_id": channel["id"]}}
    if extra:
        payload_obj["data"].update(extra)
    payload = json.dumps(payload_obj)
    for row in db.all("SELECT member_id FROM memberships WHERE community_id = %s", (c["id"],)):
        perms = channel_effective_permissions(db, community=c, channel=channel, member_id=row["member_id"], now=now)
        if "view_channel" in perms:
            db.execute("INSERT INTO live_events (recipient_id, payload) VALUES (%s, %s)",
                       (row["member_id"], payload))


def load_message_for_caller(db: Database, member: dict, message_id: int) -> tuple:
    """Hidden messages answer not found (DP-71): load with the caller's view."""
    m = db.one("SELECT * FROM messages WHERE id = %s", (message_id,))
    if m is None:
        raise not_found()
    channel = db.one("SELECT * FROM channels WHERE id = %s", (m["channel_id"],))
    c = db.one("SELECT * FROM communities WHERE id = %s", (channel["community_id"],))
    membership = membership_of(db, member["id"], c["id"])
    if membership is None:
        raise not_found()
    now = db.one("SELECT now() AS now")["now"]
    perms = channel_effective_permissions(db, community=c, channel=channel, member_id=member["id"], now=now)
    if "view_channel" not in perms:
        raise not_found()
    return m, channel, c, perms


async def api_message_patch(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    message_id = parse_id_or_404(request.path_params["message_id"])
    m, channel, c, perms = load_message_for_caller(db, member, message_id)
    if m["author_id"] != member["id"]:
        raise forbidden()
    body = await parse_json_body(request)
    text = body.get("body")
    if not isinstance(text, str):
        raise validation("body")
    if "\x00" in text:
        raise validation("body")
    text = text.strip()
    limit = TIER_MESSAGE_LIMIT.get(member["tier"], 2000)
    if "longer_messages" in TIER_ENTITLEMENTS.get(member["tier"], []):
        limit = 4000
    if len(text) > limit:
        raise validation("body")
    if not text:
        existing_attachments = db.one(
            "SELECT COUNT(*) AS n FROM attachments WHERE message_id = %s", (message_id,)
        )["n"]
        if existing_attachments == 0:
            raise validation("body")
    with db.session() as conn:
        with conn.transaction():
            row = conn.execute(
                "UPDATE messages SET body = %s, edited_at = now() WHERE id = %s RETURNING *",
                (text, message_id),
            ).fetchone()
            old_mentions = {r["mentioned_id"] for r in conn.execute(
                "SELECT mentioned_id FROM message_mentions WHERE message_id = %s", (message_id,)
            ).fetchall()}
            new_mentions = compute_mentions(db, text, c, channel, member["id"], perms)
            for mid in new_mentions:
                if mid not in old_mentions:
                    conn.execute(
                        "INSERT INTO message_mentions (message_id, mentioned_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                        (message_id, mid),
                    )
            for mid in old_mentions:
                if mid not in new_mentions:
                    conn.execute(
                        "DELETE FROM message_mentions WHERE message_id = %s AND mentioned_id = %s",
                        (message_id, mid),
                    )
            # an edit notifies only members the message has never mentioned before
            notified = {r["recipient_id"] for r in conn.execute(
                """SELECT recipient_id FROM notifications WHERE message_id = %s AND kind = 'mention'""",
                (message_id,),
            ).fetchall()}
            author_perms = perms
            for mid in new_mentions:
                if mid in old_mentions or mid in notified:
                    continue
                viewer_perms = channel_effective_permissions(
                    db, community=c, channel=channel, member_id=mid,
                    now=conn.execute("SELECT now() AS now").fetchone()["now"])
                if "view_channel" not in viewer_perms:
                    continue
                conn.execute(
                    """INSERT INTO notifications (recipient_id, message_id, community_id, channel_id, kind)
                       VALUES (%s, %s, %s, %s, 'mention')""",
                    (mid, message_id, c["id"], channel["id"]),
                )
    broadcast_message(db, c, channel, row, kind="message_updated")
    return no_store(api_json(message_shape(db, row)))


async def api_message_delete(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    message_id = parse_id_or_404(request.path_params["message_id"])
    m, channel, c, perms = load_message_for_caller(db, member, message_id)
    if m["author_id"] != member["id"] and "manage_messages" not in perms:
        raise forbidden()
    with db.session() as conn:
        with conn.transaction():
            conn.execute("DELETE FROM notifications WHERE message_id = %s", (message_id,))
            conn.execute("DELETE FROM messages WHERE id = %s", (message_id,))
    broadcast_deletion(db, c, channel, message_id)
    return Response(status_code=204, headers={"Cache-Control": "no-store", "Vary": "Authorization"})


def broadcast_deletion(db: Database, c: dict, channel: dict, message_id: int) -> None:
    now = db.one("SELECT now() AS now")["now"]
    payload = json.dumps({"type": "message_deleted", "data": {
        "message_id": message_id, "community_id": c["id"], "channel_id": channel["id"]}})
    for row in db.all("SELECT member_id FROM memberships WHERE community_id = %s", (c["id"],)):
        perms = channel_effective_permissions(db, community=c, channel=channel, member_id=row["member_id"], now=now)
        if "view_channel" in perms:
            db.execute("INSERT INTO live_events (recipient_id, payload) VALUES (%s, %s)",
                       (row["member_id"], payload))


async def api_message_replies(request: Request) -> Response:
    db = db_of(request)
    member = require_session(request)
    message_id = parse_id_or_404(request.path_params["message_id"])
    m, channel, c, perms = load_message_for_caller(db, member, message_id)
    rows = db.all("SELECT * FROM messages WHERE reply_to_id = %s ORDER BY id ASC", (message_id,))
    return no_store(api_json({"data": [message_shape(db, r) for r in rows]}))


async def api_reaction_put(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    message_id = parse_id_or_404(request.path_params["message_id"])
    emoji_raw = request.path_params["emoji"]
    if "\x00" in emoji_raw:
        raise not_found()
    emoji = validate_emoji(emoji_raw)
    if emoji is None:
        raise validation("emoji")
    if emoji.startswith(":") and "custom_emoji" not in TIER_ENTITLEMENTS.get(member["tier"], []):
        raise ApiError("entitlement_required")
    m, channel, c, perms = load_message_for_caller(db, member, message_id)
    if "add_reactions" not in perms:
        raise forbidden()
    with db.session() as conn:
        conn.execute(
            """INSERT INTO reactions (message_id, member_id, emoji)
               VALUES (%s, %s, %s) ON CONFLICT DO NOTHING""",
            (message_id, member["id"], emoji),
        )
    broadcast_message(db, c, channel, m, kind="reaction_added",
                      extra={"emoji": emoji, "user": public_user(member)})
    return Response(status_code=204, headers={"Cache-Control": "no-store", "Vary": "Authorization"})


async def api_reaction_delete(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    message_id = parse_id_or_404(request.path_params["message_id"])
    emoji_raw = request.path_params["emoji"]
    if "\x00" in emoji_raw:
        raise not_found()
    emoji = validate_emoji(emoji_raw)
    if emoji is None:
        raise validation("emoji")
    m, channel, c, perms = load_message_for_caller(db, member, message_id)
    with db.session() as conn:
        removed = conn.execute(
            "DELETE FROM reactions WHERE message_id = %s AND member_id = %s AND emoji = %s RETURNING id",
            (message_id, member["id"], emoji),
        ).fetchone()
    if removed is None:
        raise not_found()
    broadcast_message(db, c, channel, m, kind="reaction_removed",
                      extra={"emoji": emoji, "user": public_user(member)})
    return Response(status_code=204, headers={"Cache-Control": "no-store", "Vary": "Authorization"})


# ---------------------------------------------------------------------------
# attachments and media


async def api_attachment_upload(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    form = await request.form()
    upload = form.get("file")
    if upload is None or isinstance(upload, str) or not upload.filename:
        raise validation("file")
    filename = clean_upload_filename(upload.filename)
    if filename is None:
        raise validation("file")
    data = await upload.read()
    if not data:
        raise validation("file")
    limit = TIER_UPLOAD_LIMITS[member["tier"]]
    if len(data) > limit:
        raise ApiError("payload_too_large", field="file")
    content_type = sniff_content_type(data)
    width = height = None
    duration_ms = None
    if content_type == "image/png":
        width, height = png_size(data)
    elif content_type == "image/jpeg":
        width, height = jpeg_size(data)
    elif content_type == "image/gif":
        width, height = gif_size(data)
    elif content_type == "image/webp":
        width, height = webp_size(data)
    elif content_type == "video/webm":
        width, height, duration_ms = webm_size_duration(data)
    with db.session() as conn:
        row = conn.execute(
            """INSERT INTO attachments (uploader_id, message_id, filename, size_bytes, content_type,
                   sha256, data, width, height, duration_ms)
               VALUES (%s, NULL, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            (member["id"], filename, len(data), content_type,
             hashlib.sha256(data).hexdigest(), data, width, height, duration_ms),
        ).fetchone()
    return no_store(api_json({
        "id": row["id"], "filename": filename, "size_bytes": len(data),
        "content_type": content_type, "sha256": hashlib.sha256(data).hexdigest(),
        "url": f"/media/{row['id']}", "width": width, "height": height, "duration_ms": duration_ms,
    }, status=201))


def media_response(request: Request, attachment_id_raw: str) -> Response:
    db = db_of(request)
    try:
        attachment_id = int(attachment_id_raw)
    except ValueError:
        raise not_found()
    if attachment_id < 1:
        raise not_found()
    row = db.one("SELECT * FROM attachments WHERE id = %s", (attachment_id,))
    if row is None or row["message_id"] is None:
        raise not_found()
    data = row["data"]
    etag = f'"{row["sha256"]}"'
    headers = {
        "ETag": etag,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Content-Disposition": disposition_for(row),
    }
    inm = request.headers.get("if-none-match")
    if inm and etag in [t.strip() for t in inm.split(",")]:
        return Response(status_code=304, headers=headers)
    size = len(data)
    range_header = request.headers.get("range")
    if range_header:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
        if not match:
            raise ApiError("range_not_satisfiable",
                           headers={"Content-Range": f"bytes */{size}"})
        start_raw, end_raw = match.groups()
        if start_raw == "" and end_raw == "":
            raise ApiError("range_not_satisfiable",
                           headers={"Content-Range": f"bytes */{size}"})
        if start_raw == "":
            suffix = int(end_raw)
            if suffix == 0:
                raise ApiError("range_not_satisfiable",
                               headers={"Content-Range": f"bytes */{size}"})
            start = max(0, size - suffix)
            end = size - 1
        else:
            start = int(start_raw)
            end = int(end_raw) if end_raw else size - 1
            if end >= size:
                end = size - 1
        if start >= size or start > end:
            raise ApiError("range_not_satisfiable",
                           headers={"Content-Range": f"bytes */{size}"})
        chunk = data[start:end + 1]
        headers.update({
            "Content-Type": row["content_type"],
            "Accept-Ranges": "bytes",
            "Content-Length": str(len(chunk)),
            "Content-Range": f"bytes {start}-{end}/{size}",
        })
        return Response(chunk, status_code=206, headers=headers)
    headers.update({
        "Content-Type": row["content_type"],
        "Accept-Ranges": "bytes",
        "Content-Length": str(size),
    })
    return Response(bytes(data), status_code=200, headers=headers)


def disposition_for(row: dict) -> str:
    ctype = row["content_type"]
    disp = "inline" if (ctype.startswith("image/") or ctype == "video/webm") else "attachment"
    encoded = urllib.parse.quote(row["filename"], safe="!#$&+-.^_`|~")
    return f"{disp}; filename*=UTF-8''{encoded}"


def disposition_filename(name: str) -> str:
    encoded = urllib.parse.quote(name, safe="!#$&+-.^_`|~")
    return f"filename*=UTF-8''{encoded}"


# ---------------------------------------------------------------------------
# message search


def parse_search_query(q: str) -> dict:
    """Terms and filters per the search rule; malformed queries name q (DP-33)."""
    if not q or len(q) > 200:
        raise validation("q")
    terms = []
    filters: dict = {}
    seen_date = set()
    parts = re.findall(r'"[^"]*"|\S+', q)
    for part in parts:
        if part.startswith('"') and part.endswith('"') and len(part) >= 2:
            inner = part[1:-1]
            if not inner:
                raise validation("q")
            terms.append(("phrase", inner))
            continue
        m = re.fullmatch(r"(from|mentions|in|has|before|after|during):(.*)", part)
        if m:
            key, value = m.group(1), m.group(2)
            if not value:
                raise validation("q")
            if key in ("before", "after", "during"):
                if key in seen_date:
                    raise validation("q")
                seen_date.add(key)
                try:
                    _dt.date.fromisoformat(value)
                except ValueError:
                    raise validation("q")
                filters.setdefault("dates", {})[key] = value
            elif key == "has":
                if value not in ("link", "attachment", "image", "video"):
                    raise validation("q")
                filters.setdefault("has", set()).add(value)
            else:
                filters.setdefault(key, set()).add(value)
        else:
            terms.append(("text", part))
    if not terms and not filters:
        raise validation("q")
    return {"terms": terms, "filters": filters}


async def api_search(request: Request) -> Response:
    db = db_of(request)
    member = require_session(request)
    slug = request.path_params["slug"]
    q_raw = request.query_params.get("q", "")
    q = check_query_value("q", q_raw)
    limit = int_query(request, "limit", 25, 1, 25)
    offset = int_query(request, "offset", 0, 0, 10_000_000)
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    if membership_of(db, member["id"], c["id"]) is None:
        raise forbidden()
    parsed = parse_search_query(q)
    channels = viewable_text_channels(db, c, member["id"])
    text_channel_ids = [ch["id"] for ch in channels if ch["type"] == "text"]
    if not text_channel_ids:
        return no_store(api_json({"total_results": 0, "data": []}))
    args: list = []
    where = ["ch.community_id = %s", "ch.type = 'text'"]
    args.append(c["id"])
    username_filters = parsed["filters"].get("from")
    if username_filters:
        placeholders = ", ".join("%s" for _ in username_filters)
        where.append(f"m.author_id IN (SELECT id FROM members WHERE LOWER(username) IN ({placeholders}))")
        args.extend([u.lower() for u in username_filters])
    mentions_filters = parsed["filters"].get("mentions")
    if mentions_filters:
        placeholders = ", ".join("%s" for _ in mentions_filters)
        where.append(f"m.id IN (SELECT message_id FROM message_mentions mm JOIN members x ON x.id = mm.mentioned_id WHERE LOWER(x.username) IN ({placeholders}))")
        args.extend([u.lower() for u in mentions_filters])
    in_filters = parsed["filters"].get("in")
    if in_filters:
        placeholders = ", ".join("%s" for _ in in_filters)
        where.append(f"LOWER(ch.name) IN ({placeholders})")
        args.extend([n.lower() for n in in_filters])
    has_filters = parsed["filters"].get("has")
    if has_filters:
        if "link" in has_filters:
            where.append("(m.body LIKE '%http://%' OR m.body LIKE '%https://%')")
        if "attachment" in has_filters:
            where.append("EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)")
        if "image" in has_filters:
            where.append("EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type LIKE 'image/%')")
        if "video" in has_filters:
            where.append("EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type LIKE 'video/%')")
    dates = parsed["filters"].get("dates")
    if dates:
        if "during" in dates:
            where.append("m.created_at >= %s::date AND m.created_at < (%s::date + 1)")
            args.extend([dates["during"], dates["during"]])
        if "before" in dates:
            where.append("m.created_at < %s::date")
            args.append(dates["before"])
        if "after" in dates:
            where.append("m.created_at >= (%s::date + 1)")
            args.append(dates["after"])
    for kind, term in parsed["terms"]:
        if kind == "phrase":
            where.append("m.body ILIKE %s")
            args.append("%" + term + "%")
        else:
            where.append("m.body ~* %s")
            args.append(r"\m" + re.escape(term) + r"\M")
    # only viewable channels
    placeholders = ", ".join("%s" for _ in text_channel_ids)
    where.append(f"m.channel_id IN ({placeholders})")
    args.extend(text_channel_ids)
    where_sql = " AND ".join(where)
    with db.session() as conn:
        total = conn.execute(
            f"""SELECT COUNT(*) AS n FROM messages m JOIN channels ch ON ch.id = m.channel_id
                WHERE {' AND '.join(where)}""",
            tuple(args),
        ).fetchone()["n"]
        rows = conn.execute(
            f"""SELECT m.* FROM messages m JOIN channels ch ON ch.id = m.channel_id
                WHERE {where_sql}
                ORDER BY m.id DESC LIMIT %s OFFSET %s""",
            tuple(args) + (limit, offset),
        ).fetchall()
    return no_store(api_json({"total_results": int(total),
                              "data": [message_shape(db, r) for r in rows]}))


# ---------------------------------------------------------------------------
# read states and notifications


async def api_read_states(request: Request) -> Response:
    db = db_of(request)
    member = require_session(request)
    slug = request.path_params["slug"]
    c = load_community(db, slug)
    if c is None:
        raise not_found()
    if membership_of(db, member["id"], c["id"]) is None:
        raise forbidden()
    channels = viewable_text_channels(db, c, member["id"])
    data = []
    for ch in channels:
        if ch["type"] != "text":
            continue
        state = db.one(
            "SELECT * FROM read_states WHERE member_id = %s AND channel_id = %s",
            (member["id"], ch["id"]),
        )
        marker = state["last_read_message_id"] if state else None
        unread = db.one(
            """SELECT COUNT(*) AS n FROM messages m WHERE m.channel_id = %s
               AND m.id > COALESCE(%s, 0) AND m.author_id != %s""",
            (ch["id"], marker, member["id"]),
        )["n"]
        mention_count = db.one(
            """SELECT COUNT(*) AS n FROM messages m
               JOIN message_mentions mm ON mm.message_id = m.id
               WHERE m.channel_id = %s AND m.id > COALESCE(%s, 0) AND mm.mentioned_id = %s""",
            (ch["id"], marker, member["id"]),
        )["n"]
        data.append({
            "channel_id": ch["id"],
            "last_read_message_id": marker,
            "unread_count": int(unread),
            "mention_count": int(mention_count),
        })
    return no_store(api_json({"data": data}))


async def api_channel_ack(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    channel_id = parse_id_or_404(request.path_params["channel_id"])
    message_id_raw = request.query_params.get("message_id")
    body = await parse_json_body(request)
    message_id = body.get("message_id")
    if not isinstance(message_id, int) or isinstance(message_id, bool):
        raise validation("message_id")
    channel = db.one("SELECT * FROM channels WHERE id = %s", (channel_id,))
    if channel is None:
        raise not_found()
    c = db.one("SELECT * FROM communities WHERE id = %s", (channel["community_id"],))
    if membership_of(db, member["id"], c["id"]) is None:
        raise forbidden()
    now = db.one("SELECT now() AS now")["now"]
    perms = channel_effective_permissions(db, community=c, channel=channel, member_id=member["id"], now=now)
    if "view_channel" not in perms:
        raise forbidden()
    target = db.one("SELECT 1 FROM messages WHERE id = %s AND channel_id = %s", (message_id, channel_id))
    if target is None:
        raise validation("message_id")
    with db.session() as conn:
        # a marker never moves backward
        conn.execute(
            """INSERT INTO read_states (member_id, channel_id, last_read_message_id)
               VALUES (%s, %s, %s)
               ON CONFLICT (member_id, channel_id)
               DO UPDATE SET last_read_message_id = GREATEST(read_states.last_read_message_id, EXCLUDED.last_read_message_id)""",
            (member["id"], channel_id, message_id),
        )
    state = db.one(
        "SELECT * FROM read_states WHERE member_id = %s AND channel_id = %s",
        (member["id"], channel_id),
    )
    marker = state["last_read_message_id"] if state else None
    unread = db.one(
        """SELECT COUNT(*) AS n FROM messages m WHERE m.channel_id = %s
           AND m.id > COALESCE(%s, 0) AND m.author_id != %s""",
        (channel_id, marker, member["id"]),
    )["n"]
    mention_count = db.one(
        """SELECT COUNT(*) AS n FROM messages m
           JOIN message_mentions mm ON mm.message_id = m.id
           WHERE m.channel_id = %s AND m.id > COALESCE(%s, 0) AND mm.mentioned_id = %s""",
        (channel_id, marker, member["id"]),
    )["n"]
    return no_store(api_json({
        "channel_id": channel_id, "last_read_message_id": marker,
        "unread_count": int(unread), "mention_count": int(mention_count),
    }))


def notification_shape(n: dict, actor_row: Optional[dict]) -> dict:
    return {
        "id": n["id"], "kind": n["kind"], "read": n["read"],
        "created_at": iso_seconds(n["created_at"]),
        "message_id": n["message_id"], "channel_id": n["channel_id"],
        "community_id": n["community_id"], "actor": actor_row,
    }


def collect_visible(db: Database, member: dict, *, unread_only: bool, before_id, limit: int) -> tuple:
    """Walk pages by id descending, keeping only entries the recipient may see now."""
    out = []
    cursor = before_id
    has_more = False
    while True:
        args = [member["id"]]
        where = ["n.recipient_id = %s"]
        if unread_only:
            where.append("n.read = FALSE")
        if cursor is not None:
            where.append("n.id < %s")
            args.append(cursor)
        rows = db.all(
            f"""SELECT n.* FROM notifications n
                WHERE {' AND '.join(where)}
                ORDER BY n.id DESC LIMIT %s""",
            tuple(args) + (limit * 3,),
        )
        if not rows:
            break
        for row in rows:
            if len(out) >= limit + 1:
                break
            if notification_visible(db, row, member):
                out.append(row)
            cursor = row["id"]
        if len(out) >= limit + 1 or len(rows) < limit * 3:
            break
    has_more = len(out) > limit
    return out[:limit], has_more, cursor


async def api_notifications_list(request: Request) -> Response:
    db = db_of(request)
    member = require_session(request)
    unread_only = bool_query(request, "unread", False)
    limit = int_query(request, "limit", 20, 1, 50)
    before = request.query_params.get("before")
    before_id = None
    if before:
        if not re.fullmatch(r"[1-9][0-9]{0,9}", before):
            raise validation("before")
        before_id = int(before)
        if before_id > 2147483647:
            raise validation("before")
    rows, has_more, _cursor = collect_visible(
        db, member, unread_only=unread_only, before_id=before_id, limit=limit)
    unread_rows, _, _ = collect_visible(
        db, member, unread_only=True, before_id=None, limit=10000)
    data = []
    for n in rows:
        actor = None
        if n["message_id"] is not None:
            m = db.one("SELECT author_id FROM messages WHERE id = %s", (n["message_id"],))
            if m is not None:
                actor_row = db.one("SELECT * FROM members WHERE id = %s", (m["author_id"],))
                actor = public_user(actor_row) if actor_row else None
        data.append(notification_shape(n, actor))
    return no_store(api_json({"data": data, "unread_count": len(unread_rows), "has_more": has_more}))


async def api_notification_read(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    note_id = parse_id_or_404(request.path_params["id"])
    row = db.one("SELECT * FROM notifications WHERE id = %s", (note_id,))
    if row is None or row["recipient_id"] != member["id"]:
        raise not_found()
    if not notification_visible(db, row, member):
        raise not_found()
    with db.session() as conn:
        conn.execute("UPDATE notifications SET read = TRUE WHERE id = %s", (note_id,))
    return no_store(api_json({"id": note_id, "read": True}))


def notification_visible(db: Database, row: dict, member: dict) -> bool:
    if membership_of(db, member["id"], row["community_id"]) is None:
        return False
    if row["channel_id"] is None:
        return True
    channel = db.one("SELECT * FROM channels WHERE id = %s", (row["channel_id"],))
    if channel is None:
        return False
    now = db.one("SELECT now() AS now")["now"]
    perms = channel_effective_permissions(db, community=db.one(
        "SELECT * FROM communities WHERE id = %s", (channel["community_id"],)),
        channel=channel, member_id=member["id"], now=now)
    return "view_channel" in perms


async def api_notifications_read_all(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    visible_rows, _, _ = collect_visible(
        db, member, unread_only=True, before_id=None, limit=100000)
    visible_ids = [r["id"] for r in visible_rows]
    if visible_ids:
        with db.session() as conn:
            conn.execute(
                "UPDATE notifications SET read = TRUE WHERE id = ANY(%s)",
                (visible_ids,),
            )
    return no_store(api_json({"updated": len(visible_ids)}))


# ---------------------------------------------------------------------------
# live (SSE)


async def api_live(request: Request) -> Response:
    """The single live channel, authenticated at the handshake (DP-81)."""
    check_origin(request, config_of(request).public_origin)
    member = resolve_bearer(request)
    if member is None:
        raise unauthorized()
    hub = request.app.state.hub
    header = request.headers.get("authorization") or ""
    token = header[7:].strip()
    token_hash = sha256_hex(token)
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    async def stream():
        hub.live.subscribe(member["id"], token_hash, queue, loop)
        try:
            yield b":ok\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield b":keepalive\n\n"
                    continue
                if event.get("type") == "__session_ended__":
                    return
                payload = json.dumps(event, ensure_ascii=False)
                yield f"data: {payload}\n\n".encode("utf-8")
        finally:
            hub.live.unsubscribe(member["id"], token_hash, queue)

    headers = {
        "Cache-Control": "no-store",
        "Vary": "Authorization",
        "Content-Type": "text/event-stream",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(stream(), headers=headers, background=None)


# ---------------------------------------------------------------------------
# membership and billing


async def api_tiers(request: Request) -> Response:
    return api_json({"data": [
        {"id": "basic", "name": "Basic", "price_cents": 299, "currency": "usd",
         "entitlements": TIER_ENTITLEMENTS["basic"]},
        {"id": "max", "name": "Max", "price_cents": 999, "currency": "usd",
         "entitlements": TIER_ENTITLEMENTS["max"]},
    ]})


async def api_checkout(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    cfg = config_of(request)
    member = require_session(request)
    body = await parse_json_body(request)
    tier = body.get("tier")
    card = body.get("card_number")
    key = request.headers.get("idempotency-key")
    if tier not in ("basic", "max"):
        raise validation("tier")
    if not isinstance(card, str):
        raise validation("card_number")
    digits = card.replace(" ", "")
    if not re.fullmatch(r"[0-9]{16}", digits):
        raise validation("card_number")
    if key is not None:
        if not key or len(key) > 64 or any(c < "!" or c > "~" for c in key):
            raise validation("Idempotency-Key")
    with db.session() as conn:
        with conn.transaction():
            if key:
                stored = conn.execute(
                    "SELECT * FROM idempotency_keys WHERE member_id = %s AND key = %s",
                    (member["id"], key),
                ).fetchone()
                if stored:
                    if stored["tier"] != tier or stored["card_digits"] != digits:
                        raise conflict()
                    body_out = json.loads(stored.get("body_json") or "{}") if "body_json" in stored else None
                    if stored["status"] == 200:
                        return no_store(api_json(_replay_success_body(db, stored), status=200))
                    return no_store(api_json({"error": {"code": "payment_declined",
                        "message": ERROR_MESSAGES["payment_declined"], "field": None}}, status=402))
            if member["tier"] == tier:
                raise conflict()
            decided = conn.execute(
                """INSERT INTO idempotency_keys (member_id, key, tier, card_digits, status)
                   VALUES (%s, %s, %s, %s, 0) ON CONFLICT (member_id, key) DO NOTHING RETURNING id""",
                (member["id"], key or "", tier, digits),
            ).fetchone() if key else None
            amount = _billing_amount(member["tier"], tier)
            success = digits == "4242424242424242"
            if success:
                conn.execute(
                    "UPDATE subscriptions SET status = 'cancelled' WHERE member_id = %s AND status = 'active'",
                    (member["id"],),
                )
                receipt = conn.execute(
                    """INSERT INTO subscriptions (member_id, tier, amount_cents, status)
                       VALUES (%s, %s, %s, 'active') RETURNING id""",
                    (member["id"], tier, amount),
                ).fetchone()
                conn.execute(
                    "UPDATE members SET tier = %s WHERE id = %s", (tier, member["id"])
                )
                body_text = f"Amount: ${amount // 100}.{amount % 100:02d}"
                conn.execute(
                    "INSERT INTO outbox (recipient, subject, body) VALUES (%s, %s, %s)",
                    (member["email"], f"Your Community Hub receipt {receipt['id']}", body_text),
                )
                if key:
                    conn.execute(
                        "UPDATE idempotency_keys SET status = 200, receipt_id = %s WHERE id = %s",
                        (receipt["id"], decided["id"]),
                    )
                response = {"tier": tier, "entitlements": TIER_ENTITLEMENTS[tier],
                            "receipt": {"id": receipt["id"], "amount_cents": amount, "currency": "usd"}}
                return no_store(api_json(response, status=200))
            # declined
            conn.execute(
                """INSERT INTO subscriptions (member_id, tier, amount_cents, status)
                   VALUES (%s, %s, %s, 'declined')""",
                (member["id"], tier, amount),
            )
            if key:
                conn.execute(
                    "UPDATE idempotency_keys SET status = 402 WHERE id = %s", (decided["id"],)
                )
            raise ApiError("payment_declined")


def _replay_success_body(db: Database, stored: dict) -> dict:
    receipt = db.one("SELECT * FROM subscriptions WHERE id = %s", (stored["receipt_id"],))
    amount = receipt["amount_cents"] if receipt else 0
    tier = stored["tier"]
    return {"tier": tier, "entitlements": TIER_ENTITLEMENTS[tier],
            "receipt": {"id": stored["receipt_id"], "amount_cents": amount, "currency": "usd"}}


def _billing_amount(current: str, target: str) -> int:
    """The billing amount in one place (DP-34, DP-35)."""
    if current == "free":
        return TIER_PRICES[target]
    if current == "basic" and target == "max":
        return TIER_PRICES["max"] - TIER_PRICES["basic"]
    if current == "max" and target == "basic":
        return 0
    return TIER_PRICES[target]


async def api_membership_cancel(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    member = require_session(request)
    if member["tier"] == "free":
        raise conflict()
    with db.session() as conn:
        with conn.transaction():
            conn.execute(
                "UPDATE subscriptions SET status = 'cancelled' WHERE member_id = %s AND status = 'active'",
                (member["id"],),
            )
            conn.execute("UPDATE members SET tier = 'free', app_icon = 'classic' WHERE id = %s",
                         (member["id"],))
    return Response(status_code=204, headers={"Cache-Control": "no-store", "Vary": "Authorization"})


# ---------------------------------------------------------------------------
# trending, safety, support, analytics


def _game_community(db: Database, game: dict, viewer: Optional[dict]) -> Optional[dict]:
    """Published visibility: no community to non-members while unpublished (DP-37)."""
    row = db.one(
        "SELECT community_slug FROM game_communities WHERE game_slug = %s", (game["slug"],)
    )
    if row is None:
        return None
    c = db.one("SELECT * FROM communities WHERE slug = %s", (row["community_slug"],))
    if c is None:
        return None
    if not c["published"]:
        if viewer is None or membership_of(db, viewer["id"], c["id"]) is None:
            return None
    members, _ = community_counts(db, c["id"])
    return {"slug": c["slug"], "name": c["name"], "member_count": members}


def _week_streak(db: Database, game_slug: str, week: str) -> int:
    rows = db.all(
        "SELECT week_date FROM trending_ranks WHERE game_slug = %s ORDER BY week_date DESC",
        (game_slug,),
    )
    dates = {str(r["week_date"]) for r in rows}
    current = _dt.date.fromisoformat(week)
    streak = 0
    while str(current) in dates:
        streak += 1
        current -= _dt.timedelta(days=7)
    return streak


async def api_trending(request: Request) -> Response:
    db = db_of(request)
    viewer = resolve_bearer(request)
    week = request.query_params.get("week")
    category = request.query_params.get("category", "all")
    if category not in GAME_CATEGORIES:
        raise validation("category")
    with db.session() as conn:
        weeks = [str(r["week_date"]) for r in conn.execute(
            "SELECT week_date FROM trending_weeks ORDER BY week_date DESC").fetchall()]
    if week is None or week == "":
        if not weeks:
            raise not_found()
        week = weeks[0]
    else:
        week = check_query_value("week", week)
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", week) or not _valid_date(week):
            raise validation("week")
        if week not in weeks:
            raise not_found()
    idx = weeks.index(week)
    prev_week = weeks[idx + 1] if idx + 1 < len(weeks) else None
    next_week = weeks[idx - 1] if idx - 1 >= 0 else None
    rows = db.all(
        """SELECT g.*, r.rank, r.plays_change_pct, r.streams_change_pct FROM trending_ranks r
           JOIN trending_games g ON g.slug = r.game_slug
           WHERE r.week_date = %s ORDER BY r.rank ASC""",
        (week,),
    )
    games = []
    for row in rows:
        if category != "all" and category not in (row["categories"] or []):
            continue
        games.append({
            "rank": row["rank"], "slug": row["slug"], "name": row["name"],
            "description": row["description"], "cover_url": row["cover_url"],
            "categories": row["categories"] or [],
            "plays_change_pct": row["plays_change_pct"],
            "streams_change_pct": row["streams_change_pct"],
            "week_streak": _week_streak(db, row["slug"], week),
            "community": _game_community(db, row, viewer),
        })
    return no_store(api_json({
        "week_date": week, "prev_week_date": prev_week, "next_week_date": next_week,
        "games": games,
    }))


def _valid_date(value: str) -> bool:
    try:
        _dt.date.fromisoformat(value)
        return True
    except ValueError:
        return False


async def api_game_detail(request: Request) -> Response:
    db = db_of(request)
    viewer = resolve_bearer(request)
    slug = request.path_params["slug"]
    if "\x00" in slug:
        raise not_found()
    game = db.one("SELECT * FROM trending_games WHERE slug = %s", (slug,))
    if game is None:
        raise not_found()
    weeks = [str(r["week_date"]) for r in db.all(
        "SELECT week_date FROM trending_weeks ORDER BY week_date DESC")]
    if not weeks:
        raise not_found()
    week = weeks[0]
    rank_row = db.one(
        "SELECT * FROM trending_ranks WHERE game_slug = %s AND week_date = %s",
        (slug, week),
    )
    history = db.all(
        """SELECT week_date, rank, plays_change_pct, streams_change_pct FROM trending_ranks
           WHERE game_slug = %s ORDER BY week_date DESC""",
        (slug,),
    )
    history_out = [{
        "week_date": str(h["week_date"]), "rank": h["rank"],
        "plays_change_pct": h["plays_change_pct"], "streams_change_pct": h["streams_change_pct"],
    } for h in history]
    return no_store(api_json({
        "rank": rank_row["rank"] if rank_row else None,
        "slug": game["slug"], "name": game["name"], "description": game["description"],
        "cover_url": game["cover_url"], "categories": game["categories"] or [],
        "plays_change_pct": rank_row["plays_change_pct"] if rank_row else None,
        "streams_change_pct": rank_row["streams_change_pct"] if rank_row else None,
        "week_streak": _week_streak(db, slug, week),
        "community": _game_community(db, game, viewer),
        "history": history_out,
    }))


async def api_safety_articles(request: Request) -> Response:
    db = db_of(request)
    q_raw = request.query_params.get("q")
    category = request.query_params.get("category")
    topic = request.query_params.get("topic")
    q = ""
    if q_raw is not None:
        q = check_query_value("q", q_raw)
        if len(q) > 256:
            raise validation("q")
    args = []
    where = ["TRUE"]
    if q:
        where.append("(LOWER(title) LIKE %s OR LOWER(summary) LIKE %s)")
        like = "%" + q.lower() + "%"
        args.extend([like, like])
    if category:
        where.append("LOWER(category) = LOWER(%s)")
        args.append(category)
    if topic:
        where.append("LOWER(topic) = LOWER(%s)")
        args.append(topic)
    rows = db.all(
        f"SELECT * FROM safety_articles WHERE {' AND '.join(where)} ORDER BY id ASC",
        tuple(args),
    )
    return api_json({"data": [{
        "slug": r["slug"], "title": r["title"], "category": r["category"],
        "topic": r["topic"], "summary": r["summary"],
    } for r in rows]})


async def api_support_ticket(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    cfg = config_of(request)
    body = await parse_json_body(request)
    email = validate_email(body.get("email")) if "email" in body else None
    if not email:
        raise validation("email")
    category = body.get("category")
    if category not in ("account", "billing", "safety", "other"):
        raise validation("category")
    subject = body.get("subject")
    desc = body.get("body")
    if not isinstance(subject, str) or not (3 <= len(subject) <= 120) or "\x00" in subject:
        raise validation("subject")
    if not isinstance(desc, str) or not (10 <= len(desc) <= 5000) or "\x00" in desc:
        raise validation("body")
    with db.session() as conn:
        with conn.transaction():
            recent = conn.execute(
                """SELECT COUNT(*) AS n FROM support_tickets WHERE email = %s
                   AND created_at > now() - (%s * INTERVAL '1 second')""",
                (email, cfg.support_window_seconds),
            ).fetchone()["n"]
            if recent >= 3:
                oldest = conn.execute(
                    """SELECT MIN(created_at) AS oldest FROM support_tickets WHERE email = %s
                       AND created_at > now() - (%s * INTERVAL '1 second')""",
                    (email, cfg.support_window_seconds),
                ).fetchone()["oldest"]
                now = conn.execute("SELECT now() AS now").fetchone()["now"]
                wait = (oldest + _dt.timedelta(seconds=cfg.support_window_seconds) - now).total_seconds()
                raise rate_limited(max(1, math.ceil(wait)))
            row = conn.execute(
                """INSERT INTO support_tickets (reference, email, category, subject, body)
                   VALUES ('TMP', %s, %s, %s, %s) RETURNING id""",
                (email, category, subject, desc),
            ).fetchone()
            reference = f"HUB-{row['id']:06d}"
            conn.execute(
                "UPDATE support_tickets SET reference = %s WHERE id = %s", (reference, row["id"])
            )
            conn.execute(
                "INSERT INTO outbox (recipient, subject, body) VALUES (%s, %s, %s)",
                (email, f"We received your request {reference}",
                 "Thanks for reaching out. Our team will reply soon."),
            )
    return api_json({"id": row["id"], "reference": reference, "status": "open"}, status=201)


async def api_pageview(request: Request) -> Response:
    await guard(request, write=True)
    db = db_of(request)
    body = await parse_json_body(request)
    path = body.get("path")
    visitor_id = body.get("visitor_id")
    if not isinstance(path, str) or not path or "\x00" in path:
        raise validation("path")
    if not isinstance(visitor_id, str) or not visitor_id:
        raise validation("visitor_id")
    db.execute(
        "INSERT INTO page_views (path, visitor_id) VALUES (%s, %s)",
        (path, visitor_id),
    )
    return Response(status_code=204)
