"""Each account's preferences: one row, created on the first save, defaults until then."""

from .db import Row, Tx
from .errors import invalid

DEFAULTS = {"rows_per_page": 50, "date_display": "relative", "high_contrast": False}
FIELDS = tuple(DEFAULTS)


def load(tx: Tx, account_id: str) -> dict:
    row = tx.one("SELECT p.rows_per_page, p.date_display, p.high_contrast FROM preferences p WHERE p.account_id = :a",
                 a=account_id)
    return dict(row) if row else dict(DEFAULTS)


def save(tx: Tx, account: Row, fields: dict) -> dict:
    if "rows_per_page" in fields and (type(fields["rows_per_page"]) is not int
                                      or fields["rows_per_page"] not in (25, 50, 100)):
        raise invalid("rows_per_page", "Rows per page must be 25, 50 or 100")
    if "date_display" in fields and fields["date_display"] not in ("relative", "absolute"):
        raise invalid("date_display", "Date display must be relative or absolute")
    if "high_contrast" in fields and type(fields["high_contrast"]) is not bool:
        raise invalid("high_contrast", "High contrast must be true or false")
    chosen = load(tx, account["id"]) | fields
    tx.run("INSERT INTO preferences (account_id, rows_per_page, date_display, high_contrast) VALUES (:a, :r, :d, :h) "
           "ON CONFLICT (account_id) DO UPDATE SET rows_per_page = EXCLUDED.rows_per_page, "
           "date_display = EXCLUDED.date_display, high_contrast = EXCLUDED.high_contrast",
           a=account["id"], r=chosen["rows_per_page"], d=chosen["date_display"], h=chosen["high_contrast"])
    return chosen
