"""Enquiries from the public origin, which belong to the served programme."""

from __future__ import annotations

import re

import psycopg
from flask import Blueprint

from ..config import REPLY_TO
from ..domain.fields import is_hostile
from ..domain.references import live_by_slug
from ..http import Refusal, json_response, raw_body, read_object, store
from ..strings import EN
from .support import served_programme_id

bp = Blueprint("enquiry_api", __name__)

ADDRESS = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")
MESSAGES = EN["errors"]


def _validate(body: dict) -> dict:
    errors = {}

    email = body.get("email")
    if not isinstance(email, str) or is_hostile(email):
        errors["email"] = MESSAGES["email"]
    else:
        trimmed = email.strip()
        if len(trimmed) > 254 or not ADDRESS.match(trimmed):
            errors["email"] = MESSAGES["email"]

    if body.get("agreed") is not True:
        errors["agreed"] = MESSAGES["agreed"]

    phone = body.get("phone", "")
    if "phone" in body and (
        not isinstance(phone, str) or is_hostile(phone) or len(phone) < 10
    ):
        errors["phone"] = MESSAGES["phone"]

    reference = body.get("reference")
    if reference not in (None, "") and (
        not isinstance(reference, str) or is_hostile(reference)
    ):
        errors["reference"] = MESSAGES["reference"]

    return errors


def _open_enquiry_id(conn, programme_id: int, email: str) -> int | None:
    row = conn.execute(
        """SELECT id FROM enquiry
            WHERE programme_id = %s AND open AND lower(btrim(email)) = lower(btrim(%s))""",
        (programme_id, email),
    ).fetchone()
    return int(row["id"]) if row is not None else None


@bp.route("/api/enquiries", methods=["POST"], provide_automatic_options=False)
def create_enquiry():
    raw = raw_body()
    with store() as st:
        body = read_object(raw)
        errors = _validate(body)
        programme_id = served_programme_id(st)

        reference = body.get("reference")
        if (
            "reference" not in errors
            and isinstance(reference, str)
            and reference != ""
            and live_by_slug(st.conn, programme_id, st.today, reference) is None
        ):
            errors["reference"] = MESSAGES["reference"]

        if errors:
            raise Refusal(422, {"errors": errors})

        email = body["email"].strip()
        phone = body.get("phone")
        existing = _open_enquiry_id(st.conn, programme_id, email)
        if existing is not None:
            return json_response({"id": existing, "reply_to": REPLY_TO}, 201)

        try:
            with st.conn.transaction():
                row = st.conn.execute(
                    """INSERT INTO enquiry
                           (programme_id, email, phone, reference, created_at, agreed, open)
                       VALUES (%s, %s, %s, %s, %s, true, true) RETURNING id""",
                    (programme_id, email, phone, reference or None, st.now),
                ).fetchone()
            enquiry_id = int(row["id"])
        except psycopg.errors.UniqueViolation:
            enquiry_id = _open_enquiry_id(st.conn, programme_id, email)
        return json_response({"id": enquiry_id, "reply_to": REPLY_TO}, 201)
