"""MinIO access: a minimal S3 client signing requests with AWS SigV4."""

from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

from .config import CONFIG
from .httpclient import HttpError, request


class StorageError(Exception):
    """MinIO was unreachable or refused the operation."""


def _signing_key(stamp: str) -> bytes:
    key = f"AWS4{CONFIG.s3_secret_access_key}".encode()
    for part in (stamp, CONFIG.s3_region, "s3", "aws4_request"):
        key = hmac.new(key, part.encode(), hashlib.sha256).digest()
    return key


def _signed(
    method: str, key: str, payload: bytes, content_type: str | None
) -> tuple[str, dict[str, str]]:
    endpoint = urlsplit(CONFIG.s3_endpoint)
    host = endpoint.netloc
    if CONFIG.s3_force_path_style:
        path = "/" + CONFIG.s3_bucket
        if key:
            path = f"{path}/{quote(key, safe='/')}"
    else:
        host = f"{CONFIG.s3_bucket}.{host}"
        path = "/" + quote(key, safe="/") if key else "/"

    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(payload).hexdigest()
    signed = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    if content_type:
        signed["content-type"] = content_type
    names = sorted(signed)
    canonical = "\n".join(
        [
            method,
            path,
            "",
            "".join(f"{n}:{signed[n]}\n" for n in names),
            ";".join(names),
            payload_hash,
        ]
    )
    scope = f"{stamp}/{CONFIG.s3_region}/s3/aws4_request"
    to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            scope,
            hashlib.sha256(canonical.encode()).hexdigest(),
        ]
    )
    signature = hmac.new(
        _signing_key(stamp), to_sign.encode(), hashlib.sha256
    ).hexdigest()
    headers = {k: v for k, v in signed.items() if k != "host"}
    headers["Authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={CONFIG.s3_access_key_id}/{scope}, "
        f"SignedHeaders={';'.join(names)}, Signature={signature}"
    )
    return f"{endpoint.scheme}://{host}{path}", headers


async def _call(
    method: str,
    key: str,
    payload: bytes = b"",
    content_type: str | None = None,
    timeout: float = 10.0,
) -> bytes:
    url, headers = _signed(method, key, payload, content_type)
    try:
        response = await request(
            method, url, headers=headers, body=payload, timeout=timeout
        )
    except HttpError as exc:
        raise StorageError(str(exc))
    if response.status >= 300:
        raise StorageError(f"{method} /{key} answered {response.status}")
    return response.body


async def put_object(key: str, payload: bytes, content_type: str) -> None:
    await _call("PUT", key, payload, content_type)


async def get_object(key: str) -> bytes:
    return await _call("GET", key)


async def confirm_object(key: str) -> tuple[int, str]:
    """Reads the stored object back so an upload can be confirmed."""
    stored = await _call("GET", key)
    return len(stored), hashlib.sha256(stored).hexdigest()


async def ensure_bucket() -> None:
    url, headers = _signed("PUT", "", b"", None)
    try:
        await request("PUT", url, headers=headers, timeout=10.0)
    except HttpError as exc:
        raise StorageError(str(exc))


async def healthy() -> bool:
    try:
        url, headers = _signed("HEAD", "", b"", None)
        response = await request("HEAD", url, headers=headers, timeout=1.0)
        return response.status < 500
    except HttpError:
        return False
