"""MinIO object storage: streamed writes, read-back confirmation and status."""

from __future__ import annotations

import hashlib
import os
import threading
from typing import Iterator

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError

from .config import CONFIG

PART_SIZE = 5 * 1024 * 1024
CHUNK_SIZE = 64 * 1024

_client = None
_client_lock = threading.Lock()
_status_lock = threading.Lock()
_storage_up = False
_bucket_ready = False


class StorageDown(Exception):
    """Storage is unreachable, refusing or wrongly credentialed."""


def _build_client():
    return boto3.client(
        "s3",
        endpoint_url=CONFIG.s3_endpoint,
        region_name=CONFIG.s3_region,
        aws_access_key_id=CONFIG.s3_access_key_id,
        aws_secret_access_key=CONFIG.s3_secret_access_key,
        config=BotoConfig(
            s3={"addressing_style": "path" if CONFIG.s3_force_path_style else "auto"},
            signature_version="s3v4",
            connect_timeout=2,
            read_timeout=4,
            max_pool_connections=64,
            retries={"max_attempts": 1, "mode": "standard"},
        ),
    )


def client():
    global _client
    with _client_lock:
        if _client is None:
            _client = _build_client()
        return _client


def object_key(prefix: str) -> str:
    return f"{prefix}/{os.urandom(20).hex()}"


def check_storage() -> bool:
    """An authenticated bucket check; creates the bucket when it is missing."""
    global _bucket_ready
    try:
        api = client()
        try:
            api.head_bucket(Bucket=CONFIG.s3_bucket)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchBucket") and not _bucket_ready:
                api.create_bucket(Bucket=CONFIG.s3_bucket)
                api.head_bucket(Bucket=CONFIG.s3_bucket)
            else:
                raise
        _bucket_ready = True
        _set_storage(True)
        return True
    except (ClientError, BotoCoreError, OSError):
        _set_storage(False)
        return False


def _set_storage(value: bool) -> None:
    global _storage_up
    with _status_lock:
        _storage_up = value


def storage_up() -> bool:
    with _status_lock:
        return _storage_up


def require_storage() -> None:
    if not storage_up():
        raise StorageDown("storage is down")


class ObjectWriter:
    """Streams a request body into one object without holding it whole in memory."""

    def __init__(self, key: str) -> None:
        self.key = key
        self._buffer = bytearray()
        self._parts: list[dict] = []
        self._upload_id: str | None = None
        self._digest = hashlib.sha256()
        self.size = 0

    def _start(self) -> None:
        if self._upload_id is None:
            try:
                reply = client().create_multipart_upload(
                    Bucket=CONFIG.s3_bucket, Key=self.key
                )
            except (ClientError, BotoCoreError, OSError) as exc:
                raise StorageDown(str(exc)) from exc
            self._upload_id = reply["UploadId"]

    def write(self, chunk: bytes) -> None:
        self._digest.update(chunk)
        self.size += len(chunk)
        self._buffer.extend(chunk)
        while len(self._buffer) >= PART_SIZE:
            self._flush_part(bytes(self._buffer[:PART_SIZE]))
            del self._buffer[:PART_SIZE]

    def _flush_part(self, payload: bytes) -> None:
        self._start()
        number = len(self._parts) + 1
        try:
            reply = client().upload_part(
                Bucket=CONFIG.s3_bucket,
                Key=self.key,
                UploadId=self._upload_id,
                PartNumber=number,
                Body=payload,
            )
        except (ClientError, BotoCoreError, OSError) as exc:
            raise StorageDown(str(exc)) from exc
        self._parts.append({"ETag": reply["ETag"], "PartNumber": number})

    def finish(self) -> tuple[int, str]:
        try:
            if self._upload_id is None:
                put_object(self.key, bytes(self._buffer))
            else:
                if self._buffer:
                    self._flush_part(bytes(self._buffer))
                client().complete_multipart_upload(
                    Bucket=CONFIG.s3_bucket,
                    Key=self.key,
                    UploadId=self._upload_id,
                    MultipartUpload={"Parts": self._parts},
                )
        except (ClientError, BotoCoreError, OSError) as exc:
            raise StorageDown(str(exc)) from exc
        self._buffer = bytearray()
        return self.size, self._digest.hexdigest()

    def abort(self) -> None:
        try:
            if self._upload_id is not None:
                client().abort_multipart_upload(
                    Bucket=CONFIG.s3_bucket, Key=self.key, UploadId=self._upload_id
                )
            else:
                delete_object(self.key)
        except (ClientError, BotoCoreError, OSError):
            pass


def put_object(key: str, payload: bytes) -> None:
    try:
        client().put_object(Bucket=CONFIG.s3_bucket, Key=key, Body=payload)
    except (ClientError, BotoCoreError, OSError) as exc:
        raise StorageDown(str(exc)) from exc


def read_object(key: str) -> bytes:
    try:
        reply = client().get_object(Bucket=CONFIG.s3_bucket, Key=key)
        return reply["Body"].read()
    except (ClientError, BotoCoreError, OSError) as exc:
        raise StorageDown(str(exc)) from exc


def measure_object(key: str) -> tuple[int, str]:
    """Reads an object back from storage, returning its size and digest."""
    try:
        reply = client().get_object(Bucket=CONFIG.s3_bucket, Key=key)
        body = reply["Body"]
        digest = hashlib.sha256()
        size = 0
        while True:
            chunk = body.read(CHUNK_SIZE)
            if not chunk:
                break
            size += len(chunk)
            digest.update(chunk)
        return size, digest.hexdigest()
    except (ClientError, BotoCoreError, OSError) as exc:
        raise StorageDown(str(exc)) from exc


def object_size(key: str) -> int | None:
    try:
        reply = client().head_object(Bucket=CONFIG.s3_bucket, Key=key)
        return int(reply["ContentLength"])
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            return None
        raise StorageDown(str(exc)) from exc
    except (BotoCoreError, OSError) as exc:
        raise StorageDown(str(exc)) from exc


def open_object(key: str):
    """Opens an object for streaming; raises StorageDown when it cannot be opened."""
    try:
        reply = client().get_object(Bucket=CONFIG.s3_bucket, Key=key)
        return reply["Body"]
    except (ClientError, BotoCoreError, OSError) as exc:
        raise StorageDown(str(exc)) from exc


def stream_object(body) -> Iterator[bytes]:
    try:
        while True:
            chunk = body.read(CHUNK_SIZE)
            if not chunk:
                return
            yield chunk
    finally:
        body.close()


def delete_object(key: str) -> None:
    try:
        client().delete_object(Bucket=CONFIG.s3_bucket, Key=key)
    except (ClientError, BotoCoreError, OSError) as exc:
        raise StorageDown(str(exc)) from exc


def object_exists(key: str) -> bool:
    return object_size(key) is not None
