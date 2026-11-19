"""The signed attestation: its statement code, its payload and its printed lines."""

from __future__ import annotations

import json
from typing import Any

from .numbers import mwh_text, percent_text

OBJECT_KEY_PREFIX = "attestations/"


def statement_code(month: str, site_code: str, signature_count: int) -> str:
    return f"HP-{month[0:4]}-{month[5:7]}-{site_code}-{signature_count + 1}"


def object_key(code: str) -> str:
    return f"{OBJECT_KEY_PREFIX}{code}.pdf"


def payload(
    window_id: str,
    site_name: str,
    month: str,
    scores: dict[str, int],
    opinion: str,
    firm_name: str,
    consumed_wh: int,
    hour_matched_wh: int,
    allocation_digest: str,
    signed_at: str,
) -> str:
    """Compact JSON with sorted keys: the exact text the signature covers."""
    body: dict[str, Any] = {
        "window_id": window_id,
        "site_name": site_name,
        "month": month,
        "month_bp": scores["month_bp"],
        "week_bp": scores["week_bp"],
        "day_bp": scores["day_bp"],
        "hour_bp": scores["hour_bp"],
        "opinion": opinion,
        "firm_name": firm_name,
        "consumed_wh": consumed_wh,
        "hour_matched_wh": hour_matched_wh,
        "allocation_digest": allocation_digest,
        "signed_at": signed_at,
    }
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def printed_lines(
    code: str,
    site_name: str,
    month: str,
    scores: dict[str, int],
    consumed_wh: int,
    hour_matched_wh: int,
    opinion: str,
    firm_name: str,
    allocation_digest: str,
) -> list[str]:
    return [
        f"Statement {code}",
        f"Site {site_name}",
        f"Month {month}",
        f"Month score {percent_text(scores['month_bp'])}%",
        f"Week score {percent_text(scores['week_bp'])}%",
        f"Day score {percent_text(scores['day_bp'])}%",
        f"Hour score {percent_text(scores['hour_bp'])}%",
        f"Consumed {mwh_text(consumed_wh)} MWh",
        f"Hour matched {mwh_text(hour_matched_wh)} MWh",
        f"Opinion {opinion}",
        f"Verifier firm {firm_name}",
        f"Allocation digest {allocation_digest}",
    ]
