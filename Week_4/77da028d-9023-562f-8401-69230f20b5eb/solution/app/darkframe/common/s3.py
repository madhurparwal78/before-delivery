"""A small SigV4 client for MinIO: the frames and masters the ledger stores, and the health probe."""
import datetime
import hashlib
import hmac
from urllib.parse import quote, urlsplit

import aiohttp

from darkframe.common.config import Settings


class StorageUnavailable(Exception):
    """The object store did not answer, or answered with something other than success."""


def _sign(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode(), hashlib.sha256).digest()


class ObjectStore:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.bucket = settings.s3_bucket
        self._session: aiohttp.ClientSession | None = None

    def session(self) -> aiohttp.ClientSession:
        if self._session is None:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60, connect=3))
        return self._session

    async def close(self) -> None:
        if self._session is not None:
            await self._session.close()

    def _target(self, key: str) -> tuple[str, str, str]:
        parts = urlsplit(self._settings.s3_endpoint)
        if self._settings.s3_force_path_style:
            host, path = parts.netloc, f"/{self.bucket}" + (f"/{key}" if key else "")
        else:
            host, path = f"{self.bucket}.{parts.netloc}", f"/{key}"
        return f"{parts.scheme}://{host}", host, quote(path, safe="/-_.~")

    async def _request(self, method: str, key: str, body: bytes = b"", content_type: str | None = None,
                       timeout: float | None = None) -> aiohttp.ClientResponse:
        origin, host, path = self._target(key)
        now = datetime.datetime.now(datetime.UTC)
        stamp, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
        payload_hash = hashlib.sha256(body).hexdigest()
        headers = {"host": host, "x-amz-content-sha256": payload_hash, "x-amz-date": stamp}
        signed = ";".join(sorted(headers))
        canonical = "\n".join([method, path, "", "".join(f"{name}:{headers[name]}\n" for name in sorted(headers)), signed,
                               payload_hash])
        scope = f"{day}/{self._settings.s3_region}/s3/aws4_request"
        to_sign = f"AWS4-HMAC-SHA256\n{stamp}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
        signing_key = f"AWS4{self._settings.s3_secret_access_key}".encode()
        for part in (day, self._settings.s3_region, "s3", "aws4_request"):
            signing_key = _sign(signing_key, part)
        signature = hmac.new(signing_key, to_sign.encode(), hashlib.sha256).hexdigest()
        headers["Authorization"] = (f"AWS4-HMAC-SHA256 Credential={self._settings.s3_access_key_id}/{scope}, "
                                    f"SignedHeaders={signed}, Signature={signature}")
        if content_type:
            headers["Content-Type"] = content_type
        try:
            return await self.session().request(method, origin + path, data=body or None, headers=headers,
                                                timeout=aiohttp.ClientTimeout(total=timeout or 60, connect=3))
        except (aiohttp.ClientError, TimeoutError) as error:
            raise StorageUnavailable(str(error)) from error

    async def ensure_bucket(self) -> None:
        response = await self._request("PUT", "")
        async with response:
            if response.status not in (200, 409):
                raise StorageUnavailable(f"bucket {self.bucket}: {response.status}")

    async def ping(self) -> bool:
        try:
            response = await self._request("HEAD", "", timeout=1)
        except StorageUnavailable:
            return False
        async with response:
            return response.status in (200, 403)

    async def put(self, key: str, body: bytes, content_type: str) -> None:
        """Store the object, then read back its size and checksum from the provider; both must match the upload."""
        response = await self._request("PUT", key, body, content_type)
        async with response:
            if response.status != 200:
                raise StorageUnavailable(f"PUT {key}: {response.status}")
        head = await self._request("HEAD", key)
        async with head:
            stored_size = int(head.headers.get("Content-Length", -1))
            stored_etag = head.headers.get("ETag", "").strip('"')
            if head.status != 200 or stored_size != len(body) or stored_etag != hashlib.md5(body).hexdigest():
                raise StorageUnavailable(f"HEAD {key}: stored object differs from the upload")

    async def get(self, key: str) -> tuple[bytes, str]:
        response = await self._request("GET", key)
        async with response:
            if response.status != 200:
                raise StorageUnavailable(f"GET {key}: {response.status}")
            return await response.read(), response.headers.get("Content-Type", "application/octet-stream")
