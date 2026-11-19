"""Open addresses: the sales enquiry and the newsletter subscribe."""
from starlette.responses import JSONResponse, Response

from . import auth, config
from .ctx import Ctx
from .db import one, tx
from .errors import refuse
from .util import norm_email, valid_email


def _fields(ctx: Ctx) -> dict:
    if ctx.is_form:
        return ctx.form or {}
    body = ctx.json()
    if not isinstance(body, dict):
        refuse(422, "The request body must be a JSON object.", "body")
    return body


def _text(data: dict, name: str, label: str, *, required: bool, limit: int) -> str | None:
    value = data.get(name)
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            refuse(422, f"Enter {label}", name)
        return None
    if not isinstance(value, str) or len(value) > limit:
        refuse(422, f"{label[0].upper() + label[1:]} must be text of up to {limit} characters", name)
    return value.strip() if name != "message" else value


def enquiry(ctx: Ctx) -> Response:
    auth.require_form_token(ctx)
    data = _fields(ctx)
    full_name = _text(data, "full_name", "your full name", required=True, limit=120)
    email = norm_email(data.get("work_email"))
    if not valid_email(email):
        refuse(422, "Enter a work email such as name@company.com", "work_email")
    phone = _text(data, "phone", "a phone number", required=False, limit=40)
    company = _text(data, "company", "your company name", required=True, limit=120)
    role = _text(data, "role", "your role", required=False, limit=120)
    message = data.get("message")
    if not isinstance(message, str) or not message.strip():
        refuse(422, "Enter a message", "message")
    if len(message) > config.MESSAGE_CEILING:
        refuse(422, f"The message may be at most {config.MESSAGE_CEILING} characters", "message")
    with tx() as conn:
        row = one(conn, "INSERT INTO enquiries (full_name, work_email, phone, company, role, message) "
                        "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                  (full_name, email, phone, company, role, message))
    return JSONResponse({"id": row["id"], "work_email": email,
                         "confirmation": f"Thank you. We recorded your enquiry against {email}."}, status_code=201)


def subscribe(ctx: Ctx) -> Response:
    auth.require_form_token(ctx)
    data = _fields(ctx)
    email = norm_email(data.get("email"))
    if not valid_email(email):
        refuse(422, "Enter an email such as name@company.com", "email")
    with tx() as conn:
        conn.execute("INSERT INTO subscribers (email) VALUES (%s) ON CONFLICT (email) DO NOTHING", (email,))
    return JSONResponse({"email": email, "confirmation": "You're on the list."})
