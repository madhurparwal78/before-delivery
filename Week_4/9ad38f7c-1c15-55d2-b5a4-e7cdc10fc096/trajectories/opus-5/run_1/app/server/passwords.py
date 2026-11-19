"""Password protection: a salted slow hash, with nothing truncated."""

from __future__ import annotations

import hashlib
import hmac
import secrets

ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 120_000
SALT_BYTES = 16


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    return _encode(salt, ITERATIONS, _derive(password, salt, ITERATIONS))


def password_matches(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = stored.split("$")
        if algorithm != ALGORITHM:
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        rounds = int(iterations)
    except ValueError:
        return False
    return hmac.compare_digest(_derive(password, salt, rounds), expected)


def _derive(password: str, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)


def _encode(salt: bytes, iterations: int, digest: bytes) -> str:
    return f"{ALGORITHM}${iterations}${salt.hex()}${digest.hex()}"


def new_token() -> str:
    return secrets.token_urlsafe(32)
