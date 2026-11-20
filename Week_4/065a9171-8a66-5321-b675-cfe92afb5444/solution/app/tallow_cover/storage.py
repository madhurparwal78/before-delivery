"""The private MinIO bucket over S3 Signature Version 4: put, a bucket probe and 60-second presigned GETs."""

import asyncio
import hashlib
import hmac
import http.client
from datetime import UTC, datetime
from urllib.parse import quote, urlsplit

from .config import settings

SIGNED_SECONDS = 60
TIMEOUT_SECONDS = 3
_endpoint = urlsplit(settings.s3_endpoint)


def _location(key: str) -> tuple[str, str]:
    """(host, path) for a key, path-style or virtual-hosted as configured."""
    if settings.s3_force_path_style:
        return _endpoint.netloc, f"/{settings.s3_bucket}/{key}" if key else f"/{settings.s3_bucket}"
    return f"{settings.s3_bucket}.{_endpoint.netloc}", f"/{key}"


def _signing_key(day: str) -> bytes:
    key = f"AWS4{settings.s3_secret_access_key}".encode()
    for part in (day, settings.s3_region, "s3", "aws4_request"):
        key = hmac.new(key, part.encode(), hashlib.sha256).digest()
    return key


def _signature(day: str, amz_date: str, canonical: str) -> str:
    scope = f"{day}/{settings.s3_region}/s3/aws4_request"
    to_sign = f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
    return hmac.new(_signing_key(day), to_sign.encode(), hashlib.sha256).hexdigest()


def _request(method: str, key: str, body: bytes = b"", content_type: str | None = None) -> int:
    host, path = _location(key)
    now = datetime.now(UTC)
    amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    headers = {"host": host, "x-amz-content-sha256": hashlib.sha256(body).hexdigest(), "x-amz-date": amz_date}
    if content_type:
        headers["content-type"] = content_type
    names = sorted(headers)
    canonical = "\n".join([method, quote(path), "", "".join(f"{n}:{headers[n]}\n" for n in names),
                           ";".join(names), headers["x-amz-content-sha256"]])
    headers["authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={settings.s3_access_key_id}/{day}/{settings.s3_region}/s3/aws4_request, "
        f"SignedHeaders={';'.join(names)}, Signature={_signature(day, amz_date, canonical)}")
    connection_type = http.client.HTTPSConnection if _endpoint.scheme == "https" else http.client.HTTPConnection
    connection = connection_type(host, timeout=TIMEOUT_SECONDS)
    try:
        connection.request(method, quote(path), body=body or None, headers=headers)
        return connection.getresponse().status
    finally:
        connection.close()


async def put(key: str, data: bytes, content_type: str) -> bool:
    """True once the object is stored; False when storage cannot be reached, so the caller holds the bytes."""
    try:
        return await asyncio.to_thread(_request, "PUT", key, data, content_type) == 200
    except (OSError, http.client.HTTPException):
        return False


async def reachable() -> bool:
    try:
        return await asyncio.to_thread(_request, "HEAD", "") == 200
    except (OSError, http.client.HTTPException):
        return False


def attachment(file_name: str) -> str:
    """The signed-download disposition: an ASCII fallback name and the exact UTF-8 name."""
    fallback = "".join("_" if not ch.isascii() or ch in '"\\' else ch for ch in file_name)
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(file_name, safe='-._~')}"


def presigned_get(key: str, content_type: str, file_name: str) -> str:
    """A 60-second signed GET for one key, signed with the response type and disposition storage must serve."""
    host, path = _location(key)
    now = datetime.now(UTC)
    amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    credential = f"{settings.s3_access_key_id}/{day}/{settings.s3_region}/s3/aws4_request"
    params = {"X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": credential, "X-Amz-Date": amz_date,
              "X-Amz-Expires": str(SIGNED_SECONDS), "X-Amz-SignedHeaders": "host",
              "response-content-disposition": attachment(file_name), "response-content-type": content_type}
    query = "&".join(f"{quote(k, safe='-_.~')}={quote(v, safe='-_.~')}" for k, v in sorted(params.items()))
    canonical = "\n".join(["GET", quote(path), query, f"host:{host}\n", "host", "UNSIGNED-PAYLOAD"])
    return f"{_endpoint.scheme}://{host}{quote(path)}?{query}&X-Amz-Signature={_signature(day, amz_date, canonical)}"
