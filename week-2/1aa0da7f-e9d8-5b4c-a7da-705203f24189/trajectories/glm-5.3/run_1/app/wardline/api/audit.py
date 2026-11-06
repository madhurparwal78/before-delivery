"""Link holder routes, downloads, ledger and audit surfaces (DP-60 to DP-94)."""
from __future__ import annotations

import datetime

from .. import ledger, security
from ..errors import (
    REQUIRED,
    ApiError,
    forbidden,
    method_not_allowed,
    not_found,
    storage_unavailable,
    throttled,
    unauthenticated,
)
from .base import db_ts
from .ctx import Ctx
from .releases import _load_items

PRIVACY_HEADERS = {
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
}


def _live_link(ctx: Ctx, token: str):
    digest = security.hash_token(token)
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT id, release_id, expires_at, state FROM links WHERE token_sha256 = %s", (digest,)
        )
        row = cur.fetchone()
    if not row:
        return None
    link_id, rid, expires_at, state = row
    now = datetime.datetime.now(datetime.timezone.utc)
    if state != "active" or expires_at.astimezone(datetime.timezone.utc) <= now:
        return None
    return link_id, rid


async def link_view(ctx: Ctx) -> dict:
    token = ctx.request.scope['path_params']["token"]
    live = _live_link(ctx, token)
    if live is None:
        resp = ctx.json(404, {"error": "not_found"})
        resp.headers.update(PRIVACY_HEADERS)
        return resp
    link_id, rid = live
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, matter_ref, recipient_kind, manifest_digest FROM releases WHERE id = %s", (rid,)
        )
        r = cur.fetchone()
        if not r:
            resp = ctx.json(404, {"error": "not_found"})
            resp.headers.update(PRIVACY_HEADERS)
            return resp
        items = _load_items(ctx, rid)
    body = {
        "reference": r[0],
        "name": r[1],
        "matter_ref": r[2],
        "recipient_kind": r[3],
        "manifest_digest": r[4],
        "items": [{"id": i["id"], "label": i["label"], "sha256": _item_sha(ctx, i["derivative_id"]),
                   "size": i["size"]} for i in items],
    }
    resp = ctx.json(200, body)
    resp.headers.update(PRIVACY_HEADERS)
    return resp


def _item_sha(ctx: Ctx, derivative_id: str) -> str:
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT sha256 FROM derivatives WHERE id = %s", (derivative_id,))
        return cur.fetchone()[0]


async def link_item_grant(ctx: Ctx) -> dict:
    token = ctx.request.scope['path_params']["token"]
    item_id = ctx.request.scope['path_params']["item_id"]
    live = _live_link(ctx, token)
    if live is None:
        resp = ctx.json(404, {"error": "not_found"})
        resp.headers.update(PRIVACY_HEADERS)
        return resp
    link_id, rid = live
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT derivative_id FROM release_items WHERE id = %s AND release_id = %s",
            (item_id, rid),
        )
        item = cur.fetchone()
    if not item:
        resp = ctx.json(404, {"error": "not_found"})
        resp.headers.update(PRIVACY_HEADERS)
        return resp
    # collection throttle: 10 grants in any 60 seconds per link
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (919191 ^ (hash(link_id) & 0x7FFFFFFF),))
    now = datetime.datetime.now(datetime.timezone.utc)
    cur.execute(
        "SELECT window_start, window_end, count FROM link_collect_windows WHERE link_id = %s", (link_id,)
    )
    w = cur.fetchone()
    burst = False
    if not w or w[1].astimezone(datetime.timezone.utc) <= now:
        cur.execute(
            "INSERT INTO link_collect_windows (link_id, window_start, window_end, count) "
            "VALUES (%s, %s, %s, 1) ON CONFLICT (link_id) DO UPDATE SET "
            "window_start = %s, window_end = %s, count = 1",
            (link_id, now, now + datetime.timedelta(seconds=60), now, now + datetime.timedelta(seconds=60)),
        )
    else:
        if w[2] >= 10:
            remaining = max(1, int((w[1].astimezone(datetime.timezone.utc) - now).total_seconds()))
            ctx.rollback()
            raise throttled(min(60, remaining))
        cur.execute(
            "UPDATE link_collect_windows SET count = count + 1 WHERE link_id = %s", (link_id,)
        )
        if w[2] + 1 == 10:
            burst = True
    if burst:
        cur.execute("INSERT INTO signals (kind, target) VALUES ('bulk_collection', %s)", (link_id,))
        ledger.append(cur, f"link:{link_id}", None, "collection.throttled", link_id, {})
    grant_token = security.new_token()
    cur.execute(
        "INSERT INTO download_grants (token_sha256, kind, derivative_id, link_id, expires_at) "
        "VALUES (%s, 'file', %s, %s, now() + interval '60 seconds')",
        (security.hash_token(grant_token), item[0], link_id),
    )
    ctx.commit()
    resp = ctx.json(201, {"token": grant_token, "expires_in_seconds": 60})
    resp.headers.update(PRIVACY_HEADERS)
    return resp


async def download(ctx: Ctx):
    """Claim a download grant and stream the object (DP-19, DP-64, DP-65)."""
    token = ctx.request.scope['path_params']["token"]
    digest = security.hash_token(token)
    cur = ctx.begin()
    cur.execute(
        "SELECT kind, exhibit_id, derivative_id, preview_page, session_id, link_id, expires_at, claimed_at "
        "FROM download_grants WHERE token_sha256 = %s", (digest,),
    )
    row = cur.fetchone()
    if not row or row[7] is not None or row[6].astimezone(datetime.timezone.utc) <= datetime.datetime.now(datetime.timezone.utc):
        ctx.rollback()
        resp = ctx.json(404, {"error": "not_found"})
        resp.headers.update(PRIVACY_HEADERS)
        return resp
    kind, exhibit_id, derivative_id, preview_page, session_id, link_id, expires_at, _claimed = row
    # tokens die with their authority (DP-63)
    if session_id:
        cur.execute("SELECT closed FROM sessions WHERE id = %s", (session_id,))
        s = cur.fetchone()
        if not s or s[0] is not None:
            ctx.rollback()
            resp = ctx.json(404, {"error": "not_found"})
            resp.headers.update(PRIVACY_HEADERS)
            return resp
        if exhibit_id:
            cur.execute(
                "SELECT e.state, c.id, g.scope FROM exhibits e JOIN compartments c ON c.id = e.compartment_id "
                "LEFT JOIN grants g ON g.compartment_id = c.id AND g.user_id = "
                "(SELECT user_id FROM sessions WHERE id = %s) AND g.state = 'active' "
                "WHERE e.id = %s", (session_id, exhibit_id),
            )
            info = cur.fetchone()
            if not info or info[0] == "disposed" or info[2] != "full":
                ctx.rollback()
                resp = ctx.json(404, {"error": "not_found"})
                resp.headers.update(PRIVACY_HEADERS)
                return resp
        if derivative_id:
            cur.execute(
                "SELECT d.disposed, e.state, g.scope FROM derivatives d JOIN exhibits e ON e.id = d.exhibit_id "
                "LEFT JOIN grants g ON g.compartment_id = d.compartment_id AND g.user_id = "
                "(SELECT user_id FROM sessions WHERE id = %s) AND g.state = 'active' "
                "WHERE d.id = %s", (session_id, derivative_id),
            )
            info = cur.fetchone()
            if not info or info[0] or info[1] == "disposed":
                ctx.rollback()
                resp = ctx.json(404, {"error": "not_found"})
                resp.headers.update(PRIVACY_HEADERS)
                return resp
    else:
        live = None
        if link_id:
            cur.execute("SELECT state, expires_at FROM links WHERE id = %s", (link_id,))
            l = cur.fetchone()
            if l and l[0] == "active" and l[1].astimezone(datetime.timezone.utc) > datetime.datetime.now(datetime.timezone.utc):
                live = True
        if link_id and not live:
            ctx.rollback()
            resp = ctx.json(404, {"error": "not_found"})
            resp.headers.update(PRIVACY_HEADERS)
            return resp
    # claim: exactly one winner
    cur.execute(
        "UPDATE download_grants SET claimed_at = now() WHERE token_sha256 = %s AND claimed_at IS NULL",
        (digest,),
    )
    if cur.rowcount != 1:
        ctx.rollback()
        resp = ctx.json(404, {"error": "not_found"})
        resp.headers.update(PRIVACY_HEADERS)
        return resp
    # open the object inside this transaction so a failure rolls the claim back
    if kind == "preview":
        cur.execute("SELECT storage_key, sniffed_type, sha256 FROM exhibits WHERE id = %s", (exhibit_id,))
        key, content_type, sha = cur.fetchone()
        kind_target, detail_exhibit, detail_derivative = exhibit_id, exhibit_id, None
        actor = None
    else:
        if derivative_id:
            cur.execute(
                "SELECT storage_key, content_type, sha256, exhibit_id FROM derivatives WHERE id = %s",
                (derivative_id,),
            )
            key, content_type, sha, eid = cur.fetchone()
            kind_target, detail_exhibit, detail_derivative = derivative_id, eid, derivative_id
        else:
            cur.execute("SELECT storage_key, sniffed_type, sha256 FROM exhibits WHERE id = %s", (exhibit_id,))
            key, content_type, sha = cur.fetchone()
            kind_target, detail_exhibit, detail_derivative = exhibit_id, exhibit_id, None
        if session_id:
            cur.execute("SELECT user_id FROM sessions WHERE id = %s", (session_id,))
            actor = cur.fetchone()[0]
        else:
            actor = f"link:{link_id}" if link_id else "system"
    try:
        stream = ctx.app.storage.open_stream(key)
    except Exception:
        ctx.rollback()
        raise storage_unavailable()
    # claim commits once storage has opened the object
    cur.execute(
        "INSERT INTO download_claims (token_sha256, user_id, derivative_id) VALUES (%s, %s, %s) "
        "ON CONFLICT DO NOTHING",
        (digest, actor, detail_derivative),
    )
    detail = {"sha256": sha, "exhibit_id": detail_exhibit, "kind": kind}
    if detail_derivative:
        detail["derivative_id"] = detail_derivative
    if session_id:
        via = None
        cur.execute(
            "SELECT g.kind FROM grants g JOIN sessions s ON s.user_id = g.user_id "
            "WHERE s.id = %s AND g.kind = 'break_glass' AND g.state = 'active' LIMIT 1", (session_id,),
        )
        bg = cur.fetchone()
        if bg:
            cur.execute(
                "SELECT id FROM grants WHERE user_id = (SELECT user_id FROM sessions WHERE id = %s) "
                "AND kind = 'break_glass' AND state = 'active' LIMIT 1", (session_id,),
            )
            bgid = cur.fetchone()[0]
            detail["via"] = "break_glass"
            detail["grant_id"] = bgid
        ledger.append(cur, actor, session_id, "download.claimed", kind_target, detail)
    else:
        ledger.append(cur, actor, None, "download.claimed", kind_target, detail)
    ctx.commit()
    if kind == "preview":
        from .. import rendering
        try:
            data = ctx.app.storage.get(key)
            parsed = rendering.parse(data, content_type)
            png = parsed.raster(preview_page, None)
        except Exception:
            resp = ctx.json(404, {"error": "not_found"})
            resp.headers.update(PRIVACY_HEADERS)
            return resp
        filename = f"{exhibit_id}-{sha[:12]}-p{preview_page}.png"
        return ctx.file_response(png, "image/png", filename)
    stat = ctx.app.storage.stat(key)
    size = stat[0] if stat else 0
    filename = f"{(derivative_id or exhibit_id)}-{sha[:12]}"
    if content_type == "application/pdf":
        filename += ".pdf"
    elif content_type == "image/png":
        filename += ".png"
    elif content_type == "image/jpeg":
        filename += ".jpg"
    return ctx.stream_response(key, size, content_type, filename)


async def ledger_view(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    if ctx.role != "auditor":
        ctx.deny_and_raise(forbidden(), ctx.request.url.path)
    try:
        after = int(ctx.request.query_params.get("after", 0) or 0)
        limit = int(ctx.request.query_params.get("limit", 200) or 200)
    except (TypeError, ValueError):
        after, limit = 0, 200
    if after < 0 or after >= 2**63:
        after = 0
    if limit < 1 or limit >= 2**63:
        limit = 200
    if limit > 1000:
        limit = 1000
    action = ctx.request.query_params.get("action")
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM ledger_entries")
        count = cur.fetchone()[0]
        sql = "SELECT seq, at, actor_id, session_id, action, target, detail, prev_digest, digest FROM ledger_entries WHERE seq > %s"
        params: list = [after]
        if action in ("bulk_collection", "sign_in_lockout", "seal_mismatch"):
            sql += " AND action = %s"
            params.append(_ledger_action(action))
        sql += " ORDER BY seq LIMIT %s"
        params.append(limit)
        cur.execute(sql, params)
        rows = cur.fetchall()
    from .serialisers import ledger_entry
    return ctx.json(200, {"entries": [ledger_entry(r) for r in rows], "count": count})


def _ledger_action(kind: str) -> str:
    return {"bulk_collection": "collection.throttled", "sign_in_lockout": "signin.locked",
            "seal_mismatch": "exhibit.seal_failed"}[kind]


async def signals_view(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    if ctx.role != "auditor":
        ctx.deny_and_raise(forbidden(), ctx.request.url.path)
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT id, kind, at, target FROM signals ORDER BY id DESC LIMIT 200")
        rows = cur.fetchall()
    from .serialisers import signal
    return ctx.json(200, {"signals": [signal(r) for r in rows]})


async def custody_view(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    eid = ctx.request.scope['path_params']["id"]
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT id, compartment_id FROM exhibits WHERE id = %s", (eid,))
        ex = cur.fetchone()
    if not ex:
        ctx.deny_and_raise(not_found(), eid)
    allowed = False
    if ctx.role == "auditor":
        allowed = True
    elif ctx.role == "case_lead":
        grant = ctx.active_grant(ex[1])
        if grant and grant["scope"] == "full":
            allowed = True
    if not allowed:
        ctx.deny_and_raise(ApiError(403, {"error": "forbidden"}) if ctx.active_grant(ex[1]) else not_found(), eid)
    try:
        after = int(ctx.request.query_params.get("after", 0) or 0)
        limit = int(ctx.request.query_params.get("limit", 200) or 200)
    except (TypeError, ValueError):
        after, limit = 0, 200
    if after < 0 or after >= 2**63:
        after = 0
    if limit < 1 or limit >= 2**63:
        limit = 200
    if limit > 1000:
        limit = 1000
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT seq, at, actor_id, session_id, action, target, detail, prev_digest, digest "
            "FROM ledger_entries WHERE (target = %s OR detail ->> 'exhibit_id' = %s) AND seq > %s "
            "ORDER BY seq LIMIT %s",
            (eid, eid, after, limit),
        )
        rows = cur.fetchall()
        derivative_ids = [r[1] for r in []]
        cur.execute(
            "SELECT id FROM derivatives WHERE exhibit_id = %s", (eid,),
        )
        derivs = [r[0] for r in cur.fetchall()]
        if derivs:
            cur.execute(
                "SELECT seq, at, actor_id, session_id, action, target, detail, prev_digest, digest "
                "FROM ledger_entries WHERE target = ANY(%s) AND seq > %s ORDER BY seq LIMIT %s",
                (derivs, after, limit),
            )
            rows = _merge(rows, cur.fetchall())
        cur.execute("SELECT count(*) FROM ledger_entries WHERE (target = %s OR detail ->> 'exhibit_id' = %s)", (eid, eid))
    rows.sort(key=lambda r: r[0])
    from .serialisers import ledger_entry
    next_after = rows[-1][0] if rows else None
    return ctx.json(200, {"entries": [ledger_entry(r) for r in rows], "next_after": next_after})


def _merge(a, b):
    seen = {r[0] for r in a}
    return a + [r for r in b if r[0] not in seen]
