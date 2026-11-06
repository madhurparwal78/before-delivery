"""MinIO object storage: originals and preview slices, signed with AWS SigV4."""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import urllib.error
import urllib.parse
import urllib.request

from .config import CONFIG

EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
DATA_TIMEOUT = 10.0
PROBE_TIMEOUT = 3.0


class StorageUnavailable(Exception):
    """Storage could not be reached or refused the operation."""


def original_key(account_id: str, scan_id: str) -> str:
    return f"originals/{account_id}/{scan_id}"


def preview_key(account_id: str, scan_id: str, n: int) -> str:
    return f"previews/{account_id}/{scan_id}/{n}.png"


def _sign_key(date_stamp: str) -> bytes:
    def mac(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode(), hashlib.sha256).digest()

    key = mac(f"AWS4{CONFIG.s3_secret_access_key}".encode(), date_stamp)
    key = mac(key, CONFIG.s3_region)
    key = mac(key, "s3")
    return mac(key, "aws4_request")


def _request(
    method: str,
    key: str,
    *,
    body: bytes | None = None,
    content_type: str | None = None,
    query: str = "",
    timeout: float = DATA_TIMEOUT,
) -> bytes:
    path = "/" + CONFIG.s3_bucket
    if key:
        path += "/" + key
    canonical_uri = urllib.parse.quote(path, safe="/")
    url = CONFIG.s3_endpoint + canonical_uri + (("?" + query) if query else "")
    host = urllib.parse.urlsplit(CONFIG.s3_endpoint).netloc

    payload = body if body is not None else b""
    payload_hash = hashlib.sha256(payload).hexdigest() if payload else EMPTY_SHA256
    amz_date = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    date_stamp = amz_date[:8]

    canonical_headers = (
        f"host:{host}\n"
        f"x-amz-content-sha256:{payload_hash}\n"
        f"x-amz-date:{amz_date}\n"
    )
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join(
        [
            method,
            canonical_uri,
            query,
            canonical_headers,
            signed_headers,
            payload_hash,
        ]
    )
    scope = f"{date_stamp}/{CONFIG.s3_region}/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ]
    )
    signature = hmac.new(
        _sign_key(date_stamp), string_to_sign.encode(), hashlib.sha256
    ).hexdigest()
    authorization = (
        f"AWS4-HMAC-SHA256 Credential={CONFIG.s3_access_key_id}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    headers = {
        "Authorization": authorization,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "Host": host,
    }
    if content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        raise StorageUnavailable(f"{method} {key} answered {exc.code}") from exc
    except (urllib.error.URLError, OSError) as exc:
        raise StorageUnavailable(f"{method} {key} failed: {exc}") from exc


def ensure_bucket() -> None:
    try:
        _request("HEAD", "")
    except StorageUnavailable:
        _request("PUT", "")


def available() -> bool:
    try:
        _request("HEAD", "", timeout=PROBE_TIMEOUT)
    except StorageUnavailable:
        return False
    return True


def put_object(key: str, body: bytes, content_type: str) -> None:
    _request("PUT", key, body=body, content_type=content_type)


def get_object(key: str) -> bytes:
    return _request("GET", key)


def delete_object(key: str) -> None:
    try:
        _request("DELETE", key)
    except StorageUnavailable:
        pass
