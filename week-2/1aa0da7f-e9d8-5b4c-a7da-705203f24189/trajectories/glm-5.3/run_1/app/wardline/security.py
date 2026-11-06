"""Security primitives: hashing, tokens, TOTP (DP-07, DP-65)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from typing import Any


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hash_token(token: str) -> str:
    return sha256_hex(token.encode("utf-8"))


def new_token(prefix: str = "") -> str:
    return prefix + secrets.token_hex(32)


def new_id(prefix: str, number: int) -> str:
    return f"{prefix}-{number:04d}"


def totp(secret_b32: str, at: float | None = None) -> str:
    """RFC 6238: SHA-1, 6 digits, 30-second steps."""
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8), casefold=True)
    counter = int((at if at is not None else time.time()) // 30)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1000000
    return f"{code:06d}"


def totp_verify(secret_b32: str, code: str, at: float | None = None) -> bool:
    now = at if at is not None else time.time()
    step = int(now // 30)
    for delta in (-1, 0, 1):
        try:
            expected = totp(secret_b32, step * 30.0 + delta * 30.0)
        except Exception:
            return False
        if hmac.compare_digest(expected, code):
            return True
    return False


def id_ok(value: Any) -> bool:
    """True when the value can be used as an id-like token at all."""
    return isinstance(value, str) and len(value) <= 200


def encode_target(value: str) -> str:
    """Target encoding for ledger targets: bytes other than unreserved become %XX."""
    raw = value.encode("utf-8", errors="surrogatepass")
    out = []
    safe = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"
    for b in raw:
        if b in safe:
            out.append(chr(b))
        else:
            out.append("%%%02X" % b)
    return "".join(out)[:200]


def session_key_of(email: str) -> str:
    return "email:" + sha256_hex(email.strip().lower().encode("utf-8"))
