"""The services behind the desk: certificate registry, meter hub and grid-factor feed (all WireMock here),
the PDF press (Gotenberg) and the object store (MinIO). Every call has a five second timeout and
every failure is reduced to ProviderDown so provider text never travels further."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import http.client
import json
import uuid
from datetime import datetime, timezone
from urllib.parse import quote, urlencode, urlsplit

from .config import Settings
from .jsontypes import JsonObject

TIMEOUT_SECONDS = 5
RENDER_TIMEOUT_SECONDS = 30
REGISTRY_ACCOUNT = "KG-HOLD-01"
SIGV4_ALGORITHM = "AWS4-HMAC-SHA256"
SIGV4_PREFIX = "AWS4"
SIGV4_SERVICE = "s3"
SIGV4_TERMINATOR = "aws4" + "_request"
AMZ_HEADER = "x-amz-"


class ProviderDown(Exception):
    """The provider could not be reached, timed out, answered 5xx or answered an unreadable body."""


def _exchange(
    base_url: str, method: str, target: str, body: bytes, headers: dict[str, str] | None, timeout: int
) -> tuple[int, bytes]:
    parts = urlsplit(base_url)
    connection_class = http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
    connection = connection_class(parts.hostname or "", parts.port, timeout=timeout)
    try:
        connection.request(method, parts.path.rstrip("/") + target, body=body or None, headers=headers or {})
        response = connection.getresponse()
        return response.status, response.read()
    except (OSError, http.client.HTTPException) as error:
        raise ProviderDown from error
    finally:
        connection.close()


async def _call(
    base_url: str,
    method: str,
    target: str,
    body: bytes = b"",
    headers: dict[str, str] | None = None,
    timeout: int = TIMEOUT_SECONDS,
) -> tuple[int, bytes]:
    status, payload = await asyncio.to_thread(_exchange, base_url, method, target, body, headers, timeout)
    if status >= 500:
        raise ProviderDown
    return status, payload


def _json(payload: bytes) -> object:
    try:
        return json.loads(payload)
    except ValueError as error:
        raise ProviderDown from error


class Registry:
    """The certificate registry. `reachable` is set by the latest call alone."""

    def __init__(self, settings: Settings) -> None:
        self._url = settings.wiremock_url
        self.reachable = True

    async def _call(
        self, method: str, target: str, body: bytes = b"", headers: dict[str, str] | None = None
    ) -> tuple[int, bytes]:
        try:
            result = await _call(self._url, method, target, body, headers)
        except ProviderDown:
            self.reachable = False
            raise
        self.reachable = True
        return result

    async def holdings(self, production_month: str) -> list[object]:
        query = urlencode({"account": REGISTRY_ACCOUNT, "production_month": production_month})
        status, payload = await self._call("GET", f"/registry/v2/holdings?{query}")
        document = _json(payload)
        if status != 200 or not isinstance(document, dict) or not isinstance(document.get("bundles"), list):
            raise ProviderDown
        return document["bundles"]

    async def submit(self, line_id: str, document: JsonObject) -> tuple[str, str | None]:
        """Send one cancellation line: ('Pending', None) or ('Rejected', the registry's reason)."""
        headers = {"Content-Type": "application/json", "Idempotency-Key": line_id}
        status, payload = await self._call("POST", "/registry/v2/cancellations", json.dumps(document).encode(), headers)
        if 200 <= status < 300:
            return "Pending", None
        answer = _json(payload) if payload else {}
        if status == 409 and isinstance(answer, dict) and answer.get("status") == "ALREADY_RECEIVED":
            return "Pending", None
        if 400 <= status < 500:
            reason = answer.get("reason") if isinstance(answer, dict) else None
            return "Rejected", reason if isinstance(reason, str) else None
        raise ProviderDown

    async def confirmation(self, line_id: str) -> tuple[str, str | None]:
        status, payload = await self._call("GET", f"/registry/v2/cancellations/{quote(line_id)}")
        document = _json(payload)
        if (
            status != 200
            or not isinstance(document, dict)
            or document.get("status") not in ("CONFIRMED", "PENDING", "REJECTED")
        ):
            raise ProviderDown
        reason = document.get("reason")
        return document["status"], reason if isinstance(reason, str) else None


class MeterHub:
    def __init__(self, settings: Settings) -> None:
        self._url = settings.wiremock_url

    async def _get(self, target: str, key: str) -> list[object]:
        status, payload = await _call(self._url, "GET", target)
        document = _json(payload)
        if status != 200 or not isinstance(document, dict) or not isinstance(document.get(key), list):
            raise ProviderDown
        return document[key]

    async def readings(self, meter: str, first: datetime, end: datetime) -> list[object]:
        query = urlencode({"meter": meter, "from": _instant(first), "to": _instant(end)})
        return await self._get(f"/hub/v1/readings?{query}", "runs")

    async def corrections(self, meter: str, since: datetime) -> list[object]:
        query = urlencode({"meter": meter, "since": _instant(since)})
        return await self._get(f"/hub/v1/corrections?{query}", "corrections")


class GridFeed:
    def __init__(self, settings: Settings) -> None:
        self._url = settings.wiremock_url

    async def factors(self, zone: str, first: datetime, end: datetime) -> list[object]:
        query = urlencode({"zone": zone, "from": _instant(first), "to": _instant(end)})
        status, payload = await _call(self._url, "GET", f"/grid/v1/factors?{query}")
        document = _json(payload)
        if status != 200 or not isinstance(document, dict) or not isinstance(document.get("runs"), list):
            raise ProviderDown
        return document["runs"]


class Press:
    def __init__(self, settings: Settings) -> None:
        self._url = settings.gotenberg_url

    async def render(self, html: str) -> bytes:
        boundary = uuid.uuid4().hex
        body = (
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="index.html"\r\n'
                f"Content-Type: text/html; charset=utf-8\r\n\r\n"
            ).encode()
            + html.encode()
            + f"\r\n--{boundary}--\r\n".encode()
        )
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        status, payload = await _call(
            self._url, "POST", "/forms/chromium/convert/html", body, headers, RENDER_TIMEOUT_SECONDS
        )
        if status != 200 or not payload.startswith(b"%PDF"):
            raise ProviderDown
        return payload


class Store:
    """The private PDF bucket, spoken to with signed requests, path-style unless S3_FORCE_PATH_STYLE is false."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def _addressing(self, path: str) -> tuple[str, str, str]:
        """(endpoint, host header, request path): path-style unless S3_FORCE_PATH_STYLE says virtual-hosted."""
        settings = self._settings
        parts = urlsplit(settings.s3_endpoint)
        if settings.s3_force_path_style:
            return settings.s3_endpoint, parts.netloc, path
        host = f"{settings.s3_bucket}.{parts.netloc}"
        stripped = path[len(settings.s3_bucket) + 1:] or "/"
        return f"{parts.scheme}://{host}{parts.path}", host, stripped

    def _signed(self, method: str, host: str, path: str, payload: bytes, content_type: str | None) -> dict[str, str]:
        settings = self._settings
        now = datetime.now(timezone.utc)
        stamp, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
        payload_hash = hashlib.sha256(payload).hexdigest()
        headers = {
            "host": host,
            f"{AMZ_HEADER}content-sha256": payload_hash,
            f"{AMZ_HEADER}date": stamp,
        }
        signed = ";".join(headers)
        scope = f"{day}/{settings.s3_region}/{SIGV4_SERVICE}/{SIGV4_TERMINATOR}"
        canonical = "\n".join(
            [method, quote(path), "", "".join(f"{k}:{v}\n" for k, v in headers.items()), signed, payload_hash]
        )
        to_sign = f"{SIGV4_ALGORITHM}\n{stamp}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
        key = f"{SIGV4_PREFIX}{settings.s3_secret_access_key}".encode()
        for part in (day, settings.s3_region, SIGV4_SERVICE, SIGV4_TERMINATOR):
            key = hmac.new(key, part.encode(), hashlib.sha256).digest()
        signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
        headers["Authorization"] = (
            f"{SIGV4_ALGORITHM} Credential={settings.s3_access_key_id}/{scope}, "
            f"SignedHeaders={signed}, Signature={signature}"
        )
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    async def _request(
        self, method: str, path: str, payload: bytes = b"", content_type: str | None = None
    ) -> tuple[int, bytes]:
        endpoint, host, target = self._addressing(path)
        headers = self._signed(method, host, target, payload, content_type)
        return await _call(endpoint, method, quote(target), payload, headers)

    async def get(self, key: str) -> bytes | None:
        """The stored bytes, or None when no object has that key."""
        status, payload = await self._request("GET", f"/{self._settings.s3_bucket}/{key}")
        if status == 404:
            return None
        if status != 200:
            raise ProviderDown
        return payload

    async def put(self, key: str, pdf: bytes) -> None:
        path = f"/{self._settings.s3_bucket}/{key}"
        status, _ = await self._request("PUT", path, pdf, "application/pdf")
        if status == 404:
            await self._request("PUT", f"/{self._settings.s3_bucket}")
            status, _ = await self._request("PUT", path, pdf, "application/pdf")
        if status not in (200, 201, 204):
            raise ProviderDown


def _instant(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
