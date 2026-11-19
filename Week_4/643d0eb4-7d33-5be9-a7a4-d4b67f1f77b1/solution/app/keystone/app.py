"""Assemble the Starlette application: the /api routes, the pages, static files and the error handlers."""
from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import api_access, api_public, api_tables, auth, config, pages, seed, snapshots
from .ctx import api
from .errors import Refusal, refuse, refusal_response

ALL = ["GET", "POST", "PUT", "PATCH", "DELETE"]


def route(path, fn, methods):
    return Route(path, api(fn), methods=methods)


def by_method(**handlers):
    """Dispatch one address by HTTP verb; a verb with no handler is answered by the shared refusal."""

    def dispatch(ctx):
        handler = handlers.get(ctx.method)
        if handler is None:
            refuse(405, "That method is not allowed here.", "method", headers={"Allow": ", ".join(handlers)})
        return handler(ctx)

    return dispatch


def api_routes() -> list[Route]:
    t = "/api/tables/{slug}"
    return [
        route("/api/health", api_tables.health, ["GET"]),
        route("/api/tiers", api_tables.tiers, ["GET"]),
        route("/api/departments/{slug}/grants", api_tables.department_grants, ["GET"]),
        route("/api/auth/login", auth.sign_in, ["POST"]),
        route("/api/auth/signup", auth.sign_up, ["POST"]),
        route("/api/auth/logout", auth.sign_out, ["POST"]),
        route("/api/login-attempts", auth.login_attempts, ["GET"]),
        route("/api/tables", api_tables.tables_list, ["GET"]),
        route(t, api_tables.table_detail, ["GET"]),
        route(t + "/rows", by_method(GET=api_tables.rows_list, POST=api_tables.row_create), ["GET", "POST"]),
        route(t + "/rows/{row_id}", by_method(GET=api_tables.row_detail, PATCH=api_tables.row_update,
                                              DELETE=api_tables.row_delete), ["GET", "PATCH", "DELETE"]),
        route(t + "/columns", api_tables.column_create, ["POST"]),
        route(t + "/columns/{column_id}", api_tables.column_delete, ["DELETE"]),
        route(t + "/views", by_method(GET=api_tables.views_list, POST=api_tables.view_create), ["GET", "POST"]),
        route(t + "/views/{view_id}", by_method(PATCH=api_tables.view_update, DELETE=api_tables.view_delete),
              ["PATCH", "DELETE"]),
        route(t + "/log", by_method(GET=api_tables.log_list, **{m: api_tables.no_role_amends("the change log")
                                                                for m in ("POST", "PUT", "PATCH", "DELETE")}), ALL),
        route(t + "/lock", by_method(POST=api_tables.lock_table, DELETE=api_tables.unlock_table), ["POST", "DELETE"]),
        route("/api/snapshots", by_method(GET=snapshots.list_snapshots, POST=snapshots.publish_snapshot),
              ["GET", "POST"]),
        route("/api/snapshots/{snapshot_id}", by_method(GET=snapshots.get_snapshot, **{
            m: snapshots.refuse_snapshot_amend for m in ("POST", "PUT", "PATCH", "DELETE")}), ALL),
        route("/api/requests", by_method(GET=api_access.requests_list, POST=api_access.request_create),
              ["GET", "POST"]),
        route("/api/requests/{request_id}/decision", api_access.request_decision, ["POST"]),
        route("/api/enquiries", api_public.enquiry, ["POST"]),
        route("/api/subscribers", api_public.subscribe, ["POST"]),
        route("/api/admin/{rest:path}", api_access.admin_endpoint, ALL),
    ]


async def on_http_error(request: Request, exc: HTTPException):
    if request.url.path.startswith("/api/"):
        status = exc.status_code
        reason = {404: "There is no such address.", 405: "That method is not allowed here."}.get(status, str(exc.detail))
        headers = dict(exc.headers or {})
        return refusal_response(Refusal(status, reason, "method" if status == 405 else "path", headers))
    return await pages.not_found_response(request, exc.status_code)


async def on_refusal(request: Request, exc: Refusal):
    return refusal_response(exc)


async def on_error(request: Request, exc: Exception):
    return JSONResponse({"reason": "Something went wrong on our side.", "field": None}, status_code=500)


def create_app() -> Starlette:
    seed.run()
    routes = api_routes() + pages.page_routes() + [
        Mount("/static", StaticFiles(directory=config.ROOT / "static"), name="static")]
    return Starlette(routes=routes, exception_handlers={HTTPException: on_http_error, 404: on_http_error,
                                                        Refusal: on_refusal, Exception: on_error})
