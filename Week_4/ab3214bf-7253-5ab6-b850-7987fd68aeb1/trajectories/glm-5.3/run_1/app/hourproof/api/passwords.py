"""Password hashing with stdlib pbkdf2_hmac."""
import hashlib
import hmac
import os


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000)
    return "pbkdf2$" + salt.hex() + "$" + dk.hex()


def verify_password(password: str, stored: str) -> bool:
    try:
        _scheme, salt_hex, dk_hex = stored.split("$")
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(dk_hex)
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000)
    return hmac.compare_digest(dk, expected)
