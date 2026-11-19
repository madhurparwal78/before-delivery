"""The certificate registry: holdings, cancellations and their confirmations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..config import CONFIG
from . import http

ACCOUNT = "KG-HOLD-01"
ALREADY_RECEIVED = "ALREADY_RECEIVED"
ACCEPTED = "ACCEPTED"
REJECTED = "REJECTED"
CONFIRMED = "CONFIRMED"
PENDING = "PENDING"


@dataclass(frozen=True)
class SubmissionResult:
    outcome: str
    reason: str | None = None


@dataclass(frozen=True)
class ConfirmationResult:
    status: str
    reason: str | None = None


def holdings(production_month: str) -> list[dict[str, Any]]:
    url = (
        f"{CONFIG.wiremock_url}/registry/v2/holdings"
        f"?account={ACCOUNT}&production_month={production_month}"
    )
    body = http.get_json(url)
    bundles = body.get("bundles")
    if not isinstance(bundles, list):
        raise http.ProviderUnavailable("holdings body")
    return bundles


def submit_cancellation(
    line_id: str,
    bundle_id: str,
    range_start_wh: int,
    range_end_wh: int,
    hour_utc: str,
    beneficiary: str,
) -> SubmissionResult:
    response = http.post_json(
        f"{CONFIG.wiremock_url}/registry/v2/cancellations",
        {
            "client_line_id": line_id,
            "bundle_id": bundle_id,
            "range_start_wh": range_start_wh,
            "range_end_wh": range_end_wh,
            "hour_utc": hour_utc,
            "beneficiary": beneficiary,
        },
        headers={"Idempotency-Key": line_id},
    )
    if 200 <= response.status < 300:
        return SubmissionResult(ACCEPTED)
    body = _safe_body(response)
    if body.get("status") == ALREADY_RECEIVED:
        return SubmissionResult(ALREADY_RECEIVED)
    return SubmissionResult(REJECTED, body.get("reason"))


def confirmation(line_id: str) -> ConfirmationResult:
    body = http.get_json(f"{CONFIG.wiremock_url}/registry/v2/cancellations/{line_id}")
    status = body.get("status")
    if status not in (CONFIRMED, PENDING, REJECTED):
        raise http.ProviderUnavailable("confirmation body")
    return ConfirmationResult(status, body.get("reason"))


def _safe_body(response: http.ProviderResponse) -> dict[str, Any]:
    try:
        body = response.json()
    except http.ProviderUnavailable:
        return {}
    return body if isinstance(body, dict) else {}
