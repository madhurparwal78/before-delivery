"""The request context handed to every handler, and the adapters that run handlers in the thread pool."""
import json
from urllib.parse import parse_qs

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request

from .errors import Refusal, refuse, refusal_response

FORM_TYPES = ("application/x-www-form-urlencoded", "multipart/form-data")


class Ctx:
    def __init__(self, request: Request, body: bytes, content_type: str, form: dict | None) -> None:
        self.request = request
        self.body = body
        self.content_type = content_type
        self.form = form
        self.method = request.method
        self.path = request.url.path
        self.params = request.path_params
        self.query = {k: v[-1] for k, v in parse_qs(request.url.query, keep_blank_values=True).items()}
        self.headers = request.headers
        self.cookies = request.cookies
        self.account: dict | None = None

    @property
    def is_form(self) -> bool:
        return self.content_type in FORM_TYPES

    def json(self, *, required: bool = True):
        if not self.body.strip():
            if required:
                refuse(422, "The request body must be JSON.", "body")
            return None
        try:
            return json.loads(self.body)
        except (ValueError, UnicodeDecodeError):
            refuse(422, "The request body must be JSON.", "body")

    def object(self) -> dict:
        data = self.json()
        if not isinstance(data, dict):
            refuse(422, "The request body must be a JSON object.", "body")
        return data


async def read(request: Request) -> Ctx:
    body = await request.body()
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    form = None
    if content_type in FORM_TYPES:
        parsed = await request.form()
        form = {k: v for k, v in parsed.items() if isinstance(v, str)}
    return Ctx(request, body, content_type, form)


def api(fn):
    """Adapt a sync `fn(ctx)` returning a Response into a Starlette endpoint that answers refusals as JSON."""

    async def run(request: Request):
        ctx = await read(request)
        try:
            return await run_in_threadpool(fn, ctx)
        except Refusal as exc:
            return refusal_response(exc)

    run.__name__ = fn.__name__
    return run


def page(fn, render_refusal):
    """Same, for HTML pages: a refusal becomes the refusal page with its status."""

    async def run(request: Request):
        ctx = await read(request)
        try:
            return await run_in_threadpool(fn, ctx)
        except Refusal as exc:
            return await run_in_threadpool(render_refusal, ctx, exc)

    run.__name__ = fn.__name__
    return run
