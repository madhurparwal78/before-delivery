"""Private object storage. Keys are the lowercase hex SHA-256 of the object bytes."""

import hashlib
import threading

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError

from .config import config
from .errors import ApiError

_lock = threading.Lock()
_client = None
_bucket_ready = False


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def document_key(digest):
    return f"directives/{digest}.pdf"


EVIDENCE_SUFFIX = {"image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf"}


def evidence_key(digest, content_type):
    return f"evidence/{digest}.{EVIDENCE_SUFFIX[content_type]}"


def pack_key(digest, suffix):
    return f"packs/{digest}.{suffix}"


def _get_client():
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=config.s3_endpoint,
            region_name=config.s3_region,
            aws_access_key_id=config.s3_access_key_id,
            aws_secret_access_key=config.s3_secret_access_key,
            config=BotoConfig(
                signature_version="s3v4",
                s3={"addressing_style": "path" if config.s3_force_path_style else "auto"},
                connect_timeout=3,
                read_timeout=8,
                retries={"max_attempts": 1},
            ),
        )
    return _client


def ensure_bucket():
    """Create the bucket when it is absent, at start or on the first attempt after
    object storage returns."""
    global _bucket_ready
    if _bucket_ready:
        return
    with _lock:
        if _bucket_ready:
            return
        client = _get_client()
        try:
            client.head_bucket(Bucket=config.s3_bucket)
        except ClientError as error:
            status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if status not in (404, 403):
                raise unavailable() from error
            try:
                client.create_bucket(Bucket=config.s3_bucket)
            except ClientError as create_error:
                code = create_error.response.get("Error", {}).get("Code")
                if code not in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
                    raise unavailable() from create_error
        except BotoCoreError as error:
            raise unavailable() from error
        _bucket_ready = True


def unavailable():
    return ApiError("storage_unavailable", "Object storage is unavailable.")


def _forget_bucket():
    """A failed object call means the bucket must be checked again next time."""
    global _bucket_ready
    _bucket_ready = False


def put(key, data, content_type):
    ensure_bucket()
    try:
        _get_client().put_object(
            Bucket=config.s3_bucket, Key=key, Body=data, ContentType=content_type
        )
    except (ClientError, BotoCoreError) as error:
        _forget_bucket()
        raise unavailable() from error
    return key


def get(key):
    ensure_bucket()
    try:
        response = _get_client().get_object(Bucket=config.s3_bucket, Key=key)
        return response["Body"].read()
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        if code in ("NoSuchKey", "404"):
            return None
        _forget_bucket()
        raise unavailable() from error
    except BotoCoreError as error:
        _forget_bucket()
        raise unavailable() from error


def delete(key):
    ensure_bucket()
    try:
        _get_client().delete_object(Bucket=config.s3_bucket, Key=key)
    except (ClientError, BotoCoreError) as error:
        _forget_bucket()
        raise unavailable() from error
