"""Gotenberg: the press that renders the attestation PDF."""

from __future__ import annotations

from ..config import CONFIG
from . import http

BOUNDARY = "hourproof-attestation-boundary"


def render(html: str) -> bytes:
    body = (
        f"--{BOUNDARY}\r\n"
        'Content-Disposition: form-data; name="files"; filename="index.html"\r\n'
        "Content-Type: text/html; charset=utf-8\r\n\r\n"
        f"{html}\r\n"
        f"--{BOUNDARY}--\r\n"
    ).encode("utf-8")
    response = http.request(
        "POST",
        f"{CONFIG.gotenberg_url}/forms/chromium/convert/html",
        body=body,
        headers={"Content-Type": f"multipart/form-data; boundary={BOUNDARY}"},
    )
    if response.status != 200 or not response.data.startswith(b"%PDF"):
        raise http.ProviderUnavailable(f"press {response.status}")
    return response.data
