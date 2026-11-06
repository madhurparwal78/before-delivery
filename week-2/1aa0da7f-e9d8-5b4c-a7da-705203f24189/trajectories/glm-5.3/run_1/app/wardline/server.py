"""The Starlette app: routes, middleware, dependency status, sweeps."""
from __future__ import annotations

import datetime
import json
import threading
import time
import traceback
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.routing import Route, Mount
from starlette.staticfiles import StaticFiles

from .api import audit as audit_api
from .api import compartments as compartments_api
from .api import exhibits as exhibits_api
from .api import platform as platform_api
from .api import releases as releases_api
from .api.base import JSON_BODY_LIMIT
from .api.compartments import dashboard, list_compartments, search
from .api.shims import StorageStreamResponse
from .config import Config
from .db import Database, install_ledger_protection
from .errors import ApiError, method_not_allowed, to_response
from .mail import Mailer
from .storage import Storage


class App:
    """The application state shared by every request."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.db = Database(cfg)
        self.storage = Storage(cfg)
        self.mailer = Mailer(cfg, self.db)
        self.storage_status = {"storage": "down", "mail": "down"}
        self.db_ready = threading.Event()
        self.stop = threading.Event()
        self.sessions = None
        self.access_helper = None

    def start(self) -> None:
        self.sessions = _make_sessions(self)
        self.access_helper = _make_access()
        threads = [
            threading.Thread(target=self._db_loop, daemon=True, name="db-boot"),
            threading.Thread(target=self._status_loop, daemon=True, name="status"),
            threading.Thread(target=self._sweep_loop, daemon=True, name="sweep"),
            threading.Thread(target=self._mail_loop, daemon=True, name="mail"),
        ]
        for t in threads:
            t.start()

    def _db_loop(self) -> None:
        import traceback
        from . import seed

        while not self.stop.is_set():
            try:
                self.db.apply_schema()
                install_ledger_protection(self.cfg)
                seed.apply(self)
                self.db_ready.set()
                break
            except Exception:
                traceback.print_exc()
                self.stop.wait(2.0)
        # keep retrying storage bucket creation until it works
        while not self.stop.is_set():
            self.storage.ensure_bucket()
            if self.storage.check():
                break
            self.stop.wait(2.0)

    def _status_loop(self) -> None:
        while not self.stop.is_set():
            self.storage_status["storage"] = "up" if self.storage.check() else "down"
            self.storage_status["mail"] = "up" if self.mailer.check() else "down"
            self.stop.wait(4.0)

    def _sweep_loop(self) -> None:
        from . import ledger as ledger_mod

        while not self.stop.is_set():
            conn = None
            try:
                conn = self.db.connect()
                cur = conn.cursor()
                # grant lapses
                cur.execute(
                    "UPDATE grants SET state = 'lapsed', ended_reason = 'lapsed' "
                    "WHERE kind = 'grant' AND state = 'active' AND expires_at IS NOT NULL AND expires_at <= now() "
                    "RETURNING id"
                )
                for (gid,) in cur.fetchall():
                    ledger_mod.append(cur, "system", None, "grant.lapsed", gid,
                                      _grant_detail(cur, gid))
                # break-glass ends
                cur.execute(
                    "UPDATE grants SET state = 'ended', ended_reason = 'expired' "
                    "WHERE kind = 'break_glass' AND state = 'active' AND expires_at <= now() "
                    "RETURNING id"
                )
                for (gid,) in cur.fetchall():
                    ledger_mod.append(cur, "system", None, "break_glass.ended", gid, {})
                # session idle and life expiry
                cur.execute(
                    "SELECT s.id, s.user_id FROM sessions s "
                    "WHERE s.closed IS NULL AND ("
                    " s.last_activity < now() - %s * interval '1 second'"
                    " OR s.opened_at < now() - %s * interval '1 second')",
                    (self.cfg.session_idle, self.cfg.session_ttl),
                )
                for sid, uid in cur.fetchall():
                    cur.execute(
                        "UPDATE sessions SET closed = CASE "
                        "WHEN opened_at < now() - %s * interval '1 second' THEN 'expired' ELSE 'idle' END "
                        "WHERE id = %s AND closed IS NULL",
                        (self.cfg.session_ttl, sid),
                    )
                    if cur.rowcount:
                        ledger_mod.append(cur, uid, sid, "session.closed", sid, {"reason": "expired"})
                conn.commit()
            except Exception:
                pass
            finally:
                if conn is not None:
                    self.db.put(conn)
            self.stop.wait(5.0)

    def _mail_loop(self) -> None:
        self.mailer.worker_loop(self.stop)

    # ---- small helpers used by the API modules -------------------------
    def next_seq(self, cur, kind: str) -> int:
        tables = {
            "cmp": ("compartments", "id", "CMP-"),
            "grn": ("grants", "id", "GRN-"),
            "bgr": ("grants", "id", "BGR-"),
            "exhibit": ("exhibits", "id", "EX-"),
            "hold": ("holds", "id", "HLD-"),
            "dv": ("derivatives", "id", "DV-"),
            "rel": ("releases", "id", "REL-"),
            "itm": ("release_items", "id", "ITM-"),
            "lnk": ("links", "id", "LNK-"),
        }
        table, column, prefix = tables[kind]
        cur.execute(f"SELECT {column} FROM {table} WHERE {column} LIKE %s ORDER BY {column} DESC LIMIT 1",
                    (prefix + "%",))
        row = cur.fetchone()
        if not row:
            return 1
        try:
            return int(row[0].rsplit("-", 1)[1]) + 1
        except (ValueError, IndexError):
            return 1

    def idempotent_replay(self, cur, user_id: str, endpoint: str, key: str,
                          fingerprint: str | None = None) -> dict | None:
        """A stored response replays only for the same request fingerprint."""
        cur.execute(
            "SELECT status, body, fingerprint FROM idempotency WHERE user_id = %s AND endpoint = %s AND key = %s",
            (user_id, endpoint, key),
        )
        row = cur.fetchone()
        if row:
            if fingerprint is not None and row[2] != fingerprint:
                return "conflict"
            return {"status": row[0], "body": row[1]}
        return None

    def idempotent_store(self, cur, user_id: str, endpoint: str, key: str, status: int,
                          body: dict, fingerprint: str | None = None) -> None:
        cur.execute(
            "INSERT INTO idempotency (user_id, endpoint, key, status, body, fingerprint) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (user_id, endpoint, key, status, json.dumps(body), fingerprint),
        )


def _grant_detail(cur, gid: str) -> dict:
    cur.execute("SELECT compartment_id, user_id FROM grants WHERE id = %s", (gid,))
    row = cur.fetchone()
    return {"compartment_id": row[0], "user_id": row[1]}


def _make_sessions(app: App):
    from .auth import Sessions

    return Sessions(app.cfg, app.db)


def _make_access():
    class _AccessHelper:
        @staticmethod
        def other_lead_keeps_full(cur, compartment_id: str, excluding: str) -> bool:
            return _other_lead(cur, compartment_id, excluding)

    return _AccessHelper()


def _other_lead(cur, compartment_id: str, excluding: str) -> bool:
    cur.execute(
        "SELECT count(*) FROM grants g JOIN people p ON p.id = g.user_id "
        "WHERE g.compartment_id = %s AND g.id <> %s AND g.kind = 'grant' "
        "AND g.state = 'active' AND g.scope = 'full' AND g.expires_at IS NULL "
        "AND p.role = 'case_lead'",
        (compartment_id, excluding),
    )
    return cur.fetchone()[0] > 0


async def api_dispatch(request: Request) -> Response:
    """Every /api route flows through here: one pipeline, one error shape."""
    app: App = request.app.state.wardline
    routes = API_ROUTES
    handler = None
    allowed = set()
    for methods, pattern, fn in routes:
        params = match_route(pattern, request.url.path)
        if params is not None:
            allowed |= set(methods)
            if request.method in methods:
                handler = (fn, params)
                break
    if handler is None:
        if allowed:
            err = method_not_allowed()
            resp = JSONResponse(err.body, status_code=err.status)
            resp.headers["Allow"] = ", ".join(sorted(allowed))
            resp.headers["X-Content-Type-Options"] = "nosniff"
            return resp
        resp = JSONResponse({"error": "not_found"}, status_code=404)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        return resp
    fn, params = handler
    request.scope['path_params'] = params
    # same-origin rule for state-changing requests
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin:
            host = request.headers.get("host", "")
            if origin not in (f"http://{host}", f"https://{host}", "null") and host not in origin:
                return JSONResponse({"error": "forbidden_origin"}, status_code=403)
    conn = None
    try:
        conn = app.db.connect()
        from .api.ctx import Ctx

        ctx = Ctx(app, request, conn)
        # find the session
        token = request.cookies.get("wardline_session")
        session = app.sessions.find_active(conn, token)
        if session is not None:
            ctx.session = session
        # idempotent replay happens right after authentication
        if session is not None and not ctx.background:
            with conn.cursor() as cur:
                cur.execute("UPDATE sessions SET last_activity = now() WHERE id = %s", (session.id,))
            conn.commit()
        elif session is not None:
            conn.rollback()
        result = await fn(ctx)
        if isinstance(result, (Response, StorageStreamResponse)):
            return result
        return result.to_response()
    except ApiError as err:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return to_response(err)
    except Exception:
        traceback.print_exc()
        try:
            if conn is not None:
                conn.rollback()
        except Exception:
            pass
        return JSONResponse({"error": "not_found"}, status_code=404)
    finally:
        if conn is not None:
            app.db.put(conn)


def match_route(pattern: str, path: str) -> dict | None:
    parts = pattern.strip("/").split("/") if pattern.strip("/") else []
    actual = path.strip("/").split("/") if path.strip("/") else []
    if len(parts) != len(actual):
        return None
    params = {}
    for p, a in zip(parts, actual):
        if p.startswith("{") and p.endswith("}"):
            params[p[1:-1]] = a
        elif p != a:
            return None
    return params


API_ROUTES: list[tuple[tuple[str, ...], str, Any]] = [
    (("GET",), "/api/health", platform_api.health),
    (("GET",), "/api/status", platform_api.status),
    (("POST",), "/api/sign-in", platform_api.sign_in),
    (("POST",), "/api/sign-out", platform_api.sign_out),
    (("GET",), "/api/session", platform_api.session_info),
    (("POST",), "/api/step-up", platform_api.step_up),
    (("POST",), "/api/users/{id}/sessions/revoke", platform_api.revoke_sessions),
    (("GET",), "/api/directory", platform_api.directory),
    (("GET",), "/api/dashboard", compartments_api.dashboard),
    (("GET",), "/api/search", compartments_api.search),
    (("GET",), "/api/compartments", compartments_api.list_compartments),
    (("POST",), "/api/compartments", compartments_api.create_compartment),
    (("GET",), "/api/compartments/{id}", compartments_api.get_compartment),
    (("POST",), "/api/compartments/{id}/grants", compartments_api.issue_grant),
    (("PATCH",), "/api/grants/{id}", compartments_api.edit_grant),
    (("POST",), "/api/grants/{id}/revoke", compartments_api.revoke_grant),
    (("POST",), "/api/compartments/{id}/break-glass", compartments_api.open_break_glass),
    (("POST",), "/api/compartments/{id}/exhibits", exhibits_api.register_exhibit),
    (("GET",), "/api/compartments/{id}/exhibits", exhibits_api.list_exhibits),
    (("GET",), "/api/compartments/{id}/releases", releases_api.list_releases),
    (("POST",), "/api/compartments/{id}/releases", releases_api.create_release),
    (("GET",), "/api/exhibits/{id}", exhibits_api.get_exhibit),
    (("POST",), "/api/exhibits/{id}/clear", exhibits_api.clear_exhibit),
    (("POST",), "/api/exhibits/{id}/refuse", exhibits_api.refuse_exhibit),
    (("POST",), "/api/exhibits/{id}/hold", exhibits_api.place_hold),
    (("POST",), "/api/exhibits/{id}/lift-hold", exhibits_api.lift_hold),
    (("POST",), "/api/exhibits/{id}/dispose", exhibits_api.propose_disposal),
    (("POST",), "/api/exhibits/{id}/dispose/confirm", exhibits_api.confirm_disposal),
    (("POST",), "/api/exhibits/{id}/dispose/cancel", exhibits_api.cancel_disposal),
    (("POST",), "/api/exhibits/{id}/preview-grants", exhibits_api.preview_grant),
    (("POST",), "/api/exhibits/{id}/download-grants", exhibits_api.download_grant),
    (("GET",), "/api/exhibits/{id}/redactions", exhibits_api.get_redactions),
    (("PUT",), "/api/exhibits/{id}/redactions", exhibits_api.put_redactions),
    (("POST",), "/api/exhibits/{id}/redactions/find", exhibits_api.find_text),
    (("POST",), "/api/exhibits/{id}/derivatives", exhibits_api.create_derivative),
    (("GET",), "/api/exhibits/{id}/derivatives", exhibits_api.list_derivatives),
    (("GET",), "/api/exhibits/{id}/custody", audit_api.custody_view),
    (("GET",), "/api/derivatives/{id}", exhibits_api.get_derivative),
    (("POST",), "/api/derivatives/{id}/download-grants", exhibits_api.derivative_download_grant),
    (("GET",), "/api/download/{token}", audit_api.download),
    (("GET",), "/api/reviews", releases_api.list_reviews),
    (("GET",), "/api/releases/{id}", releases_api.get_release),
    (("POST",), "/api/releases/{id}/items", releases_api.add_item),
    (("DELETE",), "/api/releases/{id}/items/{item_id}", releases_api.remove_item),
    (("POST",), "/api/releases/{id}/submit", releases_api.submit_release),
    (("POST",), "/api/releases/{id}/sign-off", lambda ctx: releases_api.decide_release(ctx, "sign_off")),
    (("POST",), "/api/releases/{id}/reject", lambda ctx: releases_api.decide_release(ctx, "reject")),
    (("POST",), "/api/releases/{id}/reopen", releases_api.reopen_release),
    (("POST",), "/api/releases/{id}/share", lambda ctx: releases_api.share_release(ctx, False)),
    (("POST",), "/api/releases/{id}/link/regenerate", lambda ctx: releases_api.share_release(ctx, True)),
    (("POST",), "/api/releases/{id}/link/revoke", releases_api.revoke_link),
    (("POST",), "/api/releases/{id}/withdraw", releases_api.withdraw_release),
    (("GET",), "/api/links/{token}", audit_api.link_view),
    (("POST",), "/api/links/{token}/items/{item_id}/grant", audit_api.link_item_grant),
    (("GET",), "/api/ledger", audit_api.ledger_view),
    (("GET",), "/api/signals", audit_api.signals_view),
]
