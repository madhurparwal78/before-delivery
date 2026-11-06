"""The one place the plan rules and the bill arithmetic are decided."""
import math

PLANS = ("ship", "scale")

STORAGE_RATE_CENTS = {"ship": 50, "scale": 25}
MINIMUM_CENTS = {"ship": 2500, "scale": 30000}
DATABASE_LIMIT = {"ship": 3, "scale": 20}
PLAN_LABEL = {"ship": "Ship", "scale": "Scale"}

ONTOLOGY_CENTS_PER_MILLION_TOKENS = 500


def ontology_cents(month_tokens):
    return math.ceil(month_tokens * ONTOLOGY_CENTS_PER_MILLION_TOKENS / 1_000_000)


def storage_cents(storage_bytes, plan):
    return math.ceil(storage_bytes * STORAGE_RATE_CENTS[plan] / 1_000_000_000)


def bill(plan, month_tokens, storage_bytes):
    ontology = ontology_cents(month_tokens)
    storage = storage_cents(storage_bytes, plan)
    usage = ontology + storage
    minimum = MINIMUM_CENTS[plan]
    return {
        "ontology_cents": ontology,
        "storage_cents": storage,
        "usage_cents": usage,
        "minimum_cents": minimum,
        "billed_cents": max(usage, minimum),
        "minimum_applied": usage < minimum,
    }


def format_money(cents):
    """Dollars with a thousands comma and two decimals, as `$1,234.50`."""
    sign = "-" if cents < 0 else ""
    cents = abs(int(cents))
    return "%s$%s.%02d" % (sign, format(cents // 100, ","), cents % 100)


def format_count(number):
    return format(int(number), ",")
