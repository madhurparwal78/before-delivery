"""scrypt password hashes: scrypt$<salt hex>$<hash hex>."""

import hashlib
import hmac
import secrets

_COST = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    return f"scrypt${salt.hex()}${hashlib.scrypt(password.encode(), salt=salt, **_COST).hex()}"


def verify(password: str, stored: str) -> bool:
    _, salt, expected = stored.split("$")
    actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **_COST).hex()
    return hmac.compare_digest(actual, expected)


DECOY = hash_password(secrets.token_hex(8))
