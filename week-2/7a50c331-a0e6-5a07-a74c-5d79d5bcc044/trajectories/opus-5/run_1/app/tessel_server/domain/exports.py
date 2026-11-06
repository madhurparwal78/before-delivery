"""Export jobs and the import of an export document."""
import datetime
import hashlib
import json
import secrets

from .. import audit, textutil, validate
from ..errors import TesselError, validation_error
from . import databases, sources

QUEUED_SECONDS = 1
FINISHED_SECONDS = 2
MAX_IMPORT_COLLECTIONS = 20
MAX_IMPORT_SOURCES = 50

FACT_SPEC = {
    "subject": validate.ANY,
    "predicate": validate.ANY,
    "object": validate.ANY,
    "valid_from": validate.ANY,
    "reason": validate.ANY,
}

IMPORT_SPEC = {
    "name": validate.ANY,
    "document": {
        "database": validate.ANY,
        "lsn": validate.ANY,
        "collections": (
            "list",
            {
                "name": validate.ANY,
                "sources": (
                    "list",
                    {
                        "id": validate.ANY,
                        "version": validate.ANY,
                        "title": validate.ANY,
                        "text": validate.ANY,
                        "facts": ("list", FACT_SPEC),
                    },
                ),
            },
        ),
    },
}


def new_job_id():
    return "job_" + secrets.token_hex(8)


def canonical(document):
    return json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def build_document(cur, database_row):
    """Snapshot the database as an export document at its current lsn."""
    names = databases.collections(cur, database_row["id"])
    collections = []
    total_sources = 0
    total_facts = 0
    for name in names:
        rows = cur.all(
            """
            SELECT id, version, title, text FROM sources
             WHERE database_id = %s AND collection = %s AND NOT deleted
             ORDER BY id
            """,
            (database_row["id"], name),
        )
        listed = []
        for row in rows:
            facts = cur.all(
                """
                SELECT subject, predicate, object, valid_from, reason FROM facts
                 WHERE database_id = %s AND collection = %s AND source_id = %s
                 ORDER BY lsn, position
                """,
                (database_row["id"], name, row["id"]),
            )
            listed.append(
                {
                    "id": row["id"],
                    "version": row["version"],
                    "title": row["title"],
                    "text": row["text"],
                    "facts": [
                        {
                            "subject": fact["subject"],
                            "predicate": fact["predicate"],
                            "object": fact["object"],
                            "valid_from": textutil.format_timestamp(fact["valid_from"]),
                            "reason": fact["reason"],
                        }
                        for fact in facts
                    ],
                }
            )
            total_facts += len(facts)
        total_sources += len(listed)
        collections.append({"name": name, "sources": listed})
    document = {
        "database": database_row["name"],
        "lsn": database_row["last_lsn"],
        "collections": collections,
    }
    return document, len(names), total_sources, total_facts


def request_export(cur, actor, database_row):
    document, collection_count, source_count, fact_count = build_document(
        cur, database_row
    )
    digest = hashlib.sha256(canonical(document).encode("utf-8")).hexdigest()
    job_id = new_job_id()
    cur.execute(
        """
        INSERT INTO export_jobs (id, organization_id, database_id, database_name, lsn,
                                 requested_by, requested_at, document, sha256,
                                 collections, sources, facts)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            job_id,
            actor.organization_id,
            database_row["id"],
            database_row["name"],
            database_row["last_lsn"],
            actor.email,
            textutil.now(),
            canonical(document),
            digest,
            collection_count,
            source_count,
            fact_count,
        ),
    )
    audit.write(
        cur,
        actor.organization_id,
        actor.email,
        "export.request",
        database_row["name"],
    )
    return {
        "job_id": job_id,
        "status": "queued",
        "database": database_row["name"],
        "lsn": database_row["last_lsn"],
    }


def job_status(row, at=None):
    elapsed = ((at or textutil.now()) - row["requested_at"]).total_seconds()
    if elapsed < QUEUED_SECONDS:
        return "queued"
    if elapsed < FINISHED_SECONDS:
        return "running"
    return "succeeded"


def read_job(cur, actor, job_id):
    row = cur.one(
        """
        SELECT j.id, j.organization_id, j.database_id, j.database_name, j.lsn,
               j.requested_by, j.requested_at, j.sha256, j.collections, j.sources, j.facts
          FROM export_jobs j
         WHERE j.id = %s AND j.organization_id = %s
        """,
        (job_id, actor.organization_id),
    )
    if row is None:
        raise TesselError("JOB_NOT_FOUND")
    return row


def job_answer(row):
    status = job_status(row)
    finished = (
        row["requested_at"] + datetime.timedelta(seconds=FINISHED_SECONDS)
        if status == "succeeded"
        else None
    )
    result = None
    if status == "succeeded":
        result = {
            "collections": row["collections"],
            "sources": row["sources"],
            "facts": row["facts"],
            "sha256": row["sha256"],
        }
    return {
        "job_id": row["id"],
        "kind": "export",
        "database": row["database_name"],
        "status": status,
        "lsn": row["lsn"],
        "requested_at": textutil.format_timestamp(row["requested_at"]),
        "finished_at": textutil.format_timestamp(finished),
        "result": result,
    }


def validate_import(body):
    """Check the whole document in document order before anything is created."""
    name = validate.pattern(
        body,
        "name",
        "name",
        validate.DATABASE_NAME,
        "Lowercase letters, digits and underscores; 3 to 32 characters; starts with a letter",
    )
    document = body.get("document")
    if not isinstance(document, dict):
        raise validation_error("document", "This field must be an object")
    raw_collections = document.get("collections")
    if not isinstance(raw_collections, list):
        raise validation_error("document.collections", "This field must be a list")
    if not 1 <= len(raw_collections) <= MAX_IMPORT_COLLECTIONS:
        raise validation_error(
            "document.collections",
            "Send between 1 and %d collections" % MAX_IMPORT_COLLECTIONS,
        )
    seen_collections = set()
    parsed = []
    total_sources = 0
    for index, collection in enumerate(raw_collections):
        base = "document.collections.%d" % index
        if not isinstance(collection, dict):
            raise validation_error(base, "A collection must be a JSON object")
        collection_name = validate.pattern(
            collection,
            "name",
            base + ".name",
            validate.DATABASE_NAME,
            "Lowercase letters, digits and underscores; 3 to 32 characters; starts with a letter",
        )
        if collection_name in seen_collections:
            raise validation_error(base + ".name", "This collection name is repeated")
        seen_collections.add(collection_name)
        raw_sources = collection.get("sources")
        if raw_sources is None:
            raw_sources = []
        if not isinstance(raw_sources, list):
            raise validation_error(base + ".sources", "This field must be a list")
        total_sources += len(raw_sources)
        if total_sources > MAX_IMPORT_SOURCES:
            raise validation_error(
                "document.collections",
                "A document holds at most %d sources" % MAX_IMPORT_SOURCES,
            )
        seen_ids = set()
        listed = []
        for position, source in enumerate(raw_sources):
            source_base = "%s.sources.%d" % (base, position)
            if not isinstance(source, dict):
                raise validation_error(source_base, "A source must be a JSON object")
            source_id = validate.pattern(
                source,
                "id",
                source_base + ".id",
                validate.SOURCE_ID,
                "Write letters, digits, underscores or hyphens; 1 to 64 characters",
            )
            if source_id in seen_ids:
                raise validation_error(
                    source_base + ".id", "This source id is repeated in this collection"
                )
            seen_ids.add(source_id)
            validate.whole_number(
                source, "version", source_base + ".version", 1, 2_000_000_000
            )
            title = validate.string(source, "title", source_base + ".title", 1, 200)
            text = validate.string(source, "text", source_base + ".text", 1, 20000)
            raw_facts = validate.listed(source, "facts", source_base + ".facts", 0, 50)
            facts = sources.validate_facts(raw_facts, source_base + ".facts")
            listed.append(
                {
                    "id": source_id,
                    "title": title,
                    "text": text,
                    "if_version": None,
                    "facts": facts,
                    "relations": None,
                }
            )
        parsed.append({"name": collection_name, "sources": listed})
    return name, parsed


def perform_import(cur, actor, name, parsed):
    row = databases.create(cur, actor, name)
    moment = textutil.now()
    total_sources = 0
    total_facts = 0
    for collection in parsed:
        databases.ensure_collection(cur, row["id"], collection["name"])
        if collection["sources"]:
            sources.perform_ingest(
                cur, row, collection["name"], collection["sources"], moment
            )
            total_sources += len(collection["sources"])
            total_facts += sum(len(item["facts"]) for item in collection["sources"])
    audit.write(
        cur, actor.organization_id, actor.email, "database.import", name, str(total_sources)
    )
    return {
        "name": name,
        "status": databases.status_of(row),
        "created_at": textutil.format_timestamp(row["created_at"]),
        "sources": total_sources,
        "facts": total_facts,
    }, row["id"]
