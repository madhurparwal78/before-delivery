"""Streaming endpoints: registration and claimed downloads."""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator

import anyio
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import Response

from . import auth, db, media, multipart, storage
from .access import caller_grant, load_compartment
from .config import CONFIG
from .errors import ApiError, ValidationFailed, file_too_large
from .http import Context, route
from .idempotency import (
    fingerprint,
    key_of,
    replay_inside,
    store_response,
)
from .rules import READABLE_STATES, SCOPE_FULL
from .validation import (
    FILE_DIGEST_DIFFERS,
    FILE_NAME_UNSAFE,
    FILE_TYPE_MISMATCH,
    FILE_UNACCEPTED,
    FieldChecker,
    REQUIRED,
    trim,
)

MAX_FILE = 20_000_000
MAX_MULTIPART = 20_500_000
STALL_SECONDS = 30
EXTENSIONS = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "audio/wav": ".wav",
    "audio/mpeg": ".mp3",
}


class TimedStream(Response):
    """Streams bytes outside any transaction, closing a stalled transfer."""

    def __init__(
        self, source: Iterator[bytes], status_code: int, headers: dict[str, str]
    ) -> None:
        super().__init__(status_code=status_code, headers=headers)
        self.source = source
        self.raw_headers = [
            (key, value)
            for key, value in self.raw_headers
            if key != b"content-length"
        ]

    async def __call__(self, scope, receive, send) -> None:
        await send(
            {
                "type": "http.response.start",
                "status": self.status_code,
                "headers": self.raw_headers,
            }
        )
        try:
            while True:
                chunk = await run_in_threadpool(next, self.source, b"")
                if not chunk:
                    break
                with anyio.fail_after(STALL_SECONDS):
                    await send(
                        {
                            "type": "http.response.body",
                            "body": chunk,
                            "more_body": True,
                        }
                    )
        except (TimeoutError, anyio.EndOfStream, OSError):
            pass
        finally:
            closer = getattr(self.source, "close", None)
            if closer is not None:
                closer()
        await send({"type": "http.response.body", "body": b"", "more_body": False})


def _register_target(ctx: Context) -> dict:
    with db.tx() as cur:
        compartment, _ = load_compartment(cur, ctx, "register")
        return compartment


def _registration_mark(form: multipart.Form, digest: str) -> str:
    parts = [f"{key}={value}" for key, value in sorted(form.fields.items())]
    return fingerprint("file=" + digest + "&" + "&".join(parts))


def _seal_registration(
    ctx: Context,
    compartment: dict,
    form: multipart.Form,
    key: str,
    size: int,
    digest: str,
    sniffed: str | None,
    inspection: media.Inspection,
) -> tuple[int, Any, dict]:
    body = dict(form.fields)
    checker = FieldChecker(body)
    name = checker.free_text("name")
    source = checker.free_text("source")
    collected_by = checker.free_text("collected_by")
    collected_on = checker.collected_on()
    capture_notes = checker.optional_text("capture_notes")
    declared = trim(body.get("declared_type", ""))
    if declared == "":
        checker.fail("declared_type", REQUIRED)
    if not form.file.present:
        checker.fail("file", REQUIRED)
    elif not media.safe_file_name(form.file.filename or ""):
        checker.fail("file", FILE_NAME_UNSAFE)
    elif declared not in media.ACCEPTED_TYPES and declared != "":
        checker.fail("file", FILE_UNACCEPTED)
    elif sniffed not in media.ACCEPTED_TYPES:
        checker.fail("file", FILE_UNACCEPTED)
    elif declared != "" and sniffed != declared:
        checker.fail("file", FILE_TYPE_MISMATCH)
    else:
        submitted = trim(body.get("submitted_sha256", ""))
        if submitted != "" and submitted != digest:
            checker.fail("file", FILE_DIGEST_DIFFERS)
    checker.done()
    with db.tx() as cur:
        replay = replay_inside(cur, ctx, "register", _registration_mark(form, digest))
        if replay is not None:
            raise _Replayed(replay)
        exhibit_id = db.next_id(cur, "EX")
        cur.execute(
            """
            INSERT INTO exhibits
                (id, compartment_id, name, state, sha256, size, sniffed_type, page_count,
                 registered_by, marks_version, seal_check, object_key, renderable,
                 source, collected_by, collected_on, capture_notes, created_at)
            VALUES (%s, %s, %s, 'quarantined', %s, %s, %s, %s, %s, 0, NULL, %s, %s,
                    %s, %s, %s, %s, %s)
            """,
            (
                exhibit_id,
                compartment["id"],
                name,
                digest,
                size,
                sniffed,
                inspection.page_count,
                ctx.user["id"],
                key,
                inspection.renderable,
                source,
                collected_by,
                collected_on,
                capture_notes,
                datetime.now(timezone.utc),
            ),
        )
        ctx.log(
            cur,
            "exhibit.sealed",
            exhibit_id,
            {"sha256": digest, "size": size},
        )
        body_out = {
            "id": exhibit_id,
            "compartment_id": compartment["id"],
            "state": "quarantined",
            "sealed": True,
            "sha256": digest,
            "size": size,
            "sniffed_type": sniffed,
        }
        store_response(
            cur, ctx, "register", 201, body_out, _registration_mark(form, digest)
        )
    return 201, body_out, {}


class _Replayed(Exception):
    def __init__(self, reply: tuple[int, Any, dict]) -> None:
        super().__init__("replayed")
        self.reply = reply


def _stored_replay(ctx: Context, mark: str) -> tuple[int, Any, dict] | None:
    key = key_of(ctx)
    if key is None:
        return None
    with db.tx() as cur:
        return replay_inside(cur, ctx, "register", mark)


@route("/api/compartments/{id}/exhibits", ["POST"], streaming=True)
async def register_exhibit(ctx: Context, request: Request):
    boundary = multipart.boundary_of(request.headers.get("content-type"))
    if boundary is None:
        raise ApiError("unsupported_media_type")
    declared_length = request.headers.get("content-length")
    if declared_length and declared_length.isdigit():
        if int(declared_length) > MAX_MULTIPART:
            raise file_too_large()
    compartment = await run_in_threadpool(_register_target, ctx)
    if not storage.storage_up():
        raise ApiError("storage_unavailable")
    key = storage.object_key("originals")
    writer = storage.ObjectWriter(key)
    head = bytearray()

    async def sink(chunk: bytes) -> None:
        if len(head) < 4096:
            head.extend(chunk[: 4096 - len(head)])
        await run_in_threadpool(writer.write, chunk)

    try:
        form = await multipart.read_form(
            request.stream().__aiter__(),
            boundary,
            "file",
            sink,
            MAX_MULTIPART,
            MAX_FILE,
        )
        sent_size, sent_digest = await run_in_threadpool(writer.finish)
        data = await run_in_threadpool(storage.read_object, key)
    except multipart.FileTooLarge:
        await run_in_threadpool(writer.abort)
        raise file_too_large() from None
    except multipart.MultipartError:
        await run_in_threadpool(writer.abort)
        raise ValidationFailed({"body": "This request could not be read."}) from None
    except storage.StorageDown:
        await run_in_threadpool(writer.abort)
        raise ApiError("storage_unavailable") from None
    except BaseException:
        await run_in_threadpool(writer.abort)
        raise
    size = len(data)
    digest = hashlib.sha256(data).hexdigest()
    if size != sent_size or digest != sent_digest:
        await run_in_threadpool(writer.abort)
        raise ApiError("storage_unavailable")
    sniffed = media.sniff(bytes(head))
    mark = _registration_mark(form, digest)
    replay = await run_in_threadpool(_stored_replay, ctx, mark)
    if replay is not None:
        await run_in_threadpool(writer.abort)
        return replay
    inspection = await run_in_threadpool(media.inspect, data, sniffed or "")
    try:
        return await run_in_threadpool(
            _seal_registration,
            ctx,
            compartment,
            form,
            key,
            size,
            digest,
            sniffed,
            inspection,
        )
    except _Replayed as replayed:
        await run_in_threadpool(writer.abort)
        return replayed.reply
    except BaseException:
        await run_in_threadpool(writer.abort)
        raise


def _resolve_download(token: str | None) -> dict:
    if token is None:
        raise ApiError("not_found")
    with db.tx() as cur:
        cur.execute(
            "SELECT * FROM download_grants WHERE token_hash = %s",
            (auth.token_digest(token),),
        )
        row = cur.fetchone()
        if (
            row is None
            or row["claimed_at"] is not None
            or row["expires_at"] <= datetime.now(timezone.utc)
        ):
            raise ApiError("not_found")
        grant = dict(row)
        cur.execute("SELECT * FROM exhibits WHERE id = %s", (grant["exhibit_id"],))
        exhibit = dict(cur.fetchone())
        if exhibit["state"] == "disposed" or exhibit["state"] not in READABLE_STATES:
            raise ApiError("not_found")
        derivative = None
        if grant["derivative_id"] is not None:
            cur.execute(
                "SELECT * FROM derivatives WHERE id = %s", (grant["derivative_id"],)
            )
            derivative = dict(cur.fetchone())
            if derivative["disposed"] or derivative["object_key"] is None:
                raise ApiError("not_found")
        if grant["link_id"] is not None:
            cur.execute(
                """
                SELECT 1 FROM links
                WHERE id = %s AND state = 'active' AND expires_at > now()
                """,
                (grant["link_id"],),
            )
            if cur.fetchone() is None:
                raise ApiError("not_found")
            actor = f"link:{grant['link_id']}"
            session_id = None
            via = None
        else:
            cur.execute(
                "SELECT * FROM sessions WHERE id = %s AND state = 'active'",
                (grant["session_id"],),
            )
            session = cur.fetchone()
            if session is None:
                raise ApiError("not_found")
            now = datetime.now(timezone.utc)
            if now >= session["created_at"] + timedelta(
                seconds=CONFIG.session_ttl_seconds
            ) or now >= session["last_activity_at"] + timedelta(
                seconds=CONFIG.session_idle_seconds
            ):
                raise ApiError("not_found")
            member = caller_grant(cur, grant["user_id"], exhibit["compartment_id"])
            if member is None:
                raise ApiError("not_found")
            if derivative is None and member["scope"] != SCOPE_FULL:
                raise ApiError("not_found")
            actor = grant["user_id"]
            session_id = grant["session_id"]
            via = (
                {"via": "break_glass", "grant_id": member["id"]}
                if member["kind"] == "break_glass"
                else None
            )
        return {
            "grant": grant,
            "exhibit": exhibit,
            "derivative": derivative,
            "actor": actor,
            "session_id": session_id,
            "via": via,
        }


def _claim(resolved: dict, digest: str, kind: str) -> None:
    from . import ledger

    grant = resolved["grant"]
    with db.tx() as cur:
        cur.execute(
            """
            UPDATE download_grants SET claimed_at = now()
            WHERE id = %s AND claimed_at IS NULL
            RETURNING id
            """,
            (grant["id"],),
        )
        if cur.fetchone() is None:
            raise ApiError("not_found")
        detail = {
            "sha256": digest,
            "exhibit_id": resolved["exhibit"]["id"],
            "kind": kind,
        }
        if resolved["derivative"] is not None:
            detail["derivative_id"] = resolved["derivative"]["id"]
        if resolved["via"] is not None:
            detail.update(resolved["via"])
        target = (
            resolved["derivative"]["id"]
            if resolved["derivative"] is not None
            else resolved["exhibit"]["id"]
        )
        ledger.append(
            cur,
            action="download.claimed",
            actor_id=resolved["actor"],
            session_id=resolved["session_id"],
            target=target,
            detail=detail,
        )


def _prepare_preview(resolved: dict) -> bytes:
    exhibit = resolved["exhibit"]
    data = storage.read_object(exhibit["object_key"])
    return media.render_preview(
        data, exhibit["sniffed_type"], resolved["grant"]["page"] or 1
    )


@route(
    "/api/download/{token}",
    ["GET"],
    auth_required=False,
    denials=False,
    streaming=True,
)
async def download(ctx: Context, request: Request):
    resolved = await run_in_threadpool(_resolve_download, ctx.id_of("token"))
    grant = resolved["grant"]
    exhibit = resolved["exhibit"]
    derivative = resolved["derivative"]
    if grant["kind"] == "preview":
        try:
            payload = await run_in_threadpool(_prepare_preview, resolved)
        except storage.StorageDown:
            raise ApiError("storage_unavailable") from None
        digest = hashlib.sha256(payload).hexdigest()
        await run_in_threadpool(_claim, resolved, digest, "preview")
        return _file_response(
            iter([payload]),
            "image/png",
            f"{exhibit['id']}-p{grant['page']}-{digest[:16]}.png",
        )
    record = derivative or exhibit
    content_type = (
        derivative["content_type"] if derivative is not None else exhibit["sniffed_type"]
    )
    try:
        body = await run_in_threadpool(storage.open_object, record["object_key"])
    except storage.StorageDown:
        raise ApiError("storage_unavailable") from None
    try:
        await run_in_threadpool(_claim, resolved, record["sha256"], "file")
    except ApiError:
        await run_in_threadpool(body.close)
        raise
    name = (
        f"{record['id']}-{record['sha256'][:16]}"
        f"{EXTENSIONS.get(content_type, '.bin')}"
    )
    return _file_response(storage.stream_object(body), content_type, name)


def _file_response(source: Iterator[bytes], content_type: str, name: str) -> Response:
    return TimedStream(
        source,
        200,
        {
            "Content-Type": content_type,
            "Content-Disposition": f'attachment; filename="{name}"',
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-store",
        },
    )
