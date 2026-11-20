"""The private object bucket: uploads and 60-second signed downloads."""

from __future__ import annotations

import hashlib
import hmac
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urlparse

from .config import CONFIG

SIGNED_DOWNLOAD_SECONDS = 60
_ALGORITHM = "AWS4-HMAC-SHA256"
_UNRESERVED = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")


def _quote(text: str, keep_slash: bool = False) -> str:
    out = []
    for byte in text.encode("utf-8"):
        character = chr(byte)
        if character in _UNRESERVED or (keep_slash and character == "/"):
            out.append(character)
        else:
            out.append(f"%{byte:02X}")
    return "".join(out)


def _sign(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(stamp: str) -> bytes:
    key = f"AWS4{CONFIG.s3_secret_access_key}".encode("utf-8")
    key = _sign(key, stamp)
    key = _sign(key, CONFIG.s3_region)
    key = _sign(key, "s3")
    return _sign(key, "aws4_request")


def _endpoint() -> tuple[str, str]:
    parsed = urlparse(CONFIG.s3_endpoint)
    return f"{parsed.scheme}://{parsed.netloc}", parsed.netloc


def _canonical_uri(key: str) -> str:
    bucket = f"/{_quote(CONFIG.s3_bucket)}"
    return f"{bucket}/{_quote(key, keep_slash=True)}" if key else bucket


def content_disposition(file_name: str) -> str:
    """attachment; filename="<fallback>"; filename*=UTF-8''<encoded>"""
    fallback = "".join(
        "_" if (ord(character) > 127 or character in '"\\') else character
        for character in file_name
    )
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{_quote(file_name)}"


def presign_get(key: str, response_content_type: str, file_name: str) -> str:
    """A GET link for one object key, signed with its response headers, good for 60s."""
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    stamp = now.strftime("%Y%m%d")
    scope = f"{stamp}/{CONFIG.s3_region}/s3/aws4_request"
    base, host = _endpoint()
    query = {
        "X-Amz-Algorithm": _ALGORITHM,
        "X-Amz-Credential": f"{CONFIG.s3_access_key_id}/{scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": str(SIGNED_DOWNLOAD_SECONDS),
        "X-Amz-SignedHeaders": "host",
        "response-content-disposition": content_disposition(file_name),
        "response-content-type": response_content_type,
    }
    canonical_query = "&".join(f"{_quote(name)}={_quote(query[name])}" for name in sorted(query))
    canonical_request = "\n".join(
        [
            "GET",
            _canonical_uri(key),
            canonical_query,
            f"host:{host}\n",
            "host",
            "UNSIGNED-PAYLOAD",
        ]
    )
    to_sign = "\n".join(
        [
            _ALGORITHM,
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signature = hmac.new(_signing_key(stamp), to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{base}{_canonical_uri(key)}?{canonical_query}&X-Amz-Signature={signature}"


def _signed_request(method: str, key: str, body: bytes, content_type: str | None):
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    stamp = now.strftime("%Y%m%d")
    scope = f"{stamp}/{CONFIG.s3_region}/s3/aws4_request"
    base, host = _endpoint()
    payload_hash = hashlib.sha256(body).hexdigest()
    headers = {"host": host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date}
    if content_type:
        headers["content-type"] = content_type
    signed_headers = ";".join(sorted(headers))
    canonical_headers = "".join(f"{name}:{headers[name]}\n" for name in sorted(headers))
    canonical_request = "\n".join(
        [method, _canonical_uri(key), "", canonical_headers, signed_headers, payload_hash]
    )
    to_sign = "\n".join(
        [
            _ALGORITHM,
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signature = hmac.new(_signing_key(stamp), to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    headers["authorization"] = (
        f"{_ALGORITHM} Credential={CONFIG.s3_access_key_id}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    request = urllib.request.Request(f"{base}{_canonical_uri(key)}", data=body, method=method)
    for name, value in headers.items():
        request.add_header(name, value)
    return request


def put_object(key: str, content: bytes, content_type: str) -> None:
    request = _signed_request("PUT", key, content, content_type)
    with urllib.request.urlopen(request, timeout=10) as response:
        response.read()


def reachable() -> bool:
    try:
        request = _signed_request("HEAD", "", b"", None)
        with urllib.request.urlopen(request, timeout=5) as response:
            response.read()
        return True
    except urllib.error.HTTPError as error:
        return error.code < 500
    except OSError:
        return False
