"""MinIO object storage through a direct S3 client (AWS SigV4).

The client uses only the standard library plus urllib3, so the shipped
dependency tree carries no package outside the published licence list.
"""
from __future__ import annotations

import hashlib
import hmac
import urllib.parse

import urllib3

REGION = "us-east-1"
SERVICE = "s3"


def _url_encode(value: str) -> str:
    return urllib.parse.quote(value, safe="/")


def _canonical_query(params: dict[str, str]) -> str:
    """The SigV4 canonical query: strictly encoded, then sorted."""
    encoded = sorted((urllib.parse.quote(str(k), safe=""),
                      urllib.parse.quote(str(v), safe=""))
                     for k, v in params.items())
    return "&".join(f"{k}={v}" for k, v in encoded)


def _amz_date_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


class ObjectStorage:
    """The one place that knows the object keys and how to confirm them."""

    def __init__(self, endpoint: str, access_key: str, secret_key: str,
                 bucket: str, secure: bool, region: str | None = None) -> None:
        self.scheme = "https" if secure else "http"
        self.endpoint = endpoint.replace("https://", "").replace("http://", "")
        self.access_key = access_key
        self.secret_key = secret_key
        self.bucket = bucket
        self.region = region or REGION
        self.pool = urllib3.PoolManager(maxsize=8,
                                        timeout=urllib3.Timeout(connect=2, read=15))

    # -------------------------------------------------- request signing

    def _headers(self, method: str, canonical_uri: str, query: str,
                 payload_hash: str, content_type: str | None = None) -> dict:
        """AWS Signature Version 4 headers for one request."""
        amz_date = _amz_date_now()
        headers = {"host": self.endpoint, "x-amz-content-sha256": payload_hash,
                   "x-amz-date": amz_date}
        if content_type:
            headers["content-type"] = content_type
        signed_names = ";".join(sorted(headers))
        canonical_headers = "".join(f"{name}:{headers[name]}\n"
                                    for name in sorted(headers))
        canonical_request = "\n".join([method, canonical_uri, query,
                                       canonical_headers, signed_names,
                                       payload_hash])
        scope = f"{amz_date[:8]}/{self.region}/{SERVICE}/aws4_request"
        digest = hashlib.sha256(canonical_request.encode()).hexdigest()
        string_to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, digest])
        key = f"AWS4{self.secret_key}".encode()
        for part in (amz_date[:8], self.region, SERVICE, "aws4_request"):
            key = hmac.new(key, part.encode(), hashlib.sha256).digest()
        signature = hmac.new(key, string_to_sign.encode(), hashlib.sha256).hexdigest()
        headers["authorization"] = (
            f"AWS4-HMAC-SHA256 Credential={self.access_key}/{scope}, "
            f"SignedHeaders={signed_names}, Signature={signature}")
        return headers

    def _request(self, method: str, path: str, query: str = "",
                 body: bytes = b"", content_type: str | None = None,
                 sent_query: str | None = None,
                 ) -> urllib3.HTTPResponse:
        """One signed request; query signs canonically, sent_query goes on the wire."""
        canonical_uri = _url_encode(f"/{self.bucket}{path}")
        payload_hash = hashlib.sha256(body).hexdigest()
        headers = self._headers(method, canonical_uri, query, payload_hash,
                                 content_type)
        url = f"{self.scheme}://{self.endpoint}{canonical_uri}"
        wire = sent_query if sent_query is not None else query
        if wire:
            url += "?" + wire
        return self.pool.request(method, url, body=body, headers=headers,
                                  preload_content=False, retries=False)

    # -------------------------------------------------- operations

    def available(self) -> bool:
        """True when the service answers at all, whatever it answers."""
        try:
            response = self.pool.request("GET", f"{self.scheme}://{self.endpoint}/",
                                         preload_content=False, retries=False)
            status = response.status
            response.close()
            return status in (200, 301, 400, 403, 404)
        except urllib3.exceptions.HTTPError:
            return False

    def bucket_exists(self) -> bool:
        try:
            response = self._request("HEAD", "/")
            status = response.status
            response.close()
            return status in (200, 204)
        except (OSError, urllib3.exceptions.HTTPError):
            return False

    def ensure_bucket(self) -> None:
        if not self.available():
            raise OSError("storage unreachable")
        if self.bucket_exists():
            return
        response = self._request("PUT", "/")
        response.read()
        response.close()

    def put(self, key: str, data: bytes, content_type: str) -> None:
        response = self._request("PUT", f"/{key}", body=data,
                                 content_type=content_type)
        body = response.read()
        status = response.status
        response.close()
        if status not in (200, 201, 204):
            raise OSError(f"put {key} failed: {status} {body[:200]!r}")

    def get(self, key: str) -> bytes:
        response = self._request("GET", f"/{key}")
        data = response.read()
        status = response.status
        response.close()
        if status != 200:
            raise OSError(f"get {key} failed: {status}")
        return data

    def remove(self, key: str) -> None:
        response = self._request("DELETE", f"/{key}")
        response.read()
        response.close()

    def remove_many(self, keys: list[str]) -> None:
        for key in keys:
            try:
                self.remove(key)
            except OSError:
                pass

    def list_prefix(self, prefix: str) -> list[str]:
        query = _canonical_query({"list-type": "2", "prefix": prefix})
        sent_query = f"list-type=2&prefix={_url_encode(prefix)}"
        response = self._request("GET", "/", query=query, sent_query=sent_query)
        body = response.read()
        response.close()
        return [part.split(b"</Key>")[0].decode()
                for part in body.split(b"<Key>")[1:]]

    # -------------------------------------------------- keys

    def original_key(self, account_id: str, scan_id: str) -> str:
        return f"originals/{account_id}/{scan_id}"

    def preview_key(self, account_id: str, scan_id: str, n: int) -> str:
        return f"previews/{account_id}/{scan_id}/{n}.png"

    def preview_keys(self, account_id: str, scan_id: str, count: int) -> list[str]:
        return [self.preview_key(account_id, scan_id, n) for n in range(count)]

    def store_original(self, account_id: str, scan_id: str, data: bytes,
                       content_type: str) -> None:
        self.put(self.original_key(account_id, scan_id), data, content_type)

    def store_previews(self, account_id: str, scan_id: str,
                       slices: list[bytes]) -> None:
        for n, blob in enumerate(slices):
            self.put(self.preview_key(account_id, scan_id, n), blob, "image/png")

    def read_original(self, account_id: str, scan_id: str) -> bytes:
        return self.get(self.original_key(account_id, scan_id))

    def read_preview(self, account_id: str, scan_id: str, n: int) -> bytes:
        return self.get(self.preview_key(account_id, scan_id, n))

    def delete_scan_objects(self, account_id: str, scan_id: str,
                            preview_count: int) -> None:
        self.remove_many([self.original_key(account_id, scan_id)]
                         + self.preview_keys(account_id, scan_id, preview_count))
