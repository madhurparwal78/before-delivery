"""Saved views as SQL: filters combine with AND, sorts apply in order, ties keep insertion order."""
from datetime import date
from decimal import Decimal, InvalidOperation

from .errors import refuse

OPERATORS = {
    "text": ("equals", "not equals", "contains", "greater than", "less than", "is empty"),
    "integer": ("equals", "not equals", "greater than", "less than", "is empty"),
    "decimal": ("equals", "not equals", "greater than", "less than", "is empty"),
    "date": ("equals", "not equals", "greater than", "less than", "is empty"),
    "choice": ("equals", "not equals", "greater than", "less than", "is empty"),
    "flag": ("equals", "not equals", "is empty"),
}
_COMPARE = {"equals": "=", "greater than": ">", "less than": "<"}


def _key(kind: str) -> str:
    """The typed expression of a cell, NULL when the cell is empty. Text and choice fold case and sort bytewise."""
    if kind in ("text", "choice"):
        return '(CASE WHEN jsonb_typeof(cell_values -> %s) = \'string\' THEN lower(cell_values ->> %s) END) COLLATE "C"'
    if kind in ("integer", "decimal"):
        return "(CASE WHEN jsonb_typeof(cell_values -> %s) = 'number' THEN (cell_values ->> %s)::numeric END)"
    if kind == "date":
        return "(CASE WHEN jsonb_typeof(cell_values -> %s) = 'string' THEN (cell_values ->> %s)::date END)"
    return "(CASE WHEN jsonb_typeof(cell_values -> %s) = 'boolean' THEN (cell_values ->> %s)::boolean END)"


def _coerce(kind: str, value):
    if kind in ("text", "choice"):
        if not isinstance(value, str):
            value = "" if value is None else str(value)
        return value.lower()
    if kind in ("integer", "decimal"):
        try:
            return Decimal(str(value).strip())
        except InvalidOperation:
            raise ValueError("number") from None
    if kind == "date":
        return date.fromisoformat(str(value).strip())
    if isinstance(value, bool):
        return value
    if str(value).strip().lower() in ("true", "false"):
        return str(value).strip().lower() == "true"
    raise ValueError("flag")


def _empty(kind: str) -> str:
    if kind in ("text", "choice"):
        return "(cell_values -> %s IS NULL OR jsonb_typeof(cell_values -> %s) = 'null' OR cell_values ->> %s = '')"
    return "(cell_values -> %s IS NULL OR jsonb_typeof(cell_values -> %s) = 'null')"


def filter_clause(col: dict, operator: str, value) -> tuple[str, list]:
    caption, kind = col["caption"], col["type"]
    if operator == "is empty":
        n = _empty(kind).count("%s")
        return _empty(kind), [caption] * n
    key = _key(kind)
    if operator == "contains":
        return f"strpos({key}, %s) > 0", [caption, caption, _coerce(kind, value)]
    typed = _coerce(kind, value)
    if operator == "not equals":
        return f"{key} IS DISTINCT FROM %s", [caption, caption, typed]
    return f"{key} {_COMPARE[operator]} %s", [caption, caption, typed]


def validate_view(columns: list[dict], filters, sorts) -> None:
    by_caption = {c["caption"]: c for c in columns}
    if not isinstance(filters, list) or not isinstance(sorts, list):
        refuse(422, "filters and sorts must be lists", "filters")
    for item in filters:
        if not isinstance(item, dict) or item.get("column") not in by_caption:
            refuse(422, "Every filter names one of the table's columns", "filters")
        kind = by_caption[item["column"]]["type"]
        if item.get("operator") not in OPERATORS[kind]:
            refuse(422, f"{item.get('operator')} is not offered for the {kind} column {item['column']}", "filters")
        if item["operator"] != "is empty":
            try:
                _coerce(kind, item.get("value"))
            except (ValueError, TypeError):
                refuse(422, f"The value of the {item['column']} filter is not a {kind}", "filters")
    for item in sorts:
        if (not isinstance(item, dict) or item.get("column") not in by_caption
                or item.get("direction") not in ("asc", "desc")):
            refuse(422, "Every sort names a column and a direction of asc or desc", "sorts")


def where_and_order(columns: list[dict], filters: list, sorts: list) -> tuple[str, list, str, list]:
    """(where sql, where params, order sql, order params). Filters or sorts on a removed column are skipped."""
    by_caption = {c["caption"]: c for c in columns}
    clauses, wparams = [], []
    for item in filters or []:
        col = by_caption.get(item.get("column"))
        if col is None or item.get("operator") not in OPERATORS[col["type"]]:
            continue
        try:
            sql, params = filter_clause(col, item["operator"], item.get("value"))
        except (ValueError, TypeError):
            continue
        clauses.append(sql)
        wparams.extend(params)
    order, oparams = [], []
    for item in sorts or []:
        col = by_caption.get(item.get("column"))
        if col is None or item.get("direction") not in ("asc", "desc"):
            continue
        order.append(f"{_key(col['type'])} {item['direction'].upper()}")
        oparams.extend([col["caption"], col["caption"]])
    order.append("inserted_position ASC")
    order.append("id ASC")
    return (" AND ".join(clauses), wparams, ", ".join(order), oparams)
