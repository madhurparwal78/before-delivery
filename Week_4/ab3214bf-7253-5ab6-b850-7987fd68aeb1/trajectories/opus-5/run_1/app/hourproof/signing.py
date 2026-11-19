"""Ed25519 signing keys: the firms' keys and the signatures made under them."""

from __future__ import annotations

import hashlib

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)


def generate() -> tuple[bytes, bytes]:
    private = Ed25519PrivateKey.generate()
    private_raw = private.private_bytes(
        Encoding.Raw, PrivateFormat.Raw, NoEncryption()
    )
    public_raw = private.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return private_raw, public_raw


def key_id(public_raw: bytes) -> str:
    return hashlib.sha256(public_raw).hexdigest()[:16]


def sign(private_raw: bytes, payload: bytes) -> bytes:
    return Ed25519PrivateKey.from_private_bytes(private_raw).sign(payload)


def verify(public_raw: bytes, signature: bytes, payload: bytes) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(public_raw).verify(signature, payload)
    except InvalidSignature:
        return False
    return True
