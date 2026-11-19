"""Password hashing. Every character of a password counts, with no truncation."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os

SCHEME = "scrypt"
COST = 16384
BLOCK = 8
PARALLEL = 1
MAXMEM = 64 * 1024 * 1024


def _derive(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=COST,
        r=BLOCK,
        p=PARALLEL,
        dklen=32,
        maxmem=MAXMEM,
    )


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = _derive(password, salt)
    return "$".join(
        [
            SCHEME,
            str(COST),
            str(BLOCK),
            str(PARALLEL),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(digest).decode("ascii"),
        ]
    )


def verify_password(password: str, stored: str) -> bool:
    parts = stored.split("$")
    if len(parts) != 6 or parts[0] != SCHEME:
        return False
    salt = base64.b64decode(parts[4])
    expected = base64.b64decode(parts[5])
    candidate = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=int(parts[1]),
        r=int(parts[2]),
        p=int(parts[3]),
        dklen=len(expected),
        maxmem=MAXMEM,
    )
    return hmac.compare_digest(candidate, expected)
