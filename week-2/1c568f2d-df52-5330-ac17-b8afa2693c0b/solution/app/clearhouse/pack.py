"""The clearance pack: export every piece as one document; import a clean pack completely or not at all."""

import uuid
from datetime import timedelta

from . import rules
from .audit import record
from .db import Row, Tx, transaction
from .errors import Refusal
from .timefmt import now, today

META_KEYS = ("saveVersion", "name", "author", "created", "updated", "uuid")
CONFIG_KEYS = ("quarter", "budget_cents")
PIECE_KEYS = ("title", "summary", "fee_cents", "state", "object_ids")


def export(account: Row) -> dict:
    with transaction() as tx:
        rules.check_actor(tx, account, None, "pack")
        moment = int(now().timestamp() * 1000)
        quarter = rules.current_quarter()
        pieces = tx.rows("SELECT id, title, summary, fee_cents, state FROM pieces ORDER BY id")
        cited: dict[int, list[int]] = {}
        for row in tx.rows("SELECT piece_id, object_id FROM piece_objects ORDER BY piece_id, position"):
            cited.setdefault(row["piece_id"], []).append(row["object_id"])
        return {
            "meta": {"saveVersion": "1", "name": f"Clearhouse pack {today().isoformat()}", "author": account["name"],
                     "created": moment, "updated": moment, "uuid": str(uuid.uuid4())},
            "config": {"quarter": quarter, "budget_cents": rules.budget_cents(tx, quarter)},
            "pieces": [{"title": p["title"], "summary": p["summary"], "fee_cents": p["fee_cents"],
                        "state": p["state"], "object_ids": cited.get(p["id"], [])} for p in pieces],
        }


def _refuse(message: str) -> Refusal:
    return Refusal(400, message)


def _missing(document: dict) -> str | None:
    for section, keys in (("meta", META_KEYS), ("config", CONFIG_KEYS)):
        part = document.get(section)
        if not isinstance(part, dict):
            return section
        for key in keys:
            if part.get(key) is None:
                return f"{section}.{key}"
    entries = document.get("pieces")
    if not isinstance(entries, list):
        return "pieces"
    for number, entry in enumerate(entries, start=1):
        if not isinstance(entry, dict):
            return f"pieces.{number}"
        for key in PIECE_KEYS:
            if entry.get(key) is None:
                return f"pieces.{number}.{key}"
    return None


def _check_entries(tx: Tx, entries: list[dict]) -> None:
    seen: set[str] = set()
    for number, entry in enumerate(entries, start=1):
        if not rules.fee_ok(entry["fee_cents"]):
            raise _refuse(f"Fee out of range in piece {number}")
        title = entry["title"].strip() if isinstance(entry["title"], str) else ""
        summary = entry["summary"].strip() if isinstance(entry["summary"], str) else ""
        problem = rules.object_ids_problem(tx, entry["object_ids"])
        for key, bad in (("title", not 1 <= len(title) <= 80), ("summary", not 20 <= len(summary) <= 600),
                         ("state", entry["state"] not in rules.STATES),
                         ("object_ids", problem is not None and not problem.startswith("Unknown object"))):
            if bad:
                raise _refuse(f"Piece {number} has an invalid {key}")
        if problem:
            raise _refuse(f"{problem} in piece {number}")
        if title.lower() in seen or rules.title_taken(tx, title):
            raise _refuse(f"A piece named {title} already exists")
        seen.add(title.lower())


def apply(account: Row, document: object) -> int:
    with transaction() as tx:
        if not isinstance(document, dict):
            raise Refusal(400, "Send a JSON object")
        rules.check_actor(tx, account, None, "pack")
        meta = document.get("meta")
        if isinstance(meta, dict) and meta.get("saveVersion") is not None and str(meta["saveVersion"]) != "1":
            raise _refuse(f"Pack version {meta['saveVersion']} is not supported")
        if missing := _missing(document):
            raise _refuse(f"Pack is missing {missing}")
        entries = document["pieces"]
        _check_entries(tx, entries)
        quarter = rules.current_quarter()
        rules.lock_quarter(tx, quarter)
        rules.check_budget(tx, quarter, sum(e["fee_cents"] for e in entries if e["state"] in rules.COMMITTED_STATES),
                           "Pack", status=400)
        owner = tx.value("SELECT id FROM accounts WHERE role = 'maker' AND (lower(name) = lower(:a) OR lower(email) = "
                         "lower(:a)) ORDER BY created_at LIMIT 1", a=str(meta["author"])) or tx.value(
            "SELECT id FROM accounts WHERE role = 'maker' ORDER BY created_at, id LIMIT 1")
        moment = now()
        for entry in entries:
            _create(tx, account, owner, entry, moment, str(meta["name"]))
        return len(entries)


def _create(tx: Tx, account: Row, owner: str, entry: dict, moment, pack_name: str) -> None:
    state = entry["state"]
    cleared = moment if state in ("cleared", "scheduled", "published", "withdrawn") else None
    published = moment if state in ("published", "withdrawn") else None
    piece_id = tx.value(
        "INSERT INTO pieces (title, summary, fee_cents, submitted_fee_cents, state, owner_id, version, created_at, "
        "updated_at, cleared_at, published_at) VALUES (:t, :s, :f, :f, :state, :o, 1, :m, :m, :c, :p) RETURNING id",
        t=entry["title"].strip(), s=entry["summary"].strip(), f=entry["fee_cents"], state=state, o=owner, m=moment,
        c=cleared, p=published)
    for position, object_id in enumerate(entry["object_ids"]):
        tx.run("INSERT INTO piece_objects (piece_id, object_id, position) VALUES (:p, :o, :n)",
               p=piece_id, o=object_id, n=position)
    if state == "scheduled":
        day = today()
        while tx.value("SELECT 1 FROM schedule_slots WHERE day = :d", d=day):
            day += timedelta(days=1)
        tx.run("INSERT INTO schedule_slots (day, piece_id) VALUES (:d, :p)", d=day, p=piece_id)
    record(tx, piece_id, account["id"], "", state, f"Imported from pack {pack_name}")
