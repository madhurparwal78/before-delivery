"""The one return-path rule applied after sign in."""
from urllib.parse import unquote

CONSOLE = "/console"


def safe_next(raw):
    """Honour a plain console path, and send everything else to /console."""
    if not raw:
        return CONSOLE
    value = unquote(raw)
    if not (value == CONSOLE or value.startswith("/console/") or value.startswith("/console?")):
        return CONSOLE
    if "\\" in value or "//" in value:
        return CONSOLE
    for character in value:
        if ord(character) < 0x20 or ord(character) == 0x7F:
            return CONSOLE
    path = value.split("?", 1)[0]
    for segment in path.split("/"):
        if segment in (".", ".."):
            return CONSOLE
    return value
