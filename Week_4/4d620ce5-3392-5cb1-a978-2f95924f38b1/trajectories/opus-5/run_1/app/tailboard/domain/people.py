"""People: Person and User shapes, certification scopes, succession and erasure.

A Person is always named by reference, so an erasure changes only what a reference
resolves to.
"""

from ..ids import signer_token
from . import audit
from .notices import queue_succession_notice, rewrite_notices_for_person

ROLES = (
    "compliance_planner",
    "licensed_inspector",
    "certifying_engineer",
    "records_clerk",
    "regulator_auditor",
)


def load_people(cursor):
    rows = cursor.all(
        """SELECT u.id, u.username, u.display_name, u.role, u.contractor, u.licence, u.email,
                  u.erased, u.signer_token, u.is_system, u.sort_order,
                  ARRAY(SELECT model_code FROM engineer_scope s WHERE s.user_id = u.id
                        ORDER BY model_code) AS scope
             FROM users u ORDER BY u.sort_order, u.display_name"""
    )
    return {row["id"]: row for row in rows}


def person(row):
    if row is None:
        return None
    if row["erased"]:
        return {
            "id": row["id"],
            "display_name": row["signer_token"],
            "licence": None,
            "erased": True,
        }
    return {
        "id": row["id"],
        "display_name": row["display_name"],
        "licence": row["licence"],
        "erased": False,
    }


def display_name(row):
    return row["signer_token"] if row["erased"] else row["display_name"]


def user(row):
    shape = person(row)
    shape.update(
        {
            "username": row["username"],
            "role": row["role"],
            "contractor": bool(row["contractor"]),
            "email": None if row["erased"] else row["email"],
            "scope": list(row["scope"]) if row["role"] == "certifying_engineer" else None,
        }
    )
    return shape


def listed_users(people):
    return [user(row) for row in people.values() if not row["is_system"]]


def covers(cursor, user_id, model_code):
    """The scope check, read inside the transaction that commits the countersignature."""
    return bool(
        cursor.value(
            "SELECT 1 FROM engineer_scope WHERE user_id = %s AND model_code = %s",
            (user_id, model_code),
        )
    )


def next_certifier(cursor, model_code, skip_ids=()):
    """The first engineer on the model's standby list whose scope covers the model."""
    rows = cursor.all(
        """SELECT s.user_id FROM standby_list s
            JOIN engineer_scope e ON e.user_id = s.user_id AND e.model_code = s.model_code
            WHERE s.model_code = %s ORDER BY s.position""",
        (model_code,),
    )
    for row in rows:
        if row["user_id"] not in skip_ids:
            return row["user_id"]
    return None


def set_scope(cursor, actor_id, engineer_id, models, at):
    cursor.execute("DELETE FROM engineer_scope WHERE user_id = %s", (engineer_id,))
    for model in sorted(set(models)):
        cursor.execute(
            "INSERT INTO engineer_scope (user_id, model_code) VALUES (%s,%s)",
            (engineer_id, model),
        )
    audit.write(
        cursor, at, actor_id, "engineer.scope_changed", None, None,
        f"Scope set to {', '.join(sorted(set(models))) or 'none'}",
    )
    return _resettle(cursor, actor_id, engineer_id, set(models), at)


def _resettle(cursor, actor_id, engineer_id, models, at):
    """Hand over every inspected thread the scope change touches."""
    succession = []
    narrowed = cursor.all(
        """SELECT t.id, t.registration, t.directive_id, t.certifier_id, a.model_code
             FROM threads t JOIN tails a ON a.registration = t.registration
            WHERE t.stage = 'inspected' AND t.certifier_id = %s""",
        (engineer_id,),
    )
    for row in narrowed:
        if row["model_code"] in models:
            continue
        successor = next_certifier(cursor, row["model_code"], skip_ids={engineer_id})
        _assign(cursor, row, successor, actor_id, at, engineer_id)
        succession.append({"thread_id": row["id"], "from": engineer_id, "to": successor})

    awaiting = cursor.all(
        """SELECT t.id, t.registration, t.directive_id, t.certifier_id, a.model_code
             FROM threads t JOIN tails a ON a.registration = t.registration
            WHERE t.stage = 'inspected' AND t.certifier_id IS NULL
              AND a.model_code = ANY(%s)""",
        (sorted(models),),
    )
    for row in awaiting:
        successor = next_certifier(cursor, row["model_code"])
        if successor is None:
            continue
        _assign(cursor, row, successor, actor_id, at, None)
        succession.append({"thread_id": row["id"], "from": None, "to": successor})
    return succession


def _assign(cursor, thread_row, successor, actor_id, at, previous_id):
    cursor.execute(
        """UPDATE threads SET certifier_id = %s,
               certifier_status = CASE WHEN %s::text IS NULL THEN 'awaiting_certifier'
                                       ELSE 'awaiting_countersignature' END
            WHERE id = %s""",
        (successor, successor, thread_row["id"]),
    )
    if successor:
        queue_succession_notice(cursor, thread_row["id"], successor, previous_id, at)
    audit.write(
        cursor, at, actor_id, "thread.certifier_changed", thread_row["directive_id"],
        thread_row["id"],
        "Passed to the next certifier" if successor else "Awaiting a certifier",
    )


def erase(cursor, actor_id, target_id, reason, at):
    """Replace a contractor's name and licence everywhere with a stable signer token."""
    row = cursor.one(
        "SELECT id, display_name, licence, contractor, erased FROM users WHERE id = %s",
        (target_id,),
    )
    token = signer_token()
    while cursor.value("SELECT 1 FROM users WHERE signer_token = %s", (token,)):
        token = signer_token()

    aliases = [value.lower() for value in (row["display_name"], row["licence"]) if value]
    cursor.execute(
        "UPDATE users SET erased = true, signer_token = %s, passcode = NULL WHERE id = %s",
        (token, target_id),
    )
    for alias in aliases:
        cursor.execute(
            "INSERT INTO erased_aliases (alias, user_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
            (alias, target_id),
        )
    cursor.execute("UPDATE sessions SET ended = true WHERE user_id = %s", (target_id,))
    cursor.execute(
        "UPDATE signatures SET signer_text = %s WHERE lower(signer_text) = ANY(%s)",
        (token, aliases),
    )
    for column in ("inspector", "certifier"):
        cursor.execute(
            f"UPDATE legacy_records SET {column} = %s, {column}_licence = NULL"
            f" WHERE lower({column}) = ANY(%s) OR lower({column}_licence) = ANY(%s)",
            (token, aliases, aliases),
        )
    audit.write(cursor, at, actor_id, "person.erased", None, None,
                f"{token} replaces an erased contractor: {reason}")

    touched = _release_cards(cursor, target_id, actor_id, at, token)
    rewrite_notices_for_person(cursor, target_id, at)
    cursor.execute(
        """UPDATE packs SET rerender_needed = true
            WHERE status = 'transmitted' AND pdf_key IS NOT NULL"""
    )
    return token, touched


def _release_cards(cursor, target_id, actor_id, at, token):
    held = cursor.all(
        "SELECT id, directive_id, stage FROM threads WHERE holder_id = %s", (target_id,)
    )
    for thread in held:
        stage = "open" if thread["stage"] == "claimed" else thread["stage"]
        cursor.execute(
            "UPDATE threads SET holder_id = NULL, claimed_at = NULL, stage = %s WHERE id = %s",
            (stage, thread["id"]),
        )
        audit.write(cursor, at, actor_id, "thread.card_cleared", thread["directive_id"],
                    thread["id"], f"Work card cleared for {token}")
    return [thread["id"] for thread in held]


def erased_token_for(cursor, text):
    """The token that now stands for a legacy signer name or licence."""
    if not text:
        return None
    return cursor.value(
        """SELECT u.signer_token FROM erased_aliases a JOIN users u ON u.id = a.user_id
            WHERE a.alias = %s""",
        (text.lower(),),
    )

