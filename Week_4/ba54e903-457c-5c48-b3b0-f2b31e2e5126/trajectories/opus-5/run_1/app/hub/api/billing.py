"""Membership tiers, the test-card checkout, receipts and entitlement undo."""

from __future__ import annotations

import json
from typing import Any

import asyncpg
from starlette.responses import Response

from ..app import Ctx
from ..config import CONFIG
from ..db import DB
from ..errors import conflict, error_response, invalid
from ..mail import queue_email
from ..users import ENTITLEMENTS, TIER_NAMES, entitlements_for
from .common import json_response, no_content

PRICES = {"basic": 299, "max": 999}
SUCCESS_CARD = "4242424242424242"


def tiers_body() -> dict[str, Any]:
    return {
        "data": [
            {
                "id": tier,
                "name": TIER_NAMES[tier],
                "price_cents": PRICES[tier],
                "currency": "usd",
                "entitlements": entitlements_for(tier),
            }
            for tier in ("basic", "max")
        ]
    }


async def read_tiers(ctx: Ctx) -> Response:
    return json_response(tiers_body())


def amount_for(current: str, target: str) -> int:
    """The amount this move charges: a full price, the difference, or nothing."""
    if current == "free":
        return PRICES[target]
    if current == "basic" and target == "max":
        return PRICES["max"] - PRICES["basic"]
    return 0


def clean_idempotency_key(raw: str | None) -> str | None:
    if raw is None:
        return None
    if not 1 <= len(raw) <= 64 or any(not 0x21 <= ord(ch) <= 0x7E for ch in raw):
        raise invalid("Idempotency-Key")
    return raw


async def _undo_lost_entitlements(
    conn: asyncpg.Connection, member_id: int, tier: str
) -> None:
    if "custom_app_icons" not in ENTITLEMENTS[tier]:
        await conn.execute(
            "UPDATE members SET app_icon = 'classic' WHERE id = $1 AND app_icon <> 'classic'",
            member_id,
        )


async def checkout(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    key = clean_idempotency_key(ctx.request.headers.get("idempotency-key"))
    body = ctx.body()
    card_digits = (body.text("card_number") or "").replace(" ", "")
    tier = body.text("tier")

    async with DB.transaction() as conn:
        if key is not None:
            stored = await conn.fetchrow(
                """
                SELECT tier, card_digits, status_code, response FROM idempotency_keys
                WHERE member_id = $1 AND key = $2
                  AND created_at > clock_timestamp() - make_interval(secs => $3)
                """,
                ctx.caller.id,
                key,
                CONFIG.idempotency_key_ttl_seconds,
            )
            if stored is not None:
                if stored["tier"] != (tier or "") or stored["card_digits"] != card_digits:
                    raise conflict(None)
                return _stored_response(stored)

        await conn.execute(
            "SELECT pg_advisory_xact_lock(hashtext($1))", f"checkout:{ctx.caller.id}"
        )
        if tier not in PRICES:
            raise invalid("tier")
        current = await conn.fetchval(
            "SELECT tier FROM members WHERE id = $1 FOR UPDATE", ctx.caller.id
        )
        if current == tier:
            raise conflict(None)
        if len(card_digits) != 16 or not card_digits.isdigit():
            raise invalid("card_number")

        amount = amount_for(current, tier)
        if card_digits != SUCCESS_CARD:
            await conn.execute(
                """
                INSERT INTO subscriptions (member_id, tier, amount_cents, status)
                VALUES ($1, $2, $3, 'declined')
                """,
                ctx.caller.id,
                tier,
                amount,
            )
            payload = {
                "error": {
                    "code": "payment_declined",
                    "message": "Your card was declined.",
                    "field": None,
                }
            }
            await _store_key(conn, ctx.caller.id, key, tier, card_digits, 402, payload)
            return error_response(402, "payment_declined")

        await conn.execute(
            "UPDATE subscriptions SET status = 'cancelled' WHERE member_id = $1 "
            "AND status = 'active'",
            ctx.caller.id,
        )
        receipt_id = await conn.fetchval(
            """
            INSERT INTO subscriptions (member_id, tier, amount_cents, status)
            VALUES ($1, $2, $3, 'active') RETURNING id
            """,
            ctx.caller.id,
            tier,
            amount,
        )
        await conn.execute("UPDATE members SET tier = $2 WHERE id = $1", ctx.caller.id, tier)
        await _undo_lost_entitlements(conn, ctx.caller.id, tier)
        payload = {
            "tier": tier,
            "entitlements": entitlements_for(tier),
            "receipt": {"id": receipt_id, "amount_cents": amount, "currency": "usd"},
        }
        await _store_key(conn, ctx.caller.id, key, tier, card_digits, 200, payload)
        await queue_email(
            conn,
            recipient=ctx.caller.email,
            subject=f"Your Community Hub receipt {receipt_id}",
            body=(
                f"Thank you for your Community Hub membership.\n"
                f"Tier: {TIER_NAMES[tier]}\n"
                f"Amount: ${amount // 100}.{amount % 100:02d}\n"
            ),
        )
    return json_response(payload)


def _stored_response(stored: asyncpg.Record) -> Response:
    payload = json.loads(stored["response"])
    if stored["status_code"] == 200:
        return json_response(payload)
    return error_response(402, "payment_declined")


async def _store_key(
    conn: asyncpg.Connection,
    member_id: int,
    key: str | None,
    tier: str,
    card_digits: str,
    status_code: int,
    payload: dict[str, Any],
) -> None:
    if key is None:
        return
    await conn.execute(
        """
        INSERT INTO idempotency_keys (member_id, key, tier, card_digits, status_code, response)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (member_id, key) DO NOTHING
        """,
        member_id,
        key,
        tier,
        card_digits,
        status_code,
        json.dumps(payload, ensure_ascii=False),
    )


async def cancel_membership(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        await conn.execute(
            "SELECT pg_advisory_xact_lock(hashtext($1))", f"checkout:{ctx.caller.id}"
        )
        current = await conn.fetchval(
            "SELECT tier FROM members WHERE id = $1 FOR UPDATE", ctx.caller.id
        )
        if current == "free":
            raise conflict(None)
        await conn.execute(
            "UPDATE subscriptions SET status = 'cancelled' WHERE member_id = $1 "
            "AND status = 'active'",
            ctx.caller.id,
        )
        await conn.execute("UPDATE members SET tier = 'free' WHERE id = $1", ctx.caller.id)
        await _undo_lost_entitlements(conn, ctx.caller.id, "free")
    return no_content()
