"""Membership tiers, the test-card checkout, its replay, and cancellation.

One member's checkouts are decided one at a time: the member row is locked for the whole decision, and
the tier change, billing record, stored replay outcome, entitlement undo and receipt email commit
together or not at all.
"""

from __future__ import annotations

import json
import re
from typing import Any

from flask import Response, g, jsonify, request

from . import catalog, config, db, mail
from .errors import ApiError, invalid, refusal_response
from .router import route

SUCCESS_CARD = "4242424242424242"
CURRENCY = "usd"
_CARD = re.compile(r"\d{16}")
_KEY = re.compile(r"[\x21-\x7e]{1,64}")


def price_cents(tier: str) -> int:
    return catalog.TIER_PRICES.get(tier, 0)


def amount_to_charge(current: str, target: str) -> int:
    """The full price from the free tier, the difference on an upgrade, nothing on a move down."""
    return max(0, price_cents(target) - price_cents(current))


def _lock_member(cur: Any, member_id: int) -> dict[str, Any]:
    cur.execute("SELECT * FROM members WHERE id = %s FOR UPDATE", (member_id,))
    return cur.fetchone()


def _apply_tier(cur: Any, member: dict[str, Any], tier: str) -> None:
    """Set the tier and undo whatever the lost entitlements supported."""
    icon = member["app_icon"]
    if "custom_app_icons" not in catalog.ENTITLEMENTS[tier]:
        icon = "classic"
    cur.execute("UPDATE members SET tier = %s, app_icon = %s WHERE id = %s", (tier, icon, member["id"]))


def _idempotency_key() -> str | None:
    key = request.headers.get("Idempotency-Key")
    if key is not None and not _KEY.fullmatch(key):
        raise invalid("Idempotency-Key")
    return key


def _replay(cur: Any, member_id: int, key: str, fingerprint: str) -> Response | None:
    cur.execute("DELETE FROM checkout_replays WHERE member_id = %s AND key = %s "
                "AND created_at <= clock_timestamp() - make_interval(secs => %s)",
                (member_id, key, config.IDEMPOTENCY_KEY_TTL_SECONDS))
    cur.execute("SELECT fingerprint, status, body FROM checkout_replays WHERE member_id = %s AND key = %s",
                (member_id, key))
    stored = cur.fetchone()
    if stored is None:
        return None
    if stored["fingerprint"] != fingerprint:
        raise ApiError("conflict")
    response = jsonify(stored["body"])
    response.status_code = stored["status"]
    return response


def _fingerprint() -> str:
    tier, card = g.body.raw("tier"), g.body.raw("card_number")
    digits = card.replace(" ", "") if isinstance(card, str) else card
    return json.dumps([tier, digits], sort_keys=True)


@route("GET", "/api/membership/tiers")
def tiers() -> dict[str, Any]:
    return {"data": [{"id": tier, "name": catalog.TIER_NAMES[tier], "price_cents": catalog.TIER_PRICES[tier],
                      "currency": CURRENCY, "entitlements": sorted(catalog.ENTITLEMENTS[tier])}
                     for tier in ("basic", "max")]}


@route("POST", "/api/membership/checkout", session="required", body="json")
def checkout() -> Response:
    key = _idempotency_key()
    with db.tx() as cur:
        member = _lock_member(cur, g.member["id"])
        if key is not None:
            replayed = _replay(cur, member["id"], key, _fingerprint())
            if replayed is not None:
                return replayed
        if member["tier"] in catalog.TIER_PRICES and g.body.raw("tier") == member["tier"]:
            raise ApiError("conflict")
        tier = g.body.string("tier")
        if tier not in catalog.TIER_PRICES:
            raise invalid("tier")
        card = g.body.string("card_number").replace(" ", "")
        if not _CARD.fullmatch(card):
            raise invalid("card_number")
        amount = amount_to_charge(member["tier"], tier)
        approved = card == SUCCESS_CARD
        if approved:
            cur.execute("UPDATE subscriptions SET status = 'cancelled' WHERE member_id = %s AND status = 'active'",
                        (member["id"],))
        cur.execute("INSERT INTO subscriptions (member_id, tier, amount_cents, status) VALUES (%s, %s, %s, %s) "
                    "RETURNING id", (member["id"], tier, amount, "active" if approved else "declined"))
        receipt_id = cur.fetchone()["id"]
        if approved:
            _apply_tier(cur, member, tier)
            status = 200
            body: dict[str, Any] = {"tier": tier, "entitlements": sorted(catalog.ENTITLEMENTS[tier]),
                                    "receipt": {"id": receipt_id, "amount_cents": amount, "currency": CURRENCY}}
            mail.enqueue(cur, to=member["email"], name=None, subject=f"Your Community Hub receipt {receipt_id}",
                         body=f"Thank you for choosing {catalog.TIER_NAMES[tier]}.\n"
                              f"Amount: ${amount // 100}.{amount % 100:02d}\n")
        else:
            refused = refusal_response(ApiError("payment_declined"))
            status, body = refused.status_code, refused.get_json()
        if key is not None:
            cur.execute("INSERT INTO checkout_replays (member_id, key, fingerprint, status, body) "
                        "VALUES (%s, %s, %s, %s, %s)", (member["id"], key, _fingerprint(), status, json.dumps(body)))
    response = jsonify(body)
    response.status_code = status
    return response


@route("DELETE", "/api/membership", session="required")
def cancel() -> None:
    with db.tx() as cur:
        member = _lock_member(cur, g.member["id"])
        if member["tier"] == "free":
            raise ApiError("conflict")
        cur.execute("UPDATE subscriptions SET status = 'cancelled' WHERE member_id = %s AND status = 'active'",
                    (member["id"],))
        _apply_tier(cur, member, "free")
