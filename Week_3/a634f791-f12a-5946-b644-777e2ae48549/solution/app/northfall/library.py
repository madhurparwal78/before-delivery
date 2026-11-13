"""The rules of the reference programme, each decided here once and used by every surface.

Queries that read references alias `reference_entry` as `r`, so `LIVE` reads the same everywhere.
"""
import hashlib
import hmac
import re
import secrets
import unicodedata
from datetime import date, datetime, timedelta

from psycopg import sql

from .clock import now, published_form, today
from .copy import ENGLISH
from .store import lock_programme

SERVED_PROGRAMME = "northfall"
REPLY_TO = "hello@example.com"

# The live set: published, and the clearance window contains today (both ends inclusive). Takes %(today)s.
LIVE = "coalesce(r.published AND r.clearance_from <= %(today)s AND %(today)s <= r.clearance_until, false)"


def is_clean_text(value):
    """A string Postgres can store: no NUL, no lone surrogate."""
    if not isinstance(value, str) or "\0" in value:
        return False
    try:
        value.encode()
    except UnicodeEncodeError:
        return False
    return True


# ---------------------------------------------------------------- the reference state

def reference_state(row):
    """draft, live, withheld or retired, from a row selected with `LIVE AS live`."""
    if row["live"]:
        return "live"
    if row["published"]:
        return "withheld"
    return "retired" if row["retired_at"] else "draft"


# ---------------------------------------------------------------- the ordinal run

def write_run(conn, programme_id, run):
    """Store `run` (reference ids in display order) as ordinals 1..n; every other reference has none."""
    conn.execute("UPDATE reference_entry SET ordinal = NULL"
                 " WHERE programme_id = %s AND ordinal IS NOT NULL AND NOT (id = ANY(%s))", (programme_id, run))
    conn.execute("UPDATE reference_entry r SET ordinal = run.ordinal"
                 " FROM unnest(%s::integer[]) WITH ORDINALITY AS run (id, ordinal)"
                 " WHERE r.id = run.id AND r.ordinal IS DISTINCT FROM run.ordinal", (run,))


def settle_run(conn, programme_id):
    """Match the stored run to today's live set: leavers drop out, stayers close up in order,
    joiners go last by `clearance_from` then slug. The caller holds the programme lock."""
    rows = conn.execute(
        f"SELECT r.id FROM reference_entry r WHERE r.programme_id = %(programme)s AND {LIVE}"
        ' ORDER BY r.ordinal NULLS LAST, r.clearance_from, r.slug COLLATE "C"',
        {"programme": programme_id, "today": today(conn)}).fetchall()
    write_run(conn, programme_id, [row["id"] for row in rows])


def settle_every_run(conn):
    """Before a request is answered, settle the run of every programme whose live set has changed with the date."""
    stale = conn.execute(
        f"SELECT DISTINCT r.programme_id FROM reference_entry r WHERE (r.ordinal IS NOT NULL) <> {LIVE}"
        " ORDER BY r.programme_id", {"today": today(conn)}).fetchall()
    for row in stale:
        with conn.transaction():
            lock_programme(conn, row["programme_id"])
            settle_run(conn, row["programme_id"])


def move_in_run(conn, programme_id, reference_id, ordinal):
    """Place one live reference at `ordinal` (past the end means last) and return the new run."""
    run = [row["id"] for row in conn.execute(
        "SELECT r.id FROM reference_entry r WHERE r.programme_id = %s AND r.ordinal IS NOT NULL ORDER BY r.ordinal",
        (programme_id,))]
    run.remove(reference_id)
    run.insert(min(ordinal, len(run) + 1) - 1, reference_id)
    write_run(conn, programme_id, run)
    return conn.execute("SELECT slug, ordinal FROM reference_entry WHERE programme_id = %s AND ordinal IS NOT NULL"
                        " ORDER BY ordinal", (programme_id,)).fetchall()


# ---------------------------------------------------------------- public reads

def served_programme(conn):
    """The programme served at the public origin."""
    return conn.execute("SELECT programme.id, programme.name FROM programme WHERE programme.slug = %s",
                        (SERVED_PROGRAMME,)).fetchone()


def live_rows(conn, programme_id, sector=None):
    """The live references in display order, each with its headline figure (position 1); `sector` matches exactly."""
    rows = conn.execute(
        f"SELECT r.slug, r.ordinal, r.sector, r.title, r.title_fi, f.label, f.value"
        f" FROM reference_entry r JOIN figure f ON f.reference_id = r.id AND f.position = 1"
        f" WHERE r.programme_id = %(programme)s AND {LIVE} ORDER BY r.ordinal",
        {"programme": programme_id, "today": today(conn)}).fetchall()
    return [row for row in rows if sector is None or row["sector"] == sector]


def localised_title(row, finnish):
    return row["title_fi"] if finnish and row["title_fi"] else row["title"]


def index_entry(row, finnish):
    return {"slug": row["slug"], "ordinal": row["ordinal"], "sector": row["sector"],
            "title": localised_title(row, finnish), "result": {"label": row["label"], "value": row["value"]}}


def live_sectors(conn, programme_id):
    return sorted({row["sector"] for row in live_rows(conn, programme_id)})


def find_public_reference(conn, programme_id, slug, preview_token):
    """Resolve a public detail address to ("live" | "preview", row), ("moved", current slug) or (None, None).

    A live reference ignores the preview token; a valid token opens only its own unpublished reference;
    an earlier slug redirects only while the reference is live; everything else is not found.
    """
    params = {"programme": programme_id, "slug": slug, "today": today(conn), "token": preview_token, "now": now(conn)}
    row = conn.execute(f"SELECT r.* FROM reference_entry r WHERE r.programme_id = %(programme)s"
                       f" AND %(slug)s = r.slug AND {LIVE}", params).fetchone()
    if row:
        return "live", row
    if preview_token:
        row = conn.execute(
            "SELECT r.* FROM preview_link p JOIN reference_entry r ON r.id = p.reference_id"
            " WHERE p.token = %(token)s AND r.programme_id = %(programme)s AND %(slug)s = r.slug AND NOT r.published"
            " AND p.expires_at >= %(now)s", params).fetchone()
        if row:
            return "preview", row
    row = conn.execute(f"SELECT r.slug FROM slug_redirect s JOIN reference_entry r ON r.id = s.reference_id"
                       f" WHERE s.programme_id = %(programme)s AND s.slug = %(slug)s AND {LIVE}", params).fetchone()
    if row:
        return "moved", row["slug"]
    return None, None


def figures_of(conn, reference_id):
    return conn.execute("SELECT label, value FROM figure WHERE reference_id = %s ORDER BY figure.position",
                        (reference_id,)).fetchall()


def reference_detail(conn, row, finnish=False):
    """The public detail of one reference; the Finnish read adds `translated` and `body`."""
    detail = {
        "slug": row["slug"], "ordinal": row["ordinal"], "sector": row["sector"], "customer": row["customer"],
        "title": localised_title(row, finnish), "summary": row["summary"], "challenge": row["challenge"],
        "work": row["work"], "figures": figures_of(conn, row["id"]),
        "quote": ({"text": row["quote"], "speaker": row["quote_speaker"], "role": row["quote_role"]}
                  if row["quote"] else None),
    }
    if finnish:
        detail["translated"] = bool(row["body_fi"])
        detail["body"] = row["body_fi"]
    return detail


def first_live_quote(conn, programme_id):
    return conn.execute(f"SELECT r.quote, r.quote_speaker, r.quote_role FROM reference_entry r"
                        f" WHERE r.programme_id = %(programme)s AND {LIVE} AND r.quote IS NOT NULL"
                        f" ORDER BY r.ordinal LIMIT 1", {"programme": programme_id, "today": today(conn)}).fetchone()


def dated_notes(conn, programme_id):
    rows = conn.execute("SELECT slug, title, preview, published_on FROM note"
                        " WHERE programme_id = %s AND published_on IS NOT NULL"
                        " ORDER BY published_on DESC, slug", (programme_id,)).fetchall()
    return [{**row, "published_on": row["published_on"].isoformat()} for row in rows]


# ---------------------------------------------------------------- the desk's reads

# Finnish alphabetical order: other characters by code point, then a to z, then å, ä, ö, ignoring case.
FINNISH_LETTERS = {letter: 1 + position for position, letter in enumerate("abcdefghijklmnopqrstuvwxyzåäö")}


def finnish_order(row):
    title = unicodedata.normalize("NFC", row["title"]).lower()
    return [(FINNISH_LETTERS[letter], 0) if letter in FINNISH_LETTERS else (0, ord(letter)) for letter in title], row["slug"]


def desk_rows(conn, programme_id):
    """Every reference of one programme: live first by ordinal, then the rest in Finnish order."""
    rows = conn.execute(f"SELECT r.*, {LIVE} AS live FROM reference_entry r WHERE r.programme_id = %(programme)s",
                        {"programme": programme_id, "today": today(conn)}).fetchall()
    run = sorted((row for row in rows if row["ordinal"] is not None), key=lambda row: row["ordinal"])
    return run + sorted((row for row in rows if row["ordinal"] is None), key=finnish_order)


def desk_row(conn, programme_id, slug):
    return conn.execute(f"SELECT r.*, {LIVE} AS live FROM reference_entry r"
                        f" WHERE r.programme_id = %(programme)s AND r.slug = %(slug)s",
                        {"programme": programme_id, "slug": slug, "today": today(conn)}).fetchone()


def open_enquiries(conn, programme_id):
    rows = conn.execute("SELECT id, email, phone, reference, created_at, agreed FROM enquiry"
                        " WHERE programme_id = %s AND open ORDER BY created_at DESC, id DESC",
                        (programme_id,)).fetchall()
    return [row | {"created_at": published_form(row["created_at"])} for row in rows]


# ---------------------------------------------------------------- slugs

LETTER_FOLDS = str.maketrans({"ä": "a", "å": "a", "ö": "o"})


def slugify(title):
    """The slug of a title; empty when the title holds nothing to make one from."""
    folded = unicodedata.normalize("NFC", title).lower().translate(LETTER_FOLDS)
    return re.sub(r"[^0-9a-z]+", "-", folded).strip("-")


def claim_slug(conn, programme_id, title, reference_id=None):
    """The slug for `title`, unique across the programme's current and earlier slugs, with the lowest free suffix.

    A reference may take back one of its own earlier slugs, and keeps its current slug when the title still yields it.
    """
    wanted = slugify(title)
    own_earlier = {row["slug"] for row in conn.execute("SELECT s.slug FROM slug_redirect s WHERE s.reference_id = %s",
                                                       (reference_id,))}
    if wanted in own_earlier:
        return wanted
    taken = {row["slug"] for row in conn.execute(
        "SELECT r.slug FROM reference_entry r WHERE r.programme_id = %(programme)s AND r.id IS DISTINCT FROM %(reference)s"
        " UNION SELECT s.slug FROM slug_redirect s WHERE s.programme_id = %(programme)s",
        {"programme": programme_id, "reference": reference_id})}
    slug, suffix = wanted, 2
    while slug in taken:
        slug, suffix = f"{wanted}-{suffix}", suffix + 1
    return slug


def rename(conn, reference, new_slug):
    """Move a reference to `new_slug`, keeping its current slug as an earlier address."""
    conn.execute("DELETE FROM slug_redirect WHERE reference_id = %s AND slug = %s", (reference["id"], new_slug))
    conn.execute("INSERT INTO slug_redirect (programme_id, slug, reference_id) VALUES (%s, %s, %s)",
                 (reference["programme_id"], reference["slug"], reference["id"]))
    conn.execute("UPDATE reference_entry SET slug = %s WHERE id = %s", (new_slug, reference["id"]))


# ---------------------------------------------------------------- editable fields

def _title(value):
    return is_clean_text(value) and 1 <= len(unicodedata.normalize("NFC", value)) <= 120 and bool(slugify(value))


def _customer(value):
    return is_clean_text(value) and 1 <= len(value) <= 120


def _prose(value):
    return is_clean_text(value) and value != ""


def _sector(value):
    return is_clean_text(value) and re.fullmatch(r"[a-z][a-z-]{0,39}", value) is not None


def _figures(value):
    return (isinstance(value, list) and 1 <= len(value) <= 6
            and all(isinstance(figure, dict) and _prose(figure.get("label")) and _prose(figure.get("value"))
                    for figure in value))


def _text_or_null(value):
    return value is None or is_clean_text(value)


# Field name -> (check, message). These are the only keys a create or edit writes.
EDITABLE_FIELDS = {
    "title": (_title, "Give a title of 1 to 120 characters holding at least one letter or digit"),
    "summary": (_prose, "Write the summary"),
    "challenge": (_prose, "Write the challenge"),
    "work": (_prose, "Write the work"),
    "sector": (_sector, "Use 1 to 40 lowercase letters and hyphens, starting with a letter"),
    "customer": (_customer, "Give the customer's name in 1 to 120 characters"),
    "figures": (_figures, "Give 1 to 6 figures, each with a label and a value"),
    "quote": (_text_or_null, "Write the quote as text, or leave it empty"),
    "quote_speaker": (_text_or_null, "Write the speaker as text, or leave it empty"),
    "quote_role": (_text_or_null, "Write the role as text, or leave it empty"),
    "title_fi": (_text_or_null, "Write the Finnish title as text, or leave it empty"),
    "body_fi": (_text_or_null, "Write the Finnish body as text, or leave it empty"),
}
REQUIRED_ON_CREATE = ("title", "sector", "customer", "summary", "challenge", "work")
EMPTY_MEANS_NULL = ("quote", "quote_speaker", "quote_role", "title_fi", "body_fi")
# The customer clears these together: changing any of them on a recorded window voids it.
CLEARED_CONTENT = ("customer", "quote", "quote_speaker", "quote_role", "figures")


def read_editable(body, creating):
    """Keep only the editable keys of `body`, checked and normalised; every other key is ignored. -> (fields, errors)"""
    fields = {key: body[key] for key in EDITABLE_FIELDS if key in body}
    errors = {key: EDITABLE_FIELDS[key][1] for key in REQUIRED_ON_CREATE if creating and key not in fields}
    errors |= {key: EDITABLE_FIELDS[key][1] for key, value in fields.items() if not EDITABLE_FIELDS[key][0](value)}
    if errors:
        return fields, errors
    if "title" in fields:
        fields["title"] = unicodedata.normalize("NFC", fields["title"])
    if "figures" in fields:
        fields["figures"] = [{"label": figure["label"], "value": figure["value"]} for figure in fields["figures"]]
    for key in EMPTY_MEANS_NULL:
        if fields.get(key) == "":
            fields[key] = None
    return fields, {}


def _replace_figures(conn, reference_id, figures):
    conn.execute("DELETE FROM figure WHERE reference_id = %s", (reference_id,))
    for position, figure in enumerate(figures, start=1):
        conn.execute("INSERT INTO figure (reference_id, label, value, position) VALUES (%s, %s, %s, %s)",
                     (reference_id, figure["label"], figure["value"], position))


def create_draft(conn, programme_id, fields):
    """Write a new unpublished draft and return its slug."""
    figures = fields.pop("figures", [])
    fields["slug"] = claim_slug(conn, programme_id, fields["title"])
    columns = ["programme_id", *fields]
    reference_id = conn.execute(
        sql.SQL("INSERT INTO reference_entry ({}) VALUES ({}) RETURNING id").format(
            sql.SQL(", ").join(map(sql.Identifier, columns)), sql.SQL(", ").join(sql.Placeholder() * len(columns))),
        [programme_id, *fields.values()]).fetchone()["id"]
    _replace_figures(conn, reference_id, figures)
    return fields["slug"]


def edit_reference(conn, reference, fields):
    """Apply an edit. Only real changes are written: a change counts one version, and a change to the
    cleared content voids a recorded window in the same transaction. -> (slug, version, clearance_voided)"""
    stored = dict(reference) | {"figures": figures_of(conn, reference["id"])}
    changes = {key: value for key, value in fields.items() if value != stored[key]}
    if not changes:
        return reference["slug"], reference["version"], False
    voided = reference["clearance_from"] is not None and any(key in changes for key in CLEARED_CONTENT)
    if "figures" in changes:
        _replace_figures(conn, reference["id"], changes.pop("figures"))
    if voided:
        changes |= {"clearance_from": None, "clearance_until": None}
    slug = reference["slug"]
    if "title" in changes:
        slug = claim_slug(conn, reference["programme_id"], changes["title"], reference["id"])
        if slug != reference["slug"]:
            rename(conn, reference, slug)
    changes["version"] = reference["version"] + 1
    conn.execute(sql.SQL("UPDATE reference_entry SET {} WHERE id = %s").format(
        sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(key)) for key in changes)),
        [*changes.values(), reference["id"]])
    return slug, changes["version"], voided


# ---------------------------------------------------------------- versions

def matches_version(if_match, version):
    """`If-Match` against a reference's version: `*` matches any; no header makes no check; anything else must be `"<n>"`."""
    return if_match is None or if_match.strip() in ("*", f'"{version}"')


# ---------------------------------------------------------------- clearance windows

WINDOW_KEYS = ("clearance_from", "clearance_until")


def read_clearance_window(body):
    """Two real YYYY-MM-DD dates with from <= until. -> ({key: date}, errors)"""
    window, errors = {}, {}
    for key in WINDOW_KEYS:
        value = body.get(key)
        try:
            if not (isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value)):
                raise ValueError(value)
            window[key] = date.fromisoformat(value)
        except ValueError:
            errors[key] = "Enter a real date as YYYY-MM-DD"
    if not errors and window["clearance_from"] > window["clearance_until"]:
        errors["clearance_until"] = "End the window on or after its first day"
    return window, errors


def record_clearance_window(conn, reference, window):
    if (reference["clearance_from"], reference["clearance_until"]) == (window["clearance_from"], window["clearance_until"]):
        return
    conn.execute("UPDATE reference_entry SET clearance_from = %s, clearance_until = %s, version = version + 1"
                 " WHERE id = %s", (window["clearance_from"], window["clearance_until"], reference["id"]))


# ---------------------------------------------------------------- publication

ALREADY_PUBLISHED = "This reference is already published"


def publication_refusal(conn, reference):
    """Why this reference may not be published now, in the published order; None when it may."""
    if reference["published"]:
        return ALREADY_PUBLISHED
    if reference["clearance_from"] is None:
        return "Record a clearance window before publishing"
    if reference["clearance_until"] < today(conn):
        return "The clearance window has ended"
    if not figures_of(conn, reference["id"]):
        return "Add at least one result figure before publishing"
    return None


def publish(conn, reference):
    conn.execute("UPDATE reference_entry SET published = true, retired_at = NULL, version = version + 1 WHERE id = %s",
                 (reference["id"],))
    retire_preview_links(conn, reference["id"])


def retire(conn, reference):
    conn.execute("UPDATE reference_entry SET published = false, retired_at = %s, version = version + 1 WHERE id = %s",
                 (now(conn), reference["id"]))
    retire_preview_links(conn, reference["id"])


# ---------------------------------------------------------------- preview links

PREVIEW_DEFAULT = timedelta(seconds=604_800)
PREVIEW_LONGEST = timedelta(seconds=2_592_000)
EXPIRY_FORM = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|[+-][0-9]{2}:[0-9]{2})")


def read_preview_expiry(conn, body):
    """The expiry the desk asked for, or the default. -> (expires_at, error message or None)"""
    minted_at = now(conn)
    if "expires_at" not in body:
        return minted_at + PREVIEW_DEFAULT, None
    requested = body["expires_at"]
    try:
        if not (isinstance(requested, str) and EXPIRY_FORM.fullmatch(requested)):
            raise ValueError(requested)
        expires_at = datetime.fromisoformat(requested)
        if minted_at < expires_at <= minted_at + PREVIEW_LONGEST:
            return expires_at, None
    except (ValueError, OverflowError):
        return None, "Give the expiry as YYYY-MM-DDThh:mm:ss with Z or an offset"
    return None, "Choose an expiry after now and at most 30 days ahead"


def mint_preview_link(conn, reference, expires_at):
    """A fresh opaque token for one unpublished reference; every earlier link for it is retired."""
    token = secrets.token_urlsafe(32)
    while reference["slug"] in token:
        token = secrets.token_urlsafe(32)
    retire_preview_links(conn, reference["id"])
    conn.execute("INSERT INTO preview_link (token, reference_id, expires_at) VALUES (%s, %s, %s)",
                 (token, reference["id"], expires_at))
    return token


def retire_preview_links(conn, reference_id):
    conn.execute("DELETE FROM preview_link WHERE reference_id = %s", (reference_id,))


# ---------------------------------------------------------------- enquiries

EMAIL_SHAPE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
ENQUIRY_MESSAGES = ENGLISH["errors"]


def _is_live_slug(conn, programme_id, slug):
    return any(row["slug"] == slug for row in live_rows(conn, programme_id))


def read_enquiry(conn, programme_id, body):
    """-> (enquiry fields, errors keyed by field, every failing field at once)"""
    email, reference = body.get("email"), body.get("reference")
    failing = []
    if not (is_clean_text(email) and len(email.strip(" ")) <= 254 and EMAIL_SHAPE.fullmatch(email.strip(" "))):
        failing.append("email")
    if body.get("agreed") is not True:
        failing.append("agreed")
    if "phone" in body and not (is_clean_text(body["phone"]) and len(body["phone"]) >= 10):
        failing.append("phone")
    if reference not in (None, "") and not (is_clean_text(reference) and _is_live_slug(conn, programme_id, reference)):
        failing.append("reference")
    if failing:
        return None, {field: ENQUIRY_MESSAGES[field] for field in failing}
    return {"email": email.strip(" "), "phone": body.get("phone"), "reference": reference or None}, {}


def record_enquiry(conn, programme_id, enquiry):
    """The id of the open enquiry from this address, writing one only when none is open."""
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(2, hashtext(%s || lower(%s)))", (str(programme_id), enquiry["email"]))
        open_one = conn.execute("SELECT id FROM enquiry WHERE programme_id = %s AND lower(email) = lower(%s) AND open",
                                (programme_id, enquiry["email"])).fetchone()
        if open_one:
            return open_one["id"]
        return conn.execute(
            "INSERT INTO enquiry (programme_id, email, phone, reference, created_at, agreed)"
            " VALUES (%s, %s, %s, %s, %s, true) RETURNING id",
            (programme_id, enquiry["email"], enquiry["phone"], enquiry["reference"], now(conn))).fetchone()["id"]


# ---------------------------------------------------------------- desk accounts and sessions

SESSION_LENGTH = timedelta(seconds=28_800)
# Compared against when the address is unknown, so a miss costs the same as a wrong password.
UNKNOWN_ACCOUNT_HASH = ("pbkdf2_sha256$240000$13e6d1b58f7ceea64bdc3b31a61d4af3$"
                        "cc499f6238d47fd1537ee4856cf7997dfd005702afd2ba52af04bb7ebc2809ff")


def password_matches(password, stored):
    _, iterations, salt, digest = stored.split("$")
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations)).hex()
    return hmac.compare_digest(candidate, digest)


def token_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def sign_in(conn, email, password):
    """A new bearer token, the account's role and its programme's slug, or None for any failure."""
    if not (is_clean_text(email) and is_clean_text(password)):
        return None
    account = conn.execute("SELECT a.id, a.role, a.password_hash, p.slug AS programme FROM account a"
                           " JOIN programme p ON p.id = a.programme_id WHERE lower(a.email) = lower(%s)",
                           (email.strip(" "),)).fetchone()
    if not password_matches(password, account["password_hash"] if account else UNKNOWN_ACCOUNT_HASH) or not account:
        return None
    token = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO desk_session (token_digest, account_id, signed_in_at) VALUES (%s, %s, %s)",
                 (token_digest(token), account["id"], now(conn)))
    return token, account["role"], account["programme"]


def session_account(conn, token):
    """The stored account behind a bearer token still within its session: its id, role and programme."""
    return conn.execute("SELECT a.id, a.role, a.programme_id FROM desk_session s JOIN account a ON a.id = s.account_id"
                        " WHERE s.token_digest = %s AND s.signed_in_at >= %s",
                        (token_digest(token), now(conn) - SESSION_LENGTH)).fetchone()
