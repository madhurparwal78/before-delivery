"""The plan catalogue and the trial rule."""

from datetime import date, datetime, timedelta, timezone

PLANS = [
    {"id": "free", "name": "Free", "annual_price_cents": 0, "monthly_price_cents": 0, "seats": 1},
    {"id": "individual", "name": "Individual", "annual_price_cents": 7999, "monthly_price_cents": 1199, "seats": 1},
    {"id": "family", "name": "Family", "annual_price_cents": 12999, "monthly_price_cents": None, "seats": 4},
    {"id": "student", "name": "Student", "annual_price_cents": 3999, "monthly_price_cents": None, "seats": 1},
]
TRIAL_DAYS = 30


def trial_end() -> date:
    return datetime.now(timezone.utc).date() + timedelta(days=TRIAL_DAYS)


def billing_allowed(plan: str, billing: str) -> bool:
    """Only the paid plans can be chosen, and monthly billing exists only for the individual plan."""
    return plan in ("individual", "family", "student") and (billing == "annual" or (billing == "monthly" and plan == "individual"))
