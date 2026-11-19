"""Which members a message body mentions. Code spans never mention anyone."""

from __future__ import annotations

import re
from dataclasses import dataclass

INLINE_CODE = re.compile(r"`[^`\n]*`")
MENTION = re.compile(r"(?<![0-9A-Za-z_.])@([0-9A-Za-z_.]+)")


@dataclass(frozen=True)
class MentionTokens:
    usernames: frozenset[str]
    everyone: bool
    here: bool


def strip_code(body: str) -> str:
    kept: list[str] = []
    fenced = False
    for line in body.split("\n"):
        if line.startswith("```"):
            fenced = not fenced
            continue
        if fenced:
            continue
        kept.append(INLINE_CODE.sub(" ", line))
    return "\n".join(kept)


def mention_tokens(body: str) -> MentionTokens:
    names = {match.group(1).lower() for match in MENTION.finditer(strip_code(body))}
    return MentionTokens(
        usernames=frozenset(name for name in names if name not in {"everyone", "here"}),
        everyone="everyone" in names,
        here="here" in names,
    )
