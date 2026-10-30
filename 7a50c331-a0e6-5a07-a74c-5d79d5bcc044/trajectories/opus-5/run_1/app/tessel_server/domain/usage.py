"""The usage bill and the daily token series."""
import datetime

from .. import pricing, textutil
from . import databases


def month_start(moment=None):
    moment = moment or textutil.now()
    return moment.replace(
        day=1, hour=0, minute=0, second=0, microsecond=0, tzinfo=datetime.timezone.utc
    )


def month_tokens(cur, organization_id, since=None):
    since = since or month_start()
    return int(
        cur.value(
            """
            SELECT coalesce(sum(token_count), 0) FROM source_versions
             WHERE organization_id = %s AND ingested_at >= %s
            """,
            (organization_id, since),
        )
    )


def organization_storage_bytes(cur, organization_id):
    rows = cur.all(
        "SELECT id FROM databases WHERE organization_id = %s", (organization_id,)
    )
    return sum(databases.storage_bytes(cur, row["id"]) for row in rows)


def bill(cur, organization):
    tokens = month_tokens(cur, organization["id"])
    storage = organization_storage_bytes(cur, organization["id"])
    figures = pricing.bill(organization["plan"], tokens, storage)
    return {
        "month": textutil.format_month(textutil.now()),
        "plan": organization["plan"],
        "month_tokens": tokens,
        "storage_bytes": storage,
        "ontology_cents": figures["ontology_cents"],
        "storage_cents": figures["storage_cents"],
        "usage_cents": figures["usage_cents"],
        "minimum_cents": figures["minimum_cents"],
        "billed_cents": figures["billed_cents"],
        "minimum_applied": figures["minimum_applied"],
    }


def daily(cur, organization_id):
    now = textutil.now()
    start = month_start(now)
    rows = cur.all(
        """
        SELECT to_char(ingested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
               sum(token_count) AS tokens
          FROM source_versions
         WHERE organization_id = %s AND ingested_at >= %s
         GROUP BY 1
        """,
        (organization_id, start),
    )
    by_day = {row["day"]: int(row["tokens"]) for row in rows}
    days = []
    cursor = start
    while cursor.date() <= now.date():
        label = textutil.format_day(cursor)
        days.append({"day": label, "tokens": by_day.get(label, 0)})
        cursor += datetime.timedelta(days=1)
    return {"month": textutil.format_month(now), "days": days}
