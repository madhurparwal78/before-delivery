"""MinIO through the S3 API: SigV4-signed requests over the standard library, run in worker threads."""

import datetime
import hashlib
import hmac
import http.client
import urllib.parse
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

import anyio

from .config import Settings
from .errors import StorageUnavailable

TIMEOUT_SECONDS = 20
EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class Reply:
    status: int
    body: bytes


class Storage:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        endpoint = urllib.parse.urlsplit(settings.s3_endpoint)
        self.secure = endpoint.scheme == "https"
        self.netloc = endpoint.netloc

    def _sign(self, method: str, host: str, path: str, query: str, body_sha256: str) -> dict[str, str]:
        now = datetime.datetime.now(datetime.UTC)
        stamp, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
        headers = {"host": host, "x-amz-content-sha256": body_sha256, "x-amz-date": stamp}
        signed = ";".join(headers)
        canonical = "\n".join([method, path, query, "".join(f"{k}:{v}\n" for k, v in headers.items()), signed,
                               body_sha256])
        scope = f"{day}/{self.settings.s3_region}/s3/aws4_request"
        to_sign = "\n".join(["AWS4-HMAC-SHA256", stamp, scope, hashlib.sha256(canonical.encode()).hexdigest()])
        key = f"AWS4{self.settings.s3_secret_access_key}".encode()
        for part in (day, self.settings.s3_region, "s3", "aws4_request"):
            key = hmac.new(key, part.encode(), hashlib.sha256).digest()
        signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
        headers["Authorization"] = (f"AWS4-HMAC-SHA256 Credential={self.settings.s3_access_key_id}/{scope}, "
                                    f"SignedHeaders={signed}, Signature={signature}")
        return headers

    def _request(self, method: str, key: str = "", body: bytes = b"", content_type: str | None = None,
                 query: str = "") -> Reply:
        bucket = self.settings.s3_bucket
        if self.settings.s3_force_path_style:
            host, path = self.netloc, f"/{bucket}" + (f"/{key}" if key else "")
        else:
            host, path = f"{bucket}.{self.netloc}", f"/{key}"
        path = urllib.parse.quote(path, safe="/-_.~")
        headers = self._sign(method, host, path, query, hashlib.sha256(body).hexdigest() if body else EMPTY_SHA256)
        if content_type:
            headers["Content-Type"] = content_type
        connection_class = http.client.HTTPSConnection if self.secure else http.client.HTTPConnection
        connection = connection_class(self.netloc, timeout=TIMEOUT_SECONDS)
        try:
            connection.request(method, path + (f"?{query}" if query else ""), body=body or None, headers=headers)
            response = connection.getresponse()
            return Reply(response.status, response.read())
        except OSError as error:
            raise StorageUnavailable() from error
        finally:
            connection.close()

    async def _run(self, call: Callable[[], T]) -> T:
        return await anyio.to_thread.run_sync(call)

    async def reachable(self) -> bool:
        try:
            reply = await self._run(lambda: self._request("GET", query="list-type=2&max-keys=1"))
        except StorageUnavailable:
            return False
        return reply.status == 200

    async def put(self, key: str, body: bytes, content_type: str) -> None:
        reply = await self._run(lambda: self._request("PUT", key, body, content_type))
        if reply.status != 200:
            raise StorageUnavailable()

    async def get(self, key: str) -> bytes:
        reply = await self._run(lambda: self._request("GET", key))
        if reply.status != 200:
            raise StorageUnavailable()
        return reply.body

    async def exists(self, key: str) -> bool:
        """True when the object is there; an unreachable store raises StorageUnavailable."""
        reply = await self._run(lambda: self._request("HEAD", key))
        if reply.status not in (200, 404):
            raise StorageUnavailable()
        return reply.status == 200

    async def delete(self, key: str) -> None:
        await self._run(lambda: self._request("DELETE", key))
