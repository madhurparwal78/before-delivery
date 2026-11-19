"""Legacy spreadsheet import: normalise, match, merge into thread history (brief: Legacy import)."""

import csv
import hashlib
import io
import re
from datetime import date, datetime

from . import clock, db, rules, views
from .errors import invalid
from .people import identity_hash

REQUIRED = ["tail", "directive", "revision", "status", "inspector", "inspector_licence", "inspected_on", "certifier",
            "certifier_licence", "certified_on", "notes"]
MAX_ROWS = 2000
PERSON_FIELDS = ("inspector", "inspector_licence", "certifier", "certifier_licence")


def _parse_date(text: str) -> date | None:
    for pattern, fmt in ((r"\d{4}-\d{2}-\d{2}", "%Y-%m-%d"), (r"\d{2}/\d{2}/\d{4}", "%d/%m/%Y")):
        if re.fullmatch(pattern, text):
            try:
                return datetime.strptime(text, fmt).date()
            except ValueError:
                return None
    return None


def _rows(data: bytes) -> list[dict]:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise invalid({"file": "The file must be UTF-8 CSV."}) from None
    reader = csv.reader(io.StringIO(text, newline=""))
    header = next(reader, None)
    if header is None:
        raise invalid({"file": "The file has no header row."})
    index = {}
    for i, name in enumerate(header):
        index.setdefault(name.strip().lower(), i)
    missing = [c for c in REQUIRED if c not in index]
    if missing:
        raise invalid({"file": f"Missing column: {', '.join(missing)}."})
    rows = [r for r in reader if any(cell.strip() for cell in r)]
    if len(rows) > MAX_ROWS:
        raise invalid({"file": f"The file has more than {MAX_ROWS:,} data rows."})
    # Imported fields are kept exactly as they arrive (brief: Regulator CSV, Neutralisation).
    return [{c: r[index[c]] if index[c] < len(r) else "" for c in REQUIRED} for r in rows]


def _rejection(row: dict) -> tuple[str, str] | None:
    """The first malformed field of a row, in the published order: status, revision, dates, notes."""
    status = row["status"].lower()
    if status not in ("complied", "open"):
        return "status", "Status must be complied or open."
    if rules.normalise_revision(row["revision"]) is None:
        return "revision", "The revision must be R1, Rev 1, ORIG or a whole number."
    for field in ("inspected_on", "certified_on"):
        if row[field] and _parse_date(row[field]) is None:
            return field, "Dates must be YYYY-MM-DD or DD/MM/YYYY."
        if not row[field] and status == "complied":
            return field, f"A complied row needs {field}."
    if len(row["notes"]) > 1000:
        return "notes", "Notes are limited to 1,000 characters."
    return None


def _orphan(result: dict, n: int, row: dict, reason: str) -> None:
    result["orphans"].append({"row": n, "tail": row["tail"], "directive": row["directive"], "revision": row["revision"],
                              "reason": reason})


async def run(conn, user: dict, data: bytes) -> tuple[int, dict]:
    rules.require_role(user, "import")
    digest = hashlib.sha256(data).hexdigest()
    await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", digest)
    earlier = await conn.fetchval("SELECT result FROM imports WHERE file_sha256 = $1", digest)
    if earlier is not None:
        return 200, {**earlier, "replayed_file": True}
    rows = _rows(data)

    fleet = await views.load_fleet(conn)
    by_tail = {rules.normalise_tail(r): r for r in fleet.tails}
    threads = {(t["directive_id"], t["registration"]): t
               for t in await conn.fetch("SELECT * FROM threads")}
    lived: dict[str, set[int]] = {}
    for h in await conn.fetch("SELECT thread_id, revision FROM thread_history"):
        lived.setdefault(h["thread_id"], set()).add(h["revision"])
    keys = {(r["thread_id"], r["revision"], r["status"], r["inspected_on"], r["certified_on"])
            for r in await conn.fetch("SELECT * FROM legacy_records")}
    signed = {r["thread_id"] for r in await conn.fetch("SELECT DISTINCT thread_id FROM signatures")}
    erased = {r["hash"]: r["token"] for r in await conn.fetch("SELECT hash, token FROM erased_identities")}

    import_id = db.new_id("imp")
    now = clock.now()
    await conn.execute("INSERT INTO imports (id, file_sha256, result, imported_by, imported_at) "
                       "VALUES ($1, $2, '{}', $3, $4)", import_id, digest, user["id"], now)
    result = {"import_id": import_id, "file_sha256": digest, "rows": len(rows), "merged": 0, "duplicates": 0,
              "closed": 0, "orphans": [], "rejected": [], "replayed_file": False}
    touched = []
    for n, row in enumerate(rows, start=1):
        rejected = _rejection(row)
        if rejected:
            result["rejected"].append({"row": n, "field": rejected[0], "message": rejected[1]})
            continue
        revision = rules.normalise_revision(row["revision"])

        registration = by_tail.get(rules.normalise_tail(row["tail"]))
        if registration is None:
            _orphan(result, n, row, "unknown_tail")
            continue
        directive = next((fleet.directives[i] for i in fleet.order
                          if rules.directive_matches(row["directive"], fleet.directives[i]["number"])), None)
        if directive is None:
            _orphan(result, n, row, "unknown_directive")
            continue
        if revision not in directive["revisions"]:
            _orphan(result, n, row, "unknown_revision")
            continue
        t = threads.get((directive["id"], registration))
        tail = fleet.tails[registration]
        if (t is None or revision not in lived.get(t["id"], set()) | {directive["current_revision"]}
                or not rules.in_effectivity(directive["revisions"][revision]["applicability"], tail.model, tail.msn)):
            _orphan(result, n, row, "not_in_effectivity")
            continue
        status = row["status"].lower()
        inspected, certified = _parse_date(row["inspected_on"]), _parse_date(row["certified_on"])
        key = (t["id"], revision, status, inspected, certified)
        if key in keys:
            result["duplicates"] += 1
            continue
        keys.add(key)
        people = {f: erased.get(identity_hash(row[f]), row[f]) if row[f] else None for f in PERSON_FIELDS}
        await conn.execute(
            "INSERT INTO legacy_records (id, thread_id, revision, status, inspector, inspector_licence, inspected_on,"
            " certifier, certifier_licence, certified_on, notes, import_id, row_number)"
            " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
            db.new_id("leg"), t["id"], revision, status, people["inspector"], people["inspector_licence"], inspected,
            people["certifier"], people["certifier_licence"], certified, row["notes"], import_id, n)
        result["merged"] += 1
        touched.append(t["id"])
        await db.audit(conn, user["id"], "thread.legacy_merged",
                       f"Legacy row {n} merged into {rules.tag(revision)} history.", directive["id"], t["id"])
        if status == "complied" and revision == directive["current_revision"] and t["id"] not in signed:
            t = await conn.fetchrow("SELECT * FROM threads WHERE id = $1 FOR UPDATE", t["id"])
            if t["stage"] not in rules.LEGACY_CLOSE or t["holder_id"] is not None:
                continue
            await _close(conn, fleet, t, revision, people, inspected, certified, row["notes"])
            signed.add(t["id"])
            result["closed"] += 1
            await db.audit(conn, user["id"], "thread.legacy_closed",
                           f"Closed from legacy row {n} under {rules.tag(revision)}.", directive["id"], t["id"])
    await conn.execute("UPDATE imports SET result = $2 WHERE id = $1", import_id, result)
    await db.audit(conn, user["id"], "import.completed",
                   f"Import of {len(rows)} rows: {result['merged']} merged, {result['duplicates']} duplicates, "
                   f"{len(result['orphans'])} orphans, {len(result['rejected'])} rejected.")
    await db.changed_threads(conn, touched)
    return 201, result


async def _close(conn, fleet, t, revision: int, people: dict, inspected: date, certified: date, notes: str) -> None:
    """A complied legacy row closes an untouched open thread as certified with two legacy signatures."""
    inspected_at, certified_at = clock.base_instant(inspected), clock.base_instant(certified)
    deadline = date.fromisoformat(views.status(fleet, t)["limits"]["deadline_date"])
    timeliness = "on_time" if inspected_at <= clock.base_instant(deadline, 23, 59, 59) else "overdue"
    for signs_as, who, licence, at in (("inspection", people["inspector"], people["inspector_licence"], inspected_at),
                                       ("countersignature", people["certifier"], people["certifier_licence"],
                                        certified_at)):
        await conn.execute(
            "INSERT INTO signatures (id, thread_id, kind, signs_as, signer_text, licence_text, revision, committed_at,"
            " timeliness, findings, status) VALUES ($1, $2, 'legacy', $3, $4, $5, $6, $7, $8, $9, 'valid')",
            db.new_id("sig"), t["id"], signs_as, who, licence, revision, at, timeliness, notes or None)
    frozen = rules.freeze(views.status(fleet, t, max(certified_at, t["entered_at"])))
    await conn.execute("UPDATE threads SET stage = $4, timeliness = $2, frozen = $3 WHERE id = $1",
                       t["id"], timeliness, frozen, rules.LEGACY_CLOSE[t["stage"]])
