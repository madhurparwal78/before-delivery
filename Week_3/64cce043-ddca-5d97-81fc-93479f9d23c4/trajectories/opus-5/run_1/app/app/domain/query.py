"""Search, filters and facet counts over a vault view."""
from __future__ import annotations

from dataclasses import dataclass

from .exposure import VaultView
from .kinds import KIND_CODES, LEVEL_CODES, kind_label
from .projection import CONTACT
from .records import Holding, company_key


@dataclass(frozen=True, slots=True)
class LedgerFilters:
    q: str = ""
    company: str = ""
    data_kind: str = ""
    level: str = ""


def group_spellings(view: VaultView) -> dict[str, str]:
    """A company group's heading and facet key use the spelling of its earliest holding."""
    earliest: dict[str, Holding] = {}
    for holding in view.holdings:
        current = earliest.get(holding.company_key)
        if current is None or (holding.created_at, holding.id) < (current.created_at, current.id):
            earliest[holding.company_key] = holding
    return {key: holding.company for key, holding in earliest.items()}


def _matches_text(holding: Holding, needle: str, role: str) -> bool:
    haystack = [holding.company, kind_label(holding.data_kind)]
    if role != CONTACT:
        haystack += [holding.value, holding.notes]
    folded = needle.casefold()
    return any(folded in field.casefold() for field in haystack)


def _passes(
    holding: Holding,
    view: VaultView,
    filters: LedgerFilters,
    role: str,
    skip: str = "",
) -> bool:
    if filters.q and skip != "q" and not _matches_text(holding, filters.q, role):
        return False
    if (
        filters.company
        and skip != "company"
        and holding.company_key != company_key(filters.company)
    ):
        return False
    if filters.data_kind and skip != "data_kind" and holding.data_kind != filters.data_kind:
        return False
    if filters.level and skip != "level" and view.levels[holding.id] != filters.level:
        return False
    return True


def filter_holdings(view: VaultView, filters: LedgerFilters, role: str) -> list[Holding]:
    return [h for h in view.holdings if _passes(h, view, filters, role)]


def facet_counts(view: VaultView, filters: LedgerFilters, role: str) -> dict[str, dict[str, int]]:
    """Each facet counts the holdings matching the search text and every filter but its own."""
    spellings = group_spellings(view)
    company: dict[str, int] = {}
    for holding in view.holdings:
        if _passes(holding, view, filters, role, skip="company"):
            name = spellings[holding.company_key]
            company[name] = company.get(name, 0) + 1

    kinds: dict[str, int] = {}
    for holding in view.holdings:
        if _passes(holding, view, filters, role, skip="data_kind"):
            kinds[holding.data_kind] = kinds.get(holding.data_kind, 0) + 1

    levels: dict[str, int] = {}
    for holding in view.holdings:
        if _passes(holding, view, filters, role, skip="level"):
            code = view.levels[holding.id]
            levels[code] = levels.get(code, 0) + 1

    return {
        "company": dict(sorted(company.items(), key=lambda item: item[0].casefold())),
        "data_kind": {code: kinds[code] for code in KIND_CODES if code in kinds},
        "level": {code: levels[code] for code in LEVEL_CODES if code in levels},
    }


def company_suggestions(view: VaultView, typed: str, limit: int = 8) -> list[str]:
    """The vault's company spellings containing the typed text, A to Z."""
    folded = typed.casefold()
    names = [
        spelling
        for spelling in group_spellings(view).values()
        if folded in spelling.casefold()
    ]
    names.sort(key=str.casefold)
    return names[:limit]
