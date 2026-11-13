"""Slug derivation, slug history and the Finnish alphabetical order."""

from __future__ import annotations

import re
import unicodedata

_FOLD = str.maketrans({"ä": "a", "å": "a", "ö": "o"})
_RUNS = re.compile(r"[^a-z0-9]+")

_LETTERS = "abcdefghijklmnopqrstuvwxyz"
_FINNISH_TAIL = {"å": 26, "ä": 27, "ö": 28}


def slugify(title: str) -> str:
    """The title in composed form, lowercased and folded to a URL slug."""
    composed = unicodedata.normalize("NFC", title).lower()
    return _RUNS.sub("-", composed.translate(_FOLD)).strip("-")


def finnish_key(title: str) -> list[tuple[int, int]]:
    """a to z, then a-ring, a-umlaut, o-umlaut; everything else before a."""
    folded = unicodedata.normalize("NFC", title).casefold()
    key: list[tuple[int, int]] = []
    for char in folded:
        rank = _LETTERS.find(char)
        if rank >= 0:
            key.append((1, rank))
        elif char in _FINNISH_TAIL:
            key.append((1, _FINNISH_TAIL[char]))
        else:
            key.append((0, ord(char)))
    return key


def claim_slug(conn, programme_id: int, title: str, reference_id: int | None) -> str:
    """The lowest free slug for this title in this programme.

    Current slugs and every earlier slug recorded for the programme are taken,
    except the reference's own earlier slugs, which it may take back.
    """
    base = slugify(title)
    taken = {
        row["slug"]
        for row in conn.execute(
            "SELECT slug FROM reference_entry WHERE programme_id = %s AND id IS DISTINCT FROM %s",
            (programme_id, reference_id),
        )
    }
    taken |= {
        row["slug"]
        for row in conn.execute(
            "SELECT slug FROM slug_redirect WHERE programme_id = %s AND reference_id IS DISTINCT FROM %s",
            (programme_id, reference_id),
        )
    }
    if base not in taken:
        return base
    suffix = 2
    while f"{base}-{suffix}" in taken:
        suffix += 1
    return f"{base}-{suffix}"


def rename(conn, programme_id: int, reference_id: int, old_slug: str, new_slug: str) -> None:
    """Record history for a slug the reference is leaving behind."""
    if new_slug == old_slug:
        return
    conn.execute(
        "DELETE FROM slug_redirect WHERE programme_id = %s AND slug = %s AND reference_id = %s",
        (programme_id, new_slug, reference_id),
    )
    conn.execute(
        "UPDATE reference_entry SET slug = %s WHERE id = %s", (new_slug, reference_id)
    )
    conn.execute(
        "INSERT INTO slug_redirect (programme_id, slug, reference_id) VALUES (%s, %s, %s)",
        (programme_id, old_slug, reference_id),
    )
