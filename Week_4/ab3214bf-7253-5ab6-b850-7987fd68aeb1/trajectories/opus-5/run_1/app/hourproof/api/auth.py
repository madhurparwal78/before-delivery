"""Sign-in, sign-out and the account behind the session cookie."""

from __future__ import annotations

from flask import Blueprint

from .. import db, passwords
from ..errors import invalid_credentials
from . import (
    LANDING,
    SESSION_COOKIE,
    Account,
    end_session,
    envelope,
    new_session,
    read_body,
    require_account,
)

auth = Blueprint("auth", __name__)


@auth.post("/auth/sign-in")
def sign_in():
    body = read_body()
    email = body.get("email")
    password = body.get("password")
    with db.tx() as cursor:
        row = (
            cursor.one("SELECT * FROM users WHERE email = %s", (email,))
            if isinstance(email, str)
            else None
        )
        if (
            row is None
            or not isinstance(password, str)
            or not passwords.matches(password, row["password_hash"])
        ):
            raise invalid_credentials()
        account = Account(
            id=row["id"],
            email=row["email"],
            name=row["name"],
            role=row["role"],
            firm_id=row["firm_id"],
        )
        token = new_session(cursor, account.id)
    response = envelope(
        {"user": account.json(), "landing_url": LANDING[account.role]}
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="Lax",
        path="/",
    )
    return response


@auth.post("/auth/sign-out")
def sign_out():
    with db.tx() as cursor:
        end_session(cursor)
    response = envelope({"signed_out": True})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@auth.get("/me")
def read_me():
    with db.tx() as cursor:
        account = require_account(cursor)
        return envelope({"user": account.json()})
