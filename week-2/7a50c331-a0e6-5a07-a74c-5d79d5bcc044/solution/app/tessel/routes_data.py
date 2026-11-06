"""Database, collection, write log, source, query, graph, feedback, export and import endpoints."""
import json
import logging
import math
import threading
import time
from datetime import timedelta

from starlette.responses import Response

from . import api, db, graph, mail, search, security, text, writelog
from .api import Answer, Ctx, route
from .fields import (DATABASE_REF, DB_NAME, DB_NAME_SPEC, PREDICATE, PREDICATE_SPEC, SOURCE_ID_SPEC, Enum, Int,
                     List, Loose, Obj, Spec, Str, TextMap, Ts, join, query_param, validate)
from .refusals import ApiError, invalid

log = logging.getLogger("tessel.data")

MISSING_SOURCE = "No source with this id in this scope"
FEEDBACK_PER_MINUTE = 100
EXPORT_QUEUED_S, EXPORT_DONE_S = 1, 2

COLLECTION_SPEC = Str(3, 32, pattern=DB_NAME, message="Name a collection with 3 to 32 lowercase letters, digits or "
                                                       "underscores, starting with a letter")
FACT = Obj({"subject": (Str(1, 80, trim=True, message="Write a subject of 1 to 80 characters"), True),
            "predicate": (PREDICATE_SPEC, True),
            "object": (Str(1, 80, trim=True, message="Write an object of 1 to 80 characters"), True),
            "valid_from": (Ts(), True),
            "reason": (Str(0, 280, message="Write a reason of at most 280 characters"), False)})
TITLE = Str(1, 200, message="Write a title of 1 to 200 characters")
BODY_TEXT = Str(1, 20000, message="Write a text of 1 to 20000 characters")
FACTS = List(FACT, 0, 50, message="A source carries at most 50 facts")
SOURCE = Obj({"id": (SOURCE_ID_SPEC, False), "title": (TITLE, True), "text": (BODY_TEXT, True),
              "if_version": (Int(lo=0, message="Send the version you read as a whole number of at least 0"), False),
              "facts": (FACTS, False),
              "relations": (Obj({"ids": (List(SOURCE_ID_SPEC), True)}), False)})
INGEST = Obj({"database": (DATABASE_REF, True), "collection": (COLLECTION_SPEC, False),
              "sources": (List(SOURCE, 1, 50, message="Send 1 to 50 sources"), True)})
NAME_BODY = Obj({"name": (DB_NAME_SPEC, True)})
DATABASE_BODY = Obj({"database": (DATABASE_REF, True)})
LIST_BODY = Obj({"database": (DATABASE_REF, True), "collection": (COLLECTION_SPEC, False)})
SOURCE_REF = Obj({"database": (DATABASE_REF, True), "collection": (COLLECTION_SPEC, False),
                  "id": (SOURCE_ID_SPEC, True)})


def _db_view(row: dict) -> dict:
    return {"name": row["name"], "status": writelog.status_of(row), "last_lsn": row["last_lsn"],
            "indexed_lsn": row["indexed_lsn"], "index_generation": row["index_generation"],
            "created_at": text.ts(row["created_at"])}


def _collection(value: str | None) -> str:
    return value or "default"


# ---- databases ----------------------------------------------------------------------------------

@route("POST", "/api/v2/databases", "owner", body=True, idempotent=True)
def create_database(ctx: Ctx):
    body = validate(NAME_BODY, ctx.body)
    p, t = ctx.principal, ctx.tx
    row = writelog.create(t, p, body["name"])
    api.audit(t, p.org_id, p.email, "database.create", row["name"])
    ctx.idempotency_database_id = row["id"]
    return Answer({"name": row["name"], "status": "provisioning", "created_at": text.ts(row["created_at"])}, 201)


@route("GET", "/api/v2/databases", "viewer")
def list_databases(ctx: Ctx):
    return Answer({"databases": [_db_view(r) for r in writelog.visible(ctx.tx, ctx.principal)]})


@route("DELETE", "/api/v2/databases", "owner")
def delete_database(ctx: Ctx):
    name = query_param(ctx.query, "database")
    p, t = ctx.principal, ctx.tx
    writelog.lock_organization(t, p.org_id)
    row = writelog.find(t, p, name, lock=True)
    writelog.delete(t, row)
    api.audit(t, p.org_id, p.email, "database.delete", row["name"])
    return Answer({"deleted": True})


@route("GET", "/api/v2/databases/status", "viewer")
def database_status(ctx: Ctx):
    row = writelog.find(ctx.tx, ctx.principal, query_param(ctx.query, "database"))
    status = writelog.status_of(row)
    return Answer({"database": row["name"], "status": status,
                   "infra": {"ready_for_ingestion": status == "ready", "graph_status": status}})


@route("GET", "/api/v2/databases/collections", "viewer")
def list_collections(ctx: Ctx):
    row = writelog.find(ctx.tx, ctx.principal, query_param(ctx.query, "database"))
    names = [r["name"] for r in ctx.tx.rows('SELECT name FROM collections WHERE database_id = :d ORDER BY name '
                                            'COLLATE "C"', d=row["id"])]
    return Answer({"collections": names})


@route("DELETE", "/api/v2/databases/collections", "editor")
def delete_collection(ctx: Ctx):
    database = query_param(ctx.query, "database")
    name = query_param(ctx.query, "name")
    t = ctx.tx
    row = writelog.find(t, ctx.principal, database, lock=True)
    writelog.require_collection(t, row, name)
    if name == "default":
        raise ApiError("COLLECTION_IS_DEFAULT")
    if t.one("SELECT 1 AS x FROM sources WHERE database_id = :d AND collection = :c AND NOT deleted LIMIT 1",
             d=row["id"], c=name):
        raise ApiError("COLLECTION_NOT_EMPTY")
    t.run("DELETE FROM collections WHERE database_id = :d AND name = :c", d=row["id"], c=name)
    return Answer({"deleted": True})


@route("GET", "/api/v2/databases/stats", "viewer")
def database_stats(ctx: Ctx):
    row = writelog.find(ctx.tx, ctx.principal, query_param(ctx.query, "database"))
    return Answer(writelog.stats(ctx.tx, row))


@route("POST", "/api/v2/databases/compact", "editor", body=True)
def compact(ctx: Ctx):
    body = validate(DATABASE_BODY, ctx.body)
    row = writelog.find_ready(ctx.tx, ctx.principal, body["database"])
    return Answer(writelog.compact(ctx.tx, row))


# ---- ingest and sources -------------------------------------------------------------------------

@route("POST", "/api/v2/context/ingest", "editor", body=True, idempotent=True)
def ingest(ctx: Ctx):
    body = validate(INGEST, ctx.body)
    for i, s in enumerate(body["sources"]):
        if "if_version" in s and "id" not in s:
            raise invalid(f"sources.{i}.if_version", "A version check needs the source id")
    row = writelog.find_ready(ctx.tx, ctx.principal, body["database"])
    ctx.idempotency_database_id = row["id"]
    results = writelog.ingest(ctx.tx, ctx.principal.org_id, row, _collection(body.get("collection")), body["sources"])
    return Answer({"results": results}, 201)


@route("GET", "/api/v2/context/status", "viewer")
def context_status(ctx: Ctx):
    database = query_param(ctx.query, "database")
    ids = [i for i in query_param(ctx.query, "ids").split(",") if i]
    collection = _collection(ctx.query.get("collection"))
    row = writelog.find(ctx.tx, ctx.principal, database)
    known = {r["id"]: r for r in ctx.tx.rows("SELECT id, version, lsn FROM sources WHERE database_id = :d AND "
                                              "collection = :c AND id = ANY(CAST(:ids AS text[]))",
                                              d=row["id"], c=collection, ids=ids)}
    statuses = []
    for sid in ids:
        r = known.get(sid)
        if r:
            statuses.append({"id": sid, "indexing_status": writelog.indexing(r["lsn"], row), "version": r["version"]})
        else:
            statuses.append({"id": sid, "indexing_status": "errored", "version": None, "error_code": "FILE_NOT_FOUND",
                             "error_message": MISSING_SOURCE})
    return Answer({"statuses": statuses})


@route("POST", "/api/v2/context/list", "viewer", body=True)
def context_list(ctx: Ctx):
    body = validate(LIST_BODY, ctx.body)
    collection = _collection(body.get("collection"))
    row = writelog.find(ctx.tx, ctx.principal, body["database"])
    writelog.require_collection(ctx.tx, row, collection)
    rows = ctx.tx.rows(
        "SELECT s.id, s.title, s.version, s.token_count, s.lsn, s.ingested_at, count(f.id) AS facts FROM sources s "
        "LEFT JOIN facts f ON f.database_id = s.database_id AND f.collection = s.collection AND f.source_id = s.id "
        "WHERE s.database_id = :d AND s.collection = :c AND NOT s.deleted GROUP BY s.database_id, s.collection, s.id "
        'ORDER BY s.id COLLATE "C"', d=row["id"], c=collection)
    return Answer({"sources": [{"id": r["id"], "title": r["title"], "version": r["version"],
                                "token_count": r["token_count"], "facts": r["facts"],
                                "indexing_status": writelog.indexing(r["lsn"], row),
                                "ingested_at": text.ts(r["ingested_at"])} for r in rows]})


def _source_params(ctx: Ctx):
    database = query_param(ctx.query, "database")
    sid = query_param(ctx.query, "id")
    return database, _collection(ctx.query.get("collection")), sid


@route("GET", "/api/v2/context/source", "viewer")
def context_source(ctx: Ctx):
    database, collection, sid = _source_params(ctx)
    t = ctx.tx
    row = writelog.find(t, ctx.principal, database)
    src = t.one("SELECT * FROM sources WHERE database_id = :d AND collection = :c AND id = :s AND NOT deleted",
                d=row["id"], c=collection, s=sid)
    if not src:
        raise ApiError("SOURCE_NOT_FOUND")
    etag = f'"{src["version"]}"'
    if ctx.header("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "no-store"})
    return Answer({"id": src["id"], "collection": src["collection"], "version": src["version"], "title": src["title"],
                   "text": src["text"], "token_count": src["token_count"], "lsn": src["lsn"],
                   "indexing_status": writelog.indexing(src["lsn"], row), "ingested_at": text.ts(src["ingested_at"]),
                   "facts": writelog.facts_of(t, row, collection, sid)}, headers={"ETag": etag})


@route("DELETE", "/api/v2/context", "editor")
def context_delete(ctx: Ctx):
    database, collection, sid = _source_params(ctx)
    row = writelog.find(ctx.tx, ctx.principal, database, lock=True)
    return Answer({"deleted": True, "lsn": writelog.delete_source(ctx.tx, row, collection, sid)})


@route("POST", "/api/v2/context/restore", "editor", body=True)
def context_restore(ctx: Ctx):
    body = validate(SOURCE_REF, ctx.body)
    row = writelog.find(ctx.tx, ctx.principal, body["database"], lock=True)
    return Answer(writelog.restore_source(ctx.tx, row, _collection(body.get("collection")), body["id"]))


# ---- reading the graph --------------------------------------------------------------------------

def _moment(ctx: Ctx):
    return query_param(ctx.query, "as_of", Ts(), required=False) or text.now()


@route("GET", "/api/v2/context/relations", "viewer")
def relations(ctx: Ctx):
    database = query_param(ctx.query, "database")
    entity = query_param(ctx.query, "entity")
    at = _moment(ctx)
    row = writelog.find(ctx.tx, ctx.principal, database)
    return Answer(graph.Graph.load(ctx.tx, row["id"]).relations(entity, at))


@route("GET", "/api/v2/context/history", "viewer")
def history(ctx: Ctx):
    database = query_param(ctx.query, "database")
    entity = query_param(ctx.query, "entity")
    predicate = query_param(ctx.query, "predicate", PREDICATE_SPEC)
    row = writelog.find(ctx.tx, ctx.principal, database)
    return Answer(graph.Graph.load(ctx.tx, row["id"]).history(entity, predicate))


@route("GET", "/api/v2/context/graph", "viewer")
def graph_route(ctx: Ctx):
    database = query_param(ctx.query, "database")
    at = _moment(ctx)
    raw = query_param(ctx.query, "predicates", required=False)
    predicates = None
    if raw is not None:
        predicates = raw.split(",")
        if not all(PREDICATE.match(x) for x in predicates):
            raise invalid("predicates", "List uppercase predicates such as OWNED_BY, separated by commas")
    row = writelog.find(ctx.tx, ctx.principal, database)
    return Answer(graph.Graph.load(ctx.tx, row["id"]).edges(at, predicates))


class Statement(Str):
    """A graph language statement, parsed as its field is checked (read-only, syntax, meaning)."""

    def check(self, value, path):
        return graph.parse(super().check(value, path))


class Words(Str):
    def check(self, value, path):
        search.parse_query(super().check(value, path))
        return value


QUERY_BY = Enum("text", "cypher")
TEXT_QUERY = Obj({"database": (DATABASE_REF, True), "query_by": (QUERY_BY, True),
                  "query": (Words(1, message="Type the words to search for"), True),
                  "collections": (List(COLLECTION_SPEC, 1, 20, message="Name 1 to 20 collections"), False),
                  "max_results": (Int(1, 20, message="Send a whole number from 1 to 20"), False)})
GRAPH_QUERY = Obj({"database": (DATABASE_REF, True), "query_by": (QUERY_BY, True),
                   "cypher": (Statement(1, message="Write a statement"), True), "as_of": (Ts(), False)})
EITHER_QUERY = Obj({k: (Loose(), False) for k in ("database", "query", "collections", "max_results", "cypher",
                                                  "as_of")} | {"query_by": (QUERY_BY, True)})


@route("POST", "/api/v2/query", "viewer", body=True, key_limited=True)
def query(ctx: Ctx):
    mode = ctx.body.get("query_by")
    body = validate({"text": TEXT_QUERY, "cypher": GRAPH_QUERY}.get(mode, EITHER_QUERY), ctx.body)
    t, p = ctx.tx, ctx.principal
    row = writelog.find(t, p, body["database"])
    if mode == "text":
        collections = list(dict.fromkeys(body.get("collections") or ["default"]))
        for c in collections:
            writelog.require_collection(t, row, c)
        docs = t.rows("SELECT id, collection, title, text FROM sources WHERE database_id = :d AND NOT deleted AND "
                      "collection = ANY(CAST(:c AS text[]))", d=row["id"], c=collections)
        answer = {"results": search.search(docs, body["query"], body.get("max_results") or 5)}
    else:
        at = body.get("as_of") or text.now()
        answer = graph.run(graph.Graph.load(t, row["id"]), body["cypher"], at)
        answer.update({"as_of": text.ts(at), "served_from": {
            "index_generation": row["index_generation"], "indexed_lsn": row["indexed_lsn"],
            "wal_entries_applied": row["last_lsn"] - row["indexed_lsn"]}})
    t.run("INSERT INTO query_records (request_id, organization_id, database_id) VALUES (CAST(:r AS uuid), :o, :d)",
          r=ctx.request_id, o=p.org_id, d=row["id"])
    return Answer(answer)


# ---- feedback -----------------------------------------------------------------------------------

FEEDBACK = Obj({"request_id": (Str(1, 64, message="Name the request_id of a search or graph query"), True),
                "feedback": (Str(0, 8000, message="Write at most 8000 characters", nullable=True), False),
                "rating": (Enum("positive", "negative", "neutral", nullable=True), False),
                "source": (Enum("user", "agent", nullable=True), False),
                "ground_truth": (Obj({"answer": (Str(1, 8000, message="Write an answer of 1 to 8000 characters"), True),
                                      "source_ids": (List(SOURCE_ID_SPEC, 1, 20, distinct=True,
                                                          message="Name 1 to 20 source ids"), True)},
                                     nullable=True), False),
                "metadata": (TextMap(20, 500), False)})


@route("POST", "/api/v2/feedback", "viewer", body=True)
def feedback(ctx: Ctx):
    body = validate(FEEDBACK, ctx.body)
    if not body.get("feedback") and not body.get("ground_truth"):
        raise invalid("feedback", "Write feedback or send a ground truth")
    t, p = ctx.tx, ctx.principal
    rid = body["request_id"]
    known = text.UUID.match(rid) and t.one("SELECT 1 AS x FROM query_records WHERE request_id = CAST(:r AS uuid) AND "
                                           "organization_id = :o", r=rid, o=p.org_id)
    if not known:
        raise ApiError("REQUEST_NOT_FOUND")
    t.run("SELECT pg_advisory_xact_lock(3, :o::int)", o=p.org_id)
    recent = t.rows("SELECT created_at FROM feedback WHERE organization_id = :o AND created_at > clock_timestamp() - "
                    "interval '60 seconds' ORDER BY created_at", o=p.org_id)
    if len(recent) >= FEEDBACK_PER_MINUTE:
        wait = (recent[len(recent) - FEEDBACK_PER_MINUTE]["created_at"] + timedelta(seconds=60) - text.now())
        n = max(1, min(60, math.ceil(wait.total_seconds())))
        raise ApiError("RATE_LIMITED", headers={"Retry-After": str(n)}, n=n)
    t.run("INSERT INTO feedback (request_id, organization_id, rating, feedback, source, ground_truth, metadata) VALUES "
          "(CAST(:r AS uuid), :o, :rating, :fb, :src, CAST(:gt AS jsonb), CAST(:md AS jsonb))",
          r=rid, o=p.org_id, rating=body.get("rating"), fb=body.get("feedback"), src=body.get("source") or "user",
          gt=json.dumps(body["ground_truth"]) if body.get("ground_truth") else None,
          md=json.dumps(body["metadata"]) if body.get("metadata") else None)
    return Answer({"request_id": rid, "received": True}, 201)


# ---- export and import --------------------------------------------------------------------------

@route("POST", "/api/v2/databases/export", "owner", body=True, idempotent=True)
def export(ctx: Ctx):
    body = validate(DATABASE_BODY, ctx.body)
    t, p = ctx.tx, ctx.principal
    row = writelog.find_ready(t, p, body["database"])
    doc = writelog.canonical(writelog.document(t, row))
    job_id = security.hex_id("job_", 16)
    t.run("INSERT INTO export_jobs (id, organization_id, database_id, lsn, requested_by, document, sha256) "
          "VALUES (:j, :o, :d, :l, :by, :doc, :sha)", j=job_id, o=p.org_id, d=row["id"], l=row["last_lsn"], by=p.email,
          doc=doc, sha=writelog.sha256(doc))
    api.audit(t, p.org_id, p.email, "export.request", row["name"])
    ctx.idempotency_database_id = row["id"]
    return Answer({"job_id": job_id, "status": "queued", "database": row["name"], "lsn": row["last_lsn"]}, 202)


def _job(ctx: Ctx) -> dict:
    job = ctx.tx.one("SELECT j.*, d.name AS database_name, clock_timestamp() - j.requested_at AS age FROM export_jobs j "
                     "JOIN databases d ON d.id = j.database_id WHERE j.id = :j AND j.organization_id = :o",
                     j=ctx.path["job_id"], o=ctx.principal.org_id)
    if not job:
        raise ApiError("JOB_NOT_FOUND")
    age = job["age"].total_seconds()
    job["status"] = "queued" if age < EXPORT_QUEUED_S else "running" if age < EXPORT_DONE_S else "succeeded"
    return job


@route("GET", "/api/v2/jobs/{job_id}", "owner")
def job(ctx: Ctx):
    j = _job(ctx)
    result, finished = None, None
    if j["status"] == "succeeded":
        doc = json.loads(j["document"])
        result = {"collections": len(doc["collections"]),
                  "sources": sum(len(c["sources"]) for c in doc["collections"]),
                  "facts": sum(len(s["facts"]) for c in doc["collections"] for s in c["sources"]), "sha256": j["sha256"]}
        finished = text.ts(j["requested_at"].replace(microsecond=0) + timedelta(seconds=EXPORT_DONE_S))
    return Answer({"job_id": j["id"], "kind": "export", "database": j["database_name"], "status": j["status"],
                   "lsn": j["lsn"], "requested_at": text.ts(j["requested_at"]), "finished_at": finished,
                   "result": result})


@route("GET", "/api/v2/jobs/{job_id}/download", "owner")
def job_download(ctx: Ctx):
    j = _job(ctx)
    if j["status"] != "succeeded":
        raise ApiError("JOB_NOT_FINISHED")
    etag = f'"{j["sha256"]}"'
    if ctx.header("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "no-store"})
    return Answer(json.loads(j["document"]), headers={"ETag": etag})


DOCUMENT_SOURCE = Obj({"id": (SOURCE_ID_SPEC, True),
                       "version": (Int(lo=1, message="Send a version of at least 1"), True),
                       "title": (TITLE, True), "text": (BODY_TEXT, True), "facts": (FACTS, False)})
DOCUMENT_COLLECTION_KEYS = {"name", "sources"}


class Document(Spec):
    """An export document, checked whole and in document order before anything is created."""

    def check(self, value, path):
        if not isinstance(value, dict):
            raise invalid(path, "Paste an export document")
        collections = None
        for k, v in value.items():
            if k in ("database", "lsn"):
                Loose().check(v, join(path, k))
            elif k == "collections":
                collections = self._collections(v, join(path, k))
            else:
                raise ApiError("UNKNOWN_FIELD", field=join(path, k), path=join(path, k))
        if collections is None:
            raise invalid(join(path, "collections"), "The document needs its collections")
        return collections

    @staticmethod
    def _collections(value, path) -> list[dict]:
        if not isinstance(value, list) or not 1 <= len(value) <= 20:
            raise invalid(path, "A document holds 1 to 20 collections")
        names, out, total = set(), [], 0
        for i, c in enumerate(value):
            where = join(path, i)
            if not isinstance(c, dict):
                raise invalid(where, "Each collection is an object of name and sources")
            entry = {}
            for k, v in c.items():
                if k not in DOCUMENT_COLLECTION_KEYS:
                    raise ApiError("UNKNOWN_FIELD", field=join(where, k), path=join(where, k))
                if k == "name":
                    entry["name"] = COLLECTION_SPEC.check(v, join(where, k))
                    if entry["name"] in names:
                        raise invalid(join(where, k), "Each collection appears once")
                    names.add(entry["name"])
                else:
                    entry["sources"] = Document._sources(v, join(where, k), total)
                    total += len(entry["sources"])
            for k in ("name", "sources"):
                if k not in entry:
                    raise invalid(join(where, k), "This value is required")
            out.append(entry)
        return out

    @staticmethod
    def _sources(value, path, before: int) -> list[dict]:
        if not isinstance(value, list):
            raise invalid(path, "Send a list of sources")
        if before + len(value) > 50:
            raise invalid(path, "A document holds at most 50 sources")
        ids, out = set(), []
        for i, s in enumerate(value):
            source = DOCUMENT_SOURCE.check(s, join(path, i))
            if source["id"] in ids:
                raise invalid(join(path, f"{i}.id"), "Each source id appears once in a collection")
            ids.add(source["id"])
            out.append(source)
        return out


IMPORT = Obj({"name": (DB_NAME_SPEC, True), "document": (Document(), True)})


@route("POST", "/api/v2/databases/import", "owner", body=True, idempotent=True)
def import_database(ctx: Ctx):
    body = validate(IMPORT, ctx.body)
    t, p = ctx.tx, ctx.principal
    row = writelog.create(t, p, body["name"])
    sources = facts = 0
    for c in body["document"]:
        for s in c["sources"]:
            s.pop("version")
            writelog.ingest(t, p.org_id, row, c["name"], [s])
            facts += len(s.get("facts") or [])
        sources += len(c["sources"])
        t.run("INSERT INTO collections (database_id, name) VALUES (:d, :c) ON CONFLICT DO NOTHING", d=row["id"],
              c=c["name"])
    api.audit(t, p.org_id, p.email, "database.import", row["name"], str(sources))
    ctx.idempotency_database_id = row["id"]
    return Answer({"name": row["name"], "status": "provisioning", "created_at": text.ts(row["created_at"]),
                   "sources": sources, "facts": facts}, 201)


# ---- export-ready notices -----------------------------------------------------------------------

def _mail_finished_exports() -> None:
    while True:
        time.sleep(0.5)
        try:
            with db.tx() as t:
                done = t.rows("UPDATE export_jobs j SET mailed_at = clock_timestamp() FROM databases d "
                              "WHERE d.id = j.database_id AND j.mailed_at IS NULL AND "
                              "j.requested_at <= clock_timestamp() - interval '2 seconds' "
                              "RETURNING j.id, j.requested_by, d.name")
            for j in done:
                mail.send([j["requested_by"]], f"Export ready: {j['name']}",
                          f"The export {j['id']} of {j['name']} is ready.\n"
                          f"Download it from /api/v2/jobs/{j['id']}/download\n")
        except Exception:  # noqa: BLE001 -- the notice loop outlives a passing database error
            log.exception("export notice loop")
            time.sleep(2)


def start_export_notices() -> None:
    threading.Thread(target=_mail_finished_exports, daemon=True, name="export-notices").start()
