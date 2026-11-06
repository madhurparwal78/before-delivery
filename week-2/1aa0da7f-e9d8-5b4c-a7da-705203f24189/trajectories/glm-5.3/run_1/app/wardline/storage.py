"""MinIO storage service (originals/ and derivatives/ keys only)."""
from __future__ import annotations

import hashlib
import io
import secrets
import threading
from typing import Any, BinaryIO

from minio import Minio
from minio.error import MinioException, S3Error

from .config import Config


class StorageUnavailable(Exception):
    pass


class Storage:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._client = Minio(
            cfg.s3_endpoint.replace("http://", "").replace("https://", ""),
            access_key=cfg.s3_access_key,
            secret_key=cfg.s3_secret_key,
            secure=cfg.s3_endpoint.startswith("https"),
        )
        self._known_bucket = False

    def ensure_bucket(self) -> None:
        try:
            if not self._client.bucket_exists(self.cfg.s3_bucket):
                self._client.make_bucket(self.cfg.s3_bucket)
            self._known_bucket = True
        except (S3Error, MinioException, OSError, ValueError):
            self._known_bucket = False

    def _prefix(self) -> str:
        return self.cfg.s3_endpoint.split("://", 1)[-1].split("/", 1)[0]

    def check(self) -> bool:
        """Authenticated bucket check (DP-80): wrong credentials behave as down."""
        try:
            self._client.bucket_exists(self.cfg.s3_bucket)
            return True
        except (S3Error, MinioException, OSError, ValueError):
            return False

    def new_key(self, kind: str) -> str:
        return f"{kind}s/{secrets.token_hex(24)}"

    def put_stream(self, key: str, stream: BinaryIO, length: int, content_type: str) -> None:
        try:
            self._client.put_object(self.cfg.s3_bucket, key, stream, length, content_type=content_type)
        except (S3Error, MinioException, OSError, ValueError) as exc:
            raise StorageUnavailable() from exc

    def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        self.put_stream(key, io.BytesIO(data), len(data), content_type)

    def put_and_hash(self, key: str, data: bytes, content_type: str) -> tuple[str, int]:
        """Store bytes and confirm them by reading back size and SHA-256 (DP-10)."""
        try:
            self.put_stream(key, io.BytesIO(data), len(data), content_type)
        except StorageUnavailable:
            raise
        except Exception as exc:
            raise StorageUnavailable() from exc
        try:
            return self.hash_object(key)
        except Exception as exc:
            raise StorageUnavailable() from exc

    def get(self, key: str) -> bytes:
        try:
            obj = self._client.get_object(self.cfg.s3_bucket, key)
            try:
                return obj.read()
            finally:
                obj.close()
                obj.release_conn()
        except (S3Error, MinioException, OSError, ValueError) as exc:
            raise StorageUnavailable() from exc

    def stat(self, key: str) -> tuple[int, str] | None:
        try:
            st = self._client.stat_object(self.cfg.s3_bucket, key)
            return int(st.size), st.etag or ""
        except (S3Error, MinioException, OSError, ValueError):
            return None

    def delete(self, key: str) -> bool:
        """True when the object is gone (deleted here, or already absent)."""
        try:
            self._client.remove_object(self.cfg.s3_bucket, key)
            return True
        except S3Error as exc:
            if getattr(exc, "code", None) == "NoSuchKey":
                return True
            if "NotExist" in str(getattr(exc, "message", "")) or "NoSuch" in str(getattr(exc, "code", "")):
                return True
            return False
        except (MinioException, OSError, ValueError):
            return False

    def hash_object(self, key: str) -> tuple[str, int]:
        """Stream an object and return (sha256, size)."""
        try:
            obj = self._client.get_object(self.cfg.s3_bucket, key)
            digest = hashlib.sha256()
            size = 0
            try:
                while True:
                    chunk = obj.read(1024 * 512)
                    if not chunk:
                        break
                    digest.update(chunk)
                    size += len(chunk)
            finally:
                obj.close()
                obj.release_conn()
            return digest.hexdigest(), size
        except (S3Error, MinioException, OSError, ValueError) as exc:
            raise StorageUnavailable() from exc

    def open_stream(self, key: str) -> Any:
        """Open an object for streaming; caller must close it."""
        try:
            obj = self._client.get_object(self.cfg.s3_bucket, key)
            return obj
        except (S3Error, MinioException, OSError, ValueError) as exc:
            raise StorageUnavailable() from exc

    def iter_chunks(self, key: str, chunk_size: int = 256 * 1024) -> Any:
        obj = self.open_stream(key)
        return obj
