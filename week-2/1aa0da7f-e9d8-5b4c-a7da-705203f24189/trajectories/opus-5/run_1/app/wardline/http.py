"""The HTTP boundary: routing, request shape, authentication and the one error shape."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable
from urllib.parse import unquote_to_bytes

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from . import auth, db, ledger
from .errors import ApiError, ValidationFailed
from .validation import BODY_UNREADABLE

MAX_JSON_BODY = 1_000_000
BACKGROUND_HEADER = "x-wardline-background"
PROOF_HEADER = "x-step-up-proof"
UNRESERVED = set(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"
)


def encode_target(raw: bytes) -> str:
    out = []
    for byte in raw:
        ch = chr(byte)
        if ch in UNRESERVED:
            out.append(ch)
        else:
            out.append("%%%02X" % byte)
    return "".join(out)[:200]


def target_from_text(value: str) -> str:
    return encode_target(
        value.encode("utf-8", "replace").replace(b"\xed\xa0\x80", b"\xef\xbf\xbd")
    )


@dataclass
class Param:
    """A path id, kept both as sent and as usable text."""

    raw: str

    def __post_init__(self) -> None:
        self.bytes = unquote_to_bytes(self.raw)
        try:
            text = self.bytes.decode("utf-8")
            self.text: str | None = None if "\x00" in text else text
        except UnicodeDecodeError:
            self.text = None

    @property
    def target(self) -> str:
        return encode_target(self.bytes)


@dataclass
class Context:
    method: str
    raw_path: str
    params: dict[str, Param]
    query: dict[str, str]
    headers: dict[str, str]
    body: dict[str, Any] = field(default_factory=dict)
    user: dict | None = None
    session: dict | None = None
    background: bool = False
    proof: str | None = None
    writes_denials: bool = True
    break_glass_grant: dict | None = None
    response_headers: dict[str, str] = field(default_factory=dict)

    def param(self, name: str) -> Param:
        return self.params[name]

    def id_of(self, name: str) -> str | None:
        return self.params[name].text

    def path_ids(self) -> list[Param]:
        return list(self.params.values())

    def last_path_target(self) -> str:
        ids = self.path_ids()
        if ids:
            return ids[-1].target
        return self.raw_path[:1000]

    def require_user(self) -> dict:
        if self.user is None:
            raise ApiError("unauthenticated")
        return self.user

    def check_step_up(self) -> str:
        auth.step_up_present(self.proof, self.session["id"])
        return self.proof

    def consume_proof(self, cur: Any) -> None:
        auth.consume_step_up(cur, self.proof, self.session["id"])

    def entry_detail(self, detail: dict[str, Any] | None = None) -> dict[str, Any]:
        """Adds break-glass attribution to every entry made under such a grant."""
        out = dict(detail or {})
        if self.break_glass_grant is not None:
            out["via"] = "break_glass"
            out["grant_id"] = self.break_glass_grant["id"]
        return out

    def log(
        self,
        cur: Any,
        action: str,
        target: str,
        detail: dict[str, Any] | None = None,
    ) -> dict:
        return ledger.append(
            cur,
            action=action,
            actor_id=self.user["id"],
            session_id=self.session["id"],
            target=target,
            detail=self.entry_detail(detail),
        )


Handler = Callable[[Context], Any]


@dataclass
class Route:
    pattern: re.Pattern[str]
    methods: frozenset[str]
    handler: Handler
    auth: bool = True
    json_body: bool = False
    denials: bool = True
    streaming: bool = False


ROUTES: list[Route] = []


def route(
    path: str,
    methods: Iterable[str],
    *,
    auth_required: bool = True,
    json_body: bool = False,
    denials: bool = True,
    streaming: bool = False,
) -> Callable[[Handler], Handler]:
    pattern = re.compile(
        "^" + re.sub(r"\{(\w+)\}", lambda m: f"(?P<{m.group(1)}>[^/]+)", path) + "$"
    )

    def decorate(handler: Handler) -> Handler:
        ROUTES.append(
            Route(
                pattern=pattern,
                methods=frozenset(methods),
                handler=handler,
                auth=auth_required,
                json_body=json_body,
                denials=denials,
                streaming=streaming,
            )
        )
        return handler

    return decorate


def json_response(status: int, body: Any, headers: dict[str, str] | None = None) -> Response:
    out = {"X-Content-Type-Options": "nosniff"}
    out.update(headers or {})
    return JSONResponse(body, status_code=status, headers=out)


def error_response(exc: ApiError | ValidationFailed) -> Response:
    return json_response(exc.status, exc.body, exc.headers)


def write_denial(ctx: Context, code: str, target: str | None) -> None:
    if not ctx.writes_denials or ctx.user is None or ctx.session is None:
        return
    detail = ctx.entry_detail(
        {"method": ctx.method, "path": ctx.raw_path[:1000], "code": code}
    )
    try:
        with db.tx() as cur:
            ledger.append(
                cur,
                action="access.denied",
                actor_id=ctx.user["id"],
                session_id=ctx.session["id"],
                target=target or ctx.last_path_target(),
                detail=detail,
            )
    except db.DatabaseUnavailable:
        return


def parse_json_body(raw: bytes) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise ValidationFailed({"body": BODY_UNREADABLE}) from None
    try:
        value = json.loads(text)
    except (ValueError, RecursionError):
        raise ValidationFailed({"body": BODY_UNREADABLE}) from None
    if not isinstance(value, dict):
        raise ValidationFailed({"body": BODY_UNREADABLE})
    return value


async def read_json_body(request: Request) -> bytes:
    size = 0
    chunks: list[bytes] = []
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_JSON_BODY:
            raise ApiError("body_too_large")
        chunks.append(chunk)
    return b"".join(chunks)


def check_origin(request: Request) -> None:
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    origin = request.headers.get("origin")
    if origin is None:
        return
    host = request.headers.get("host", "")
    expected = {f"http://{host}", f"https://{host}"}
    if origin not in expected:
        raise ApiError("forbidden_origin")
