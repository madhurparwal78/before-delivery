"""Breach routes: list, log, preview the blast, detail, edit kinds, remove."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Any

from aiohttp import web

from ..auth.store import Context, new_id
from ..core.exposure import BreachView, HoldingView, affected_holding_ids, compute_exposure, sort_holdings
from ..core.vault_writer import VaultWriter, WriteError
from ..domain import KINDS, match_company
from ..errors import (
    ApiError,
    idempotency_conflict,
    internal_error,
    json_response,
    not_found,
    owner_only,
    stale_version,
    validation,
)
from ..db.base import emit_notification
from .boundary import read_json_body
from ..core.validation import (
    clean_company,
    clean_date,
    clean_kinds,
    reject_unknown_keys,
)
from ..core.versions import check_version
from .holdings import _affected_ids_on, _exposure_for_vault

BREACH_EDITABLE_POST = {"company", "announced_on", "data_kinds"}
BREACH_EDITABLE_PATCH = {"data_kinds", "version"}


def _ctx(request: web.Request) -> Context:
    return request["ctx"]


def _vault_id(ctx: Context) -> str:
    if ctx.account.vault_id is None:
        raise not_found()
    return ctx.account.vault_id


async def _scoped_breaches(request: web.Request, ctx: Context, vault_id: str):
    """The breaches the caller may see, with affected ids limited to the scope."""
    reader = request.app["reader"]
    db = request.app["db"]
    if ctx.account.role == "owner":
        breaches = await reader.breaches_full(vault_id)
        return breaches, None, None
    grant = await reader.grant_for_vault(vault_id)
    db_now = await db.fetchval("SELECT now()")
    from ..core.grant_state import grant_status

    status, _rem = grant_status(grant, db_now) if grant else ("expired", 0)
    if grant is None or status != "active":
        from ..errors import access_ended

        raise access_ended()
    scope_rows = await db.fetch(
        "SELECT id, company, data_kind, level FROM holdings WHERE vault_id = $1 AND level = ANY($2::text[])",
        vault_id, list(grant.levels),
    )
    scope = [
        HoldingView(id=r["id"], company=r["company"], data_kind=r["data_kind"], level=r["level"])
        for r in scope_rows
    ]
    scoped_breach_views = await reader.scope_breaches(vault_id, scope)
    scoped_ids = {b.id for b in scoped_breach_views}
    all_breaches = await reader.breaches_full(vault_id)
    return [b for b in all_breaches if b["id"] in scoped_ids], scope, grant


async def list_breaches(request: web.Request) -> web.Response:
    ctx = _ctx(request)
    vault_id = _vault_id(ctx)
    breaches, scope, _grant = await _scoped_breaches(request, ctx, vault_id)
    db = request.app["db"]
    reader = request.app["reader"]

    if scope is None:
        holdings = await reader.holdings(vault_id)
        breaches_views = await reader.breaches(vault_id)
    else:
        holdings = scope
        breaches_views = await reader.scope_breaches(vault_id, scope)

    affected = set(affected_holding_ids(holdings, breaches_views))
    from ..core.projection import breach_for

    result = []
    for b in breaches:
        b["affected_holding_ids"] = [hid for hid in affected_holding_ids(holdings, breaches_views) if hid in affected]
        if scope is not None:
            in_scope = {h.id for h in scope}
            b["affected_holding_ids"] = [hid for hid in b["affected_holding_ids"] if hid in in_scope]
        result.append(breach_for(ctx, b))
    return json_response({"breaches": result})


async def post_breach_preview(request: web.Request) -> web.Response:
    """The blast preview: touched holdings in ledger order and the projected score."""
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    body = await read_json_body(request)
    if body is None:
        body = {}
    if not isinstance(body, dict):
        raise validation({"company": "Required."})
    reject_unknown_keys(body, {"company", "data_kinds", "breach_id"})
    company = body.get("company")
    if company is not None and not isinstance(company, str):
        raise validation({"company": "Required."})
    company_text = (company or "").strip() if isinstance(company, str) else ""
    kinds_raw = body.get("data_kinds")
    kinds: list[str] = []
    if kinds_raw is not None:
        if not isinstance(kinds_raw, list):
            raise validation({"data_kinds": "Tick at least one data kind."})
        for item in kinds_raw:
            if not isinstance(item, str) or item not in KINDS:
                raise validation({"data_kinds": "Choose a data kind from the list."})
        kinds = list(kinds_raw)
    breach_id = body.get("breach_id")
    if breach_id is not None and not isinstance(breach_id, str):
        raise validation({"breach_id": "Not found."})

    reader = request.app["reader"]
    db = request.app["db"]
    holdings = await reader.holdings(vault_id)
    existing = await reader.breaches(vault_id)
    done = await reader.done_marks(vault_id)

    # The breach set as it would be after this preview: existing breaches, with
    # the named breach's kinds replaced, plus the candidate breach.
    preview_breaches: list[BreachView] = list(existing)
    if breach_id:
        preview_breaches = [b for b in preview_breaches if b.id != breach_id]
    if kinds:
        if company_text:
            candidate_company = company_text
        elif breach_id:
            current = await reader.breach_by_id(vault_id, breach_id)
            if current is None:
                raise not_found()
            candidate_company = current["company"]
        else:
            candidate_company = ""
        if candidate_company:
            preview_breaches.append(
                BreachView(id=breach_id or "preview", company=candidate_company, data_kinds=tuple(kinds))
            )

    current_exposure = compute_exposure(holdings, existing, done)
    preview_exposure = compute_exposure(holdings, preview_breaches, done)
    touched_ids = affected_holding_ids(holdings, preview_breaches)

    return json_response(
        {
            "affected_holding_ids": touched_ids,
            "current_score": current_exposure.score,
            "score": preview_exposure.score,
        }
    )


def _request_fingerprint(vault_id: str, body: dict) -> str:
    canonical = json.dumps(
        {
            "company": body.get("company"),
            "announced_on": body.get("announced_on"),
            "data_kinds": body.get("data_kinds"),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(f"{vault_id}:{canonical}".encode()).hexdigest()


async def create_breach(request: web.Request) -> web.Response:
    """Log a breach, with idempotent replay for a repeated key and body."""
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    body = await read_json_body(request)
    if not isinstance(body, dict):
        raise validation({"company": "Required."})
    idem_key = request.headers.get("Idempotency-Key", "").strip()
    if idem_key:
        if not (1 <= len(idem_key) <= 100):
            raise validation({"idempotency_key": "Too long."})

    # Idempotent replay check runs after auth and before validation conflicts.
    if idem_key:
        stored = await request.app["db"].fetchrow(
            "SELECT request_hash, status, response FROM idempotency_keys WHERE vault_id = $1 AND key = $2",
            vault_id, idem_key,
        )
        fingerprint = _request_fingerprint(vault_id, body)
        if stored is not None:
            if stored["request_hash"] != fingerprint:
                raise idempotency_conflict()
            response = stored["response"]
            if isinstance(response, str):
                response = json.loads(response)
            return json_response(response, status=stored["status"])

    reject_unknown_keys(body, BREACH_EDITABLE_POST)
    today = await request.app["db"].fetchval("SELECT (now() AT TIME ZONE 'utc')::date")
    company = clean_company(body.get("company"))
    announced_on = clean_date(body.get("announced_on"), today.isoformat())
    data_kinds = clean_kinds(body.get("data_kinds"))

    writer: VaultWriter = request.app["writer"]
    db = request.app["db"]
    reader = request.app["reader"]
    breach_id = new_id("brch")
    company_key = match_company(company)

    from datetime import date as date_cls

    async def op(conn) -> None:
        await writer.create_breach(
            conn, vault_id, breach_id, company, company_key,
            date_cls.fromisoformat(announced_on), data_kinds,
        )

    from ..core.projection import breach_for

    async def build_response(conn) -> dict:
        row = await conn.fetchrow(
            """
            SELECT b.id, b.company, b.announced_on, b.version, b.created_at,
                   (SELECT array_agg(bk.data_kind ORDER BY bk.data_kind)
                    FROM breach_kinds bk WHERE bk.breach_id = b.id) AS kinds
            FROM breaches b WHERE b.id = $1
            """,
            breach_id,
        )
        data = dict(row)
        data["kinds"] = list(data["kinds"] or [])
        holdings = await reader.holdings(vault_id)
        breaches = await reader.breaches(vault_id)
        affected = affected_holding_ids(holdings, breaches)
        data["affected_holding_ids"] = affected
        exposure = await _exposure_for_vault(request, ctx, vault_id)
        return {"breach": breach_for(ctx, data), "exposure": exposure}

    try:
        async with db.pool.acquire() as conn:
            async with conn.transaction():
                await op(conn)
                response = await build_response(conn)
                if idem_key:
                    await conn.execute(
                        """
                        INSERT INTO idempotency_keys (vault_id, key, request_hash, status, response)
                        VALUES ($1, $2, $3, 201, $4::jsonb)
                        ON CONFLICT (vault_id, key) DO NOTHING
                        """,
                        vault_id, idem_key, _request_fingerprint(vault_id, body), json.dumps(response),
                    )
        return json_response(response, status=201)
    except WriteError:
        raise internal_error()


async def get_breach(request: web.Request) -> web.Response:
    """One breach with its holdings in ledger order and those holdings' steps."""
    ctx = _ctx(request)
    vault_id = _vault_id(ctx)
    breach_id = request.match_info["id"]
    reader = request.app["reader"]
    db = request.app["db"]

    breach = await reader.breach_by_id(vault_id, breach_id)
    if breach is None:
        raise not_found()

    if ctx.account.role == "owner":
        holdings = await reader.holdings_full(vault_id)
        breaches_views = await reader.breaches(vault_id)
        done = await reader.done_marks(vault_id)
        scope_ids = None
    else:
        grant = await reader.grant_for_vault(vault_id)
        db_now = await db.fetchval("SELECT now()")
        from ..core.grant_state import grant_status

        status, _rem = grant_status(grant, db_now) if grant else ("expired", 0)
        if grant is None or status != "active":
            from ..errors import access_ended

            raise access_ended()
        rows = await db.fetch(
            """
            SELECT id, company, data_kind, value, notes, level, rule_id, version, created_at, updated_at
            FROM holdings WHERE vault_id = $1 AND level = ANY($2::text[])
            """,
            vault_id, list(grant.levels),
        )
        holdings = [dict(r) for r in rows]
        scope_holdings = [
            HoldingView(id=h["id"], company=h["company"], data_kind=h["data_kind"], level=h["level"])
            for h in holdings
        ]
        breaches_views = await reader.scope_breaches(vault_id, scope_holdings)
        done = await reader.done_marks(vault_id)
        scope_ids = {h["id"] for h in scope_holdings}
        if breach_id not in {b.id for b in breaches_views}:
            raise not_found()

    views = [
        HoldingView(id=h["id"], company=h["company"], data_kind=h["data_kind"], level=h["level"])
        for h in holdings
    ]
    affected = affected_holding_ids(views, breaches_views)
    breach["affected_holding_ids"] = [hid for hid in affected if scope_ids is None or hid in scope_ids]

    for h in holdings:
        h["affected"] = h["id"] in breach["affected_holding_ids"]
    ordered = sorted(
        [h for h in holdings if h["affected"]],
        key=lambda h: (
            match_company(h["company"]),
            list(KINDS).index(h["data_kind"]) if h["data_kind"] in KINDS else 99,
            h["created_at"],
            h["id"],
        ),
    )
    exposure = compute_exposure(views, breaches_views, done)
    from ..core.projection import breach_for, holding_for, step_for

    return json_response(
        {
            "breach": breach_for(ctx, breach),
            "holdings": [holding_for(ctx, h) for h in ordered],
            "steps": [step_for(s) for s in exposure.steps],
        }
    )


async def patch_breach(request: web.Request) -> web.Response:
    """Change a breach's data kinds; clears done marks of holdings it no longer touches."""
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    breach_id = request.match_info["id"]
    reader = request.app["reader"]
    writer: VaultWriter = request.app["writer"]
    db = request.app["db"]

    body = await read_json_body(request)
    if not isinstance(body, dict):
        raise validation({"version": "Send the version you loaded."})
    current = await reader.breach_by_id(vault_id, breach_id)
    if current is None:
        raise not_found()
    check_version(body, current["version"])
    reject_unknown_keys(body, BREACH_EDITABLE_PATCH)
    data_kinds = clean_kinds(body.get("data_kinds"))

    from ..core.projection import breach_for

    try:
        async with db.pool.acquire() as conn:
            async with conn.transaction():
                await writer.update_breach_kinds(
                    conn, vault_id, breach_id, data_kinds, current["version"]
                )
                # Clear the done marks of holdings this breach no longer touches.
                holdings = await reader.holdings(vault_id)
                breaches = await reader.breaches(vault_id)
                still_affected = set(affected_holding_ids(holdings, breaches))
                rows = await conn.fetch(
                    "SELECT id, company, data_kind FROM holdings WHERE vault_id = $1", vault_id
                )
                for row in rows:
                    if row["id"] not in still_affected:
                        await conn.execute(
                            "DELETE FROM done_steps WHERE vault_id = $1 AND holding_id = $2",
                            vault_id, row["id"],
                        )
        breach = await reader.breach_by_id(vault_id, breach_id)
        holdings = await reader.holdings(vault_id)
        breaches = await reader.breaches(vault_id)
        breach["affected_holding_ids"] = affected_holding_ids(holdings, breaches)
        exposure = await _exposure_for_vault(request, ctx, vault_id)
        return json_response({"breach": breach_for(ctx, breach), "exposure": exposure})
    except WriteError as exc:
        if exc.code == "stale_version":
            raise stale_version()
        if exc.code == "not_found":
            raise not_found()
        raise internal_error()


async def delete_breach(request: web.Request) -> web.Response:
    """Remove a breach; its touched holdings, steps and score contribution go with it."""
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    breach_id = request.match_info["id"]
    reader = request.app["reader"]
    writer: VaultWriter = request.app["writer"]
    db = request.app["db"]

    if await reader.breach_by_id(vault_id, breach_id) is None:
        raise not_found()

    async with db.pool.acquire() as conn:
        async with conn.transaction():
            deleted = await writer.delete_breach(conn, vault_id, breach_id)
            if not deleted:
                raise not_found()
            # Clear done marks of holdings no longer affected.
            holdings = await reader.holdings(vault_id)
            breaches = await reader.breaches(vault_id)
            still = set(affected_holding_ids(holdings, breaches))
            rows = await conn.fetch(
                "SELECT id FROM holdings WHERE vault_id = $1", vault_id
            )
            for row in rows:
                if row["id"] not in still:
                    await conn.execute(
                        "DELETE FROM done_steps WHERE vault_id = $1 AND holding_id = $2",
                        vault_id, row["id"],
                    )
    return web.Response(status=204)
