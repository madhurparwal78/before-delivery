"""Domain rules: who may act, exhibit and release transitions, separation of duties.

Each rule is decided here and nowhere else.
"""

from __future__ import annotations

from dataclasses import dataclass

ROLE_INTAKE = "intake_officer"
ROLE_LEAD = "case_lead"
ROLE_INVESTIGATOR = "investigator"
ROLE_AUDITOR = "auditor"
ROLES = (ROLE_INTAKE, ROLE_LEAD, ROLE_INVESTIGATOR, ROLE_AUDITOR)

SCOPE_FULL = "full"
SCOPE_DERIVATIVES = "derivatives"

KIND_GRANT = "grant"
KIND_BREAK_GLASS = "break_glass"

LANDING = {
    ROLE_INTAKE: "/intake",
    ROLE_LEAD: "/compartments",
    ROLE_INVESTIGATOR: "/compartments",
    ROLE_AUDITOR: "/ledger",
}


@dataclass(frozen=True)
class Need:
    """What an action asks of the caller's role, grant scope and grant kind."""

    roles: frozenset[str]
    full_scope: bool = False
    hidden: bool = False
    break_glass_ok: bool = True


NEEDS: dict[str, Need] = {
    "read": Need(frozenset(ROLES)),
    "register": Need(frozenset({ROLE_INTAKE}), full_scope=True),
    "clear": Need(frozenset({ROLE_INTAKE}), full_scope=True),
    "download_original": Need(
        frozenset({ROLE_INTAKE, ROLE_LEAD, ROLE_INVESTIGATOR}),
        full_scope=True,
        hidden=True,
    ),
    "preview": Need(
        frozenset({ROLE_LEAD, ROLE_INVESTIGATOR}), full_scope=True, hidden=True
    ),
    "redact": Need(
        frozenset({ROLE_LEAD, ROLE_INVESTIGATOR}), full_scope=True, hidden=True
    ),
    "custody": Need(frozenset({ROLE_LEAD}), full_scope=True, hidden=True),
    "assemble": Need(frozenset({ROLE_LEAD, ROLE_INVESTIGATOR})),
    "lead_full": Need(frozenset({ROLE_LEAD}), full_scope=True),
    "lead_decide": Need(
        frozenset({ROLE_LEAD}), full_scope=True, break_glass_ok=False
    ),
}

EXHIBIT_TRANSITIONS: dict[tuple[str, str], str] = {
    ("quarantined", "clear"): "cleared",
    ("quarantined", "refuse"): "refused",
    ("cleared", "hold"): "held",
    ("held", "hold"): "held",
    ("held", "lift"): "held",
    ("cleared", "dispose"): "disposal proposed",
    ("disposal proposed", "dispose/confirm"): "disposed",
    ("disposal proposed", "dispose/cancel"): "cleared",
    ("disposal proposed", "hold"): "held",
}

EXHIBIT_ACTION_RESULT = {
    "clear": "cleared",
    "refuse": "refused",
    "hold": "held",
    "lift": "cleared",
    "dispose": "disposal proposed",
    "dispose/confirm": "disposed",
    "dispose/cancel": "cleared",
}

RELEASE_TRANSITIONS: dict[str, tuple[str, str]] = {
    "submit": ("assembling", "submitted"),
    "sign-off": ("submitted", "signed off"),
    "reject": ("submitted", "rejected"),
    "reopen": ("rejected", "assembling"),
    "share": ("signed off", "shared"),
    "withdraw": ("shared", "withdrawn"),
}

# Exhibit states where stored bytes may be read.
READABLE_STATES = frozenset({"cleared", "held", "disposal proposed"})
# Exhibit states where marks, find and rendering are allowed.
WRITABLE_STATES = frozenset({"cleared", "held"})


def landing_for(role: str) -> str:
    return LANDING[role]
