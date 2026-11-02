"""The published route table, with idempotency wrapped around its four routes."""
from . import routing
from . import idem
from . import handlers as h
from .textutil import ApiError


def idempotent(route_name, fn):
    async def wrapper(ctx):
        key = ctx.request.headers.get("Idempotency-Key")
        if key is None:
            return await fn(ctx)
        key = idem.check_key(ctx)
        replay = await idem.resolve(ctx, route_name, key, ctx.body)
        if replay is not None:
            return ctx.json(status=replay["status"], data=replay["data"],
                            idem_replayed=True)
        try:
            resp = await fn(ctx)
        except ApiError as e:
            if e.status >= 400:
                await idem.discard(ctx, route_name, key)
            raise
        data = resp.body
        import json
        payload = json.loads(data)
        await idem.record(ctx, route_name, key, ctx.body, resp.status,
                          payload.get("data"))
        return resp
    return wrapper


def register_all():
    r = routing.add
    r("GET", "/api/health", h.h_health, role="public", versioned=False)
    r("POST", "/api/auth/login", h.h_login, role="public", versioned=False, takes_body=True)
    r("POST", "/api/auth/logout", h.h_logout, versioned=False)
    r("POST", "/api/auth/logout-all", h.h_logout_all, versioned=False)
    r("POST", "/api/auth/password", h.h_password, versioned=False, takes_body=True)
    r("POST", "/api/auth/forgot", h.h_forgot, role="public", versioned=False, takes_body=True)
    r("POST", "/api/auth/reset", h.h_reset, role="public", versioned=False, takes_body=True)
    r("POST", "/api/auth/totp/setup", h.h_totp_setup, versioned=False)
    r("POST", "/api/auth/totp/enable", h.h_totp_enable, versioned=False, takes_body=True)
    r("POST", "/api/auth/totp/disable", h.h_totp_disable, versioned=False, takes_body=True)
    r("GET", "/api/me", h.h_me, versioned=False)
    r("POST", "/api/contact", h.h_contact, role="public", versioned=False, takes_body=True)
    r("GET", "/api/code-host/repo", h.h_code_host, role="public", versioned=False)

    r("POST", "/api/v2/databases", idempotent("POST /api/v2/databases", h.h_databases_create),
      role="owner", takes_body=True)
    r("GET", "/api/v2/databases", h.h_databases_list, role="viewer")
    r("DELETE", "/api/v2/databases", h.h_databases_delete, role="owner", takes_body=True)
    r("GET", "/api/v2/databases/status", h.h_databases_status, role="viewer")
    r("GET", "/api/v2/databases/collections", h.h_collections_list, role="viewer")
    r("DELETE", "/api/v2/databases/collections", h.h_collections_delete, role="editor",
      takes_body=True)
    r("GET", "/api/v2/databases/stats", h.h_databases_stats, role="viewer")
    r("POST", "/api/v2/databases/compact", h.h_compact, role="editor", takes_body=True)
    r("POST", "/api/v2/databases/export", idempotent("POST /api/v2/databases/export",
      h.h_export_request), role="owner", takes_body=True)
    r("POST", "/api/v2/databases/import", idempotent("POST /api/v2/databases/import",
      h.h_import), role="owner", takes_body=True)

    r("POST", "/api/v2/context/ingest", idempotent("POST /api/v2/context/ingest",
      h.h_ingest), role="editor", takes_body=True)
    r("GET", "/api/v2/context/status", h.h_source_status, role="viewer")
    r("POST", "/api/v2/context/list", h.h_source_list, role="viewer", takes_body=True)
    r("GET", "/api/v2/context/source", h.h_source_get, role="viewer")
    r("DELETE", "/api/v2/context", h.h_source_delete, role="editor", takes_body=True)
    r("POST", "/api/v2/context/restore", h.h_source_restore, role="editor", takes_body=True)
    r("GET", "/api/v2/context/relations", h.h_relations, role="viewer")
    r("GET", "/api/v2/context/history", h.h_history, role="viewer")
    r("GET", "/api/v2/context/graph", h.h_graph, role="viewer")

    r("POST", "/api/v2/query", h.h_query, role="viewer", takes_body=True, query_limited=True)
    r("POST", "/api/v2/feedback", h.h_feedback, role="viewer", takes_body=True)

    r("GET", "/api/v2/members", h.h_members_list, role="viewer")
    r("POST", "/api/v2/members", h.h_members_add, role="owner", takes_body=True)
    r("PATCH", "/api/v2/members/{email}", h.h_members_role, role="owner", takes_body=True)
    r("DELETE", "/api/v2/members/{email}", h.h_members_remove, role="owner")

    r("GET", "/api/v2/keys", h.h_keys_list, role="owner")
    r("POST", "/api/v2/keys", h.h_keys_create, role="owner", takes_body=True)
    r("GET", "/api/v2/keys/{id}", h.h_key_get, role="owner")
    r("DELETE", "/api/v2/keys/{id}", h.h_key_delete, role="owner")
    r("POST", "/api/v2/keys/{id}/rotate", h.h_key_rotate, role="owner")

    r("PUT", "/api/v2/org/plan", h.h_plan_set, role="owner", takes_body=True)
    r("GET", "/api/v2/usage", h.h_usage, role="owner")
    r("GET", "/api/v2/usage/daily", h.h_usage_daily, role="owner")
    r("GET", "/api/v2/audit", h.h_audit, role="owner")
    r("GET", "/api/v2/jobs/{id}", h.h_job_get, role="owner")
    r("GET", "/api/v2/jobs/{id}/download", h.h_job_download, role="owner")
