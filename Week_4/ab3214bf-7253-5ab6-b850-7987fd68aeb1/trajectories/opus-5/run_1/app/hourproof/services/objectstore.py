"""MinIO: the private store that holds the only copy of each attestation PDF."""

from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timezone
from urllib.parse import quote, urlparse

from ..config import CONFIG
from . import http

SERVICE = "s3"
ALGORITHM = "AWS4-HMAC-SHA256"
CONTENT_TYPE = "application/pdf"


def ensure_bucket() -> None:
    response = _signed("PUT", "", b"", {}, bucket_only=True)
    if response.status not in (200, 409):
        raise http.ProviderUnavailable(f"store bucket {response.status}")


def put(key: str, data: bytes) -> None:
    response = _signed("PUT", key, data, {"Content-Type": CONTENT_TYPE})
    if response.status not in (200, 201):
        raise http.ProviderUnavailable(f"store put {response.status}")


def get(key: str) -> bytes:
    response = _signed("GET", key, b"", {})
    if response.status != 200:
        raise http.ProviderUnavailable(f"store get {response.status}")
    return response.data


def _signed(
    method: str,
    key: str,
    data: bytes,
    extra_headers: dict[str, str],
    bucket_only: bool = False,
) -> http.ProviderResponse:
    endpoint = urlparse(CONFIG.s3_endpoint)
    if bucket_only:
        path = f"/{CONFIG.s3_bucket}"
    elif CONFIG.s3_force_path_style:
        path = f"/{CONFIG.s3_bucket}/{quote(key)}"
    else:
        path = f"/{quote(key)}"
    host = endpoint.netloc
    if not CONFIG.s3_force_path_style:
        host = f"{CONFIG.s3_bucket}.{host}"
    moment = datetime.now(timezone.utc)
    stamp = moment.strftime("%Y%m%dT%H%M%SZ")
    date = moment.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(data).hexdigest()
    headers = {
        "Host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": stamp,
        **extra_headers,
    }
    signed_names = sorted(name.lower() for name in headers)
    canonical_headers = "".join(
        f"{name}:{_header_value(headers, name)}\n" for name in signed_names
    )
    signed_headers = ";".join(signed_names)
    canonical_request = "\n".join(
        [method, path, "", canonical_headers, signed_headers, payload_hash]
    )
    scope = f"{date}/{CONFIG.s3_region}/{SERVICE}/aws4_request"
    to_sign = "\n".join(
        [
            ALGORITHM,
            stamp,
            scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signing_key = _signing_key(date)
    signature = hmac.new(signing_key, to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    headers["Authorization"] = (
        f"{ALGORITHM} Credential={CONFIG.s3_access_key_id}/{scope},"
        f" SignedHeaders={signed_headers}, Signature={signature}"
    )
    url = f"{endpoint.scheme}://{endpoint.netloc}{path}"
    return http.request(method, url, body=data or None, headers=headers)


def _header_value(headers: dict[str, str], lowered: str) -> str:
    for name, value in headers.items():
        if name.lower() == lowered:
            return value.strip()
    raise KeyError(lowered)


def _signing_key(date: str) -> bytes:
    key = f"AWS4{CONFIG.s3_secret_access_key}".encode("utf-8")
    for part in (date, CONFIG.s3_region, SERVICE, "aws4_request"):
        key = hmac.new(key, part.encode("utf-8"), hashlib.sha256).digest()
    return key
