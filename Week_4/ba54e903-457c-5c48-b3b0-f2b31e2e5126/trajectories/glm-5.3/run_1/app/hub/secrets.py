"""Password hashing and token digests (SHA-256 storage only)."""
from __future__ import annotations

import hashlib
import hmac
import secrets

PEPPER = "community-hub-static-pepper"


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", (PEPPER + password).encode("utf-8"),
                                 bytes.fromhex(salt), 60_000)
    return f"pbkdf2${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt, digest_hex = stored.split("$", 2)
        if scheme != "pbkdf2":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", (PEPPER + password).encode("utf-8"),
                                     bytes.fromhex(salt), 60_000)
        return hmac.compare_digest(digest.hex(), digest_hex)
    except Exception:
        return False


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_confirmation_token() -> str:
    return secrets.token_urlsafe(32).replace("-", "a").replace("_", "b")
