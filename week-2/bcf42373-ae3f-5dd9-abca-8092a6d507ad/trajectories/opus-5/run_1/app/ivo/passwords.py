"""Salted password hashing. A plain password is never stored."""

import hashlib
import hmac
import secrets

ALGORITHM = "pbkdf2-sha256"
ITERATIONS = 240_000
SALT_BYTES = 16


def hash_password(password):
    salt = secrets.token_hex(SALT_BYTES)
    digest = _derive(password, salt, ITERATIONS)
    return f"{ALGORITHM}${ITERATIONS}${salt}${digest}"


def password_matches(password, password_hash):
    try:
        algorithm, iterations, salt, digest = password_hash.split("$")
    except ValueError:
        return False
    if algorithm != ALGORITHM:
        return False
    return hmac.compare_digest(_derive(password, salt, int(iterations)), digest)


def _derive(password, salt, iterations):
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations
    ).hex()
