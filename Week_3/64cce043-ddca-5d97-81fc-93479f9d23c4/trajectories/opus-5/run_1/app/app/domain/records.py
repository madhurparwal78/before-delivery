"""In-memory domain records and the company-matching rule."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime

from .kinds import KIND_POSITION

_WHITESPACE = re.compile(r"\s+")


def company_key(company: str) -> str:
    """Companies compare case-insensitively after trimming and collapsing whitespace.

    Lower-casing matches the stored generated column the uniqueness constraint uses.
    """
    return _WHITESPACE.sub(" ", company.strip()).lower()


def collapse_company(company: str) -> str:
    return _WHITESPACE.sub(" ", company.strip())


@dataclass(frozen=True, slots=True)
class Holding:
    id: str
    company: str
    company_key: str
    data_kind: str
    value: str
    notes: str
    version: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class GradingRule:
    id: str
    priority: int
    data_kind: str
    company_contains: str
    level: str
    version: int
    created_at: datetime


@dataclass(frozen=True, slots=True)
class Breach:
    id: str
    company: str
    company_key: str
    announced_on: date
    data_kinds: tuple[str, ...]
    version: int
    created_at: datetime


def ledger_sort_key(holding: Holding) -> tuple[str, int]:
    """Ledger order: companies A to Z case-insensitively, then published kind order."""
    return (holding.company_key, KIND_POSITION[holding.data_kind])


def in_ledger_order(holdings: list[Holding]) -> list[Holding]:
    return sorted(holdings, key=ledger_sort_key)
