"""Databases, collections, sources, reads and queries."""
import json

from .. import audit, db, httpbase, textutil, validate
from ..domain import cypher, databases, exports, feedback, graph, search, sources
from ..errors import TesselError, validation_error
from .registry import Route

COMPACT_SPEC = {"database": validate.ANY}
LIST_SPEC = {"database": validate.ANY, "collection": validate.ANY}
RESTORE_SPEC = {
    "database": validate.ANY,
    "collection": validate.ANY,
    "id": validate.ANY,
}
QUERY_SPEC = {
    "database": validate.ANY,
    "query_by": validate.ANY,
    "query": validate.ANY,
    "collections": validate.ANY,
    "max_results": validate.ANY,
    "cypher": validate.ANY,
    "as_of": validate.ANY,
}
CREATE_SPEC = {"name": validate.ANY}
EXPORT_SPEC = {"database": validate.ANY}

NAME_HELP = (
    "Lowercase letters, digits and underscores; 3 to 32 characters; starts with a letter"
)


def _database_name(request):
    value = request.param("database")
    if value is None:
        raise validation_error("database", "This field is required")
    return validate.pattern({"database": value}, "database", "database", validate.DATABASE_NAME, NAME_HELP)


def _collection_name(request, default=databases.DEFAULT_COLLECTION, name="collection"):
    value = request.param(name)
    if value is None:
        return default
    return validate.pattern({name: value}, name, name, validate.DATABASE_NAME, NAME_HELP)


def _as_of(request):
    value = request.param("as_of")
    if value is None or value == "":
        return textutil.now()
    moment = textutil.parse_timestamp(value)
    if moment is None:
        raise validation_error("as_of", "Write a UTC moment as YYYY-MM-DDTHH:MM:SSZ")
    return moment


def _served_from(row):
    return {
        "index_generation": row["index_generation"],
        "indexed_lsn": row["indexed_lsn"],
        "wal_entries_applied": row["last_lsn"] - row["indexed_lsn"],
    }


def create_database(ctx):
    validate.scan_unknown(ctx.body, CREATE_SPEC)
    validate.scan_unstorable(ctx.body)
    name = validate.pattern(ctx.body, "name", "name", validate.DATABASE_NAME, NAME_HELP)
    with db.tx() as cur:
        row = databases.create(cur, ctx.actor, name)
        audit.write(cur, ctx.actor.organization_id, ctx.actor.email, "database.create", name)
        ctx.idempotency_database_id = row["id"]
    return 201, {
        "name": row["name"],
        "status": databases.status_of(row),
        "created_at": textutil.format_timestamp(row["created_at"]),
    }


def list_databases(ctx):
    with db.tx() as cur:
        rows = databases.listing(cur, ctx.actor)
    return 200, {
        "databases": [
            {
                "name": row["name"],
                "status": databases.status_of(row),
                "last_lsn": row["last_lsn"],
                "indexed_lsn": row["indexed_lsn"],
                "index_generation": row["index_generation"],
                "created_at": textutil.format_timestamp(row["created_at"]),
            }
            for row in rows
        ]
    }


def delete_database(ctx):
    name = _database_name(ctx.request)
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        databases.lock_organization(cur, ctx.actor.organization_id)
        databases.delete(cur, row)
        audit.write(cur, ctx.actor.organization_id, ctx.actor.email, "database.delete", name)
    return 200, {"deleted": True}


def database_status(ctx):
    name = _database_name(ctx.request)
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
    status = databases.status_of(row)
    return 200, {
        "database": row["name"],
        "status": status,
        "infra": {"ready_for_ingestion": status == "ready", "graph_status": status},
    }


def list_collections(ctx):
    name = _database_name(ctx.request)
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        names = databases.collections(cur, row["id"])
    return 200, {"collections": names}


def delete_collection(ctx):
    name = _database_name(ctx.request)
    target = ctx.request.param("name")
    if target is None:
        raise validation_error("name", "This field is required")
    validate.pattern({"name": target}, "name", "name", validate.DATABASE_NAME, NAME_HELP)
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        databases.delete_collection(cur, row["id"], target)
    return 200, {"deleted": True}


def database_stats(ctx):
    name = _database_name(ctx.request)
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        figures = databases.stats(cur, row)
    return 200, figures


def compact(ctx):
    validate.scan_unknown(ctx.body, COMPACT_SPEC)
    validate.scan_unstorable(ctx.body)
    name = validate.pattern(ctx.body, "database", "database", validate.DATABASE_NAME, NAME_HELP)
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        databases.require_ready(row)
        answer = databases.compact(cur, row["id"])
    return 200, answer


def export_database(ctx):
    validate.scan_unknown(ctx.body, EXPORT_SPEC)
    validate.scan_unstorable(ctx.body)
    name = validate.pattern(ctx.body, "database", "database", validate.DATABASE_NAME, NAME_HELP)
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        databases.require_ready(row)
        answer = exports.request_export(cur, ctx.actor, row)
        ctx.idempotency_database_id = row["id"]
    return 202, answer


def import_database(ctx):
    validate.scan_unknown(ctx.body, exports.IMPORT_SPEC)
    validate.scan_unstorable(ctx.body)
    name, parsed = exports.validate_import(ctx.body)
    with db.tx() as cur:
        answer, database_id = exports.perform_import(cur, ctx.actor, name, parsed)
        ctx.idempotency_database_id = database_id
    return 201, answer


def ingest(ctx):
    validate.scan_unknown(ctx.body, sources.INGEST_SPEC)
    validate.scan_unstorable(ctx.body)
    name, collection, parsed = sources.validate_ingest(ctx.body)
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        databases.require_ready(row)
        results = sources.perform_ingest(cur, row, collection, parsed)
        ctx.idempotency_database_id = row["id"]
    return 201, {"results": results}


def source_statuses(ctx):
    name = _database_name(ctx.request)
    collection = _collection_name(ctx.request)
    raw = ctx.request.param("ids")
    if raw is None or raw == "":
        raise validation_error("ids", "Name at least one source id")
    ids = raw.split(",")
    if len(ids) > 100:
        raise validation_error("ids", "Name at most 100 source ids")
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        answer = sources.statuses(cur, row, collection, ids)
    return 200, {"statuses": answer}


def list_sources(ctx):
    validate.scan_unknown(ctx.body, LIST_SPEC)
    validate.scan_unstorable(ctx.body)
    name = validate.pattern(ctx.body, "database", "database", validate.DATABASE_NAME, NAME_HELP)
    collection = validate.pattern(
        ctx.body,
        "collection",
        "collection",
        validate.DATABASE_NAME,
        NAME_HELP,
        required=False,
        default=databases.DEFAULT_COLLECTION,
    )
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        listed = sources.listing(cur, row, collection)
    return 200, {"sources": listed}


def read_source(ctx):
    name = _database_name(ctx.request)
    collection = _collection_name(ctx.request)
    source_id = ctx.request.param("id")
    if source_id is None:
        raise validation_error("id", "This field is required")
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        answer = sources.single(cur, row, collection, source_id)
    etag = '"%d"' % answer["version"]
    if ctx.request.header("If-None-Match") == etag:
        response = httpbase.Response(304, b"")
        response.add("ETag", etag)
        return response
    ctx.headers["ETag"] = etag
    return 200, answer


def delete_source(ctx):
    name = _database_name(ctx.request)
    collection = _collection_name(ctx.request)
    source_id = ctx.request.param("id")
    if source_id is None:
        raise validation_error("id", "This field is required")
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        answer = sources.delete(cur, row, collection, source_id)
    return 200, answer


def restore_source(ctx):
    validate.scan_unknown(ctx.body, RESTORE_SPEC)
    validate.scan_unstorable(ctx.body)
    name = validate.pattern(ctx.body, "database", "database", validate.DATABASE_NAME, NAME_HELP)
    collection = validate.pattern(
        ctx.body,
        "collection",
        "collection",
        validate.DATABASE_NAME,
        NAME_HELP,
        required=False,
        default=databases.DEFAULT_COLLECTION,
    )
    source_id = validate.pattern(
        ctx.body,
        "id",
        "id",
        validate.SOURCE_ID,
        "Write letters, digits, underscores or hyphens; 1 to 64 characters",
    )
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        databases.require_ready(row)
        answer = sources.restore(cur, row, collection, source_id)
    return 200, answer


def relations(ctx):
    name = _database_name(ctx.request)
    entity = ctx.request.param("entity")
    if entity is None or entity.strip() == "":
        raise validation_error("entity", "This field is required")
    as_of = _as_of(ctx.request)
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        outgoing, incoming = graph.relations(cur, row["id"], entity, as_of)
    return 200, {
        "entity": entity,
        "as_of": textutil.format_timestamp(as_of),
        "outgoing": outgoing,
        "incoming": incoming,
    }


def history(ctx):
    name = _database_name(ctx.request)
    entity = ctx.request.param("entity")
    if entity is None or entity.strip() == "":
        raise validation_error("entity", "This field is required")
    predicate = ctx.request.param("predicate")
    if predicate is None:
        raise validation_error("predicate", "This field is required")
    validate.pattern(
        {"predicate": predicate},
        "predicate",
        "predicate",
        validate.PREDICATE,
        "Write capitals, digits and underscores; 2 to 32 characters",
    )
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        facts = graph.history(cur, row["id"], entity, predicate)
    return 200, {"entity": entity, "predicate": predicate, "facts": facts}


def read_graph(ctx):
    name = _database_name(ctx.request)
    as_of = _as_of(ctx.request)
    raw = ctx.request.param("predicates")
    predicates = None
    if raw is not None and raw != "":
        predicates = raw.split(",")
        for index, value in enumerate(predicates):
            validate.pattern(
                {"predicate": value},
                "predicate",
                "predicates.%d" % index,
                validate.PREDICATE,
                "Write capitals, digits and underscores; 2 to 32 characters",
            )
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        nodes, edges = graph.graph(cur, row["id"], as_of, predicates)
    return 200, {
        "as_of": textutil.format_timestamp(as_of),
        "nodes": nodes,
        "edges": edges,
    }


def query(ctx):
    validate.scan_unknown(ctx.body, QUERY_SPEC)
    validate.scan_unstorable(ctx.body)
    name = validate.pattern(ctx.body, "database", "database", validate.DATABASE_NAME, NAME_HELP)
    query_by = validate.choice(ctx.body, "query_by", "query_by", ("text", "cypher"))
    if query_by == "text":
        words = validate.string(ctx.body, "query", "query", 1, 1000)
        collections = ctx.body.get("collections")
        if collections is None:
            collections = [databases.DEFAULT_COLLECTION]
        else:
            if not isinstance(collections, list):
                raise validation_error("collections", "This field must be a list")
            if not 1 <= len(collections) <= 20:
                raise validation_error("collections", "Name between 1 and 20 collections")
            for index, value in enumerate(collections):
                validate.pattern(
                    {"collection": value},
                    "collection",
                    "collections.%d" % index,
                    validate.DATABASE_NAME,
                    NAME_HELP,
                )
        max_results = validate.whole_number(
            ctx.body, "max_results", "max_results", 1, 20, required=False, default=5
        )
        with db.tx() as cur:
            row = databases.lookup(cur, ctx.actor, name)
            results = search.run(cur, row, words, collections, max_results)
            feedback.record_query(
                cur, ctx.request.request_id, ctx.actor.organization_id, row["id"]
            )
        return 200, {"results": results}

    statement = validate.string(ctx.body, "cypher", "cypher", 1, 4000)
    as_of = validate.timestamp(ctx.body, "as_of", "as_of", required=False)
    as_of = as_of or textutil.now()
    with db.tx() as cur:
        row = databases.lookup(cur, ctx.actor, name)
        answer = cypher.run(cur, row, statement, as_of)
        feedback.record_query(
            cur, ctx.request.request_id, ctx.actor.organization_id, row["id"]
        )
    return 200, {
        "columns": answer["columns"],
        "rows": answer["rows"],
        "as_of": textutil.format_timestamp(as_of),
        "served_from": _served_from(row),
    }


def send_feedback(ctx):
    validate.scan_unknown(ctx.body, feedback.SPEC)
    validate.scan_unstorable(ctx.body)
    parsed = feedback.validate_body(ctx.body)
    with db.tx() as cur:
        answer = feedback.store(cur, ctx.actor.organization_id, *parsed)
    return 201, answer


def read_job(ctx):
    with db.tx() as cur:
        row = exports.read_job(cur, ctx.actor, ctx.params[0])
    return 200, exports.job_answer(row)


def download_job(ctx):
    with db.tx() as cur:
        row = exports.read_job(cur, ctx.actor, ctx.params[0])
        if exports.job_status(row) != "succeeded":
            raise TesselError("JOB_NOT_FINISHED")
        document = cur.value(
            "SELECT document FROM export_jobs WHERE id = %s", (row["id"],)
        )
    etag = '"%s"' % row["sha256"]
    if ctx.request.header("If-None-Match") == etag:
        response = httpbase.Response(304, b"")
        response.add("ETag", etag)
        return response
    ctx.headers["ETag"] = etag
    return 200, json.loads(document)


def routes():
    return [
        Route("/api/v2/databases", "POST", create_database, role="owner",
              session_only=True, idempotent=True, reads_body=True),
        Route("/api/v2/databases", "GET", list_databases, role="viewer"),
        Route("/api/v2/databases", "DELETE", delete_database, role="owner",
              session_only=True),
        Route("/api/v2/databases/status", "GET", database_status, role="viewer"),
        Route("/api/v2/databases/collections", "GET", list_collections, role="viewer"),
        Route("/api/v2/databases/collections", "DELETE", delete_collection, role="editor"),
        Route("/api/v2/databases/stats", "GET", database_stats, role="viewer"),
        Route("/api/v2/databases/compact", "POST", compact, role="editor", reads_body=True),
        Route("/api/v2/databases/export", "POST", export_database, role="owner",
              session_only=True, idempotent=True, reads_body=True),
        Route("/api/v2/databases/import", "POST", import_database, role="owner",
              session_only=True, idempotent=True, reads_body=True),
        Route("/api/v2/context/ingest", "POST", ingest, role="editor",
              idempotent=True, reads_body=True),
        Route("/api/v2/context/status", "GET", source_statuses, role="viewer"),
        Route("/api/v2/context/list", "POST", list_sources, role="viewer", reads_body=True),
        Route("/api/v2/context/source", "GET", read_source, role="viewer"),
        Route("/api/v2/context", "DELETE", delete_source, role="editor"),
        Route("/api/v2/context/restore", "POST", restore_source, role="editor",
              reads_body=True),
        Route("/api/v2/context/relations", "GET", relations, role="viewer"),
        Route("/api/v2/context/history", "GET", history, role="viewer"),
        Route("/api/v2/context/graph", "GET", read_graph, role="viewer"),
        Route("/api/v2/query", "POST", query, role="viewer", reads_body=True,
              rate_limited=True),
        Route("/api/v2/feedback", "POST", send_feedback, role="viewer", reads_body=True),
        Route("/api/v2/jobs/{id}", "GET", read_job, role="owner", session_only=True),
        Route("/api/v2/jobs/{id}/download", "GET", download_job, role="owner",
              session_only=True),
    ]
