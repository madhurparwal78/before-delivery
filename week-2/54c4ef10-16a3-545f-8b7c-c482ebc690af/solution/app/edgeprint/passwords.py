"""Password hashing: scrypt with a random salt, compared in constant time."""

import hashlib
import hmac
import secrets

SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    return f"{salt.hex()}${hashlib.scrypt(password.encode(), salt=salt, **SCRYPT).hex()}"


def password_matches(password: str, stored: str) -> bool:
    salt_hex, digest_hex = stored.split("$")
    candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **SCRYPT)
    return hmac.compare_digest(candidate, bytes.fromhex(digest_hex))
