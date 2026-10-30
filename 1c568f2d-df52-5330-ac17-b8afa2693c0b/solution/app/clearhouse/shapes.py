"""The API's published shapes: piece, queue row, object, review, acknowledgement and audit row."""

from .db import Row, Tx
from .timefmt import iso

PIECE_SELECT = """
SELECT p.id, p.title, p.summary, p.fee_cents, p.submitted_fee_cents, p.state, p.owner_id, a.name AS owner_name,
       p.version, p.created_at, p.updated_at, p.cleared_at, p.published_at,
       (SELECT result FROM reviews r WHERE r.piece_id = p.id AND r.kind = 'licence') AS licence_review,
       (SELECT result FROM reviews r WHERE r.piece_id = p.id AND r.kind = 'accessibility') AS accessibility_review
FROM pieces p JOIN accounts a ON a.id = p.owner_id
"""

AUDIT_SELECT = """
SELECT e.id, e.piece_id, p.title AS piece_title, e.from_state, e.to_state, e.reason, e.created_at,
       a.id AS actor_id, a.name AS actor_name, a.role AS actor_role
FROM audit_entries e JOIN pieces p ON p.id = e.piece_id JOIN accounts a ON a.id = e.actor_id
"""


def piece_of(row: Row, *, with_summary: bool = True) -> dict:
    shaped = {
        "id": row["id"], "title": row["title"], "summary": row["summary"], "fee_cents": row["fee_cents"],
        "submitted_fee_cents": row["submitted_fee_cents"], "state": row["state"],
        "owner": {"id": row["owner_id"], "name": row["owner_name"]}, "version": row["version"],
        "created_at": iso(row["created_at"]), "updated_at": iso(row["updated_at"]),
        "cleared_at": iso(row["cleared_at"]), "published_at": iso(row["published_at"]),
        "licence_review": row["licence_review"], "accessibility_review": row["accessibility_review"],
    }
    if not with_summary:
        del shaped["summary"]
    return shaped


def piece_row(tx: Tx, piece_id: int) -> Row:
    return tx.one(PIECE_SELECT + " WHERE p.id = :id", id=piece_id)


def piece(tx: Tx, piece_id: int) -> dict:
    return piece_of(piece_row(tx, piece_id))


def object_of(row: Row) -> dict:
    return {key: row[key] for key in (
        "id", "title", "image_title", "page_url", "article_url", "description", "extract", "license",
        "license_url", "artist", "image_desc_url", "width", "height", "cutout_id", "mask_w", "mask_h", "mask_b",
        "shuffle_rank")}


def cited_objects(tx: Tx, piece_id: int) -> list[Row]:
    return tx.rows("SELECT o.* FROM piece_objects po JOIN objects o ON o.id = po.object_id "
                   "WHERE po.piece_id = :id ORDER BY po.position", id=piece_id)


def review_of(row: Row) -> dict:
    return {"id": row["id"], "piece_id": row["piece_id"], "kind": row["kind"], "result": row["result"],
            "reason": row["reason"], "reviewer_id": row["reviewer_id"],
            "reviewer": {"id": row["reviewer_id"], "name": row["reviewer_name"]},
            "created_at": iso(row["created_at"])}


def reviews(tx: Tx, piece_id: int) -> list[Row]:
    return tx.rows("SELECT r.*, a.name AS reviewer_name FROM reviews r JOIN accounts a ON a.id = r.reviewer_id "
                   "WHERE r.piece_id = :id ORDER BY r.kind DESC", id=piece_id)


def ack_of(row: Row) -> dict:
    return {"piece_id": row["piece_id"], "object_id": row["object_id"],
            "duplicate_object_id": row["duplicate_object_id"], "acknowledged_by": row["acknowledged_by"],
            "acknowledged_at": iso(row["acknowledged_at"])}


def acks(tx: Tx, piece_id: int) -> list[Row]:
    return tx.rows("SELECT d.*, a.name AS acknowledged_by_name FROM duplicate_acks d "
                   "JOIN accounts a ON a.id = d.acknowledged_by WHERE d.piece_id = :id "
                   "ORDER BY d.acknowledged_at", id=piece_id)


def audit_of(row: Row) -> dict:
    return {"id": row["id"], "piece_id": row["piece_id"], "piece_title": row["piece_title"],
            "from_state": row["from_state"], "to_state": row["to_state"], "reason": row["reason"],
            "actor": {"id": row["actor_id"], "name": row["actor_name"], "role": row["actor_role"]},
            "created_at": iso(row["created_at"])}


def piece_audit(tx: Tx, piece_id: int) -> list[Row]:
    return tx.rows(AUDIT_SELECT + " WHERE e.piece_id = :id ORDER BY e.created_at DESC, e.id DESC", id=piece_id)


def piece_detail(tx: Tx, piece_id: int) -> dict:
    return piece(tx, piece_id) | {
        "objects": [object_of(o) for o in cited_objects(tx, piece_id)],
        "reviews": [review_of(r) for r in reviews(tx, piece_id)],
        "duplicate_acks": [ack_of(a) for a in acks(tx, piece_id)],
        "audit": [audit_of(e) for e in piece_audit(tx, piece_id)],
    }
