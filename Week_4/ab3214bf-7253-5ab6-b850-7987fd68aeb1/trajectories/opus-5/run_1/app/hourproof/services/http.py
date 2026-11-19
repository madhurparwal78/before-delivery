"""The one HTTP client for every third-party call, with the published timeout."""

from __future__ import annotations

import json
from typing import Any

import urllib3

TIMEOUT_SECONDS = 5

_POOL = urllib3.PoolManager(
    timeout=urllib3.Timeout(connect=TIMEOUT_SECONDS, read=TIMEOUT_SECONDS),
    retries=False,
    maxsize=16,
)


class ProviderUnavailable(Exception):
    """A provider that could not be reached, timed out, or answered 5xx."""


class ProviderResponse:
    def __init__(self, status: int, data: bytes) -> None:
        self.status = status
        self.data = data

    def json(self) -> Any:
        try:
            return json.loads(self.data.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as failure:
            raise ProviderUnavailable("unreadable body") from failure


def request(
    method: str,
    url: str,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> ProviderResponse:
    """Send one request; 5xx and transport failures count as unavailable."""
    try:
        response = _POOL.request(method, url, body=body, headers=headers or {})
    except urllib3.exceptions.HTTPError as failure:
        raise ProviderUnavailable(method) from failure
    if response.status >= 500:
        raise ProviderUnavailable(f"{method} {response.status}")
    return ProviderResponse(response.status, response.data)


def get_json(url: str) -> Any:
    response = request("GET", url)
    if response.status != 200:
        raise ProviderUnavailable(f"GET {response.status}")
    return response.json()


def post_json(url: str, body: Any, headers: dict[str, str] | None = None) -> ProviderResponse:
    merged = {"Content-Type": "application/json"}
    merged.update(headers or {})
    return request("POST", url, body=json.dumps(body).encode("utf-8"), headers=merged)
