"""Journal entries and the one business-day rule that makes them public."""

from .config import BUSINESS_TIME_ZONE

PUBLIC_CLAUSE = (
    "published AND published_on <= (now() AT TIME ZONE %(business_zone)s)::date"
)
PUBLIC_ORDER = "published_on DESC, slug ASC"


def _parameters(extra=None):
    return {"business_zone": BUSINESS_TIME_ZONE, **(extra or {})}


def public_entries(cursor, limit=None):
    cursor.execute(
        f"""
        SELECT slug, title, excerpt, body, published_on
          FROM journal_entries
         WHERE {PUBLIC_CLAUSE}
         ORDER BY {PUBLIC_ORDER}
         {"LIMIT %(limit)s" if limit else ""}
        """,
        _parameters({"limit": limit}),
    )
    return [dict(row) for row in cursor.fetchall()]


def public_entry(cursor, slug):
    cursor.execute(
        f"""
        SELECT slug, title, excerpt, body, published_on
          FROM journal_entries
         WHERE slug = %(slug)s AND {PUBLIC_CLAUSE}
        """,
        _parameters({"slug": slug}),
    )
    row = cursor.fetchone()
    return dict(row) if row else None


def paragraphs(body):
    return [block.strip() for block in body.split("\n\n") if block.strip()]
