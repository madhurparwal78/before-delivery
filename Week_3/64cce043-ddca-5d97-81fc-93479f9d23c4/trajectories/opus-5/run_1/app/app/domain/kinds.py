"""Published data kinds, levels and recovery steps."""
from __future__ import annotations

from typing import Final, NamedTuple

ANY_KIND: Final = "any"


class Kind(NamedTuple):
    code: str
    label: str
    steps: tuple[str, str]


KINDS: Final[tuple[Kind, ...]] = (
    Kind("passport", "Passport", (
        "Report the passport to the issuing office as compromised",
        "Apply for a replacement passport")),
    Kind("national_id", "National ID", (
        "Report the ID number to the issuing authority",
        "Place a fraud alert with a credit bureau")),
    Kind("driving_licence", "Driving licence", (
        "Ask the licensing office to flag the licence number",
        "Request a replacement licence")),
    Kind("bank_account", "Bank account", (
        "Call the bank fraud line about this account",
        "Turn on alerts for every transaction")),
    Kind("payment_card", "Payment card", (
        "Freeze the card in the issuer app",
        "Order a replacement card with a new number")),
    Kind("health_record", "Health record", (
        "Ask the provider who accessed your record",
        "Check insurer statements for care you did not receive")),
    Kind("tax_id", "Tax ID", (
        "File an identity theft report with the tax office",
        "Freeze your credit with each credit bureau")),
    Kind("password", "Password", (
        "Change the password at this company",
        "Change it anywhere you reused it")),
    Kind("date_of_birth", "Date of birth", (
        "Add a spoken passphrase to key accounts",
        "Treat messages that quote your birth date with suspicion")),
    Kind("home_address", "Home address", (
        "Check for mail redirection you did not request",
        "Check your credit file for new accounts at this address")),
    Kind("phone", "Phone number", (
        "Ask your carrier for a port-out lock",
        "Treat calls that mention this breach with suspicion")),
    Kind("email", "Email address", (
        "Change the email account password",
        "Turn on two-step sign-in for the email account")),
)

KIND_CODES: Final[tuple[str, ...]] = tuple(k.code for k in KINDS)
KIND_BY_CODE: Final[dict[str, Kind]] = {k.code: k for k in KINDS}
KIND_POSITION: Final[dict[str, int]] = {k.code: i for i, k in enumerate(KINDS)}

PERSON_LEVEL_STEP_TEXTS: Final[frozenset[str]] = frozenset({
    "Place a fraud alert with a credit bureau",
    "Freeze your credit with each credit bureau",
    "Add a spoken passphrase to key accounts",
})


class Level(NamedTuple):
    code: str
    label: str
    weight: int
    points: int


LEVELS: Final[tuple[Level, ...]] = (
    Level("critical", "Critical", 40, 20),
    Level("high", "High", 20, 10),
    Level("moderate", "Moderate", 8, 4),
    Level("low", "Low", 2, 1),
)

LEVEL_CODES: Final[tuple[str, ...]] = tuple(level.code for level in LEVELS)
LEVEL_BY_CODE: Final[dict[str, Level]] = {level.code: level for level in LEVELS}
# Strictest first, so a lower rank means stricter.
LEVEL_RANK: Final[dict[str, int]] = {level.code: i for i, level in enumerate(LEVELS)}
DEFAULT_LEVEL: Final = "low"


def kind_label(code: str) -> str:
    return KIND_BY_CODE[code].label


def level_label(code: str) -> str:
    return LEVEL_BY_CODE[code].label


def step_points(level: str) -> int:
    return LEVEL_BY_CODE[level].points


def is_person_level(text: str) -> bool:
    return text in PERSON_LEVEL_STEP_TEXTS


def band_for(score: int) -> str:
    if score == 0:
        return "Clear"
    if score < 40:
        return "Contained"
    if score < 100:
        return "Exposed"
    return "Severe"


def strictest(level_codes: list[str]) -> str:
    return min(level_codes, key=lambda code: LEVEL_RANK[code])
