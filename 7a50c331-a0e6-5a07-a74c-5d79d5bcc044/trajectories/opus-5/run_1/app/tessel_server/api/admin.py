"""Owner-only panels: members, API keys, the plan, the bill and the audit log."""
from .. import audit, db, httpbase, mailer, validate
from ..domain import databases, keys, members, usage
from ..errors import validation_error
from .registry import Route

MEMBER_SPEC = {"email": validate.ANY, "role": validate.ANY, "password": validate.ANY}
ROLE_SPEC = {"role": validate.ANY}
KEY_SPEC = {"name": validate.ANY, "role": validate.ANY, "databases": validate.ANY}
PLAN_SPEC = {"plan": validate.ANY}


def list_members(ctx):
    with db.tx() as cur:
        listed = members.listing(cur, ctx.actor.organization_id)
    return 200, {"members": listed}


def add_member(ctx):
    validate.scan_unknown(ctx.body, MEMBER_SPEC)
    validate.scan_unstorable(ctx.body)
    email = validate.email(ctx.body, "email", "email")
    role = validate.choice(ctx.body, "role", "role", members.ROLES)
    password = validate.password(ctx.body, "password", "password")
    with db.tx() as cur:
        answer = members.add(cur, ctx.actor, email, role, password)
    mailer.member_added(email, ctx.organization["name"], role)
    return 201, answer


def set_member_role(ctx):
    validate.scan_unknown(ctx.body, ROLE_SPEC)
    validate.scan_unstorable(ctx.body)
    role = validate.choice(ctx.body, "role", "role", members.ROLES)
    with db.tx() as cur:
        answer = members.set_role(cur, ctx.actor, ctx.params[0], role)
    return 200, answer


def remove_member(ctx):
    with db.tx() as cur:
        answer = members.remove(cur, ctx.actor, ctx.params[0])
    return 200, answer


def list_keys(ctx):
    with db.tx() as cur:
        listed = keys.listing(cur, ctx.actor.organization_id)
    return 200, {"keys": listed}


def create_key(ctx):
    validate.scan_unknown(ctx.body, KEY_SPEC)
    validate.scan_unstorable(ctx.body)
    name = validate.string(ctx.body, "name", "name", 1, 60)
    role = validate.choice(ctx.body, "role", "role", keys.KEY_ROLES)
    requested = ctx.body.get("databases")
    if requested is not None and not isinstance(requested, list):
        raise validation_error("databases", "This field must be a list")
    with db.tx() as cur:
        scope = keys.resolve_scope(cur, ctx.actor.organization_id, requested)
        answer = keys.create(cur, ctx.actor, name, role, scope)
    return 201, answer


def key_detail(ctx):
    with db.tx() as cur:
        answer = keys.detail(cur, ctx.actor.organization_id, ctx.params[0])
    return 200, answer


def revoke_key(ctx):
    with db.tx() as cur:
        name = keys.revoke(cur, ctx.actor, ctx.params[0])
        recipients = databases.owner_emails(cur, ctx.actor.organization_id)
    mailer.key_revoked(recipients, name)
    return 200, {"revoked": True}


def rotate_key(ctx):
    with db.tx() as cur:
        answer, name = keys.rotate(cur, ctx.actor, ctx.params[0])
        recipients = databases.owner_emails(cur, ctx.actor.organization_id)
    mailer.key_rotated(recipients, name)
    return 200, answer


def set_plan(ctx):
    validate.scan_unknown(ctx.body, PLAN_SPEC)
    validate.scan_unstorable(ctx.body)
    plan = validate.choice(ctx.body, "plan", "plan", ("ship", "scale"))
    with db.tx() as cur:
        current, changed = databases.switch_plan(cur, ctx.actor, plan)
        recipients = databases.owner_emails(cur, ctx.actor.organization_id) if changed else []
    if changed:
        mailer.plan_changed(recipients, ctx.organization["name"], plan)
    return 200, {"plan": current}


def read_usage(ctx):
    with db.tx() as cur:
        answer = usage.bill(cur, ctx.organization)
    return 200, answer


def read_usage_daily(ctx):
    with db.tx() as cur:
        answer = usage.daily(cur, ctx.actor.organization_id)
    return 200, answer


def _audit_filters(request):
    limit = request.param("limit")
    if limit is None or limit == "":
        limit = audit.PAGE_DEFAULT
    else:
        if not limit.isdigit():
            raise validation_error("limit", "Write a whole number from 1 to 100")
        limit = int(limit)
        if not 1 <= limit <= 100:
            raise validation_error("limit", "Write a whole number from 1 to 100")
    action = audit.validate_action(request.param("action"))
    actor = request.param("actor") or None
    return limit, action, actor


def read_audit(ctx):
    limit, action, actor = _audit_filters(ctx.request)
    wants_csv = ctx.request.param("format") == "csv" or (
        "text/csv" in (ctx.request.header("Accept") or "")
    )
    with db.tx() as cur:
        if wants_csv:
            events = audit.read_all(cur, ctx.actor.organization_id, action, actor)
            body = audit.to_csv(events)
            response = httpbase.Response(
                200, body.encode("utf-8"), content_type="text/csv; charset=utf-8"
            )
            response.add("Cache-Control", "no-store")
            return response
        events, next_cursor = audit.read_page(
            cur,
            ctx.actor.organization_id,
            limit,
            ctx.request.param("cursor") or None,
            action,
            actor,
        )
    return 200, {"events": events, "next_cursor": next_cursor}


def routes():
    return [
        Route("/api/v2/members", "GET", list_members, role="viewer"),
        Route("/api/v2/members", "POST", add_member, role="owner",
              session_only=True, reads_body=True),
        Route("/api/v2/members/{email}", "PATCH", set_member_role, role="owner",
              session_only=True, reads_body=True),
        Route("/api/v2/members/{email}", "DELETE", remove_member, role="owner",
              session_only=True),
        Route("/api/v2/keys", "GET", list_keys, role="owner", session_only=True),
        Route("/api/v2/keys", "POST", create_key, role="owner", session_only=True,
              reads_body=True),
        Route("/api/v2/keys/{id}", "GET", key_detail, role="owner", session_only=True),
        Route("/api/v2/keys/{id}", "DELETE", revoke_key, role="owner", session_only=True),
        Route("/api/v2/keys/{id}/rotate", "POST", rotate_key, role="owner",
              session_only=True),
        Route("/api/v2/org/plan", "PUT", set_plan, role="owner", session_only=True,
              reads_body=True),
        Route("/api/v2/usage", "GET", read_usage, role="owner", session_only=True),
        Route("/api/v2/usage/daily", "GET", read_usage_daily, role="owner",
              session_only=True),
        Route("/api/v2/audit", "GET", read_audit, role="owner", session_only=True),
    ]
