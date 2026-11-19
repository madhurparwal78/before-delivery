"""The return-address rule applied to the `next` value sent with sign-in."""

from __future__ import annotations

import re
from urllib.parse import unquote

CONSOLE_HOME = "/app"

_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+\-.]*:")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def resolve_return_address(raw: str | None) -> str:
    if not raw:
        return CONSOLE_HOME
    cut = min((index for index in (raw.find("?"), raw.find("#")) if index != -1), default=-1)
    if cut == -1:
        path_part, suffix = raw, ""
    else:
        path_part, suffix = raw[:cut], raw[cut:]
    decoded = unquote(path_part)
    if (
        "\\" in decoded
        or "//" in decoded
        or _SCHEME.match(decoded)
        or "@" in decoded
        or _CONTROL.search(decoded)
    ):
        return CONSOLE_HOME
    resolved = _resolve_dot_segments(decoded)
    if resolved == CONSOLE_HOME or resolved.startswith(f"{CONSOLE_HOME}/"):
        return resolved + suffix
    return CONSOLE_HOME


def _resolve_dot_segments(path: str) -> str:
    if not path.startswith("/"):
        return path
    output: list[str] = []
    trailing = path.endswith(("/", "/.", "/.."))
    for segment in path.split("/")[1:]:
        if segment == ".":
            continue
        if segment == "..":
            if output:
                output.pop()
            continue
        if segment == "":
            continue
        output.append(segment)
    resolved = "/" + "/".join(output)
    if trailing and len(resolved) > 1:
        resolved += "/"
    return resolved
