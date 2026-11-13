"""Password hashing and token generation."""
import base64
import hashlib
import hmac
import os

import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()


def check_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def new_token() -> str:
    return base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode()


def new_id(prefix: str) -> str:
    raw = os.urandom(12)
    return prefix + "_" + base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def sign(value: str, secret: str) -> str:
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()[:16]
