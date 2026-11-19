"""MinIO object storage for frames and calibration masters."""
from __future__ import annotations

import hashlib
from typing import Optional

from minio import Minio

from darkframe.common.http import ApiError


class FrameStorage:
    def __init__(self, endpoint: str, access_key: str, secret_key: str,
                 bucket: str, region: str, secure: bool) -> None:
        self.bucket = bucket
        host, _, port = endpoint.partition("://")
        host = endpoint.split("://", 1)[-1]
        self.client = Minio(
            host, access_key=access_key, secret_key=secret_key,
            secure=endpoint.startswith("https"), region=region,
        )

    def ensure_bucket(self) -> None:
        try:
            if not self.client.bucket_exists(self.bucket):
                self.client.make_bucket(self.bucket)
        except Exception:
            pass  # Retried lazily on each upload.

    def put(self, key: str, data: bytes, content_type: str) -> dict:
        try:
            from io import BytesIO

            self.ensure_bucket()
            self.client.put_object(
                self.bucket, key, BytesIO(data), length=len(data),
                content_type=content_type,
            )
            stat = self.client.stat_object(self.bucket, key)
            if int(stat.size) != len(data):
                raise RuntimeError("size mismatch")
            return {"size_bytes": int(stat.size), "sha256": hashlib.sha256(data).hexdigest()}
        except ApiError:
            raise
        except Exception:
            raise ApiError(503, "storage_unavailable", "Frame storage is unreachable.")

    def get(self, key: str) -> tuple[bytes, str]:
        try:
            response = self.client.get_object(self.bucket, key)
            data = response.read()
            response.close()
            response.release_conn()
            return data, (response.headers.get("Content-Type") or "application/octet-stream")
        except ApiError:
            raise
        except Exception:
            raise ApiError(503, "storage_unavailable", "Frame storage is unreachable.")

    def delete(self, key: str) -> None:
        try:
            self.client.remove_object(self.bucket, key)
        except Exception:
            pass


_STORAGE: Optional[FrameStorage] = None


def init_storage(endpoint: str, access_key: str, secret_key: str, bucket: str,
                 region: str) -> FrameStorage:
    global _STORAGE
    _STORAGE = FrameStorage(endpoint, access_key, secret_key, bucket, region, False)
    return _STORAGE


def storage() -> FrameStorage:
    assert _STORAGE is not None
    return _STORAGE
