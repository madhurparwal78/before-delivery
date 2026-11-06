"""MinIO through signed S3 requests. Every failure surfaces as StorageUnavailable."""

from __future__ import annotations

import asyncio
import hashlib
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import BinaryIO
from urllib.parse import quote, urlsplit

import httpx
from botocore.auth import S3SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials

from wardline.config import CONFIG
from wardline.errors import StorageUnavailable

CHUNK = 256 * 1024
_TIMEOUT = httpx.Timeout(connect=3, read=5, write=5, pool=3)


def fresh_key(prefix: str) -> str:
    return f"{prefix}/{secrets.token_hex(16)}"


class Storage:
    def __init__(self) -> None:
        self.client = httpx.AsyncClient(
            timeout=_TIMEOUT,
            limits=httpx.Limits(max_connections=None, max_keepalive_connections=20),
            trust_env=False,
        )
        self.signer = S3SigV4Auth(Credentials(CONFIG.s3_access_key, CONFIG.s3_secret_key), "s3", CONFIG.s3_region)
        endpoint = urlsplit(CONFIG.s3_endpoint)
        self.scheme, self.netloc = endpoint.scheme, endpoint.netloc

    def _url(self, key: str) -> str:
        path = f"/{quote(key, safe='/-_.~')}" if key else ""
        if CONFIG.s3_path_style:
            return f"{self.scheme}://{self.netloc}/{CONFIG.s3_bucket}{path}"
        return f"{self.scheme}://{CONFIG.s3_bucket}.{self.netloc}{path or '/'}"

    def _request(self, method: str, key: str, signed_body: bytes | BinaryIO = b"", content=None, extra: dict[str, str] | None = None) -> httpx.Request:
        """Sign with the S3 scheme; a file body is hashed by the signer in chunks and left where it was."""
        url = self._url(key)
        signed = AWSRequest(method=method, url=url, data=signed_body)
        self.signer.add_auth(signed)
        return self.client.build_request(method, url, headers={**dict(signed.headers.items()), **(extra or {})}, content=content)

    async def _send(self, request: httpx.Request) -> httpx.Response:
        try:
            return await self.client.send(request)
        except (httpx.HTTPError, OSError) as error:
            raise StorageUnavailable(str(error)) from error

    async def check_bucket(self) -> bool:
        """An authenticated bucket check; create the bucket when it does not exist yet."""
        try:
            answer = await self._send(self._request("HEAD", ""))
            if answer.status_code == 404:
                answer = await self._send(self._request("PUT", ""))
        except StorageUnavailable:
            return False
        return answer.status_code < 300

    async def put_file(self, key: str, handle: BinaryIO, size: int) -> None:
        """Stream a local spool to storage; the bytes never sit whole in memory."""

        async def chunks() -> AsyncIterator[bytes]:
            handle.seek(0)
            while chunk := handle.read(CHUNK):
                yield chunk

        handle.seek(0)
        request = await asyncio.to_thread(self._request, "PUT", key, handle, chunks(), {"content-length": str(size)})
        answer = await self._send(request)
        if answer.status_code >= 300:
            raise StorageUnavailable(f"PUT answered {answer.status_code}")

    async def put_bytes(self, key: str, data: bytes) -> None:
        answer = await self._send(self._request("PUT", key, data, data))
        if answer.status_code >= 300:
            raise StorageUnavailable(f"PUT answered {answer.status_code}")

    @asynccontextmanager
    async def opened(self, key: str) -> AsyncIterator[httpx.Response | None]:
        """Open an object for streaming. Yields None when it does not exist."""
        request = self._request("GET", key)
        try:
            answer = await self.client.send(request, stream=True)
        except (httpx.HTTPError, OSError) as error:
            raise StorageUnavailable(str(error)) from error
        try:
            if answer.status_code == 404:
                yield None
            elif answer.status_code >= 300:
                raise StorageUnavailable(f"GET answered {answer.status_code}")
            else:
                yield answer
        finally:
            await answer.aclose()

    async def digest_of(self, key: str) -> tuple[str, int] | None:
        """Read an object in full. Returns its SHA-256 and size, or None when it is missing."""
        digest, size = hashlib.sha256(), 0
        async with self.opened(key) as answer:
            if answer is None:
                return None
            try:
                async for chunk in answer.aiter_bytes(CHUNK):
                    digest.update(chunk)
                    size += len(chunk)
            except (httpx.HTTPError, OSError) as error:
                raise StorageUnavailable(str(error)) from error
        return digest.hexdigest(), size

    async def spool(self, key: str, handle: BinaryIO) -> bool:
        """Copy an object into a local spool file. Returns False when it is missing."""
        async with self.opened(key) as answer:
            if answer is None:
                return False
            try:
                async for chunk in answer.aiter_bytes(CHUNK):
                    handle.write(chunk)
            except (httpx.HTTPError, OSError) as error:
                raise StorageUnavailable(str(error)) from error
        handle.flush()
        return True

    async def size_of(self, key: str) -> int | None:
        answer = await self._send(self._request("HEAD", key))
        if answer.status_code == 404:
            return None
        if answer.status_code >= 300:
            raise StorageUnavailable(f"HEAD answered {answer.status_code}")
        return int(answer.headers["content-length"])

    async def delete(self, key: str) -> None:
        """Delete an object and confirm it is gone. An object already gone counts as deleted."""
        answer = await self._send(self._request("DELETE", key))
        if answer.status_code not in (200, 204, 404):
            raise StorageUnavailable(f"DELETE answered {answer.status_code}")
        if await self.size_of(key) is not None:
            raise StorageUnavailable("object still present after delete")


STORAGE = Storage()
