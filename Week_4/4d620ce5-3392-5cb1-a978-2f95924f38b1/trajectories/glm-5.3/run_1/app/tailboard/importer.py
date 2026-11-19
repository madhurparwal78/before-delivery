"""Legacy CSV import: normalisation, matching, orphans and duplicates (DP-38 to DP-41)."""
import csv
import hashlib
import io
import json
import re
import secrets
from datetime import date, datetime

from .clock import clock
from .errors import validation


def normalise_tail(value: str) -> str:
    return value.replace("-", "").replace(" ", "").upper()


def normalise_directive(value: str) -> str:
    text = value.upper()
    text = re.sub(r"^(EASA|CAA|AD|SB)[ -]", "", text)
    text = re.sub(r"[ /.]+", "-", text.strip())
    return text.strip("-")


def normalise_revision(value: str) -> int | None:
    """ORIG or ORIGINAL means 1; a leading REV or R is dropped; a whole number of 1 or more."""
    text = value.upper().replace(" ", "")
    if text in ("ORIG", "ORIGINAL"):
        return 1
    text = re.sub(r"^REV", "", text)
    text = re.sub(r"^R", "", text) if text and text[0] == "R" else text
    if text.isdigit() and int(text) >= 1:
        return int(text)
    return None


def parse_import_date(value: str) -> date | None:
    """A non-empty date must be YYYY-MM-DD or DD/MM/YYYY."""
    value = value.strip()
    if not value:
        return None
    for pattern in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(value, pattern).date()
        except ValueError:
            continue
    return None


class Importer:
    def __init__(self, pool, repo, actions):
        self.pool = pool
        self.repo = repo
        self.actions = actions

    async def run(self, actor, raw: bytes) -> dict:
        file_sha256 = hashlib.sha256(raw).hexdigest()
        prior = await self.repo.import_by_hash(file_sha256)
        if prior:
            result = json.loads(prior["result"])
            result["replayed_file"] = True
            return result

        text = raw.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        if reader.fieldnames is None:
            raise validation({"file": "The import file needs a header row."})
        columns = {name.strip().lower(): name for name in reader.fieldnames if name}
        required = ["tail", "directive", "revision", "status", "inspector", "inspector_licence",
                    "inspected_on", "certifier", "certifier_licence", "certified_on", "notes"]
        missing = [column for column in required if column not in columns]
        if missing:
            raise validation({"file": f"Missing header column {missing[0]}."})
        rows = list(reader)
        if len(rows) > 2000:
            raise validation({"file": "Import files hold at most 2,000 data rows."})

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                tails = {row["registration"]: row for row in await conn.fetch("SELECT * FROM tails")}
                tails_by_norm = {normalise_tail(reg): reg for reg in tails}
                lineages = await conn.fetch("SELECT * FROM lineages")
                by_number = {}
                for lineage in lineages:
                    by_number[normalise_directive(f"{lineage['authority']} {lineage['number']}")] = lineage
                    by_number[normalise_directive(lineage["number"])] = lineage
                threads = await conn.fetch("SELECT * FROM threads")

                merged = 0
                duplicates = 0
                closed = 0
                orphans = []
                rejected = []
                changed_thread_ids = []

                for row_number, row in enumerate(rows, start=1):
                    get = lambda key: (row.get(columns[key]) or "").strip()
                    reason = None
                    status_text = get("status").lower()
                    if status_text not in ("complied", "open"):
                        rejected.append(_rejected(row_number, "status",
                                                  "Status must be complied or open."))
                        continue
                    revision_number = normalise_revision(get("revision"))
                    if revision_number is None:
                        rejected.append(_rejected(row_number, "revision",
                                                  "Revision must be ORIG or a whole number."))
                        continue
                    inspected_on = _checked_date(get("inspected_on"))
                    if inspected_on == "malformed":
                        rejected.append(_rejected(row_number, "inspected_on",
                                                  "Dates must be YYYY-MM-DD or DD/MM/YYYY."))
                        continue
                    certified_on = _checked_date(get("certified_on"))
                    if certified_on == "malformed":
                        rejected.append(_rejected(row_number, "certified_on",
                                                  "Dates must be YYYY-MM-DD or DD/MM/YYYY."))
                        continue
                    if status_text == "complied":
                        if inspected_on == "absent":
                            rejected.append(_rejected(row_number, "inspected_on",
                                                      "A complied row needs an inspected date."))
                            continue
                        if certified_on == "absent":
                            rejected.append(_rejected(row_number, "certified_on",
                                                      "A complied row needs a certified date."))
                            continue
                    notes = get("notes")
                    if len(notes) > 1000:
                        rejected.append(_rejected(row_number, "notes",
                                                  "Notes are limited to 1,000 characters."))
                        continue

                    tail_norm = normalise_tail(get("tail"))
                    registration = tails_by_norm.get(tail_norm)
                    if registration is None:
                        orphans.append(_orphan(row_number, get("tail"), get("directive"),
                                              get("revision"), "unknown_tail"))
                        continue
                    directive_norm = normalise_directive(get("directive"))
                    lineage = by_number.get(directive_norm)
                    if lineage is None:
                        orphans.append(_orphan(row_number, get("tail"), get("directive"),
                                              get("revision"), "unknown_directive"))
                        continue
                    max_revision = await conn.fetchval(
                        "SELECT MAX(revision) FROM revisions WHERE lineage_id = $1", lineage["id"])
                    if revision_number > max_revision:
                        orphans.append(_orphan(row_number, registration, get("directive"),
                                              get("revision"), "unknown_revision"))
                        continue
                    thread = await conn.fetchrow(
                        "SELECT * FROM threads WHERE lineage_id = $1 AND registration = $2",
                        *(lineage["id"], registration))
                    if thread is None:
                        orphans.append(_orphan(row_number, registration, get("directive"),
                                              get("revision"), "not_in_effectivity"))
                        continue
                    history_entry = await conn.fetchrow(
                        """SELECT 1 FROM history_entries WHERE thread_id = $1 AND revision = $2""",
                        *(thread["id"], revision_number))
                    if history_entry is None:
                        orphans.append(_orphan(row_number, registration, get("directive"),
                                              get("revision"), "not_in_effectivity"))
                        continue

                    inspected_date = None if inspected_on == "absent" else _date_of(inspected_on)
                    certified_date = None if certified_on == "absent" else _date_of(certified_on)
                    existing = await conn.fetchrow(
                        """SELECT 1 FROM legacy_records WHERE thread_id = $1 AND revision = $2
                           AND status = $3 AND inspected_on IS NOT DISTINCT FROM $4
                           AND certified_on IS NOT DISTINCT FROM $5""",
                        *(thread["id"], revision_number, status_text, inspected_date, certified_date))
                    if existing:
                        duplicates += 1
                        continue
                    await conn.execute(
                        """INSERT INTO legacy_records (thread_id, revision, status, inspected_on,
                           certified_on, notes, inspector_name, inspector_licence,
                           certifier_name, certifier_licence, created_at)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)""",
                        *(thread["id"], revision_number, status_text, inspected_date, certified_date,
                         notes, get("inspector"), get("inspector_licence"),
                         get("certifier"), get("certifier_licence"), clock().now()))
                    merged += 1
                    changed_thread_ids.append(thread["id"])

                    if (status_text == "complied" and thread["stage"] == "open"
                            and thread["holder_id"] is None):
                        sig_count = await conn.fetchval(
                            "SELECT count(*) FROM signatures WHERE thread_id = $1", thread["id"])
                        if sig_count == 0 and revision_number == thread["revision"]:
                            await conn.execute(
                                "UPDATE threads SET stage = 'certified', pinned_revision = $1 WHERE id = $2",
                                *(revision_number, thread["id"]))
                            await conn.execute(
                                """INSERT INTO signatures (id, thread_id, kind, signer_id, signer_text,
                                   revision, committed_at, timeliness, method_ref, findings, status)
                                   VALUES ($1, $2, 'legacy', NULL, $3, $4, $5, NULL, NULL, NULL, 'valid'),
                                          ($6, $2, 'legacy', NULL, $7, $8, $9, NULL, NULL, NULL, 'valid')""",
                                *(f"sig_{secrets.token_hex(8)}", thread["id"], get("inspector"),
                                 revision_number, clock().now(), f"sig_{secrets.token_hex(8)}",
                                 get("certifier"), revision_number, clock().now()))
                            closed += 1

                now = clock().now()
                result = {
                    "import_id": f"imp_{secrets.token_hex(8)}",
                    "file_sha256": file_sha256,
                    "rows": len(rows),
                    "merged": merged,
                    "duplicates": duplicates,
                    "closed": closed,
                    "orphans": orphans,
                    "rejected": rejected,
                    "replayed_file": False,
                }
                await conn.execute(
                    """INSERT INTO imports (id, file_sha256, rows, merged, duplicates, closed,
                       result, imported_at, imported_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                    *(result["import_id"], file_sha256, len(rows), merged, duplicates, closed,
                     json.dumps(result), now, actor["id"]))
                await conn.execute(
                    "INSERT INTO audit (at, actor_id, action, directive_id, thread_id, detail) VALUES ($1, $2, 'history.imported', NULL, NULL, $3)",
                    *(now, actor["id"], json.dumps({"import_id": result["import_id"],
                                                   "merged": merged, "duplicates": duplicates,
                                                   "orphans": len(orphans),
                                                   "rejected": len(rejected)})))
        await self.actions._publish_threads(changed_thread_ids)
        return result


def _orphan(row, tail, directive, revision, reason) -> dict:
    return {"row": row, "tail": tail, "directive": directive, "revision": revision, "reason": reason}


def _rejected(row, field, message) -> dict:
    return {"row": row, "field": field, "message": message}


def _checked_date(value: str):
    """Return the text, 'absent' for an empty value, or 'malformed'."""
    if not value:
        return "absent"
    return value if parse_import_date(value) is not None else "malformed"


def _date_of(value: str) -> date:
    return parse_import_date(value)


def import_shape(row) -> dict:
    result = json.loads(row["result"])
    return {
        "import_id": row["id"],
        "file_sha256": row["file_sha256"],
        "rows": row["rows"],
        "merged": row["merged"],
        "duplicates": row["duplicates"],
        "closed": row["closed"],
        "orphans": result.get("orphans", []),
        "rejected": result.get("rejected", []),
        "replayed_file": False,
    }
