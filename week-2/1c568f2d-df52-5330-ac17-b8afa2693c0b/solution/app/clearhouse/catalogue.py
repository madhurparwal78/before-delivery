"""The source catalogue: the seeded walk, its cursors, the duplicate score and the board placement."""

import base64
import binascii
import hashlib
import hmac
import re

from .db import Row, Tx
from .errors import invalid

PAGE_LIMIT = 60
SEED_MAX = 2147483647
DUPLICATE_SCORE = 85
SIMILAR_FLOOR = 40
BOX_MIN, BOX_MAX = 48, 220
GUTTER = 16
BOARD_COLUMNS = range(1, 7)
_CURSOR_KEY = hashlib.sha256(b"clearhouse catalogue walk v1").digest()
_PRIME = 2147483647


# The walk ---------------------------------------------------------------------------------------------------

def whole(value: str | None, default: int, low: int, high: int | None = None) -> int:
    """A query-string whole number; missing or malformed gives the default, out of range is clamped."""
    if value is None or not re.fullmatch(r"-?\d{1,12}", value.strip()):
        return default
    number = max(low, int(value))
    return number if high is None else min(high, number)


def _filters(q: str, licence: str) -> tuple[str, dict]:
    clauses, params = [], {}
    if len(q.strip()) >= 2:
        escaped = q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        clauses.append("(lower(title) LIKE :pattern ESCAPE '\\' OR lower(artist) LIKE :pattern ESCAPE '\\')")
        params["pattern"] = f"%{escaped}%"
    if licence:
        clauses.append("license = :licence")
        params["licence"] = licence
    return (" WHERE " + " AND ".join(clauses)) if clauses else "", params


def _tag(seed: int, offset: int, q: str, licence: str) -> str:
    message = f"{seed}|{offset}|{q.strip().lower() if len(q.strip()) >= 2 else ''}|{licence}".encode()
    return hmac.new(_CURSOR_KEY, message, hashlib.sha256).hexdigest()[:16]


def encode_cursor(seed: int, offset: int, q: str, licence: str) -> str:
    raw = f"{seed}.{offset}.{_tag(seed, offset, q, licence)}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str, seed: int, q: str, licence: str) -> int:
    """The offset an issued cursor stands for; anything else is refused."""
    try:
        text = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
    except (binascii.Error, UnicodeDecodeError, ValueError):
        text = ""
    match = re.fullmatch(r"(\d+)\.(\d+)\.([0-9a-f]{16})", text)
    if not match or int(match[1]) != seed or not hmac.compare_digest(
            match[3], _tag(seed, int(match[2]), q, licence)):
        raise invalid("cursor", "That cursor is not valid")
    return int(match[2])


def walk(tx: Tx, *, seed: int, cursor: str | None, limit: int, q: str, licence: str) -> dict:
    """One page of the seeded walk: an affine permutation of shuffle_rank modulo a prime, so every seed visits
    every matching object exactly once and a new seed only reorders them."""
    offset = decode_cursor(cursor, seed, q, licence) if cursor else 0
    where, params = _filters(q, licence)
    total = tx.value("SELECT count(*) FROM objects" + where, **params)
    multiplier = 1 + int.from_bytes(hashlib.sha256(f"multiplier {seed}".encode()).digest()[:8]) % (_PRIME - 1)
    shift = int.from_bytes(hashlib.sha256(f"shift {seed}".encode()).digest()[:8]) % _PRIME
    objects = tx.rows(
        "SELECT * FROM objects" + where
        + " ORDER BY (shuffle_rank::bigint * CAST(:m AS bigint) + CAST(:c AS bigint)) % 2147483647, id"
        " LIMIT :limit OFFSET :offset", m=multiplier, c=shift, limit=limit, offset=offset, **params)
    wrap = offset + len(objects) >= total
    return {"objects": objects, "offset": offset, "total": total, "wrap": wrap,
            "nextCursor": encode_cursor(seed, 0 if wrap else offset + len(objects), q, licence),
            "previousCursor": encode_cursor(seed, max(0, offset - limit), q, licence) if offset else None}


# The duplicate check --------------------------------------------------------------------------------------

def score(a: Row, b: Row) -> int:
    """0 to 100, symmetric: look-alikes share a cut-out mask; within a mask, closeness of the mask sizes."""
    if a["id"] == b["id"]:
        return 100
    width = min(a["mask_w"], b["mask_w"]) / max(a["mask_w"], b["mask_w"])
    height = min(a["mask_h"], b["mask_h"]) / max(a["mask_h"], b["mask_h"])
    if a["cutout_id"] != b["cutout_id"]:
        return round(20 * width) + round(20 * height)
    return 50 + round(18 * width) + round(18 * height)


def similar(tx: Tx, obj: Row) -> list[tuple[Row, int]]:
    """Every object scoring above the floor, highest first then by ascending id. Only objects sharing the
    cut-out mask can pass the floor, so only those are scored."""
    others = tx.rows("SELECT * FROM objects WHERE cutout_id = :c AND id <> :id", c=obj["cutout_id"], id=obj["id"])
    scored = [(other, score(obj, other)) for other in others]
    return sorted([pair for pair in scored if pair[1] > SIMILAR_FLOOR], key=lambda p: (-p[1], p[0]["id"]))


def flagged_pairs(tx: Tx, object_ids: list[int]) -> list[tuple[int, int]]:
    pairs = []
    for obj in tx.rows("SELECT * FROM objects WHERE id = ANY(CAST(:ids AS integer[]))", ids=object_ids):
        pairs += [(obj["id"], other["id"]) for other, value in similar(tx, obj) if value >= DUPLICATE_SCORE]
    return pairs


# The board --------------------------------------------------------------------------------------------------

def box(obj: Row) -> tuple[float, float]:
    """The cut-out's box at its stored proportions, the longer side scaled from 48 to 220 px."""
    w, h = obj["width"], obj["height"]
    longer = min(BOX_MAX, max(BOX_MIN, BOX_MIN + (BOX_MAX - BOX_MIN) * (max(w, h) - 40) / 3960))
    return (longer, longer * h / w) if w >= h else (longer * w / h, longer)


def board_layout(objects: list[Row]) -> dict:
    """Area order, then each object into the shortest column (leftmost on a tie) with a 16 px gutter, for every
    column count the stylesheet may choose."""
    sized = [(obj, *box(obj)) for obj in objects]
    sized.sort(key=lambda item: -(item[1] * item[2]))
    places = [{} for _ in sized]
    heights = {}
    for columns in BOARD_COLUMNS:
        tops = [0.0] * columns
        for index, (_, w, h) in enumerate(sized):
            column = tops.index(min(tops))
            places[index][columns] = (column * (BOX_MAX + GUTTER) + (BOX_MAX - w) / 2, tops[column])
            tops[column] += h + GUTTER
        heights[columns] = max(0.0, max(tops) - GUTTER) if sized else 0.0
    items = [{"object": obj, "w": round(w, 2), "h": round(h, 2),
              "style": "".join(f"--x{n}:{x:.1f}px;--y{n}:{y:.1f}px;" for n, (x, y) in place.items())}
             for (obj, w, h), place in zip(sized, places, strict=True)]
    return {"items": items, "style": "".join(f"--h{n}:{v:.1f}px;" for n, v in heights.items())}
