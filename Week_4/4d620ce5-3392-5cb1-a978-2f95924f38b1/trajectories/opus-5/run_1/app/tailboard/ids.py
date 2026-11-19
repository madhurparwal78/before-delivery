"""Opaque identifiers."""

import secrets


def new_id(prefix):
    return f"{prefix}_{secrets.token_hex(8)}"


def session_id():
    return secrets.token_urlsafe(32)


def signer_token():
    return "SIGNER-" + secrets.token_hex(4).upper()
