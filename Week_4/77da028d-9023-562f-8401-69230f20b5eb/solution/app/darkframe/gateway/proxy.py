"""Forwarding /api routes to the service that owns them, with the imager and request id attached."""
import re

from aiohttp import web

from darkframe.common.http import InternalClient
from darkframe.gateway.auth import Keys
from darkframe.rules.errors import ApiFault, not_found

OWNERS = (
    ("sky-engine", re.compile(r"^/api/(site|site/horizon|sky/night|tonight|plans/.+)$")),
    ("ledger", re.compile(r"^/api/(projects|sessions|batches|frames|calibration-sets)(/.*)?$")),
    ("push-dispatcher", re.compile(r"^/api/(pushes|reminders/.+)$")),
)
SHARED = re.compile(r"^/api/shared/[^/]+$")
FORWARDED_HEADERS = ("Content-Type", "Idempotency-Key")


class Proxy:
    def __init__(self, keys: Keys, client: InternalClient) -> None:
        self.keys = keys
        self.client = client

    async def handle(self, request: web.Request) -> web.Response:
        body = request["body"]
        if SHARED.match(request.path):
            if request.method != "GET":
                raise ApiFault(405, "read_only", "Shared project links are read-only.")
            return await self.forward(request, "ledger", None, body)
        imager = await self.keys.require(request)
        for service, pattern in OWNERS:
            if pattern.match(request.path):
                return await self.forward(request, service, imager.imager_id, body)
        raise not_found()

    async def forward(self, request: web.Request, service: str, imager: str | None, body: bytes) -> web.Response:
        headers = {name: request.headers[name] for name in FORWARDED_HEADERS if name in request.headers}
        status, content, content_type = await self.client.raw(
            service, request.method, request.path, imager=imager, body=body or None, headers=headers,
            query=f"?{request.query_string}" if request.query_string else "")
        response = web.Response(status=status, body=content)
        if content_type:
            response.headers["Content-Type"] = content_type
        return response
