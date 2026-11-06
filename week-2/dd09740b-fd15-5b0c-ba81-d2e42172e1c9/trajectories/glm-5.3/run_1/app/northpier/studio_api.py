"""The studio API: the queue, one inquiry, transitions and notes."""
from __future__ import annotations

import datetime as dt
import hashlib
import json

import psycopg
from flask import request

from . import auth, db, errors, labels, mailer, rules
from .config import CONFIG
from .app import (api_error_response, app, current_user, idempotency_key,
                  json_response, log_db_error, outage, read_body,
                  refuse_with_headers, require_studio, valid_origin)
from .inquiries import (iso, note_json, studio_history, studio_inquiry,
                        utc_now)
from .labels import STATUS_LABELS
from .transitions import TransitionRefusal, apply_transition

TABS = ("new", "in_review", "call_booked", "won", "declined", "all")
TAB_LIST = ("new", "in_review", "call_booked", "won", "declined")

ORDERS = {
    "new": "created_at ASC, id ASC",
    "in_review": "created_at ASC, id ASC",
    "call_booked": "call_at ASC, id ASC",
    "won": "updated_at DESC, id ASC",
    "declined": "updated_at DESC, id ASC",
    "all": "created_at DESC, id DESC",
}


def queue_query(conn, status: str, q: str) -> tuple[list[dict], dict]:
    where = ["TRUE"]
    params: dict = {}
    if q:
        literal = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        where.append(
            "(lower(name) LIKE %(like)s ESCAPE '\\' OR lower(COALESCE(company, '')) LIKE %(like)s ESCAPE '\\'"
            " OR lower(reference) LIKE %(like)s ESCAPE '\\' OR lower(split_part(email, '@', 1)) LIKE %(like)s ESCAPE '\\')"
        )
        params["like"] = f"%{literal.lower()}%"

    def rows_for(tab: str) -> list[dict]:
        tab_where = list(where)
        tab_params = dict(params)
        if tab != "all":
            tab_where.append("status = %(tab)s")
            tab_params["tab"] = tab
        sql = f"""
            SELECT id, reference, name, email, company, services, budget, timeline,
                   status, call_at, decline_reason, version, created_at, updated_at
            FROM inquiries
            WHERE {" AND ".join(tab_where)}
            ORDER BY {ORDERS[tab]}
        """
        return conn.execute(sql, tab_params).fetchall()

    counts = {tab: len(rows_for(tab)) for tab in TAB_LIST}
    counts["all"] = sum(counts[tab] for tab in TAB_LIST)
    rows = rows_for(status)
    return rows, counts


@app.route("/api/studio/inquiries", methods=["GET"])
def api_studio_queue() -> Response | tuple[Response, int]:
    user, refusal = require_studio()
    if refusal is not None:
        return refusal
    status = request.args.get("status", "new")
    q = (request.args.get("q") or "").strip()
    if status not in TABS:
        return refuse_with_headers(labels.UNKNOWN_TAB)
    if q and len(q) > 100:
        return refuse_with_headers(labels.SEARCH_TOO_LONG)

    def handler(conn):
        rows, counts = queue_query(conn, status, q)
        return json_response(
            {"inquiries": [studio_inquiry(r, include_message=False) for r in rows],
             "counts": counts}
        )

    try:
        return db.db_call(handler)
    except psycopg.Error as exc:
        log_db_error(exc)
        db.mark_unavailable()
        return outage()


def load_studio_inquiry(conn, inquiry_id: str, role: str) -> tuple[dict | None, Response | None]:
    if not inquiry_id.isdigit():
        return None, refuse_with_headers(labels.NOT_FOUND)
    row = conn.execute("SELECT * FROM inquiries WHERE id = %(i)s",
                       {"i": int(inquiry_id)}).fetchone()
    if row is None:
        return None, refuse_with_headers(labels.NOT_FOUND)
    history = conn.execute(
        """
        SELECT e.*, u.name AS actor_name FROM status_events e
        LEFT JOIN studio_users u ON u.id = e.actor_id
        WHERE e.inquiry_id = %(i)s ORDER BY e.id
        """,
        {"i": row["id"]},
    ).fetchall()
    payload = studio_inquiry(row)
    payload["allowed_actions"] = rules.allowed_actions(row["status"], role)
    payload["history"] = studio_history(history)
    return payload, None


@app.route("/api/studio/inquiries/<inquiry_id>", methods=["GET"])
def api_studio_inquiry(inquiry_id: str) -> Response | tuple[Response, int]:
    user, refusal = require_studio()
    if refusal is not None:
        return refusal

    def handler(conn):
        payload, not_found = load_studio_inquiry(conn, inquiry_id, user["role"])
        if not_found is not None:
            return not_found
        notes = conn.execute(
            """
            SELECT n.*, u.name AS author_name FROM notes n
            JOIN studio_users u ON u.id = n.author_id
            WHERE n.inquiry_id = %(i)s ORDER BY n.id DESC
            """,
            {"i": payload["id"]},
        ).fetchall()
        payload["notes"] = [note_json(n) for n in notes]
        return json_response(payload)

    try:
        return db.db_call(handler)
    except psycopg.Error as exc:
        log_db_error(exc)
        db.mark_unavailable()
        return outage()


@app.route("/api/studio/inquiries/<inquiry_id>/transition", methods=["POST"])
def api_studio_transition(inquiry_id: str) -> Response | tuple[Response, int]:
    user, refusal = require_studio()
    if refusal is not None:
        return refusal
    if not valid_origin():
        return refuse_with_headers(labels.CROSS_ORIGIN)
    data, body_refusal = read_body()
    if body_refusal is not None:
        return body_refusal
    key, key_refusal = idempotency_key()
    if key_refusal is not None:
        return key_refusal
    body_hash = None
    if key is not None:
        body_hash = hashlib.sha256(
            json.dumps(data, sort_keys=True, ensure_ascii=False).encode("utf-8")
        ).hexdigest()

    def handler(conn):
        row = None
        if inquiry_id.isdigit():
            row = conn.execute("SELECT * FROM inquiries WHERE id = %(i)s",
                               {"i": int(inquiry_id)}).fetchone()
        if row is None:
            return refuse_with_headers(labels.NOT_FOUND)
        if key is not None:
            # Claim the key before applying anything: a simultaneous request
            # with the same key blocks here until this transaction resolves.
            claimed = conn.execute(
                """
                INSERT INTO transition_keys (user_id, inquiry_id, key, request_body, response_body, created_at)
                VALUES (%(u)s, %(i)s, %(k)s, %(b)s, NULL, now())
                ON CONFLICT (user_id, inquiry_id, key) DO NOTHING
                RETURNING key
                """,
                {"u": user["id"], "i": row["id"], "k": key, "b": body_hash},
            ).fetchone()
            if claimed is None:
                stored = conn.execute(
                    "SELECT * FROM transition_keys WHERE user_id = %(u)s AND inquiry_id = %(i)s AND key = %(k)s",
                    {"u": user["id"], "i": row["id"], "k": key},
                ).fetchone()
                if stored is not None and stored["response_body"] is not None:
                    if stored["request_body"] != body_hash:
                        return refuse_with_headers(labels.CHANGE_KEY_CONFLICT)
                    return json_response(json.loads(stored["response_body"]), 200)
                conn.execute(
                    """
                    INSERT INTO transition_keys (user_id, inquiry_id, key, request_body, response_body, created_at)
                    VALUES (%(u)s, %(i)s, %(k)s, %(b)s, NULL, now())
                    ON CONFLICT (user_id, inquiry_id, key) DO NOTHING
                    """,
                    {"u": user["id"], "i": row["id"], "k": key, "b": body_hash},
                )
        action = data.get("action")
        version = data.get("version")
        call_at = data.get("call_at")
        decline_reason = data.get("decline_reason")
        if action in ("book_call", "reschedule_call") and not isinstance(call_at, str):
            call_at = None
        updated = apply_transition(conn, row, user, action, version, call_at, decline_reason)
        history = conn.execute(
            """
            SELECT e.*, u.name AS actor_name FROM status_events e
            LEFT JOIN studio_users u ON u.id = e.actor_id
            WHERE e.inquiry_id = %(i)s ORDER BY e.id
            """,
            {"i": row["id"]},
        ).fetchall()
        payload = studio_inquiry(updated)
        payload["allowed_actions"] = rules.allowed_actions(updated["status"], user["role"])
        payload["history"] = studio_history(history)
        if key is not None:
            conn.execute(
                """
                UPDATE transition_keys SET response_body = %(r)s
                 WHERE user_id = %(u)s AND inquiry_id = %(i)s AND key = %(k)s AND response_body IS NULL
                """,
                {"r": json.dumps(payload, ensure_ascii=False),
                 "u": user["id"], "i": row["id"], "k": key},
            )
        return json_response(payload, 200)

    try:
        result = db.db_transaction(handler)
    except TransitionRefusal as exc:
        return api_error_response(exc.status, exc.field, exc.message)
    except psycopg.Error as exc:
        log_db_error(exc)
        db.mark_unavailable()
        return outage()
    mailer.try_send_now()
    return result


@app.route("/api/studio/inquiries/<inquiry_id>/notes", methods=["POST"])
def api_studio_note(inquiry_id: str) -> Response | tuple[Response, int]:
    user, refusal = require_studio()
    if refusal is not None:
        return refusal
    if not valid_origin():
        return refuse_with_headers(labels.CROSS_ORIGIN)
    data, body_refusal = read_body()
    if body_refusal is not None:
        return body_refusal
    body = data.get("body")

    def handler(conn):
        row = None
        if inquiry_id.isdigit():
            row = conn.execute("SELECT id FROM inquiries WHERE id = %(i)s",
                               {"i": int(inquiry_id)}).fetchone()
        if row is None:
            return refuse_with_headers(labels.NOT_FOUND)
        if not isinstance(body, str):
            return api_error_response(422, "body", "Note cannot be empty.")
        if rules.has_unsupported_character(body, True):
            return api_error_response(422, "body", "Remove the unsupported characters.")
        text = rules.normalise_newlines(body).strip()
        if not text:
            return api_error_response(422, "body", "Note cannot be empty.")
        if len(text) > 1000:
            return api_error_response(422, "body", "Note must be 1000 characters or fewer.")
        note = conn.execute(
            """
            INSERT INTO notes (inquiry_id, author_id, body, created_at)
            VALUES (%(i)s, %(a)s, %(b)s, %(now)s)
            RETURNING id, body, created_at
            """,
            {"i": row["id"], "a": user["id"], "b": text, "now": utc_now()},
        ).fetchone()
        return json_response(
            {
                "id": note["id"],
                "body": note["body"],
                "author_name": user["name"],
                "created_at": iso(note["created_at"]),
            },
            201,
        )

    try:
        return db.db_transaction(handler)
    except psycopg.Error as exc:
        log_db_error(exc)
        db.mark_unavailable()
        return outage()
