"""Constants shared across the domain."""
import re

BASE_TZ = "Europe/London"

AUTHORITIES = ["EASA", "UK CAA", "ATR", "De Havilland", "Embraer"]

MODELS = {
    "ATR72-212A": "ATR 72",
    "DHC-8-402": "Dash 8-400",
    "ERJ-170-200": "E175",
}

ROLES = [
    "compliance_planner",
    "licensed_inspector",
    "certifying_engineer",
    "records_clerk",
    "regulator_auditor",
]

OPEN_WORK_STAGES = {"open", "claimed", "inspected", "superseded_retargeted", "reopened"}

# Directive number formats per authority.
NUMBER_PATTERNS = {
    "EASA": re.compile(r"^\d{4}-\d{4}$"),
    "UK CAA": re.compile(r"^G-\d{4}-\d{4}$"),
    "ATR": re.compile(r"^ATR72-\d{2}-\d{4}$"),
    "De Havilland": re.compile(r"^84-\d{2}-\d{4}$"),
    "Embraer": re.compile(r"^E170-\d{2}-\d{4}$"),
}

AUTHORITY_ORDER = {name: index for index, name in enumerate(AUTHORITIES)}


def tag_of(revision: int) -> str:
    return f"R{revision}"


def hours_text(value: float) -> str:
    """Hours with at most one decimal place, as the API publishes them."""
    text = f"{round(float(value) + 1e-9, 1):.1f}"
    return text
