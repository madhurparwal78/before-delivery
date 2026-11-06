"""Password hashing with the standard library's scrypt."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os

SCRYPT_N = 2 ** 14
SCRYPT_R = 8
SCRYPT_P = 1
KEY_LENGTH = 32


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N,
                            r=SCRYPT_R, p=SCRYPT_P, dklen=KEY_LENGTH)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(stored: str, password: str) -> bool:
    """Constant-time comparison of the stored scrypt digest."""
    try:
        scheme, n, r, p, salt_text, digest_text = stored.split("$")
        if scheme != "scrypt":
            return False
        salt = base64.b64decode(salt_text)
        expected = base64.b64decode(digest_text)
        digest = hashlib.scrypt(password.encode(), salt=salt, n=int(n),
                                 r=int(r), p=int(p), dklen=len(expected))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, expected)
