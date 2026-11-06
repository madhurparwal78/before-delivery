"""Two-step sign-in codes, following RFC 6238 with HMAC-SHA1 and 6 digits."""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

STEP_SECONDS = 30
DIGITS = 6
SECRET_CHARS = 32
RECOVERY_CODE_COUNT = 10


def new_secret():
    raw = secrets.token_bytes(20)
    return base64.b32encode(raw).decode("ascii").rstrip("=")


def otpauth_uri(email, secret):
    label = quote("Tessel:%s" % email, safe="")
    return "otpauth://totp/%s?secret=%s&issuer=Tessel" % (label, secret)


def current_step(at=None):
    return int((at if at is not None else time.time()) // STEP_SECONDS)


def code_for(secret, step):
    padding = "=" * (-len(secret) % 8)
    key = base64.b32decode(secret + padding, casefold=True)
    mac = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    number = struct.unpack(">I", mac[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(number % (10**DIGITS)).zfill(DIGITS)


def matching_step(secret, code, last_step):
    """The step a code belongs to, or None when it is invalid or already spent."""
    if not isinstance(code, str) or len(code) != DIGITS or not code.isdigit():
        return None
    now = current_step()
    for step in (now - 1, now, now + 1):
        if hmac.compare_digest(code_for(secret, step), code):
            if last_step is not None and step <= last_step:
                return None
            return step
    return None
