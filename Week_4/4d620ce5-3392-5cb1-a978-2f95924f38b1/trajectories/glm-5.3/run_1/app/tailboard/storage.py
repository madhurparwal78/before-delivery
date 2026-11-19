"""MinIO access: private objects streamed through the app (DP-24, Services)."""
import asyncio
import hashlib
import io
import logging

from minio import Minio

from .config import Config

log = logging.getLogger("tailboard.storage")


class ObjectStorage:
    """Content-addressed object storage. Unreachable storage never blocks startup."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.bucket = cfg.s3_bucket
        self._client = None
        self._bucket_ready = False
        self._lock = asyncio.Lock()

    def _new_client(self) -> Minio | None:
        try:
            return Minio(
                cfg_endpoint(self.cfg.s3_endpoint),
                access_key=self.cfg.s3_access_key_id,
                secret_key=self.cfg.s3_secret_access_key,
                region=self.cfg.s3_region,
                secure=self.cfg.s3_endpoint.startswith("https://"),
            )
        except Exception:
            return None

    async def ensure_bucket(self) -> bool:
        """Create the bucket when absent, at start or on the first attempt after storage returns."""
        async with self._lock:
            if self._bucket_ready:
                return True
            client = self._client or self._new_client()
            if client is None:
                return False
            try:
                await asyncio.wait_for(
                    asyncio.to_thread(self._ensure_bucket_sync, client), timeout=5)
                self._client = client
                self._bucket_ready = True
                return True
            except Exception:
                self._client = None
                return False

    def _ensure_bucket_sync(self, client: Minio):
        if not client.bucket_exists(self.bucket):
            client.make_bucket(self.bucket)

    async def available(self) -> bool:
        if self._bucket_ready:
            return True
        return await self.ensure_bucket()

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        if not await self.ensure_bucket():
            raise StorageUnavailable()
        client = self._client
        try:
            await asyncio.wait_for(asyncio.to_thread(
                client.put_object,
                self.bucket,
                key,
                io.BytesIO(data),
                len(data),
                content_type=content_type,
            ), timeout=15)
        except Exception as exc:
            self._bucket_ready = False
            raise StorageUnavailable() from exc

    async def get(self, key: str) -> bytes:
        if not await self.ensure_bucket():
            raise StorageUnavailable()
        client = self._client
        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(client.get_object, self.bucket, key), timeout=15)
            try:
                chunks = []
                while True:
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    chunks.append(chunk)
                return b"".join(chunks)
            finally:
                response.close()
                response.release_conn()
        except Exception as exc:
            raise StorageUnavailable() from exc

    async def delete(self, key: str) -> None:
        if not await self.ensure_bucket():
            raise StorageUnavailable()
        client = self._client
        try:
            await asyncio.to_thread(client.remove_object, self.bucket, key)
        except Exception as exc:
            raise StorageUnavailable() from exc


def cfg_endpoint(endpoint: str) -> str:
    return endpoint.split("://", 1)[1] if "://" in endpoint else endpoint


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def document_key(digest: str) -> str:
    return f"directives/{digest}.pdf"


def evidence_key(digest: str, content_type: str) -> str:
    ext = {"image/jpeg": "jpg", "image/png": "png"}.get(content_type, "pdf")
    return f"evidence/{digest}.{ext}"


def pack_pdf_key(digest: str) -> str:
    return f"packs/{digest}.pdf"


def pack_csv_key(digest: str) -> str:
    return f"packs/{digest}.csv"


class StorageUnavailable(Exception):
    pass


def log_storage_error(exc: Exception):
    log.warning("object storage error: %s", exc)
