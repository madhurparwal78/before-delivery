"""Feedback on an answered query, with its bounded body and rolling quota."""
import datetime
import json

from .. import textutil, validate
from ..errors import TesselError, validation_error

RATINGS = ("positive", "negative", "neutral")
SOURCES = ("user", "agent")
METADATA_ENTRIES = 20
METADATA_VALUE_LENGTH = 500
FEEDBACK_LENGTH = 8000
GROUND_TRUTH_IDS = 20
QUOTA = 100
WINDOW = datetime.timedelta(seconds=60)

SPEC = {
    "request_id": validate.ANY,
    "feedback": validate.ANY,
    "rating": validate.ANY,
    "source": validate.ANY,
    "ground_truth": {"answer": validate.ANY, "source_ids": ("list", validate.ANY)},
    "metadata": validate.ANY,
}


def validate_body(body):
    request_id = validate.string(body, "request_id", "request_id", 1, 200)
    rating = validate.choice(body, "rating", "rating", RATINGS, required=False)
    source = validate.choice(body, "source", "source", SOURCES, required=False, default="user")
    ground_truth = None
    if body.get("ground_truth") is not None:
        holder = body["ground_truth"]
        if not isinstance(holder, dict):
            raise validation_error("ground_truth", "This field must be an object")
        answer = validate.string(
            holder, "answer", "ground_truth.answer", 1, FEEDBACK_LENGTH
        )
        ids = validate.listed(
            holder, "source_ids", "ground_truth.source_ids", 1, GROUND_TRUTH_IDS
        )
        seen = set()
        for index, value in enumerate(ids):
            path = "ground_truth.source_ids.%d" % index
            validate.pattern(
                {"id": value},
                "id",
                path,
                validate.SOURCE_ID,
                "Write letters, digits, underscores or hyphens; 1 to 64 characters",
            )
            if value in seen:
                raise validation_error(path, "This source id is repeated")
            seen.add(value)
        ground_truth = {"answer": answer, "source_ids": ids}
    text = validate.string(
        body, "feedback", "feedback", 0, FEEDBACK_LENGTH, required=ground_truth is None
    )
    metadata = None
    if body.get("metadata") is not None:
        holder = body["metadata"]
        if not isinstance(holder, dict):
            raise validation_error("metadata", "This field must be an object")
        if len(holder) > METADATA_ENTRIES:
            raise validation_error(
                "metadata", "Send at most %d entries" % METADATA_ENTRIES
            )
        for key, value in holder.items():
            path = "metadata.%s" % key
            if not validate.METADATA_KEY.match(key):
                raise validation_error(
                    path, "Write letters, digits, underscores or hyphens; 1 to 64 characters"
                )
            if not isinstance(value, str):
                raise validation_error(path, "This field must be a string")
            if textutil.length(value) > METADATA_VALUE_LENGTH:
                raise validation_error(
                    path, "Write at most %d characters" % METADATA_VALUE_LENGTH
                )
        metadata = holder
    return request_id, text, rating, source, ground_truth, metadata


def store(cur, organization_id, request_id, text, rating, source, ground_truth, metadata):
    """Record feedback naming a query of this organization, under the quota."""
    known = cur.value(
        """
        SELECT 1 FROM query_records q JOIN databases d ON d.id = q.database_id
         WHERE q.request_id = %s AND q.organization_id = %s
        """,
        (request_id, organization_id),
    )
    if not known:
        raise TesselError("REQUEST_NOT_FOUND")
    since = textutil.now() - WINDOW
    rows = cur.all(
        """
        SELECT created_at FROM feedback
         WHERE organization_id = %s AND created_at > %s ORDER BY created_at
        """,
        (organization_id, since),
    )
    if len(rows) >= QUOTA:
        oldest = rows[-QUOTA]["created_at"]
        remaining = (oldest + WINDOW - textutil.now()).total_seconds()
        seconds = max(1, min(60, int(remaining) + 1))
        raise TesselError(
            "RATE_LIMITED", seconds=seconds, headers={"Retry-After": str(seconds)}
        )
    cur.execute(
        """
        INSERT INTO feedback (request_id, organization_id, rating, feedback, source,
                              ground_truth, metadata, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (request_id) DO UPDATE
           SET rating = excluded.rating, feedback = excluded.feedback,
               source = excluded.source, ground_truth = excluded.ground_truth,
               metadata = excluded.metadata, created_at = excluded.created_at
        """,
        (
            request_id,
            organization_id,
            rating,
            text,
            source,
            json.dumps(ground_truth, ensure_ascii=False) if ground_truth else None,
            json.dumps(metadata, ensure_ascii=False) if metadata else None,
            textutil.now(),
        ),
    )
    return {"request_id": request_id, "received": True}


def record_query(cur, request_id, organization_id, database_id):
    cur.execute(
        """
        INSERT INTO query_records (request_id, organization_id, database_id, created_at)
        VALUES (%s, %s, %s, %s)
        """,
        (request_id, organization_id, database_id, textutil.now()),
    )
