"""Sessions for the seeded users."""

from . import clock
from .errors import ApiError
from .ids import session_id


def sign_in(cursor, username, passcode):
    row = cursor.one(
        """SELECT * FROM users
            WHERE username = %s AND passcode = %s AND erased = false AND is_system = false""",
        (username, passcode),
    )
    if row is None:
        raise ApiError("bad_credentials", "Username or passcode is wrong.", status=401)
    identifier = session_id()
    cursor.execute(
        "INSERT INTO sessions (id, user_id, created_at) VALUES (%s,%s,%s)",
        (identifier, row["id"], clock.now()),
    )
    return identifier, row


def current_user(cursor, identifier):
    if not identifier:
        return None
    return cursor.one(
        """SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.id = %s AND s.ended = false AND u.erased = false""",
        (identifier,),
    )


def sign_out(cursor, identifier):
    cursor.execute("UPDATE sessions SET ended = true WHERE id = %s", (identifier,))
