"""The contact form: stored messages, the website trap and the hourly limit."""
import datetime

from .. import textutil, validate
from ..errors import TesselError, validation_error

WINDOW = datetime.timedelta(minutes=60)
QUOTA = 3
MESSAGE_MIN = 10
MESSAGE_MAX = 4000

SPEC = {"email": validate.ANY, "message": validate.ANY, "website": validate.ANY}


def validate_body(body):
    email = validate.email(body, "email", "email")
    message = validate.string(body, "message", "message", MESSAGE_MIN, MESSAGE_MAX)
    website = body.get("website")
    if website is not None and not isinstance(website, str):
        raise validation_error("website", "This field must be a string")
    return email, message, (website or "")


def store(cur, email, message, website):
    """Store a real message under the hourly limit; thank a trapped robot."""
    if website.strip():
        return
    since = textutil.now() - WINDOW
    rows = cur.all(
        """
        SELECT created_at FROM contact_messages
         WHERE email = %s AND created_at > %s ORDER BY created_at
        """,
        (email, since),
    )
    if len(rows) >= QUOTA:
        oldest = rows[-QUOTA]["created_at"]
        remaining = (oldest + WINDOW - textutil.now()).total_seconds()
        seconds = max(1, min(3600, int(remaining) + 1))
        raise TesselError(
            "RATE_LIMITED", seconds=seconds, headers={"Retry-After": str(seconds)}
        )
    cur.execute(
        "INSERT INTO contact_messages (email, message, created_at) VALUES (%s, %s, %s)",
        (email, message, textutil.now()),
    )
