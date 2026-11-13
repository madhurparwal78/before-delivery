"""Idempotency keys: a fingerprint of the request decides between replay and reuse."""

import hashlib
import json


def fingerprint(method: str, path: str, body) -> str:
    """sha256 hex of the method, the path and the body with keys sorted at every depth."""
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(f"{method.upper()}\n{path}\n{canonical}".encode()).hexdigest()
