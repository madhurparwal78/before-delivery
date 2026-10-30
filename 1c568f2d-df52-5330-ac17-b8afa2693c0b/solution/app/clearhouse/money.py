"""Money is whole cents everywhere; this is the one place cents become display text."""


def format_cents(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    dollars, rest = divmod(abs(cents), 100)
    return f"{sign}${dollars:,}.{rest:02d}"
