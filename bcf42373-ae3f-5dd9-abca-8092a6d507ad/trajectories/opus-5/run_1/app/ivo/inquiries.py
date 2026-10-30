"""Inquiries: validation, the duplicate window and the guarded resolve."""

import hashlib

from . import fields
from .errors import ALREADY_RESOLVED, ApiError

DUPLICATE_WINDOW_SECONDS = 60

COLUMNS = (
    "id, name, phone, email, message, project_type, status, received_at, "
    "resolved_at"
)


def validate(payload):
    """Check one inquiry body, naming every failing field at once."""
    errors = {}
    values = {}

    for key in payload:
        if key not in fields.INQUIRY_FIELDS:
            errors[key] = fields.CANNOT_BE_SET

    for name in fields.INQUIRY_FIELDS:
        if name not in payload:
            if name != "project_type":
                errors[name] = fields.REQUIRED
            continue
        value, message = _check_field(name, payload[name])
        if message:
            errors[name] = message
        else:
            values[name] = value

    return values, errors


def _check_field(name, value):
    if name == "name":
        return fields.check_name(value)
    if name == "phone":
        return fields.check_phone(value)
    if name == "email":
        return fields.check_email(value)
    if name == "project_type":
        return fields.check_choice(
            value, fields.PROJECT_TYPES, fields.PROJECT_TYPE_CHOICE
        )
    return fields.check_text(value, *fields.INQUIRY_TEXT_LIMITS["message"], True)


def _duplicate_key(email, message):
    digest = hashlib.blake2b(
        f"{email.lower()}\n{message}".encode("utf-8"), digest_size=8
    ).digest()
    return int.from_bytes(digest, "big", signed=True)


def store(cursor, values):
    """Store one inquiry, or answer with the original inside the window."""
    email = values["email"]
    message = values["message"]
    cursor.execute(
        "SELECT pg_advisory_xact_lock(%s)", (_duplicate_key(email, message),)
    )
    cursor.execute(
        f"""
        SELECT {COLUMNS} FROM inquiries
         WHERE lower(email) = lower(%(email)s)
           AND message = %(message)s
           AND received_at > now() - make_interval(secs => %(window)s)
         ORDER BY received_at DESC, id DESC
         LIMIT 1
        """,
        {"email": email, "message": message, "window": DUPLICATE_WINDOW_SECONDS},
    )
    original = cursor.fetchone()
    if original is not None:
        return dict(original), False

    cursor.execute(
        f"""
        INSERT INTO inquiries (name, phone, email, message, project_type)
        VALUES (%(name)s, %(phone)s, %(email)s, %(message)s, %(project_type)s)
        RETURNING {COLUMNS}
        """,
        {"project_type": None, **values},
    )
    return dict(cursor.fetchone()), True


def inbox(cursor):
    cursor.execute(
        f"SELECT {COLUMNS} FROM inquiries ORDER BY received_at DESC, id DESC"
    )
    return [dict(row) for row in cursor.fetchall()]


def resolve(cursor, inquiry_id):
    """The one guarded transition: new becomes resolved exactly once."""
    cursor.execute(
        f"""
        UPDATE inquiries SET status = 'resolved', resolved_at = now()
         WHERE id = %s AND status = 'new'
        RETURNING {COLUMNS}
        """,
        (inquiry_id,),
    )
    row = cursor.fetchone()
    if row is None:
        raise ApiError(409, ALREADY_RESOLVED)
    return dict(row)


def exists(cursor, inquiry_id):
    cursor.execute("SELECT 1 FROM inquiries WHERE id = %s", (inquiry_id,))
    return cursor.fetchone() is not None
