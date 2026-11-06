"""Plans and the pricing arithmetic: database limits, the usage bill and the daily token series."""
from datetime import timedelta

from . import db, text

PLAN_LIMIT = {"ship": 3, "scale": 20}
PLAN_TITLE = {"ship": "Ship", "scale": "Scale"}
STORAGE_RATE = {"ship": 50, "scale": 25}          # cents per GB-month
MINIMUM = {"ship": 2500, "scale": 30000}          # cents
ONTOLOGY_RATE = 500                               # cents per million tokens ingested
PER_FACT_BYTES = 64


def ceil_div(a: int, b: int) -> int:
    return -(-a // b)


def bill(month_tokens: int, storage_bytes: int, plan: str) -> dict:
    ontology = ceil_div(month_tokens * ONTOLOGY_RATE, 1_000_000)
    storage = ceil_div(storage_bytes * STORAGE_RATE[plan], 1_000_000_000)
    usage = ontology + storage
    minimum = MINIMUM[plan]
    return {"ontology_cents": ontology, "storage_cents": storage, "usage_cents": usage, "minimum_cents": minimum,
            "billed_cents": max(usage, minimum), "minimum_applied": usage < minimum}


def storage_bytes(t: db.Tx, organization_id: int, database_id: int | None = None) -> int:
    """UTF-8 bytes of every live source's title and text, plus 64 per live fact, in one organization or database."""
    scope = "d.organization_id = :o" + (" AND d.id = :d" if database_id is not None else "")
    params = {"o": organization_id, **({"d": database_id} if database_id is not None else {})}
    row = t.one("SELECT COALESCE(sum(octet_length(s.title) + octet_length(s.text)), 0) AS bytes, "
                "COALESCE(sum((SELECT count(*) FROM facts f WHERE f.database_id = s.database_id AND "
                "f.collection = s.collection AND f.source_id = s.id)), 0) AS facts "
                "FROM sources s JOIN databases d ON d.id = s.database_id WHERE NOT s.deleted AND " + scope, **params)
    return int(row["bytes"]) + PER_FACT_BYTES * int(row["facts"])


def month_start():
    return text.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def usage(t: db.Tx, organization_id: int, plan: str) -> dict:
    start = month_start()
    tokens = int(t.one("SELECT COALESCE(sum(token_count), 0) AS n FROM source_versions WHERE organization_id = :o "
                       "AND ingested_at >= :start", o=organization_id, start=start)["n"])
    stored = storage_bytes(t, organization_id)
    return {"month": start.strftime("%Y-%m"), "plan": plan, "month_tokens": tokens, "storage_bytes": stored,
            **bill(tokens, stored, plan)}


def daily(t: db.Tx, organization_id: int) -> dict:
    start = month_start()
    rows = t.rows("SELECT to_char(ingested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, sum(token_count) AS n "
                  "FROM source_versions WHERE organization_id = :o AND ingested_at >= :start GROUP BY 1",
                  o=organization_id, start=start)
    by_day = {r["day"]: int(r["n"]) for r in rows}
    days, day, today = [], start, text.now().date()
    while day.date() <= today:
        label = day.strftime("%Y-%m-%d")
        days.append({"day": label, "tokens": by_day.get(label, 0)})
        day += timedelta(days=1)
    return {"month": start.strftime("%Y-%m"), "days": days}
