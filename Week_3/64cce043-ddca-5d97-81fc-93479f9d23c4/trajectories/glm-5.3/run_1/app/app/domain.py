"""Published domain constants: data kinds, recovery steps, levels, bands."""

from __future__ import annotations

from typing import Mapping, Sequence

# --- Data kinds, in published order -----------------------------------------


class Kind:
    """One data kind with its ordered recovery steps."""

    __slots__ = ("code", "label", "steps")

    def __init__(self, code: str, label: str, steps: Sequence[str]) -> None:
        self.code = code
        self.label = label
        self.steps = tuple(steps)

    def step(self, number: int) -> str:
        return self.steps[number - 1]

    @property
    def person_level_step_numbers(self) -> Sequence[int]:
        return [
            n for n, text in enumerate(self.steps, start=1) if text in PERSON_LEVEL_STEP_TEXTS
        ]


KIND_LIST: tuple[Kind, ...] = (
    Kind(
        "passport",
        "Passport",
        (
            "Report the passport to the issuing office as compromised",
            "Apply for a replacement passport",
        ),
    ),
    Kind(
        "national_id",
        "National ID",
        (
            "Report the ID number to the issuing authority",
            "Place a fraud alert with a credit bureau",
        ),
    ),
    Kind(
        "driving_licence",
        "Driving licence",
        (
            "Ask the licensing office to flag the licence number",
            "Request a replacement licence",
        ),
    ),
    Kind(
        "bank_account",
        "Bank account",
        (
            "Call the bank fraud line about this account",
            "Turn on alerts for every transaction",
        ),
    ),
    Kind(
        "payment_card",
        "Payment card",
        (
            "Freeze the card in the issuer app",
            "Order a replacement card with a new number",
        ),
    ),
    Kind(
        "health_record",
        "Health record",
        (
            "Ask the provider who accessed your record",
            "Check insurer statements for care you did not receive",
        ),
    ),
    Kind(
        "tax_id",
        "Tax ID",
        (
            "File an identity theft report with the tax office",
            "Freeze your credit with each credit bureau",
        ),
    ),
    Kind(
        "password",
        "Password",
        (
            "Change the password at this company",
            "Change it anywhere you reused it",
        ),
    ),
    Kind(
        "date_of_birth",
        "Date of birth",
        (
            "Add a spoken passphrase to key accounts",
            "Treat messages that quote your birth date with suspicion",
        ),
    ),
    Kind(
        "home_address",
        "Home address",
        (
            "Check for mail redirection you did not request",
            "Check your credit file for new accounts at this address",
        ),
    ),
    Kind(
        "phone",
        "Phone number",
        (
            "Ask your carrier for a port-out lock",
            "Treat calls that mention this breach with suspicion",
        ),
    ),
    Kind(
        "email",
        "Email address",
        (
            "Change the email account password",
            "Turn on two-step sign-in for the email account",
        ),
    ),
)

KINDS: Mapping[str, Kind] = {k.code: k for k in KIND_LIST}
KIND_ORDER: Mapping[str, int] = {k.code: i for i, k in enumerate(KIND_LIST)}

# Steps that apply to the person once, not once per holding.
PERSON_LEVEL_STEP_TEXTS: frozenset[str] = frozenset(
    {
        "Place a fraud alert with a credit bureau",
        "Freeze your credit with each credit bureau",
        "Add a spoken passphrase to key accounts",
    }
)

# --- Levels ------------------------------------------------------------------


class Level:
    __slots__ = ("code", "label", "weight", "step_points")

    def __init__(self, code: str, label: str, weight: int, step_points: int) -> None:
        self.code = code
        self.label = label
        self.weight = weight
        self.step_points = step_points


LEVEL_LIST: tuple[Level, ...] = (
    Level("critical", "Critical", 40, 20),
    Level("high", "High", 20, 10),
    Level("moderate", "Moderate", 8, 4),
    Level("low", "Low", 2, 1),
)
LEVELS: Mapping[str, Level] = {lvl.code: lvl for lvl in LEVEL_LIST}
LEVEL_ORDER: Mapping[str, int] = {lvl.code: i for i, lvl in enumerate(LEVEL_LIST)}
# Strictness ranking: lower number = stricter.
LEVEL_STRICTNESS: Mapping[str, int] = LEVEL_ORDER
LEVEL_CODES: tuple[str, ...] = tuple(LEVELS)


def is_level(code: str) -> bool:
    return code in LEVELS


def stricter_level(a: str, b: str) -> str:
    return a if LEVEL_STRICTNESS[a] <= LEVEL_STRICTNESS[b] else b


# --- Bands -------------------------------------------------------------------


def band_for_score(score: int) -> str:
    if score <= 0:
        return "Clear"
    if score <= 39:
        return "Contained"
    if score <= 99:
        return "Exposed"
    return "Severe"


# --- Company matching ---------------------------------------------------------


def match_company(name: str) -> str:
    """Normalise a company name for comparison: trim, collapse whitespace, lowercase."""
    return " ".join(name.split()).casefold()


def display_company(name: str) -> str:
    """Trim and collapse whitespace for display."""
    return " ".join(name.split())


# --- Default rules -----------------------------------------------------------

DEFAULT_RULES: tuple[tuple[str, str, str], ...] = (
    # (data_kind, company_contains, level)
    ("passport", "", "critical"),
    ("national_id", "", "critical"),
    ("tax_id", "", "critical"),
    ("health_record", "", "high"),
    ("bank_account", "", "high"),
    ("payment_card", "", "high"),
    ("driving_licence", "", "high"),
    ("password", "", "high"),
    ("date_of_birth", "", "moderate"),
    ("home_address", "", "moderate"),
    ("phone", "", "low"),
    ("email", "", "low"),
)

DURATIONS: Mapping[str, int] = {"24h": 24, "7d": 168, "30d": 720}
DURATION_LABELS: Mapping[str, str] = {"24h": "24 hours", "7d": "7 days", "30d": "30 days"}
