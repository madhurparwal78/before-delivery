"""The audit log, which the API offers no way to change."""

from __future__ import annotations

from flask import Blueprint, request

from .. import projections
from ..db import rows
from ..errors import ApiError
from ..responses import api_response
from .common import endpoint, require_roles, resolve_home, visible_home_ids

blueprint = Blueprint("audit", __name__)

AUDIT_COLUMNS = """
    id, entered_at, actor_id, actor_display_name, actor_role, action, home_id,
    target_type, target_id, before_state, after_state, reason
"""


@blueprint.get("/api/audit")
@endpoint()
def read_audit(conn, person):
    raw_home = request.args.get("home")
    if raw_home:
        homes = [resolve_home(conn, person, raw_home)["id"]]
    else:
        homes = visible_home_ids(conn, person)
    require_roles(person, "unit_manager", "hr_admin")
    if not homes:
        return api_response({"items": []})
    marks = ",".join(["%s"] * len(homes))
    entries = rows(
        conn,
        f"""SELECT {AUDIT_COLUMNS} FROM audit_entries WHERE home_id IN ({marks})
            ORDER BY entered_at DESC, id DESC""",
        tuple(homes),
    )
    return api_response({"items": [projections.audit_entry(entry) for entry in entries]})


def _refuse_change(**_parameters):
    raise ApiError("method_not_allowed")


def register_audit_guards(app) -> None:
    """Append-only: the API offers no way to change an entry."""
    app.add_url_rule(
        "/api/audit",
        "audit_guard",
        _refuse_change,
        methods=["PUT", "PATCH", "DELETE"],
    )
    app.add_url_rule(
        "/api/audit/<entry_id>",
        "audit_entry_guard",
        _refuse_change,
        methods=["PUT", "PATCH", "DELETE"],
    )
