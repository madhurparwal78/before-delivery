"""Reading inquiries and turning rows into the API shapes; every shape names its fields explicitly."""
import re
from typing import Any

from northpier import db
from northpier.studio_time import zulu

INQUIRY_COLUMNS = ("id, reference, status_token, name, email, company, services, budget, timeline, message, "
                   "status, call_at, decline_reason, version, created_at, updated_at")


def inquiry_by_id(tx: db.Tx, inquiry_id: int, lock: bool = False) -> dict[str, Any] | None:
    return tx.one(f"SELECT {INQUIRY_COLUMNS} FROM inquiries WHERE id = :id" + (" FOR UPDATE" if lock else ""),
                  id=inquiry_id)


TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,128}")


def inquiry_by_token(tx: db.Tx, token: str) -> dict[str, Any] | None:
    """The inquiry a status token names; a token that cannot have been minted names none."""
    if not TOKEN_PATTERN.fullmatch(token):
        return None
    return tx.one(f"SELECT {INQUIRY_COLUMNS} FROM inquiries WHERE status_token = :token", token=token)


def studio_inquiry(row: dict[str, Any], with_message: bool = True) -> dict[str, Any]:
    shape = {
        "id": row["id"], "reference": row["reference"], "name": row["name"], "email": row["email"],
        "company": row["company"], "services": list(row["services"]), "budget": row["budget"],
        "timeline": row["timeline"], "message": row["message"], "status": row["status"],
        "call_at": zulu(row["call_at"], seconds_only=True), "decline_reason": row["decline_reason"],
        "version": row["version"], "created_at": zulu(row["created_at"]), "updated_at": zulu(row["updated_at"]),
    }
    if not with_message:
        del shape["message"]
    return shape


def history_rows(tx: db.Tx, inquiry_id: int) -> list[dict[str, Any]]:
    return tx.rows("SELECT e.action, e.from_status, e.to_status, e.call_at, e.decline_reason, e.created_at, "
                   "u.name AS actor_name FROM status_events e LEFT JOIN studio_users u ON u.id = e.actor_id "
                   "WHERE e.inquiry_id = :id ORDER BY e.id", id=inquiry_id)


def studio_history(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"action": r["action"], "from_status": r["from_status"], "to_status": r["to_status"],
             "call_at": zulu(r["call_at"], seconds_only=True), "decline_reason": r["decline_reason"],
             "actor_name": r["actor_name"], "created_at": zulu(r["created_at"])} for r in rows]


def note_rows(tx: db.Tx, inquiry_id: int) -> list[dict[str, Any]]:
    return tx.rows("SELECT n.id, n.body, u.name AS author_name, n.created_at FROM notes n "
                   "JOIN studio_users u ON u.id = n.author_id WHERE n.inquiry_id = :id ORDER BY n.id DESC",
                   id=inquiry_id)


def note_shape(row: dict[str, Any]) -> dict[str, Any]:
    return {"id": row["id"], "body": row["body"], "author_name": row["author_name"],
            "created_at": zulu(row["created_at"])}


def public_inquiry(row: dict[str, Any], history: list[dict[str, Any]]) -> dict[str, Any]:
    """The visitor's view: no name, email, note, actor, id or token."""
    return {
        "reference": row["reference"], "status": row["status"], "call_at": zulu(row["call_at"], seconds_only=True),
        "decline_reason": row["decline_reason"], "company": row["company"], "services": list(row["services"]),
        "budget": row["budget"], "timeline": row["timeline"], "message": row["message"],
        "created_at": zulu(row["created_at"]),
        "history": [{"status": h["to_status"], "created_at": zulu(h["created_at"])} for h in history],
    }
