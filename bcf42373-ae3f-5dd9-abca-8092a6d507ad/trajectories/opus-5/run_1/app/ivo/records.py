"""Recognitions and figures: seeded, read-only, listed by ascending position."""


def recognitions(cursor):
    cursor.execute(
        "SELECT award, issuer, awarded_on FROM recognitions ORDER BY position ASC"
    )
    return [dict(row) for row in cursor.fetchall()]


def figures(cursor):
    cursor.execute(
        "SELECT value, label, caption FROM figures ORDER BY position ASC"
    )
    return [dict(row) for row in cursor.fetchall()]
