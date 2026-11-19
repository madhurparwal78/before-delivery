"""MinIO object storage over the S3 API, signed with AWS Signature Version 4. Objects are private."""

import hashlib
import hmac
import logging
from datetime import UTC, datetime
from urllib.parse import quote, urlsplit

import httpx

from .config import settings

_client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0))
log = logging.getLogger("tailboard.storage")


class StorageUnavailable(Exception):
    """MinIO could not be reached or refused the request."""


def content_key(prefix: str, data: bytes, extension: str) -> tuple[str, str]:
    """Content-addressed key: <prefix>/<lowercase sha256>.<extension>, plus the digest."""
    digest = hashlib.sha256(data).hexdigest()
    return f"{prefix}/{digest}.{extension}", digest


def _url_and_host(key: str | None) -> tuple[str, str, str]:
    endpoint = urlsplit(settings.s3_endpoint)
    tail = "/" + quote(key, safe="/-_.~") if key else "/"
    if settings.s3_path_style:
        host, path = endpoint.netloc, f"/{settings.s3_bucket}" + (tail if key else "")
    else:
        host, path = f"{settings.s3_bucket}.{endpoint.netloc}", tail
    return f"{endpoint.scheme}://{host}{path}", host, path


def _sign(method: str, host: str, path: str, payload_hash: str, extra: dict[str, str]) -> dict[str, str]:
    now = datetime.now(UTC)
    amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    headers = {"host": host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date,
               **{k.lower(): v for k, v in extra.items()}}
    names = sorted(headers)
    signed = ";".join(names)
    canonical = "\n".join([method, path, "", "".join(f"{n}:{headers[n].strip()}\n" for n in names), signed,
                           payload_hash])
    scope = f"{day}/{settings.s3_region}/s3/aws4_request"
    to_sign = f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
    key = f"AWS4{settings.s3_secret_key}".encode()
    for part in (day, settings.s3_region, "s3", "aws4_request"):
        key = hmac.new(key, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    headers["authorization"] = (f"AWS4-HMAC-SHA256 Credential={settings.s3_access_key}/{scope}, "
                                f"SignedHeaders={signed}, Signature={signature}")
    del headers["host"]
    return headers


async def _request(method: str, key: str | None, body: bytes = b"", content_type: str | None = None) -> httpx.Response:
    url, host, path = _url_and_host(key)
    extra = {"content-type": content_type} if content_type else {}
    headers = _sign(method, host, path, hashlib.sha256(body).hexdigest(), extra)
    try:
        response = await _client.request(method, url, content=body or None, headers=headers)
    except httpx.HTTPError as error:
        log.warning("object storage %s %s failed (%s)", method, key, type(error).__name__)
        raise StorageUnavailable(str(error)) from error
    if response.status_code >= 500 or response.status_code in (401, 403):
        log.warning("object storage %s %s answered %s", method, key, response.status_code)
        raise StorageUnavailable(f"{method} {key}: {response.status_code}")
    return response


async def put(key: str, data: bytes, content_type: str) -> None:
    response = await _request("PUT", key, data, content_type)
    if response.status_code != 200:
        raise StorageUnavailable(f"PUT {key}: {response.status_code}")


async def get(key: str) -> bytes | None:
    response = await _request("GET", key)
    return response.content if response.status_code == 200 else None


async def exists(key: str) -> bool:
    return (await _request("HEAD", key)).status_code == 200


async def delete(key: str) -> None:
    await _request("DELETE", key)


async def ensure_bucket() -> None:
    """Create the bucket when it is missing (a fresh store), leaving an existing one untouched."""
    if (await _request("HEAD", None)).status_code == 404:
        await _request("PUT", None)

