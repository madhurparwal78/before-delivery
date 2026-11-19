"""Passcode hashing for the seeded users (scrypt with a per-user salt)."""

import hashlib
import hmac
import secrets


def hash_passcode(passcode: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(passcode.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify(passcode: str, stored: str | None) -> bool:
    if not stored:
        return False
    _, salt, digest = stored.split("$")
    candidate = hashlib.scrypt(passcode.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
    return hmac.compare_digest(candidate.hex(), digest)
