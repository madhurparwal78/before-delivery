"""Case studies: the catalogue order, the publish rule and the stored writes."""

import psycopg2

from . import fields
from .errors import ALREADY_DRAFT, ALREADY_PUBLISHED, SLUG_CONFLICT, ApiError

CATALOGUE_ORDER = "position ASC, slug ASC"

COLUMNS = (
    "id, slug, title, discipline, summary, challenge, approach, outcome, "
    "stack, year, featured, position, published, published_at, created_at, "
    "updated_at"
)

SUMMARY_REQUIRED = "Add a summary before publishing."
OUTCOME_REQUIRED = "Add an outcome before publishing."


def format_ordinal(number):
    """Ordinals and totals read as zero-padded strings of at least two digits."""
    return f"{number:02d}"


def publish_blockers(summary, outcome):
    """The one publish rule: a published case study needs both of these."""
    blockers = {}
    if not summary.strip():
        blockers["summary"] = SUMMARY_REQUIRED
    if not outcome.strip():
        blockers["outcome"] = OUTCOME_REQUIRED
    return blockers


def published_catalogue(cursor):
    """The one catalogue order, with each ordinal and the shared total."""
    cursor.execute(
        f"SELECT {COLUMNS} FROM case_studies WHERE published "
        f"ORDER BY {CATALOGUE_ORDER}"
    )
    rows = cursor.fetchall()
    total = len(rows)
    catalogue = []
    for index, row in enumerate(rows):
        entry = dict(row)
        entry["ordinal"] = format_ordinal(index + 1)
        entry["total"] = format_ordinal(total)
        entry["label"] = fields.DISCIPLINE_LABELS[entry["discipline"]]
        catalogue.append(entry)
    return catalogue


def neighbours(catalogue, index):
    """Neighbours wrap, so a single published case study is its own pair."""
    previous = catalogue[index - 1]
    following = catalogue[(index + 1) % len(catalogue)]
    return (
        {"slug": previous["slug"], "title": previous["title"]},
        {"slug": following["slug"], "title": following["title"]},
    )


def find_published(catalogue, slug):
    for index, entry in enumerate(catalogue):
        if entry["slug"] == slug:
            return index, entry
    return None, None


def filtered(catalogue, discipline):
    """A discipline filter keeps each ordinal from the full published set."""
    if discipline is None:
        return catalogue
    return [entry for entry in catalogue if entry["discipline"] == discipline]


def studio_rows(cursor):
    cursor.execute(
        f"SELECT {COLUMNS} FROM case_studies ORDER BY {CATALOGUE_ORDER}"
    )
    return [dict(row) for row in cursor.fetchall()]


def fetch(cursor, case_id):
    cursor.execute(f"SELECT {COLUMNS} FROM case_studies WHERE id = %s", (case_id,))
    row = cursor.fetchone()
    return dict(row) if row else None


def validate(payload, creating):
    """Check one create or edit body, naming every failing field at once."""
    accepted = fields.EDITABLE_FIELDS + (fields.CREATE_ONLY_FIELDS if creating else ())
    errors = {}
    values = {}

    for key in payload:
        if key not in accepted:
            errors[key] = fields.CANNOT_BE_SET

    for name in accepted:
        if name not in payload:
            if creating and name in fields.REQUIRED_ON_CREATE:
                errors[name] = fields.REQUIRED
            continue
        value, message = _check_field(name, payload[name])
        if message:
            errors[name] = message
        else:
            values[name] = value

    if not creating and not payload:
        errors["body"] = fields.EMPTY_EDIT

    return values, errors


def _check_field(name, value):
    if name == "slug":
        return fields.check_slug(value)
    if name == "discipline":
        return fields.check_choice(
            value, fields.DISCIPLINES, fields.DISCIPLINE_CHOICE
        )
    if name == "featured":
        return fields.check_boolean(value)
    if name in fields.CASE_STUDY_NUMBER_LIMITS:
        return fields.check_integer(value, *fields.CASE_STUDY_NUMBER_LIMITS[name])
    minimum, maximum = fields.CASE_STUDY_TEXT_LIMITS[name]
    return fields.check_text(value, minimum, maximum, required=minimum > 0)


def create(cursor, values):
    stored = {name: "" for name in fields.CASE_STUDY_TEXT_LIMITS if name != "slug"}
    stored["featured"] = False
    stored.update(values)
    try:
        cursor.execute(
            f"""
            INSERT INTO case_studies (
                slug, title, discipline, summary, challenge, approach, outcome,
                stack, year, featured, position
            ) VALUES (
                %(slug)s, %(title)s, %(discipline)s, %(summary)s, %(challenge)s,
                %(approach)s, %(outcome)s, %(stack)s, %(year)s, %(featured)s,
                %(position)s
            ) RETURNING {COLUMNS}
            """,
            stored,
        )
    except psycopg2.errors.UniqueViolation as error:
        raise ApiError(409, SLUG_CONFLICT) from error
    return dict(cursor.fetchone())


def edit(cursor, case_id, values):
    assignments = ", ".join(f"{name} = %({name})s" for name in values)
    cursor.execute(
        f"UPDATE case_studies SET {assignments}, updated_at = now() "
        f"WHERE id = %(id)s RETURNING {COLUMNS}",
        {**values, "id": case_id},
    )
    return dict(cursor.fetchone())


def set_published(cursor, case_id, published):
    """Flip one case study's state, guarded so exactly one writer wins."""
    cursor.execute(
        f"""
        UPDATE case_studies
           SET published = %s,
               published_at = CASE WHEN %s THEN now() END,
               updated_at = now()
         WHERE id = %s AND published = %s
        RETURNING {COLUMNS}
        """,
        (published, published, case_id, not published),
    )
    row = cursor.fetchone()
    if row is None:
        raise ApiError(409, ALREADY_PUBLISHED if published else ALREADY_DRAFT)
    return dict(row)


def delete(cursor, case_id):
    cursor.execute("DELETE FROM case_studies WHERE id = %s RETURNING id", (case_id,))
    return cursor.fetchone() is not None
