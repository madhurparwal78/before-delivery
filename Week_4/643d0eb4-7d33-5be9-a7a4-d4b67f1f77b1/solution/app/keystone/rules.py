"""Tiers, allowances, derived table figures and the hash-chained change log.

Every allowance is counted, compared and refused in `check_allowance`, from the grant rows in force."""
import hashlib
from datetime import datetime

from psycopg.types.json import Jsonb

from .db import all_, one
from .errors import refuse
from .util import business_day, iso, now

GENESIS = "0" * 64
KILOBYTE = 1024
KILOBYTES_PER_ROW = 2


# ---- tiers and the grant in force --------------------------------------------------------------------------------

def tier_in_force(conn, department: str, at: datetime | None = None) -> dict:
    """The tier whose grant carries the greatest effective_at at or before `at`; later grants decide nothing."""
    at = at or now()
    tier = one(conn, "SELECT t.* FROM department_grants g JOIN tiers t ON t.name = g.tier "
                     "WHERE g.department = %s AND g.effective_at <= %s ORDER BY g.effective_at DESC LIMIT 1",
               (department, at))
    if tier is None:
        tier = one(conn, "SELECT t.* FROM departments d JOIN tiers t ON t.name = d.tier WHERE d.slug = %s",
                   (department,))
    return tier


def sync_stored_tiers(conn) -> None:
    """departments.tier and tables.tier hold the name of the tier whose grant is in force now."""
    for dept in all_(conn, "SELECT slug, tier FROM departments"):
        current = tier_in_force(conn, dept["slug"])["name"]
        if current != dept["tier"]:
            conn.execute("UPDATE departments SET tier = %s WHERE slug = %s", (current, dept["slug"]))
        conn.execute("UPDATE tables SET tier = %s WHERE department = %s AND tier <> %s",
                     (current, dept["slug"], current))


def tier_answer(tier: dict) -> dict:
    return {"name": tier["name"], "position": tier["position"], "row_allowance": tier["row_allowance"],
            "stored_megabytes": tier["stored_megabytes"],
            "content_allowance_kilobytes": tier["content_allowance_kilobytes"],
            "view_allowance": tier["view_allowance"], "retention": tier["retention"]}


def all_tiers(conn) -> list[dict]:
    return all_(conn, "SELECT * FROM tiers ORDER BY position")


# ---- tables and columns ------------------------------------------------------------------------------------------

def load_table(conn, slug: str, lock: bool = False) -> dict:
    sql = "SELECT * FROM tables WHERE slug = %s" + (" FOR UPDATE" if lock else "")
    table = one(conn, sql, (slug,))
    if table is None:
        refuse(404, f"There is no table {slug}", "table")
    return table


def columns_of(conn, slug: str) -> list[dict]:
    return all_(conn, "SELECT id, caption, position, type, options FROM columns WHERE table_slug = %s "
                      "ORDER BY position", (slug,))


def column_answer(col: dict) -> dict:
    return {"id": col["id"], "caption": col["caption"], "position": col["position"], "type": col["type"],
            "options": col["options"]}


def content_bytes_sql(columns: list[dict]) -> tuple[str, list]:
    """The published content recipe as one SQL expression per row: text, date and choice count their characters,
    an integer 4, a decimal 8, a flag 1, an empty cell 0."""
    parts, params = [], []
    for col in columns:
        if col["type"] in ("text", "date", "choice"):
            parts.append("COALESCE(char_length(cell_values ->> %s), 0)")
        else:
            weight = {"integer": 4, "decimal": 8, "flag": 1}[col["type"]]
            kind = "boolean" if col["type"] == "flag" else "number"
            parts.append(f"(CASE WHEN jsonb_typeof(cell_values -> %s) = '{kind}' THEN {weight} ELSE 0 END)")
        params.append(col["caption"])
    return (" + ".join(parts) or "0"), params


def content_bytes(conn, slug: str, columns: list[dict], where: str = "", extra: tuple = ()) -> int:
    expression, params = content_bytes_sql(columns)
    row = one(conn, f"SELECT COALESCE(sum({expression}), 0)::bigint AS n FROM rows WHERE table_slug = %s {where}",
              (*params, slug, *extra))
    return int(row["n"])


def row_count(conn, slug: str) -> int:
    return int(one(conn, "SELECT count(*) AS n FROM rows WHERE table_slug = %s", (slug,))["n"])


def log_high_ordinal(conn, slug: str) -> int:
    return int(one(conn, "SELECT COALESCE(max(ordinal), 0) AS n FROM log_entries WHERE table_slug = %s",
                   (slug,))["n"])


def table_answer(conn, table: dict, columns: list[dict] | None = None, tier: dict | None = None) -> dict:
    """A table with its figures, every derived one computed now from the stored rows and log entries."""
    columns = columns if columns is not None else columns_of(conn, table["slug"])
    tier = tier or tier_in_force(conn, table["department"])
    count = row_count(conn, table["slug"])
    size = content_bytes(conn, table["slug"], columns)
    return {"id": table["id"], "slug": table["slug"], "name": table["name"], "department": table["department"],
            "tier": tier["name"], "row_allowance": tier["row_allowance"], "allowance": tier["row_allowance"],
            "content_allowance_kilobytes": tier["content_allowance_kilobytes"],
            "view_allowance": tier["view_allowance"], "locked_period": table["locked_period"],
            "columns": [column_answer(c) for c in columns], "count": count,
            "stored_kilobytes": count * KILOBYTES_PER_ROW, "content_bytes": size,
            "content_kilobytes": size // KILOBYTE, "log_high_ordinal": log_high_ordinal(conn, table["slug"]),
            "read_at": iso(now())}


def refuse_if_locked(table: dict) -> None:
    """A locked table refuses every amendment with 409 and names the period that locked it."""
    if table["locked_period"]:
        refuse(409, f"Table locked for {table['locked_period']}", "locked_period", locked_period=table["locked_period"])


# ---- allowances: the one place they are compared and refused -----------------------------------------------------

def check_allowance(conn, kind: str, table: dict, tier: dict, columns: list[dict] | None = None) -> None:
    """Refuse 422 naming the tier, the allowance and the count when `kind` ('rows', 'content' or 'views') is spent."""
    slug = table["slug"]
    if kind == "rows":
        used = row_count(conn, slug)
        if used >= tier["row_allowance"]:
            refuse(422, f"The {tier['name']} tier allows {tier['row_allowance']} rows per table and {slug} "
                        f"holds {used}", "row_allowance")
    elif kind == "content":
        columns = columns if columns is not None else columns_of(conn, slug)
        used = content_bytes(conn, slug, columns) // KILOBYTE
        if used >= tier["content_allowance_kilobytes"]:
            refuse(422, f"The {tier['name']} tier allows {tier['content_allowance_kilobytes']} content kilobytes per "
                        f"table and {slug} holds {used}", "content_kilobytes")
    elif kind == "views":
        used = int(one(conn, "SELECT count(*) AS n FROM views WHERE table_slug = %s AND visibility = 'shared'",
                       (slug,))["n"])
        if used >= tier["view_allowance"]:
            refuse(422, f"The {tier['name']} tier allows {tier['view_allowance']} shared views per table and "
                        f"{slug} holds {used}", "visibility")
    else:  # pragma: no cover - programmer error
        raise ValueError(kind)


# ---- the change log: contiguous ordinals and a SHA-256 hash chain ------------------------------------------------

def append_log(conn, stream: str, *, action: str, account: str, recorded_at: datetime, column: str | None = None,
               before=None, after=None, subject: str | None = None) -> dict:
    """Append one entry to `stream`. The caller holds the row lock of the stream's owner, so the ordinal and the
    predecessor hash are read and written without a rival."""
    last = one(conn, "SELECT ordinal, entry_hash FROM log_entries WHERE table_slug = %s ORDER BY ordinal DESC LIMIT 1",
               (stream,))
    ordinal = last["ordinal"] + 1 if last else 1
    previous = last["entry_hash"] if last else GENESIS
    stamp = iso(recorded_at)
    material = "|".join([previous, stream, str(ordinal), action, account, column or "", stamp])
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()
    conn.execute(
        "INSERT INTO log_entries (table_slug, ordinal, action, account, recorded_at, business_day, column_caption, "
        "before, after, subject, previous_hash, entry_hash) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (stream, ordinal, action, account, recorded_at, business_day(recorded_at), column,
         None if before is None else Jsonb(before), None if after is None else Jsonb(after), subject, previous,
         digest))
    return {"ordinal": ordinal, "entry_hash": digest}


def log_answer(row: dict) -> dict:
    return {"id": row["id"], "ordinal": row["ordinal"], "action": row["action"], "account": row["account"],
            "column": row["column_caption"], "recorded_at": iso(row["recorded_at"]),
            "business_day": row["business_day"].isoformat(), "before": row["before"], "after": row["after"],
            "subject": row["subject"], "previous_hash": row["previous_hash"], "entry_hash": row["entry_hash"]}
