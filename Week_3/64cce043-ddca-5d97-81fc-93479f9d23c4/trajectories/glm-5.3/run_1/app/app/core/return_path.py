"""The return-path check, decided in this one place."""

from __future__ import annotations

import re

MAX_LEN = 512

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def screen_for_role(role: str, path: str) -> bool:
    """Whether the part before any '?' is a screen route for the signer's role."""
    route = path.split("?", 1)[0]
    if role == "contact":
        return route == "/shared"
    if role == "owner":
        return route == "/vault" or route.startswith("/vault/")
    return False


def safe_return_path(role: str, next_value: str | None) -> str | None:
    """Validate a stored `next` value; return it when safe, else None.

    A safe value starts with exactly one '/', its second character is neither
    '/' nor '\\', it contains no '\\', no control character and no whitespace,
    it is at most 512 characters, and the part before any '?' is a screen
    route for the signer's role.
    """
    if not next_value:
        return None
    if len(next_value) > MAX_LEN:
        return None
    if not next_value.startswith("/"):
        return None
    if next_value.startswith("//") or next_value.startswith("/\\"):
        return None
    if "\\" in next_value:
        return None
    if any((ch.isspace() or ord(ch) < 32 or ord(ch) == 127) for ch in next_value):
        return None
    if not screen_for_role(role, next_value):
        return None
    return next_value


def default_path_for_role(role: str) -> str:
    return "/shared" if role == "contact" else "/vault"
