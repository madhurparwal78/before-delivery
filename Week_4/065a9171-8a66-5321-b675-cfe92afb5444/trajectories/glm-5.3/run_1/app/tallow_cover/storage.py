"""Private object storage: SigV4 requests, held uploads for outages, and 60-second
presigned downloads that fix the response type and disposition.

Files never reach storage under a name anyone typed: fit notes live at
fit-notes/<home>/<sickness>/<upload id>.<ext> and exports at
exports/timesheets/<period>/<export id>.csv.
"""
import datetime as dt
import hashlib
import hmac
import re
import time
import urllib.error
import urllib.parse
import urllib.request

ALGORITHM = "AWS4-HMAC-SHA256"


def disposition_file_name(name):
    """The one signed-disposition rule: fallback plus RFC 5987 encoded form."""
    fallback = re.sub(r"[^\x00-\x7f]", "_", name).replace('"', "_").replace("\\", "_")
    encoded = urllib.parse.quote(name, safe="")
    return f'attachment; filename="{fallback}"; filename*=UTF-8\'\'{encoded}'


class Storage:
    def __init__(self, config):
        self.config = config
        self.ok = False
        self.checked_at = 0.0

    @property
    def up(self):
        return self.ok and time.time() - self.checked_at < 10

    # --- request building ----------------------------------------------------

    def _target(self, object_key):
        parsed = urllib.parse.urlparse(self.config.s3_endpoint)
        host = parsed.netloc
        base_path = parsed.path.rstrip("/")
        if self.config.s3_force_path_style:
            return host, f"{base_path}/{self.config.s3_bucket}/{object_key}"
        return f"{self.config.s3_bucket}.{host}", f"{base_path}/{object_key}"

    def _canonical_query(self, params):
        params = sorted(params)
        return "&".join(f"{k}={urllib.parse.quote(v, safe='')}" for k, v in params)

    def _sign(self, method, host, uri, canonical_query, payload_hash, headers):
        now = dt.datetime.now(dt.UTC)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")
        scope = f"{date_stamp}/{self.config.s3_region}/s3/aws4_request"
        header_lines = "".join(f"{k}:{v}\n" for k, v in headers)
        signed_names = ";".join(k for k, _ in headers)
        canonical_request = "\n".join([
            method, uri, canonical_query, header_lines, signed_names, payload_hash])
        string_to_sign = "\n".join([
            ALGORITHM, amz_date, scope,
            hashlib.sha256(canonical_request.encode()).hexdigest()])
        key = hmac.new(("AWS4" + self.config.s3_secret_access_key).encode(),
                       date_stamp.encode(), hashlib.sha256).digest()
        for part in (self.config.s3_region, "s3", "aws4_request"):
            key = hmac.new(key, part.encode(), hashlib.sha256).digest()
        signature = hmac.new(key, string_to_sign.encode(), hashlib.sha256).hexdigest()
        authorization = (f"{ALGORITHM} Credential={self.config.s3_access_key_id}/{scope},"
                         f"SignedHeaders={signed_names}, Signature={signature}")
        return amz_date, authorization

    def _request(self, method, object_key, payload=None, query_params=(),
                 extra_headers=None, timeout=10):
        host, uri = self._target(object_key)
        canonical_query = self._canonical_query(query_params)
        payload_bytes = payload or b""
        payload_hash = hashlib.sha256(payload_bytes).hexdigest()
        headers = [("host", host), ("x-amz-content-sha256", payload_hash)]
        amz_date, authorization = self._sign(
            method, host, uri, canonical_query, payload_hash, headers)
        parsed = urllib.parse.urlparse(self.config.s3_endpoint)
        scheme = parsed.scheme or "http"
        url = f"{scheme}://{host}{uri}"
        if canonical_query:
            url += f"?{canonical_query}"
        req = urllib.request.Request(url, data=payload_bytes if method != "GET" else None,
                                     method=method)
        req.add_header("Authorization", authorization)
        req.add_header("x-amz-date", amz_date)
        req.add_header("x-amz-content-sha256", payload_hash)
        for k, v in (extra_headers or []):
            req.add_header(k, v)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
        return body

    def probe(self):
        """A signed empty list request; updates the health state."""
        try:
            self._request("GET", "", query_params=(("list-type", "2"), ("max-keys", "0")))
            self.ok = True
        except (OSError, urllib.error.HTTPError):
            self.ok = False
        self.checked_at = time.time()

    def put(self, object_key, content_type, payload):
        """PUT bytes; returns True when the object reached storage."""
        try:
            self._request("PUT", object_key, payload=payload,
                          extra_headers=[("content-type", content_type)])
            self.ok = True
            self.checked_at = time.time()
            return True
        except (OSError, urllib.error.HTTPError):
            return False

    def presigned_get(self, object_key, content_type, disposition, expires=60):
        """A presigned GET valid for 60 seconds, signed for one key with fixed
        response type and disposition."""
        host, uri = self._target(object_key)
        now = dt.datetime.now(dt.UTC)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")
        scope = f"{date_stamp}/{self.config.s3_region}/s3/aws4_request"
        credential = urllib.parse.quote(f"{self.config.s3_access_key_id}/{scope}", safe="")
        params = sorted([
            ("X-Amz-Algorithm", ALGORITHM),
            ("X-Amz-Credential", credential),
            ("X-Amz-Date", amz_date),
            ("X-Amz-Expires", str(expires)),
            ("X-Amz-SignedHeaders", "host"),
            ("response-content-disposition", urllib.parse.quote(disposition, safe="")),
            ("response-content-type", urllib.parse.quote(content_type, safe="")),
        ])
        canonical_query = "&".join(f"{k}={v}" for k, v in params)
        canonical_request = "\n".join([
            "GET", uri, canonical_query, f"host:{host}\n", "host", "UNSIGNED-PAYLOAD"])
        string_to_sign = "\n".join([
            ALGORITHM, amz_date, scope,
            hashlib.sha256(canonical_request.encode()).hexdigest()])
        key = hmac.new(("AWS4" + self.config.s3_secret_access_key).encode(),
                       date_stamp.encode(), hashlib.sha256).digest()
        for part in (self.config.s3_region, "s3", "aws4_request"):
            key = hmac.new(key, part.encode(), hashlib.sha256).digest()
        signature = hmac.new(key, string_to_sign.encode(), hashlib.sha256).hexdigest()
        parsed = urllib.parse.urlparse(self.config.s3_endpoint)
        scheme = parsed.scheme or "http"
        return f"{scheme}://{host}{uri}?{canonical_query}&X-Amz-Signature={signature}"
