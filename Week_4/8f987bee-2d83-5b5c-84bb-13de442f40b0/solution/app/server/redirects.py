"""The return-address rule for sign-in: `redirect_to` stays inside the console or falls back to /app."""

import re
from urllib.parse import unquote

CONSOLE = "/app"
_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def remove_dot_segments(path: str) -> str:
    """RFC 3986 section 5.2.4."""
    output: list[str] = []
    rest = path
    while rest:
        if rest.startswith("../"):
            rest = rest[3:]
        elif rest.startswith("./"):
            rest = rest[2:]
        elif rest.startswith("/./"):
            rest = "/" + rest[3:]
        elif rest == "/.":
            rest = "/"
        elif rest.startswith("/../"):
            rest = "/" + rest[4:]
            if output:
                output.pop()
        elif rest == "/..":
            rest = "/"
            if output:
                output.pop()
        elif rest in (".", ".."):
            rest = ""
        else:
            start = 1 if rest.startswith("/") else 0
            cut = rest.find("/", start)
            segment, rest = (rest, "") if cut == -1 else (rest[:cut], rest[cut:])
            output.append(segment)
    return "".join(output)


def redirect_to(raw_next: str | None) -> str:
    if not raw_next:
        return CONSOLE
    cut = min((i for i in (raw_next.find("?"), raw_next.find("#")) if i != -1), default=len(raw_next))
    path, suffix = raw_next[:cut], raw_next[cut:]
    decoded = unquote(path)
    if "\\" in decoded or "//" in decoded or "@" in decoded or _SCHEME.match(decoded) or _CONTROL.search(decoded):
        return CONSOLE
    resolved = remove_dot_segments(decoded)
    if resolved == CONSOLE or resolved.startswith(CONSOLE + "/"):
        return resolved + suffix
    return CONSOLE
