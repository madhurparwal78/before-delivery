"""The JSON API: routing, sessions and every record that is not a scan."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import uuid
from typing import Any, Callable

from . import db, errors, records, scans_api, storage, validate, web
from .config import CONFIG
from .copy import FIELD_COPY
from .domain import alignment as align
from .domain.rounding import round_half_away
from .validate import Fields
from .web import Request, Response, json_response

UUID_PATTERN = r"[0-9a-fA-F-]{36}"


def dispatch(request: Request, host: str | None) -> Response:
    """Routing with the published error precedence."""
    if request.method in web.STATE_CHANGING and not web.same_origin(request, host):
        raise errors.cross_origin()
    for pattern, method, handler, public in ROUTES:
        match = pattern.fullmatch(request.path)
        if not match:
            continue
        if method != request.method:
            continue
        if not public:
            request.account = web.session_account(request.session_token)
            if request.account is None:
                raise errors.unauthenticated()
        return handler(request, *match.groups())
    raise errors.not_found()


def account_id(request: Request) -> str:
    assert request.account is not None
    return str(request.account["id"])


def require_view(request: Request, roll_id: str) -> records.RollView:
    view = records.load_view(account_id(request), roll_id)
    if view is None:
        raise errors.not_found()
    return view


def require_entry(request: Request, entry_id: str) -> tuple[dict[str, Any], records.RollView]:
    row = db.fetch_one(
        """
        SELECT e.* FROM entries e
        JOIN rolls r ON r.id = e.roll_id
        WHERE e.id = %s AND r.account_id = %s
        """,
        (entry_id, account_id(request)),
    )
    if row is None:
        raise errors.not_found()
    return row, require_view(request, str(row["roll_id"]))


# --- health and storage ------------------------------------------------------


def health(request: Request) -> Response:
    del request
    if not db.ready():
        return json_response(503, {"status": "starting"})
    return json_response(200, {"status": "ok"})


def storage_state(request: Request) -> Response:
    del request
    return json_response(
        200, {"storage": "ok" if storage.available() else "unavailable"}
    )


# --- accounts and sessions ---------------------------------------------------


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def password_matches(stored: str, password: str) -> bool:
    _, salt_hex, digest_hex = stored.split("$")
    digest = hashlib.scrypt(
        password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1
    )
    return secrets.compare_digest(digest.hex(), digest_hex)


def _session_cookie(token: str) -> tuple[str, str]:
    return (
        "Set-Cookie",
        f"{web.SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; "
        f"Max-Age={CONFIG.session_ttl_seconds}",
    )


def _start_session(account_id_value: str) -> str:
    token = secrets.token_urlsafe(32)
    db.execute(
        """
        INSERT INTO sessions (token, account_id, expires_at)
        VALUES (%s, %s, now() + make_interval(secs => %s))
        """,
        (token, account_id_value, CONFIG.session_ttl_seconds),
    )
    return token


def signup(request: Request) -> Response:
    body = request.json_body()
    fields = Fields()
    email = validate.email(fields, body)
    password = validate.password(fields, body)
    if not fields.ok():
        raise errors.validation_failed(fields.errors)
    assert email is not None and password is not None
    if db.fetch_one("SELECT id FROM accounts WHERE email = %s", (email,)):
        raise errors.conflict("email_taken")
    new_id = str(uuid.uuid4())
    db.execute(
        "INSERT INTO accounts (id, email, password_hash) VALUES (%s, %s, %s)",
        (new_id, email, hash_password(password)),
    )
    token = _start_session(new_id)
    return json_response(
        201, {"id": new_id, "email": email}, headers=[_session_cookie(token)]
    )


def signin(request: Request) -> Response:
    body = request.json_body()
    email = (body.get("email") or "").strip().lower() if isinstance(body.get("email"), str) else ""
    password = body.get("password") if isinstance(body.get("password"), str) else ""
    account = db.fetch_one(
        "SELECT id, email, password_hash FROM accounts WHERE email = %s", (email,)
    )
    if account is None or not password or not password_matches(
        account["password_hash"], password
    ):
        raise errors.ApiError(401, "invalid_credentials")
    token = _start_session(str(account["id"]))
    return json_response(
        200,
        {"id": str(account["id"]), "email": account["email"]},
        headers=[_session_cookie(token)],
    )


def signout(request: Request) -> Response:
    if request.session_token:
        db.execute("DELETE FROM sessions WHERE token = %s", (request.session_token,))
    return Response(
        status=204,
        body=b"",
        headers=[
            (
                "Set-Cookie",
                f"{web.SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
            )
        ],
    )


def me(request: Request) -> Response:
    assert request.account is not None
    return json_response(
        200,
        {
            "id": account_id(request),
            "email": request.account["email"],
            "latest_aligned_frame": records.latest_aligned_frame(account_id(request)),
        },
    )


# --- rolls -------------------------------------------------------------------


def list_rolls(request: Request) -> Response:
    rows = db.fetch_all(
        "SELECT id FROM rolls WHERE account_id = %s ORDER BY created_at DESC, id DESC",
        (account_id(request),),
    )
    rolls = []
    for row in rows:
        view = records.load_view(account_id(request), str(row["id"]))
        if view is not None:
            rolls.append(records.serialise_roll(view))
    return json_response(200, {"rolls": rolls})


def _curve_roll_id(
    request: Request, fields: Fields, body: dict[str, Any], kind: str, default: Any
) -> str | None:
    value = body.get("curve_roll_id", default)
    if value is None:
        return None
    if not isinstance(value, str):
        fields.fail("curve_roll_id")
        return None
    if not _looks_like_uuid(value):
        raise errors.not_found()
    row = db.fetch_one(
        "SELECT id, kind FROM rolls WHERE id = %s AND account_id = %s",
        (value, account_id(request)),
    )
    if row is None:
        raise errors.not_found()
    if kind == "test" or row["kind"] != "test":
        fields.fail("curve_roll_id")
        return None
    return str(row["id"])


def _looks_like_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True


def create_roll(request: Request) -> Response:
    body = request.json_body()
    fields = Fields()
    name = validate.text(fields, body, "name", maximum=validate.MAX_NAME, minimum=1)
    stock = validate.text(fields, body, "stock", maximum=validate.MAX_STOCK, minimum=1)
    roll_format = validate.choice(fields, body, "format", validate.FORMATS)
    ei = validate.whole_number(fields, body, "ei", low=6, high=12800)
    push_pull = validate.whole_number(fields, body, "push_pull", low=-3, high=3, default=0)
    reciprocity_p = validate.reciprocity_exponent(fields, body, default=1.00)
    development_note = validate.note_text(
        fields, body, "development_note", validate.MAX_NOTE
    )
    kind = validate.choice(fields, body, "kind", validate.KINDS, default="normal")
    curve_roll_id = _curve_roll_id(request, fields, body, kind or "normal", None)
    if not fields.ok():
        raise errors.validation_failed(fields.errors)
    new_id = str(uuid.uuid4())
    db.execute(
        """
        INSERT INTO rolls (id, account_id, name, stock, format, ei, push_pull,
                           reciprocity_p, development_note, kind, curve_roll_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            new_id,
            account_id(request),
            name,
            stock,
            roll_format,
            ei,
            push_pull,
            reciprocity_p,
            development_note,
            kind,
            curve_roll_id,
        ),
    )
    return json_response(201, records.serialise_roll(require_view(request, new_id)))


def get_roll(request: Request, roll_id: str) -> Response:
    return json_response(200, records.serialise_roll(require_view(request, roll_id)))


def patch_roll(request: Request, roll_id: str) -> Response:
    view = require_view(request, roll_id)
    body = request.json_body()
    fields = Fields()
    updates: dict[str, Any] = {}
    if "format" in body and body["format"] != view.roll["format"]:
        fields.fail("format", "format_change")
    if "kind" in body and body["kind"] != view.roll["kind"]:
        fields.fail("kind", "format_change")
    if "name" in body:
        updates["name"] = validate.text(
            fields, body, "name", maximum=validate.MAX_NAME, minimum=1
        )
    if "stock" in body:
        updates["stock"] = validate.text(
            fields, body, "stock", maximum=validate.MAX_STOCK, minimum=1
        )
    if "ei" in body:
        updates["ei"] = validate.whole_number(fields, body, "ei", low=6, high=12800)
    if "push_pull" in body:
        updates["push_pull"] = validate.whole_number(
            fields, body, "push_pull", low=-3, high=3
        )
    if "reciprocity_p" in body:
        updates["reciprocity_p"] = validate.reciprocity_exponent(fields, body)
    if "development_note" in body:
        updates["development_note"] = validate.note_text(
            fields, body, "development_note", validate.MAX_NOTE
        )
    if "curve_roll_id" in body:
        updates["curve_roll_id"] = _curve_roll_id(
            request, fields, body, view.roll["kind"], None
        )
    if not fields.ok():
        raise errors.validation_failed(fields.errors)
    if updates:
        assignments = ", ".join(f"{column} = %s" for column in updates)
        db.execute(
            f"UPDATE rolls SET {assignments} WHERE id = %s",
            (*updates.values(), roll_id),
        )
    return json_response(200, records.serialise_roll(require_view(request, roll_id)))


# --- shooting log ------------------------------------------------------------


def list_entries(request: Request, roll_id: str) -> Response:
    view = require_view(request, roll_id)
    return json_response(
        200,
        {"entries": [records.serialise_entry(view, entry) for entry in view.entries]},
    )


def create_entry(request: Request, roll_id: str) -> Response:
    view = require_view(request, roll_id)
    body = request.json_body()
    fields = Fields()
    counter = validate.whole_number(fields, body, "counter", low=0, high=99)
    aperture = validate.aperture(fields, body)
    shutter = validate.shutter(fields, body)
    metered_ev = validate.decimal_number(fields, body, "metered_ev", low=-6, high=21)
    note = validate.note_text(fields, body, "note", validate.MAX_NOTE)
    misfire = validate.flag(fields, body, "misfire", False)
    if counter is not None and any(entry.counter == counter for entry in view.entries):
        raise errors.conflict("counter_taken", {"counter": counter})
    if not fields.ok():
        raise errors.validation_failed(fields.errors)
    new_id = str(uuid.uuid4())
    db.execute(
        """
        INSERT INTO entries (id, roll_id, counter, aperture, shutter, metered_ev,
                             note, misfire)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (new_id, roll_id, counter, aperture, shutter, metered_ev, note, misfire),
    )
    fresh = require_view(request, roll_id)
    entry = next(item for item in fresh.entries if item.id == new_id)
    return json_response(201, records.serialise_entry(fresh, entry))


def patch_entry(request: Request, entry_id: str) -> Response:
    row, view = require_entry(request, entry_id)
    body = request.json_body()
    fields = Fields()
    updates: dict[str, Any] = {}
    if "counter" in body:
        counter = validate.whole_number(fields, body, "counter", low=0, high=99)
        if counter is not None and any(
            entry.counter == counter and entry.id != entry_id for entry in view.entries
        ):
            raise errors.conflict("counter_taken", {"counter": counter})
        updates["counter"] = counter
    if "aperture" in body:
        updates["aperture"] = validate.aperture(fields, body)
    if "shutter" in body:
        updates["shutter"] = validate.shutter(fields, body)
    if "metered_ev" in body:
        updates["metered_ev"] = validate.decimal_number(
            fields, body, "metered_ev", low=-6, high=21
        )
    if "note" in body:
        updates["note"] = validate.note_text(fields, body, "note", validate.MAX_NOTE)
    if "misfire" in body:
        updates["misfire"] = validate.flag(fields, body, "misfire", False)
    if not fields.ok():
        raise errors.validation_failed(fields.errors)
    if updates:
        assignments = ", ".join(f"{column} = %s" for column in updates)
        db.execute(
            f"UPDATE entries SET {assignments} WHERE id = %s",
            (*updates.values(), entry_id),
        )
    fresh = require_view(request, str(row["roll_id"]))
    entry = next(item for item in fresh.entries if item.id == entry_id)
    return json_response(200, records.serialise_entry(fresh, entry))


def delete_entry(request: Request, entry_id: str) -> Response:
    row, _ = require_entry(request, entry_id)
    with db.transaction() as cur:
        cur.execute(
            "UPDATE alignments SET slip_after = NULL WHERE roll_id = %s AND slip_after = %s",
            (str(row["roll_id"]), int(row["counter"])),
        )
        cur.execute("UPDATE readings SET entry_id = NULL WHERE entry_id = %s", (entry_id,))
        cur.execute("DELETE FROM alignment_overrides WHERE entry_id = %s", (entry_id,))
        cur.execute("DELETE FROM entries WHERE id = %s", (entry_id,))
    return Response(status=204, body=b"")


# --- contact sheet and curve -------------------------------------------------


def contact_sheet(request: Request, roll_id: str) -> Response:
    view = require_view(request, roll_id)
    return json_response(
        200,
        {
            "counters": view.counters(),
            "frames": [records.serialise_frame(view, frame) for frame in view.frames],
            "entries": [
                records.serialise_entry(view, entry) for entry in view.entries
            ],
        },
    )


def roll_curve(request: Request, roll_id: str) -> Response:
    view = require_view(request, roll_id)
    return json_response(200, records.serialise_curve(view))


# --- alignment ---------------------------------------------------------------


def _candidate_json(candidate: align.Candidate, with_slip: bool) -> dict[str, Any]:
    body: dict[str, Any] = {"offset": candidate.offset}
    if with_slip:
        body["slip_after"] = candidate.slip_after
    body["rho"] = (
        None if candidate.rho is None else round_half_away(candidate.rho, 4)
    )
    body["pairs"] = candidate.pairs
    return body


def _proposal_json(proposal: align.Proposal) -> dict[str, Any]:
    return {
        "proposed_offset": proposal.proposed_offset,
        "proposed_slip_after": proposal.proposed_slip_after,
        "candidates": [
            _candidate_json(candidate, False) for candidate in proposal.candidates
        ],
        "slip_candidates": [
            _candidate_json(candidate, True)
            for candidate in sorted(
                proposal.slip_candidates,
                key=lambda item: (item.offset, item.slip_after or 0),
            )
        ],
    }


def _ensure_alignment_row(roll_id: str) -> None:
    db.execute(
        "INSERT INTO alignments (roll_id, version) VALUES (%s, 0) ON CONFLICT DO NOTHING",
        (roll_id,),
    )


def propose_alignment(request: Request, roll_id: str) -> Response:
    view = require_view(request, roll_id)
    request.json_body()
    if not view.frames:
        raise errors.conflict("no_frames")
    proposal = align.propose(view.entry_facts(), view.frame_facts())
    body = _proposal_json(proposal)
    _ensure_alignment_row(roll_id)
    db.execute(
        "UPDATE alignments SET proposal = %s WHERE roll_id = %s",
        (json.dumps(body), roll_id),
    )
    return json_response(200, body)


def _alignment_json(view: records.RollView) -> dict[str, Any]:
    alignment = view.alignment
    return {
        "version": int(alignment["version"]),
        "offset": alignment["offset_frames"],
        "slip_after": alignment["slip_after"],
        "source": alignment["source"],
        "overrides": [
            {"entry_id": entry_id, "frame_id": frame_id}
            for entry_id, frame_id in sorted(view.overrides.items())
        ],
        "proposal": alignment["proposal"],
        "counters": view.counters(),
    }


def get_alignment(request: Request, roll_id: str) -> Response:
    return json_response(200, _alignment_json(require_view(request, roll_id)))


def _override_pairs(
    request: Request, view: records.RollView, body: dict[str, Any], fields: Fields
) -> list[tuple[str, str | None]]:
    raw = body.get("overrides", [])
    if not isinstance(raw, list):
        fields.fail("overrides")
        return []
    pairs: list[tuple[str, str | None]] = []
    seen_entries: set[str] = set()
    seen_frames: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            fields.fail("overrides")
            continue
        entry_id = item.get("entry_id")
        frame_id = item.get("frame_id")
        if not isinstance(entry_id, str) or not _looks_like_uuid(entry_id):
            raise errors.not_found()
        _require_own_entry(request, entry_id)
        if not any(entry.id == entry_id for entry in view.entries):
            fields.fail("overrides")
            continue
        if entry_id in seen_entries:
            fields.fail("overrides")
            continue
        seen_entries.add(entry_id)
        if frame_id is None:
            pairs.append((entry_id, None))
            continue
        if not isinstance(frame_id, str) or not _looks_like_uuid(frame_id):
            raise errors.not_found()
        _require_own_frame(request, frame_id)
        if not any(frame.id == frame_id for frame in view.frames):
            fields.fail("overrides")
            continue
        if frame_id in seen_frames:
            fields.fail("overrides")
            continue
        seen_frames.add(frame_id)
        pairs.append((entry_id, frame_id))
    return pairs


def _require_own_entry(request: Request, entry_id: str) -> None:
    row = db.fetch_one(
        """
        SELECT e.id FROM entries e JOIN rolls r ON r.id = e.roll_id
        WHERE e.id = %s AND r.account_id = %s
        """,
        (entry_id, account_id(request)),
    )
    if row is None:
        raise errors.not_found()


def _require_own_frame(request: Request, frame_id: str) -> None:
    row = db.fetch_one(
        """
        SELECT f.id FROM frames f
        JOIN scans s ON s.id = f.scan_id
        JOIN rolls r ON r.id = s.roll_id
        WHERE f.id = %s AND r.account_id = %s
        """,
        (frame_id, account_id(request)),
    )
    if row is None:
        raise errors.not_found()


def put_alignment(request: Request, roll_id: str) -> Response:
    view = require_view(request, roll_id)
    body = request.json_body()
    fields = Fields()
    version = body.get("version")
    if isinstance(version, bool) or not isinstance(version, int):
        raise errors.validation_failed({"version": FIELD_COPY["version"]})
    current = int(view.alignment["version"])
    if version != current:
        raise errors.stale_alignment(current)
    if not view.frames:
        raise errors.conflict("no_frames")
    if any(scan["state"] not in ("framed", "aligned") for scan in view.scans):
        raise errors.conflict("unframed_scans")
    if any(frame.flag == "flagged" for frame in view.frames):
        raise errors.conflict("flagged_frames")
    offset = validate.whole_number(fields, body, "offset", low=-2, high=2)
    slip_after = body.get("slip_after")
    if slip_after is not None:
        if isinstance(slip_after, bool) or not isinstance(slip_after, int) or not any(
            entry.counter == slip_after for entry in view.entries
        ):
            fields.fail("slip_after")
            slip_after = None
    overrides = _override_pairs(request, view, body, fields)
    if not fields.ok():
        raise errors.validation_failed(fields.errors)
    proposal = view.alignment["proposal"] or {}
    source = (
        "proposed"
        if proposal.get("proposed_offset") == offset
        and proposal.get("proposed_slip_after") == slip_after
        else "manual"
    )
    _ensure_alignment_row(roll_id)
    with db.transaction() as cur:
        cur.execute(
            "SELECT version FROM alignments WHERE roll_id = %s FOR UPDATE", (roll_id,)
        )
        row = cur.fetchone()
        stored = int(row["version"]) if row else 0
        if stored != version:
            raise errors.stale_alignment(stored)
        cur.execute("DELETE FROM alignment_overrides WHERE roll_id = %s", (roll_id,))
        for entry_id, frame_id in overrides:
            cur.execute(
                """
                INSERT INTO alignment_overrides (roll_id, entry_id, frame_id)
                VALUES (%s, %s, %s)
                """,
                (roll_id, entry_id, frame_id),
            )
        cur.execute(
            """
            UPDATE alignments
            SET version = version + 1, offset_frames = %s, slip_after = %s,
                source = %s, saved_at = now()
            WHERE roll_id = %s
            """,
            (offset, slip_after, source, roll_id),
        )
        cur.execute(
            "UPDATE scans SET state = 'aligned' WHERE roll_id = %s AND state = 'framed'",
            (roll_id,),
        )
    return json_response(200, _alignment_json(require_view(request, roll_id)))


Handler = Callable[..., Response]

ROUTES: list[tuple[re.Pattern[str], str, Handler, bool]] = [
    (re.compile(r"/api/health"), "GET", health, True),
    (re.compile(r"/api/storage"), "GET", storage_state, True),
    (re.compile(r"/api/auth/signup"), "POST", signup, True),
    (re.compile(r"/api/auth/signin"), "POST", signin, True),
    (re.compile(r"/api/auth/signout"), "POST", signout, False),
    (re.compile(r"/api/me"), "GET", me, False),
    (re.compile(r"/api/rolls"), "GET", list_rolls, False),
    (re.compile(r"/api/rolls"), "POST", create_roll, False),
    (re.compile(rf"/api/rolls/({UUID_PATTERN})"), "GET", get_roll, False),
    (re.compile(rf"/api/rolls/({UUID_PATTERN})"), "PATCH", patch_roll, False),
    (re.compile(rf"/api/rolls/({UUID_PATTERN})/entries"), "GET", list_entries, False),
    (re.compile(rf"/api/rolls/({UUID_PATTERN})/entries"), "POST", create_entry, False),
    (re.compile(rf"/api/entries/({UUID_PATTERN})"), "PATCH", patch_entry, False),
    (re.compile(rf"/api/entries/({UUID_PATTERN})"), "DELETE", delete_entry, False),
    (
        re.compile(rf"/api/rolls/({UUID_PATTERN})/contact-sheet"),
        "GET",
        contact_sheet,
        False,
    ),
    (re.compile(rf"/api/rolls/({UUID_PATTERN})/curve"), "GET", roll_curve, False),
    (
        re.compile(rf"/api/rolls/({UUID_PATTERN})/alignment/proposal"),
        "POST",
        propose_alignment,
        False,
    ),
    (re.compile(rf"/api/rolls/({UUID_PATTERN})/alignment"), "GET", get_alignment, False),
    (re.compile(rf"/api/rolls/({UUID_PATTERN})/alignment"), "PUT", put_alignment, False),
    (re.compile(rf"/api/rolls/({UUID_PATTERN})/scans"), "GET", scans_api.list_scans, False),
    (
        re.compile(rf"/api/rolls/({UUID_PATTERN})/scans"),
        "POST",
        scans_api.upload_scan,
        False,
    ),
    (re.compile(rf"/api/scans/({UUID_PATTERN})"), "GET", scans_api.get_scan, False),
    (
        re.compile(rf"/api/scans/({UUID_PATTERN})/original"),
        "GET",
        scans_api.get_original,
        False,
    ),
    (
        re.compile(rf"/api/scans/({UUID_PATTERN})/preview/(\d+)"),
        "GET",
        scans_api.get_preview,
        False,
    ),
    (
        re.compile(rf"/api/scans/({UUID_PATTERN})/calibration"),
        "POST",
        scans_api.calibrate,
        False,
    ),
    (
        re.compile(rf"/api/scans/({UUID_PATTERN})/frames/detect"),
        "POST",
        scans_api.detect_frames,
        False,
    ),
    (
        re.compile(rf"/api/scans/({UUID_PATTERN})/reading"),
        "GET",
        scans_api.get_reading,
        False,
    ),
    (
        re.compile(rf"/api/scans/({UUID_PATTERN})/readings"),
        "POST",
        scans_api.pin_reading,
        False,
    ),
    (re.compile(rf"/api/frames/({UUID_PATTERN})"), "GET", scans_api.get_frame, False),
    (re.compile(rf"/api/frames/({UUID_PATTERN})"), "PATCH", scans_api.patch_frame, False),
    (
        re.compile(rf"/api/frames/({UUID_PATTERN})/accept-width"),
        "POST",
        scans_api.accept_width,
        False,
    ),
]
