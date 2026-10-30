"""The write log of a database: provisioning, ingest, versions, delete, restore, compaction and stats.
Every lsn is assigned while the database row is locked, so numbering is gapless under concurrency."""
import hashlib
import json

from . import api, billing, db, security, text
from .refusals import ApiError

PROVISIONING_SECONDS = 2


def is_ready(row: dict) -> bool:
    return (text.now() - row["created_at"]).total_seconds() >= PROVISIONING_SECONDS


def status_of(row: dict) -> str:
    return "ready" if is_ready(row) else "provisioning"


def indexing(lsn: int, row: dict) -> str:
    return "graph_creation" if lsn > row["indexed_lsn"] else "completed"


def visible(t: db.Tx, p: api.Principal) -> list[dict]:
    """The databases a principal reaches, by name."""
    rows = t.rows("SELECT * FROM databases WHERE organization_id = :o ORDER BY name COLLATE \"C\"", o=p.org_id)
    return [r for r in rows if p.scope is None or r["id"] in p.scope]


def find(t: db.Tx, p: api.Principal, name: str, lock: bool = False) -> dict:
    """A database of the principal's organization inside its key scope, else DATABASE_NOT_FOUND."""
    row = t.one("SELECT * FROM databases WHERE organization_id = :o AND name = :n" + (" FOR UPDATE" if lock else ""),
                o=p.org_id, n=name)
    if not row or (p.scope is not None and row["id"] not in p.scope):
        raise ApiError("DATABASE_NOT_FOUND")
    return row


def find_ready(t: db.Tx, p: api.Principal, name: str) -> dict:
    row = find(t, p, name, lock=True)
    if not is_ready(row):
        raise ApiError("DATABASE_NOT_READY")
    return row


def lock_organization(t: db.Tx, org_id: int) -> dict:
    """Creations, deletions and plan switches of one organization are decided one at a time on this row."""
    return t.one("SELECT * FROM organizations WHERE id = :o FOR UPDATE", o=org_id)


def create(t: db.Tx, p: api.Principal, name: str) -> dict:
    org = lock_organization(t, p.org_id)
    if t.one("SELECT 1 AS x FROM databases WHERE organization_id = :o AND name = :n", o=p.org_id, n=name):
        raise ApiError("DATABASE_ALREADY_EXISTS")
    held = t.one("SELECT count(*) AS n FROM databases WHERE organization_id = :o", o=p.org_id)["n"]
    if held >= billing.PLAN_LIMIT[org["plan"]]:
        raise ApiError("PLAN_LIMIT", n=billing.PLAN_LIMIT[org["plan"]])
    row = t.one("INSERT INTO databases (organization_id, name) VALUES (:o, :n) RETURNING *", o=p.org_id, n=name)
    t.run("INSERT INTO collections (database_id, name) VALUES (:d, 'default')", d=row["id"])
    return row


def delete(t: db.Tx, row: dict) -> None:
    """Remove the database and all it holds; only its token rows (stripped) and audit events remain."""
    t.run("UPDATE source_versions SET database_id = NULL, collection = NULL, source_id = NULL, version = NULL, "
          "lsn = NULL WHERE database_id = :d", d=row["id"])
    t.run("DELETE FROM databases WHERE id = :d", d=row["id"])


def collection_exists(t: db.Tx, row: dict, name: str) -> bool:
    return bool(t.one("SELECT 1 AS x FROM collections WHERE database_id = :d AND name = :n", d=row["id"], n=name))


def require_collection(t: db.Tx, row: dict, name: str) -> None:
    if not collection_exists(t, row, name):
        raise ApiError("COLLECTION_NOT_FOUND")


def _append(t: db.Tx, row: dict, kind: str, collection: str, source_id: str) -> int:
    lsn = row["last_lsn"] + 1
    t.run("INSERT INTO wal_entries (database_id, lsn, kind, collection, source_id) VALUES (:d, :l, :k, :c, :s)",
          d=row["id"], l=lsn, k=kind, c=collection, s=source_id)
    t.run("UPDATE databases SET last_lsn = :l WHERE id = :d", l=lsn, d=row["id"])
    row["last_lsn"] = lsn
    return lsn


def _write_source(t: db.Tx, org_id: int, row: dict, collection: str, source: dict, now) -> dict:
    """One accepted source: its next version, a version row for the bill, its facts and one write log entry."""
    sid = source["id"]
    tokens = text.token_count(source["title"], source["text"])
    current = t.one("SELECT max_version, deleted FROM sources WHERE database_id = :d AND collection = :c AND id = :s",
                    d=row["id"], c=collection, s=sid)
    lsn = _append(t, row, "ingest", collection, sid)
    if current:
        version = current["max_version"] + 1
        if current["deleted"]:
            t.run("DELETE FROM facts WHERE database_id = :d AND collection = :c AND source_id = :s",
                  d=row["id"], c=collection, s=sid)
        t.run("UPDATE sources SET title = :ti, text = :tx, version = :v, max_version = :v, token_count = :n, "
              "ingested_at = :at, lsn = :l, deleted = false WHERE database_id = :d AND collection = :c AND id = :s",
              ti=source["title"], tx=source["text"], v=version, n=tokens, at=now, l=lsn, d=row["id"], c=collection,
              s=sid)
    else:
        version = 1
        t.run("INSERT INTO sources (database_id, collection, id, title, text, version, max_version, token_count, "
              "ingested_at, lsn) VALUES (:d, :c, :s, :ti, :tx, 1, 1, :n, :at, :l)",
              d=row["id"], c=collection, s=sid, ti=source["title"], tx=source["text"], n=tokens, at=now, l=lsn)
    t.run("INSERT INTO source_versions (organization_id, database_id, collection, source_id, version, lsn, "
          "token_count, ingested_at) VALUES (:o, :d, :c, :s, :v, :l, :n, :at)",
          o=org_id, d=row["id"], c=collection, s=sid, v=version, l=lsn, n=tokens, at=now)
    for position, f in enumerate(source.get("facts") or []):
        t.run("INSERT INTO facts (database_id, collection, source_id, version, lsn, position, subject, subject_key, "
              "predicate, object, object_key, valid_from, reason) VALUES (:d, :c, :s, :v, :l, :p, :su, :sk, :pr, "
              ":ob, :ok, :vf, :r)", d=row["id"], c=collection, s=sid, v=version, l=lsn, p=position,
              su=f["subject"], sk=text.key(f["subject"]), pr=f["predicate"], ob=f["object"], ok=text.key(f["object"]),
              vf=f["valid_from"], r=f.get("reason", ""))
    return {"id": sid, "version": version, "lsn": lsn, "indexing_status": indexing(lsn, row)}


def ingest(t: db.Tx, org_id: int, row: dict, collection: str, sources: list[dict]) -> list[dict]:
    """Check every if_version against the live versions (earlier sources of the request included), then write."""
    live: dict[str, int] = {}
    highest: dict[str, int] = {}
    for i, s in enumerate(sources):
        s.setdefault("id", security.hex_id("src_", 12))
        sid = s["id"]
        if sid not in live:
            cur = t.one("SELECT version, max_version, deleted FROM sources WHERE database_id = :d AND collection = :c "
                        "AND id = :s", d=row["id"], c=collection, s=sid)
            live[sid] = cur["version"] if cur and not cur["deleted"] else 0
            highest[sid] = cur["max_version"] if cur else 0
        if "if_version" in s and s["if_version"] != live[sid]:
            raise ApiError("VERSION_CONFLICT", field=f"sources.{i}.if_version", id=sid, n=live[sid])
        highest[sid] += 1
        live[sid] = highest[sid]
    t.run("INSERT INTO collections (database_id, name) VALUES (:d, :c) ON CONFLICT DO NOTHING",
          d=row["id"], c=collection)
    now = text.now()
    return [_write_source(t, org_id, row, collection, s, now) for s in sources]


def delete_source(t: db.Tx, row: dict, collection: str, sid: str) -> int:
    if not t.one("SELECT 1 AS x FROM sources WHERE database_id = :d AND collection = :c AND id = :s AND NOT deleted",
                 d=row["id"], c=collection, s=sid):
        raise ApiError("SOURCE_NOT_FOUND")
    t.run("UPDATE sources SET deleted = true WHERE database_id = :d AND collection = :c AND id = :s",
          d=row["id"], c=collection, s=sid)
    return _append(t, row, "delete", collection, sid)


def restore_source(t: db.Tx, row: dict, collection: str, sid: str) -> dict:
    """Bring a deleted source back as it stood: its facts keep their lsns; only the restore entry is new."""
    src = t.one("SELECT version, deleted FROM sources WHERE database_id = :d AND collection = :c AND id = :s",
                d=row["id"], c=collection, s=sid)
    if not src:
        raise ApiError("SOURCE_NOT_FOUND")
    if not src["deleted"]:
        raise ApiError("SOURCE_IS_LIVE", id=sid)
    lsn = _append(t, row, "restore", collection, sid)
    t.run("UPDATE sources SET deleted = false, lsn = :l WHERE database_id = :d AND collection = :c AND id = :s",
          l=lsn, d=row["id"], c=collection, s=sid)
    return {"id": sid, "version": src["version"], "lsn": lsn, "indexing_status": indexing(lsn, row)}


def compact(t: db.Tx, row: dict) -> dict:
    folded = row["last_lsn"] - row["indexed_lsn"]
    generation = row["index_generation"]
    if folded:
        generation += 1
        t.run("UPDATE databases SET indexed_lsn = last_lsn, index_generation = :g WHERE id = :d",
              g=generation, d=row["id"])
    return {"generation": generation, "folded_entries": folded, "indexed_lsn": row["last_lsn"]}


def stats(t: db.Tx, row: dict) -> dict:
    live = t.one("SELECT count(*) AS n FROM sources WHERE database_id = :d AND NOT deleted", d=row["id"])["n"]
    facts = t.one("SELECT count(*) AS n, count(DISTINCT x.k) AS e FROM facts f JOIN sources s ON "
                  "s.database_id = f.database_id AND s.collection = f.collection AND s.id = f.source_id "
                  "CROSS JOIN LATERAL (VALUES (f.subject_key), (f.object_key)) AS x(k) "
                  "WHERE f.database_id = :d AND NOT s.deleted", d=row["id"])
    tokens = t.one("SELECT COALESCE(sum(token_count), 0) AS n FROM source_versions WHERE database_id = :d",
                   d=row["id"])["n"]
    return {"sources": live, "facts": facts["n"] // 2, "entities": facts["e"], "last_lsn": row["last_lsn"],
            "indexed_lsn": row["indexed_lsn"], "wal_pending": row["last_lsn"] - row["indexed_lsn"],
            "index_generation": row["index_generation"], "tokens_ingested": int(tokens),
            "storage_bytes": billing.storage_bytes(t, row["organization_id"], row["id"])}


def fact_view(f: dict) -> dict:
    return {"subject": f["subject"], "predicate": f["predicate"], "object": f["object"],
            "valid_from": text.ts(f["valid_from"]), "reason": f["reason"]}


def facts_of(t: db.Tx, row: dict, collection: str, sid: str) -> list[dict]:
    return [fact_view(f) for f in t.rows(
        "SELECT * FROM facts WHERE database_id = :d AND collection = :c AND source_id = :s ORDER BY lsn, position",
        d=row["id"], c=collection, s=sid)]


def document(t: db.Tx, row: dict) -> dict:
    """The export document: every collection by name, every live source by id with its facts in ingest order."""
    collections = []
    for c in t.rows("SELECT name FROM collections WHERE database_id = :d ORDER BY name COLLATE \"C\"", d=row["id"]):
        sources = [{"id": s["id"], "version": s["version"], "title": s["title"], "text": s["text"],
                    "facts": facts_of(t, row, c["name"], s["id"])}
                   for s in t.rows("SELECT id, version, title, text FROM sources WHERE database_id = :d AND "
                                   "collection = :c AND NOT deleted ORDER BY id COLLATE \"C\"", d=row["id"], c=c["name"])]
        collections.append({"name": c["name"], "sources": sources})
    return {"database": row["name"], "lsn": row["last_lsn"], "collections": collections}


def canonical(doc: dict) -> str:
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256(doc_text: str) -> str:
    return hashlib.sha256(doc_text.encode()).hexdigest()
