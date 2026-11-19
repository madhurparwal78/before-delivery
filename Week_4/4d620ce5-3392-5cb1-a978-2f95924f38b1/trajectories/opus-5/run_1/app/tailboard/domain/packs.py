"""Compliance packs: stored as content-addressed objects, emailed to the authority
once, and marked transmitted only when both have happened."""

import datetime

from .. import clock, mail, pdf, storage
from ..config import AUTHORITY_MAILBOX, OPERATOR_NAME, config
from ..errors import ApiError
from ..ids import new_id
from . import audit
from . import people as people_rules
from .directives import label_of, tag_of
from .exportcsv import COLUMNS, neutralise, render as render_csv, rows_for

RETRY_SECONDS = 10


def shape(row, people):
    return {
        "id": row["id"],
        "directive_id": row["directive_id"],
        "revision": tag_of(row["revision"]),
        "status": row["status"],
        "waiting_for": row["waiting_for"],
        "requested_by": people_rules.person(people.get(row["requested_by"])),
        "requested_at": clock.iso(row["requested_at"]),
        "transmitted_at": clock.iso(row["transmitted_at"]),
        "attempts": row["attempts"],
        "pdf_key": row["pdf_key"],
        "csv_key": row["csv_key"],
        "pdf_sha256": row["pdf_sha256"],
        "csv_sha256": row["csv_sha256"],
    }


def listed(cursor):
    people = people_rules.load_people(cursor)
    rows = cursor.all(
        "SELECT * FROM packs ORDER BY requested_at DESC, id DESC"
    )
    return [shape(row, people) for row in rows]


def load(cursor, pack_id):
    row = cursor.one("SELECT * FROM packs WHERE id = %s", (pack_id,))
    if row is None:
        raise ApiError("not_found", "No such pack.")
    return row


def render_documents(cursor, directive_id):
    directive, rows = rows_for(cursor, directive_id)
    csv_bytes = render_csv(cursor, directive_id)
    lines = [
        f"Compliance pack — {label_of(directive)} {tag_of(directive['current_revision'])}",
        f"Operator: {OPERATOR_NAME}",
        f"Directive: {label_of(directive)}",
        f"Revision: {tag_of(directive['current_revision'])}",
        f"Generated at: {clock.iso(clock.now())}",
        "",
        " | ".join(COLUMNS),
    ]
    for row in rows:
        lines.append(" | ".join(neutralise(row[column]) for column in COLUMNS))
    return pdf.render(lines), csv_bytes, directive


def request(cursor, user, directive_id, at):
    """Create the pack record, then attempt it at once."""
    existing = cursor.one(
        "SELECT id FROM packs WHERE directive_id = %s AND status = 'queued' FOR UPDATE",
        (directive_id,),
    )
    if existing:
        directive = cursor.one("SELECT authority, number FROM directives WHERE id = %s",
                               (directive_id,))
        raise ApiError(
            "pack_already_queued",
            f"A pack for {directive['authority']} {directive['number']} is already queued.",
            pack_id=existing["id"],
        )
    revision = cursor.value(
        "SELECT current_revision FROM directives WHERE id = %s", (directive_id,)
    )
    pack_id = new_id("pck")
    cursor.execute(
        """INSERT INTO packs (id, directive_id, revision, status, requested_by, requested_at,
                              next_attempt_at)
           VALUES (%s,%s,%s,'queued',%s,%s,%s)""",
        (pack_id, directive_id, revision, user["id"], at, at),
    )
    audit.write(cursor, at, user["id"], "pack.requested", directive_id, None,
                f"Compliance pack {pack_id} requested")
    return pack_id


def attempt(cursor, pack_id, actor_id):
    """One attempt: render, store both objects, send the email, then mark transmitted.

    If storing fails nothing is kept. If sending fails both objects are deleted.
    """
    row = cursor.one(
        "SELECT * FROM packs WHERE id = %s AND status = 'queued' FOR UPDATE", (pack_id,)
    )
    if row is None:
        return None
    pdf_bytes, csv_bytes, directive = render_documents(cursor, row["directive_id"])
    cursor.execute(
        "UPDATE packs SET attempts = attempts + 1, next_attempt_at = %s WHERE id = %s",
        (clock.now() + datetime.timedelta(seconds=RETRY_SECONDS), pack_id),
    )
    label = label_of(directive)
    tag = tag_of(row["revision"])

    pdf_digest = storage.sha256_hex(pdf_bytes)
    csv_digest = storage.sha256_hex(csv_bytes)
    pdf_key = storage.pack_key(pdf_digest, "pdf")
    csv_key = storage.pack_key(csv_digest, "csv")
    try:
        storage.put(pdf_key, pdf_bytes, "application/pdf")
        storage.put(csv_key, csv_bytes, "text/csv")
    except ApiError:
        cursor.execute(
            "UPDATE packs SET waiting_for = 'object_storage' WHERE id = %s", (pack_id,)
        )
        return "object_storage"

    body = "\n".join(
        [
            f"Compliance pack {pack_id} for {label} {tag}.",
            f"Operator: {OPERATOR_NAME}",
            f"Pack: {config.public_url.rstrip('/')}/api/packs/{pack_id}/pdf",
            f"PDF SHA-256: {pdf_digest}",
            f"CSV SHA-256: {csv_digest}",
        ]
    )
    try:
        mail.send(
            AUTHORITY_MAILBOX,
            f"Compliance pack {label} {tag} from {OPERATOR_NAME}",
            body,
            attachment=(f"{pack_id}-manifest.csv", csv_bytes),
        )
    except mail.MailUnavailable:
        _delete_unreferenced(cursor, pack_id, [pdf_key, csv_key])
        cursor.execute("UPDATE packs SET waiting_for = 'mail' WHERE id = %s", (pack_id,))
        return "mail"

    at = clock.now()
    cursor.execute(
        """UPDATE packs SET status = 'transmitted', waiting_for = NULL, transmitted_at = %s,
               pdf_key = %s, csv_key = %s, pdf_sha256 = %s, csv_sha256 = %s,
               next_attempt_at = NULL
            WHERE id = %s AND status = 'queued'""",
        (at, pdf_key, csv_key, pdf_digest, csv_digest, pack_id),
    )
    audit.write(cursor, at, actor_id, "pack.transmitted", row["directive_id"], None,
                f"Compliance pack {pack_id} transmitted to {AUTHORITY_MAILBOX}")
    return None


def _delete_unreferenced(cursor, pack_id, keys):
    """Deleting a pack object never removes an object another pack record references."""
    for key in keys:
        referenced = cursor.value(
            "SELECT 1 FROM packs WHERE id <> %s AND (pdf_key = %s OR csv_key = %s) LIMIT 1",
            (pack_id, key, key),
        )
        if not referenced:
            try:
                storage.delete(key)
            except ApiError:
                pass


def rerender(cursor, pack_id):
    """Re-render a stored pack after an erasure, under new content-addressed keys."""
    row = cursor.one("SELECT * FROM packs WHERE id = %s FOR UPDATE", (pack_id,))
    if row is None or not row["rerender_needed"]:
        return True
    pdf_bytes, csv_bytes, _directive = render_documents(cursor, row["directive_id"])
    old_keys = [row["pdf_key"], row["csv_key"]]
    pdf_digest = storage.sha256_hex(pdf_bytes)
    csv_digest = storage.sha256_hex(csv_bytes)
    pdf_key = storage.pack_key(pdf_digest, "pdf")
    csv_key = storage.pack_key(csv_digest, "csv")
    try:
        storage.put(pdf_key, pdf_bytes, "application/pdf")
        storage.put(csv_key, csv_bytes, "text/csv")
    except ApiError:
        return False
    cursor.execute(
        """UPDATE packs SET pdf_key = %s, csv_key = %s, pdf_sha256 = %s, csv_sha256 = %s,
               rerender_needed = false WHERE id = %s""",
        (pdf_key, csv_key, pdf_digest, csv_digest, pack_id),
    )
    _delete_unreferenced(
        cursor, pack_id, [key for key in old_keys if key not in (pdf_key, csv_key)]
    )
    return True


def download(row, kind):
    if row["status"] != "transmitted":
        raise ApiError("pack_not_transmitted")
    key = row["pdf_key"] if kind == "pdf" else row["csv_key"]
    data = storage.get(key)
    if data is None:
        raise storage.unavailable()
    return data, "application/pdf" if kind == "pdf" else "text/csv; charset=utf-8"
