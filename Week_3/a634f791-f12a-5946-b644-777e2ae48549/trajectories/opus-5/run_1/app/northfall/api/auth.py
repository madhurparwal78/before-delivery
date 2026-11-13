"""Sign in. Every failure answers one byte-identical body."""

from __future__ import annotations

from flask import Blueprint

from ..domain.accounts import sign_in
from ..domain.fields import is_hostile
from ..http import Refusal, json_response, raw_body, read_object, store

bp = Blueprint("auth_api", __name__)

REFUSED = {"message": "The address or password is not right"}


@bp.route("/api/auth/login", methods=["POST"], provide_automatic_options=False)
def login():
    raw = raw_body()
    with store() as st:
        body = read_object(raw)
        email, password = body.get("email"), body.get("password")
        for value in (email, password):
            if not isinstance(value, str) or is_hostile(value):
                raise Refusal(401, REFUSED)
        granted = sign_in(st.conn, email, password, st.now)
        if granted is None:
            raise Refusal(401, REFUSED)
        return json_response(granted)
