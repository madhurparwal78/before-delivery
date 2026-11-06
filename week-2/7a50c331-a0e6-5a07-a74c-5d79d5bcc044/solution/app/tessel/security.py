"""Password hashing, digests of secrets, random tokens and RFC 6238 two-step codes."""
import base64
import hashlib
import hmac
import secrets
import struct
import time

_ITER = 120_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _ITER).hex()
    return f"pbkdf2_sha256${_ITER}${salt}${dk}"


def check_password(password: str, stored: str) -> bool:
    try:
        _, it, salt, dk = stored.split("$")
    except ValueError:
        return False
    got = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(it)).hex()
    return hmac.compare_digest(got, dk)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def session_token() -> str:
    return secrets.token_hex(32)


def key_secret() -> str:
    return "tsl_" + secrets.token_hex(20)


def hex_id(prefix: str, digits: int) -> str:
    return prefix + secrets.token_hex(digits // 2)


def totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_code(secret: str, step: int) -> str:
    padded = secret + "=" * (-len(secret) % 8)
    mac = hmac.new(base64.b32decode(padded), struct.pack(">Q", step), hashlib.sha1).digest()
    off = mac[-1] & 0x0F
    value = struct.unpack(">I", mac[off:off + 4])[0] & 0x7FFFFFFF
    return f"{value % 1_000_000:06d}"


def totp_match(secret: str, code: str, last_step: int) -> int | None:
    """The step a code is valid for (current, one before, one after) and newer than last_step."""
    if not isinstance(code, str) or len(code) != 6 or not code.isdigit():
        return None
    now = int(time.time()) // 30
    for step in (now - 1, now, now + 1):
        if step > last_step and hmac.compare_digest(totp_code(secret, step), code):
            return step
    return None


def recovery_codes() -> list[str]:
    return [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}" for _ in range(10)]
