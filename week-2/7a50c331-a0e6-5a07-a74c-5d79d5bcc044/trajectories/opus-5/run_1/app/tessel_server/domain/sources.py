"""Sources, versions, facts, the write log and restores."""
import collections as pycollections
import secrets

from .. import textutil, validate
from ..errors import SOURCE_MISSING_MESSAGE, TesselError, validation_error
from . import databases

INGEST_SPEC = {
    "database": validate.ANY,
    "collection": validate.ANY,
    "sources": (
        "list",
        {
            "id": validate.ANY,
            "title": validate.ANY,
            "text": validate.ANY,
            "if_version": validate.ANY,
            "facts": (
                "list",
                {
                    "subject": validate.ANY,
                    "predicate": validate.ANY,
                    "object": validate.ANY,
                    "valid_from": validate.ANY,
                    "reason": validate.ANY,
                },
            ),
            "relations": {"ids": ("list", validate.ANY)},
        },
    ),
}


def new_source_id():
    return "src_" + secrets.token_hex(6)


def indexing_status(lsn, indexed_lsn):
    return "completed" if lsn <= indexed_lsn else "graph_creation"


def term_rows(title, text):
    """The term positions a keyword search scores, built once per version."""
    terms = textutil.terms(title + " " + text)
    positions = pycollections.OrderedDict()
    for index, term in enumerate(terms):
        positions.setdefault(term, []).append(index)
    return len(terms), positions


def validate_facts(facts, path):
    out = []
    for index, fact in enumerate(facts):
        base = "%s.%d" % (path, index)
        if not isinstance(fact, dict):
            raise validation_error(base, "A fact must be a JSON object")
        subject = validate.string(
            {"subject": _trim(fact.get("subject"))}, "subject", base + ".subject", 1, 80
        )
        predicate = validate.pattern(
            fact,
            "predicate",
            base + ".predicate",
            validate.PREDICATE,
            "Write capitals, digits and underscores; 2 to 32 characters",
        )
        obj = validate.string(
            {"object": _trim(fact.get("object"))}, "object", base + ".object", 1, 80
        )
        valid_from = validate.timestamp(fact, "valid_from", base + ".valid_from")
        reason = validate.string(fact, "reason", base + ".reason", 0, 280)
        out.append(
            {
                "subject": subject,
                "subject_key": textutil.entity_key(subject),
                "predicate": predicate,
                "object": obj,
                "object_key": textutil.entity_key(obj),
                "valid_from": valid_from,
                "reason": reason,
            }
        )
    return out


def _trim(value):
    return value.strip() if isinstance(value, str) else value


def validate_ingest(body):
    """Check the whole request before anything is written."""
    name = validate.pattern(
        body,
        "database",
        "database",
        validate.DATABASE_NAME,
        "Lowercase letters, digits and underscores; 3 to 32 characters; starts with a letter",
    )
    collection = validate.pattern(
        body,
        "collection",
        "collection",
        validate.DATABASE_NAME,
        "Lowercase letters, digits and underscores; 3 to 32 characters; starts with a letter",
        required=False,
        default=databases.DEFAULT_COLLECTION,
    )
    raw_sources = validate.listed(body, "sources", "sources", 1, 50)
    parsed = []
    for index, source in enumerate(raw_sources):
        base = "sources.%d" % index
        if not isinstance(source, dict):
            raise validation_error(base, "A source must be a JSON object")
        source_id = validate.pattern(
            source,
            "id",
            base + ".id",
            validate.SOURCE_ID,
            "Write letters, digits, underscores or hyphens; 1 to 64 characters",
            required=False,
        )
        title = validate.string(source, "title", base + ".title", 1, 200)
        text = validate.string(source, "text", base + ".text", 1, 20000)
        if_version = validate.whole_number(
            source, "if_version", base + ".if_version", 0, 2_000_000_000, required=False
        )
        if if_version is not None and source_id is None:
            raise validation_error(
                base + ".if_version", "Send an id with if_version"
            )
        raw_facts = validate.listed(source, "facts", base + ".facts", 0, 50)
        facts = validate_facts(raw_facts, base + ".facts")
        relations = None
        if source.get("relations") is not None:
            holder = source["relations"]
            if not isinstance(holder, dict):
                raise validation_error(base + ".relations", "This field must be an object")
            ids = validate.listed(holder, "ids", base + ".relations.ids", 0, 50)
            for position, value in enumerate(ids):
                validate.pattern(
                    {"id": value},
                    "id",
                    "%s.relations.ids.%d" % (base, position),
                    validate.SOURCE_ID,
                    "Write letters, digits, underscores or hyphens; 1 to 64 characters",
                )
            relations = ids
        parsed.append(
            {
                "id": source_id,
                "title": title,
                "text": text,
                "if_version": if_version,
                "facts": facts,
                "relations": relations,
            }
        )
    return name, collection, parsed


def next_lsns(cur, database_id, count):
    row = cur.one(
        "UPDATE databases SET last_lsn = last_lsn + %s WHERE id = %s RETURNING last_lsn",
        (count, database_id),
    )
    highest = row["last_lsn"]
    return list(range(highest - count + 1, highest + 1))


def perform_ingest(cur, database_row, collection, parsed, moment=None):
    """Write each accepted source as one write log entry, in request order."""
    database_id = database_row["id"]
    locked = databases.lock_database(cur, database_id)
    moment = moment or textutil.now()
    databases.ensure_collection(cur, database_id, collection)

    existing = {}
    for index, source in enumerate(parsed):
        if source["id"] is None:
            continue
        row = cur.one(
            """
            SELECT id, version, deleted FROM sources
             WHERE database_id = %s AND collection = %s AND id = %s
            """,
            (database_id, collection, source["id"]),
        )
        existing[index] = row
        if source["if_version"] is not None:
            live = 0 if row is None or row["deleted"] else row["version"]
            if live != source["if_version"]:
                raise TesselError(
                    "VERSION_CONFLICT",
                    field="sources.%d.if_version" % index,
                    id=source["id"],
                    version=live,
                )

    lsns = next_lsns(cur, database_id, len(parsed))
    results = []
    for index, source in enumerate(parsed):
        lsn = lsns[index]
        source_id = source["id"] or new_source_id()
        previous = existing.get(index)
        version = previous["version"] + 1 if previous else 1
        token_count = len(textutil.tokens(source["title"] + " " + source["text"]))
        term_count, positions = term_rows(source["title"], source["text"])
        if previous:
            cur.execute(
                """
                UPDATE sources
                   SET title = %s, text = %s, version = %s, token_count = %s,
                       term_count = %s, ingested_at = %s, lsn = %s, deleted = false
                 WHERE database_id = %s AND collection = %s AND id = %s
                """,
                (
                    source["title"],
                    source["text"],
                    version,
                    token_count,
                    term_count,
                    moment,
                    lsn,
                    database_id,
                    collection,
                    source_id,
                ),
            )
            cur.execute(
                """
                DELETE FROM source_terms
                 WHERE database_id = %s AND collection = %s AND source_id = %s
                """,
                (database_id, collection, source_id),
            )
        else:
            cur.execute(
                """
                INSERT INTO sources (database_id, collection, id, title, text, version,
                                     token_count, term_count, ingested_at, lsn, deleted)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, false)
                """,
                (
                    database_id,
                    collection,
                    source_id,
                    source["title"],
                    source["text"],
                    version,
                    token_count,
                    term_count,
                    moment,
                    lsn,
                ),
            )
        for term, places in positions.items():
            cur.execute(
                """
                INSERT INTO source_terms (database_id, collection, source_id, term, tf, positions)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (database_id, collection, source_id, term, len(places), places),
            )
        for position, fact in enumerate(source["facts"]):
            cur.execute(
                """
                INSERT INTO facts (database_id, collection, source_id, version, lsn, position,
                                   subject, subject_key, predicate, object, object_key,
                                   valid_from, reason)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    database_id,
                    collection,
                    source_id,
                    version,
                    lsn,
                    position,
                    fact["subject"],
                    fact["subject_key"],
                    fact["predicate"],
                    fact["object"],
                    fact["object_key"],
                    fact["valid_from"],
                    fact["reason"],
                ),
            )
        cur.execute(
            """
            INSERT INTO wal_entries (database_id, lsn, kind, collection, source_id, created_at)
            VALUES (%s, %s, 'ingest', %s, %s, %s)
            """,
            (database_id, lsn, collection, source_id, moment),
        )
        cur.execute(
            """
            INSERT INTO source_versions (organization_id, database_id, collection, source_id,
                                         version, lsn, token_count, ingested_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                database_row["organization_id"],
                database_id,
                collection,
                source_id,
                version,
                lsn,
                token_count,
                moment,
            ),
        )
        results.append(
            {
                "id": source_id,
                "version": version,
                "lsn": lsn,
                "indexing_status": indexing_status(lsn, locked["indexed_lsn"]),
            }
        )
    return results


def listing(cur, database_row, collection):
    rows = cur.all(
        """
        SELECT s.id, s.title, s.version, s.token_count, s.ingested_at, s.lsn,
               (SELECT count(*) FROM facts f
                 WHERE f.database_id = s.database_id AND f.collection = s.collection
                   AND f.source_id = s.id) AS facts
          FROM sources s
         WHERE s.database_id = %s AND s.collection = %s AND NOT s.deleted
         ORDER BY s.id
        """,
        (database_row["id"], collection),
    )
    return [
        {
            "id": row["id"],
            "title": row["title"],
            "version": row["version"],
            "token_count": row["token_count"],
            "facts": int(row["facts"]),
            "indexing_status": indexing_status(row["lsn"], database_row["indexed_lsn"]),
            "ingested_at": textutil.format_timestamp(row["ingested_at"]),
        }
        for row in rows
    ]


def single(cur, database_row, collection, source_id):
    row = cur.one(
        """
        SELECT id, title, text, version, token_count, ingested_at, lsn
          FROM sources
         WHERE database_id = %s AND collection = %s AND id = %s AND NOT deleted
        """,
        (database_row["id"], collection, source_id),
    )
    if row is None:
        raise TesselError("SOURCE_NOT_FOUND")
    facts = cur.all(
        """
        SELECT subject, predicate, object, valid_from, reason FROM facts
         WHERE database_id = %s AND collection = %s AND source_id = %s
         ORDER BY lsn, position
        """,
        (database_row["id"], collection, source_id),
    )
    return {
        "id": row["id"],
        "collection": collection,
        "version": row["version"],
        "title": row["title"],
        "text": row["text"],
        "token_count": row["token_count"],
        "lsn": row["lsn"],
        "indexing_status": indexing_status(row["lsn"], database_row["indexed_lsn"]),
        "ingested_at": textutil.format_timestamp(row["ingested_at"]),
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


def statuses(cur, database_row, collection, ids):
    rows = {
        row["id"]: row
        for row in cur.all(
            """
            SELECT id, version, lsn FROM sources
             WHERE database_id = %s AND collection = %s
            """,
            (database_row["id"], collection),
        )
    }
    out = []
    for source_id in ids:
        row = rows.get(source_id)
        if row is None:
            out.append(
                {
                    "id": source_id,
                    "indexing_status": "errored",
                    "version": None,
                    "error_code": "FILE_NOT_FOUND",
                    "error_message": SOURCE_MISSING_MESSAGE,
                }
            )
        else:
            out.append(
                {
                    "id": source_id,
                    "indexing_status": indexing_status(
                        row["lsn"], database_row["indexed_lsn"]
                    ),
                    "version": row["version"],
                }
            )
    return out


def delete(cur, database_row, collection, source_id):
    database_id = database_row["id"]
    databases.lock_database(cur, database_id)
    row = cur.one(
        """
        SELECT id FROM sources
         WHERE database_id = %s AND collection = %s AND id = %s AND NOT deleted
        """,
        (database_id, collection, source_id),
    )
    if row is None:
        raise TesselError("SOURCE_NOT_FOUND")
    lsn = next_lsns(cur, database_id, 1)[0]
    cur.execute(
        """
        UPDATE sources SET deleted = true
         WHERE database_id = %s AND collection = %s AND id = %s
        """,
        (database_id, collection, source_id),
    )
    cur.execute(
        """
        INSERT INTO wal_entries (database_id, lsn, kind, collection, source_id, created_at)
        VALUES (%s, %s, 'delete', %s, %s, %s)
        """,
        (database_id, lsn, collection, source_id, textutil.now()),
    )
    return {"deleted": True, "lsn": lsn}


def restore(cur, database_row, collection, source_id):
    database_id = database_row["id"]
    locked = databases.lock_database(cur, database_id)
    row = cur.one(
        """
        SELECT id, version, deleted FROM sources
         WHERE database_id = %s AND collection = %s AND id = %s
        """,
        (database_id, collection, source_id),
    )
    if row is None:
        raise TesselError("SOURCE_NOT_FOUND")
    if not row["deleted"]:
        raise TesselError("SOURCE_IS_LIVE", id=source_id)
    lsn = next_lsns(cur, database_id, 1)[0]
    cur.execute(
        """
        UPDATE sources SET deleted = false, lsn = %s
         WHERE database_id = %s AND collection = %s AND id = %s
        """,
        (lsn, database_id, collection, source_id),
    )
    cur.execute(
        """
        INSERT INTO wal_entries (database_id, lsn, kind, collection, source_id, created_at)
        VALUES (%s, %s, 'restore', %s, %s, %s)
        """,
        (database_id, lsn, collection, source_id, textutil.now()),
    )
    return {
        "id": source_id,
        "version": row["version"],
        "lsn": lsn,
        "indexing_status": indexing_status(lsn, locked["indexed_lsn"]),
    }
