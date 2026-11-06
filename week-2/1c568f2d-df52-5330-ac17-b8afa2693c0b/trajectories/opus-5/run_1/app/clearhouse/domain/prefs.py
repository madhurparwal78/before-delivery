"""One preferences row per account."""
from ..db import row
from ..errors import Refusal

DEFAULTS = {"rows_per_page": 50, "date_display": "relative", "high_contrast": False}
FIELDS = ("rows_per_page", "date_display", "high_contrast")
ROWS_MESSAGE = "Rows per page must be 25, 50 or 100"
DISPLAY_MESSAGE = "Date display must be relative or absolute"
CONTRAST_MESSAGE = "High contrast must be true or false"


def get(conn, account_id):
    found = row(
        conn,
        "select rows_per_page, date_display, high_contrast from preferences"
        " where account_id = %s",
        (account_id,),
    )
    return dict(found) if found else dict(DEFAULTS)


def put(conn, account_id, body):
    wanted = get(conn, account_id)
    if "rows_per_page" in body:
        if body["rows_per_page"] not in (25, 50, 100):
            raise Refusal(400, ROWS_MESSAGE, field="rows_per_page")
        wanted["rows_per_page"] = body["rows_per_page"]
    if "date_display" in body:
        if body["date_display"] not in ("relative", "absolute"):
            raise Refusal(400, DISPLAY_MESSAGE, field="date_display")
        wanted["date_display"] = body["date_display"]
    if "high_contrast" in body:
        if not isinstance(body["high_contrast"], bool):
            raise Refusal(400, CONTRAST_MESSAGE, field="high_contrast")
        wanted["high_contrast"] = body["high_contrast"]
    conn.execute(
        "insert into preferences (account_id, rows_per_page, date_display, high_contrast)"
        " values (%(account)s, %(rows_per_page)s, %(date_display)s, %(high_contrast)s)"
        " on conflict (account_id) do update set rows_per_page = %(rows_per_page)s,"
        " date_display = %(date_display)s, high_contrast = %(high_contrast)s",
        dict(wanted, account=account_id),
    )
    return wanted
