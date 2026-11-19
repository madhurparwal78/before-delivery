"""HTTP clients for the three invented services behind WireMock,
plus the PDF press (Gotenberg) and the object store (MinIO), over the stdlib.

A provider counts as unavailable when it cannot be reached, times out,
answers 5xx or an unreadable body. Raw provider text never escapes this module.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

from .. import config

ACCOUNT = "KG-HOLD-01"


class ProviderUnavailable(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _open(method: str, url: str, *, headers: dict[str, str] | None = None,
           data: bytes | None = None, timeout: float | None = None) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=data, method=method)
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=timeout or config.PROVIDER_TIMEOUT) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, exc.read()
        except Exception:
            return exc.code, b""
    except Exception:
        raise ProviderUnavailable("UNAVAILABLE")


class Registry:
    def __init__(self) -> None:
        self._base = config.WIREMOCK_URL

    async def holdings(self, production_month: str) -> list[dict[str, Any]]:
        query = urllib.parse.urlencode({"account": ACCOUNT, "production_month": production_month})
        status, body = _open("GET", f"{self._base}/registry/v2/holdings?{query}")
        if status >= 500:
            raise ProviderUnavailable("REGISTRY_UNAVAILABLE")
        try:
            parsed = json.loads(body)
            bundles = parsed["bundles"]
            if not isinstance(bundles, list):
                raise ValueError
        except Exception:
            raise ProviderUnavailable("REGISTRY_UNAVAILABLE")
        return bundles

    async def cancel(self, line_id: str, bundle_id: str, range_start: str, range_end: str,
                     hour_utc: str, beneficiary: str) -> dict[str, Any]:
        payload = json.dumps({
            "client_line_id": line_id,
            "bundle_id": bundle_id,
            "range_start_wh": int(range_start),
            "range_end_wh": int(range_end),
            "hour_utc": hour_utc,
            "beneficiary": beneficiary,
        }).encode()
        status, body = _open(
            "POST", f"{self._base}/registry/v2/cancellations", data=payload,
            headers={"Content-Type": "application/json", "Idempotency-Key": line_id},
        )
        if status == 409:
            try:
                if json.loads(body).get("status") == "ALREADY_RECEIVED":
                    return {"status": "ALREADY_RECEIVED"}
            except Exception:
                pass
            return {"status": "REJECTED", "reason": "The registry rejected this line."}
        if 400 <= status < 500:
            try:
                reason = str(json.loads(body).get("reason", "")) or "The registry rejected this line."
            except Exception:
                reason = "The registry rejected this line."
            return {"status": "REJECTED", "reason": reason}
        try:
            parsed = json.loads(body)
            status_word = parsed["status"]
        except Exception:
            raise ProviderUnavailable("REGISTRY_UNAVAILABLE")
        return {"status": status_word}

    async def confirm(self, line_id: str) -> dict[str, Any]:
        status, body = _open("GET", f"{self._base}/registry/v2/cancellations/{line_id}")
        if 400 <= status < 500:
            try:
                parsed = json.loads(body)
                if parsed.get("status") in ("CONFIRMED", "REJECTED"):
                    return {"status": parsed["status"],
                            "confirmed_at": parsed.get("confirmed_at"),
                            "reason": parsed.get("reason")}
            except Exception:
                pass
            return {"status": "REJECTED", "reason": "The registry rejected this line."}
        try:
            parsed = json.loads(body)
            status_word = parsed["status"]
        except Exception:
            raise ProviderUnavailable("REGISTRY_UNAVAILABLE")
        if status_word == "CONFIRMED":
            return {"status": "CONFIRMED", "confirmed_at": parsed.get("confirmed_at")}
        if status_word == "REJECTED":
            return {"status": "REJECTED",
                    "reason": parsed.get("reason") or "The registry rejected this line."}
        return {"status": "PENDING"}


class MeterHub:
    def __init__(self) -> None:
        self._base = config.WIREMOCK_URL

    async def readings(self, meter_id: str, from_hour: str, to_instant: str) -> list[dict[str, Any]]:
        query = urllib.parse.urlencode({"meter": meter_id, "from": from_hour, "to": to_instant})
        status, body = _open("GET", f"{self._base}/hub/v1/readings?{query}")
        if status >= 500:
            raise ProviderUnavailable("METER_HUB_UNAVAILABLE")
        try:
            parsed = json.loads(body)
            runs = parsed["runs"]
            if not isinstance(runs, list):
                raise ValueError
        except Exception:
            raise ProviderUnavailable("METER_HUB_UNAVAILABLE")
        return runs

    async def corrections(self, meter_id: str, since: str) -> list[dict[str, Any]]:
        query = urllib.parse.urlencode({"meter": meter_id, "since": since})
        status, body = _open("GET", f"{self._base}/hub/v1/corrections?{query}")
        if status >= 500:
            raise ProviderUnavailable("METER_HUB_UNAVAILABLE")
        try:
            parsed = json.loads(body)
            corrections = parsed["corrections"]
            if not isinstance(corrections, list):
                raise ValueError
        except Exception:
            raise ProviderUnavailable("METER_HUB_UNAVAILABLE")
        return corrections


class GridFeed:
    def __init__(self) -> None:
        self._base = config.WIREMOCK_URL

    async def factors(self, zone: str, from_hour: str, to_instant: str) -> list[dict[str, Any]]:
        query = urllib.parse.urlencode({"zone": zone, "from": from_hour, "to": to_instant})
        status, body = _open("GET", f"{self._base}/grid/v1/factors?{query}")
        if status >= 500:
            raise ProviderUnavailable("GRID_UNAVAILABLE")
        try:
            parsed = json.loads(body)
            runs = parsed["runs"]
            if not isinstance(runs, list):
                raise ValueError
        except Exception:
            raise ProviderUnavailable("GRID_UNAVAILABLE")
        return runs


class PdfPress:
    """Gotenberg: renders the attestation HTML to PDF."""

    def __init__(self) -> None:
        self._base = config.GOTENBERG_URL

    async def render(self, html: str) -> bytes:
        boundary = "hourproof-attestation"
        content = html.encode("utf-8")
        body = bytearray()
        body += f"--{boundary}\r\n".encode()
        body += (b'Content-Disposition: form-data; name="files"; filename="index.html"\r\n')
        body += b"Content-Type: text/html\r\n\r\n"
        body += content + b"\r\n"
        body += f"--{boundary}--\r\n".encode()
        try:
            status, resp = _open(
                "POST", f"{self._base}/forms/chromium/convert/html",
                data=bytes(body),
                headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
                timeout=config.PROVIDER_TIMEOUT * 2,
            )
        except ProviderUnavailable:
            raise ProviderUnavailable("HELD_PRESS")
        if status >= 400 or not resp.startswith(b"%PDF"):
            raise ProviderUnavailable("HELD_PRESS")
        return resp


class Store:
    """MinIO over its S3-compatible HTTP API, using signed requests."""

    def __init__(self) -> None:
        self._base = config.S3_ENDPOINT
        self._host = config.S3_ENDPOINT.split("://", 1)[1]

    def _auth(self, method: str, key: str, payload: bytes,
              content_type: str | None = None) -> tuple[dict[str, str], str, str]:
        amz_date = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        date_stamp = amz_date[:8]
        if config.S3_FORCE_PATH_STYLE:
            canonical_uri = f"/{config.S3_BUCKET}/{key}"
            host = self._host
        else:
            canonical_uri = f"/{key}"
            host = f"{config.S3_BUCKET}.{self._host}"
        payload_hash = hashlib.sha256(payload).hexdigest()
        headers: dict[str, str] = {
            "host": host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date,
        }
        if content_type:
            headers["content-type"] = content_type
        signed_headers = ";".join(sorted(headers))
        canonical_headers = "".join(f"{h}:{headers[h]}\n" for h in sorted(headers))
        canonical_request = "\n".join([
            method, canonical_uri, "", canonical_headers, signed_headers, payload_hash,
        ])
        scope = f"{date_stamp}/{config.S3_REGION}/s3/aws4_request"
        to_sign = "\n".join([
            "AWS4-HMAC-SHA256", amz_date, scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ])
        secret = ("AWS4" + config.S3_SECRET_ACCESS_KEY).encode()
        digest = hmac.new(secret, date_stamp.encode(), hashlib.sha256).digest()
        digest = hmac.new(digest, config.S3_REGION.encode(), hashlib.sha256).digest()
        digest = hmac.new(digest, b"s3", hashlib.sha256).digest()
        digest = hmac.new(digest, b"aws4_request", hashlib.sha256).digest()
        signature = hmac.new(digest, to_sign.encode(), hashlib.sha256).hexdigest()
        auth = (f"AWS4-HMAC-SHA256 Credential={config.S3_ACCESS_KEY_ID}/{scope}, "
                f"SignedHeaders={signed_headers}, Signature={signature}")
        return headers, auth, canonical_uri

    async def put(self, key: str, data: bytes, content_type: str = "application/pdf") -> None:
        headers, auth, uri = self._auth("PUT", key, data, content_type)
        headers["Authorization"] = auth
        headers["Content-Length"] = str(len(data))
        try:
            status, _ = _open("PUT", f"{self._base}{uri}", data=data, headers=headers)
        except ProviderUnavailable:
            raise ProviderUnavailable("HELD_STORE")
        if status >= 400:
            raise ProviderUnavailable("HELD_STORE")

    async def get(self, key: str) -> bytes:
        headers, auth, uri = self._auth("GET", key, b"")
        headers["Authorization"] = auth
        try:
            status, body = _open("GET", f"{self._base}{uri}", headers=headers)
        except ProviderUnavailable:
            raise ProviderUnavailable("STORE_UNAVAILABLE")
        if status == 404:
            raise ProviderUnavailable("STORE_MISSING")
        if status >= 400:
            raise ProviderUnavailable("STORE_UNAVAILABLE")
        return body

    async def ensure_bucket(self) -> None:
        headers, auth, _ = self._auth("PUT", "", b"")
        headers["Authorization"] = auth
        headers["Content-Length"] = "0"
        try:
            _open("PUT", f"{self._base}/{config.S3_BUCKET}", data=b"", headers=headers)
        except ProviderUnavailable:
            return


REGISTRY = Registry()
METER_HUB = MeterHub()
GRID_FEED = GridFeed()
PRESS = PdfPress()
STORE = Store()
