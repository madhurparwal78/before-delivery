"""The source catalogue: the seeded walk, the drawn box and the duplicate check."""
import base64
import hashlib
import hmac
import json

from .. import config
from ..db import row, rows, value
from ..errors import Refusal

ALLOWED_LICENCES = ("CC0", "Public domain", "CC BY 4.0", "CC BY-SA 4.0")
DUPLICATE_THRESHOLD = 85
SIMILAR_FLOOR = 40
MAX_SEED = 2147483647
MAX_LIMIT = 60
# The walk order: one deterministic permutation of the catalogue for each seed.
WALK_KEY = "md5(%s::text || ':' || shuffle_rank::text)"

LICENCE_NOT_ALLOWED = "Licence is not on the allowed list"
NO_ARTIST = "No artist is attributed"
NO_LICENCE_ADDRESS = "No licence address is recorded"

OBJECT_COLUMNS = (
    "id, title, image_title, page_url, article_url, description, extract, license, "
    "license_url, artist, image_desc_url, width, height, cutout_id, mask_w, mask_h, "
    "mask_b, shuffle_rank"
)


def unusable_reason(obj):
    if obj["license"] not in ALLOWED_LICENCES:
        return LICENCE_NOT_ALLOWED
    if not (obj["artist"] or "").strip():
        return NO_ARTIST
    if not (obj["license_url"] or "").strip():
        return NO_LICENCE_ADDRESS
    return None


def box(obj):
    """The drawn box: the object's own proportions, longer side 48 to 220 pixels."""
    longer = 96 + (obj["id"] * 53) % 125
    scale = longer / max(obj["width"], obj["height"])
    return max(24, round(obj["width"] * scale)), max(24, round(obj["height"] * scale))


def score(left, right):
    """A whole number 0 to 100, the same in both directions and on every call."""
    low, high = sorted((left["id"], right["id"]))
    if low == high:
        return 100
    if left["cutout_id"] == right["cutout_id"]:
        return DUPLICATE_THRESHOLD + (low + high) % 16
    if left["mask_b"] and left["mask_b"] == right["mask_b"]:
        return SIMILAR_FLOOR + 1 + (low * 31 + high * 17) % 44
    return 0


def _sign(payload):
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    body = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    tag = hmac.new(config.CURSOR_KEY, body.encode("ascii"), hashlib.sha256).hexdigest()[:16]
    return body + "." + tag


def _unsign(text):
    try:
        body, tag = text.split(".", 1)
        expected = hmac.new(
            config.CURSOR_KEY, body.encode("ascii"), hashlib.sha256
        ).hexdigest()[:16]
        if not hmac.compare_digest(tag, expected):
            raise ValueError
        padded = body + "=" * (-len(body) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
        if not isinstance(payload, dict):
            raise ValueError
        return str(payload["k"]), int(payload["i"]), int(payload["o"])
    except Exception:
        raise Refusal(400, "That cursor is not valid", field="cursor")


def start_cursor():
    return _sign({"k": "", "i": 0, "o": 0})


def _filters(q, licence):
    clauses, params = [], []
    if q and len(q.strip()) >= 2:
        like = "%" + q.strip() + "%"
        clauses.append("(title ilike %s or artist ilike %s)")
        params += [like, like]
    if licence:
        clauses.append("license = %s")
        params.append(licence)
    return ("".join(" and " + c for c in clauses), params)


def walk(conn, cursor, limit, seed, q, licence):
    where, params = _filters(q, licence)
    total = value(
        conn, "select count(*) from objects where true" + where, tuple(params)
    )
    key, last_id, offset = _unsign(cursor) if cursor else ("", 0, 0)
    sql = (
        "select " + OBJECT_COLUMNS + ", " + WALK_KEY + " as walk_key from objects"
        " where true" + where + " and (" + WALK_KEY + ", id) > (%s, %s)"
        " order by walk_key, id limit %s"
    )
    found = rows(conn, sql, tuple([seed] + params + [seed, key, last_id, limit + 1]))
    page = found[:limit]
    wrap = len(found) <= limit
    if page:
        last = page[-1]
        next_cursor = (
            start_cursor()
            if wrap
            else _sign({"k": last["walk_key"], "i": last["id"], "o": offset + len(page)})
        )
    else:
        wrap = True
        next_cursor = start_cursor()
    for item in page:
        item.pop("walk_key", None)
    return {
        "objects": page,
        "nextCursor": next_cursor,
        "wrap": wrap,
        "total": total,
        "offset": offset,
    }


def cursor_at(conn, seed, q, licence, offset):
    """The cursor whose next page starts at this offset in the same walk."""
    if offset <= 0:
        return start_cursor()
    where, params = _filters(q, licence)
    found = row(
        conn,
        "select id, " + WALK_KEY + " as walk_key from objects where true" + where
        + " order by walk_key, id limit 1 offset %s",
        tuple([seed] + params + [offset - 1]),
    )
    if found is None:
        return start_cursor()
    return _sign({"k": found["walk_key"], "i": found["id"], "o": offset})


def get(conn, object_id):
    return row(conn, "select " + OBJECT_COLUMNS + " from objects where id = %s", (object_id,))


def similar(conn, obj, limit=20, offset=0):
    candidates = rows(
        conn,
        "select " + OBJECT_COLUMNS + " from objects where id <> %s"
        " and (cutout_id = %s or (%s <> 0 and mask_b = %s))",
        (obj["id"], obj["cutout_id"], obj["mask_b"], obj["mask_b"]),
    )
    scored = [(score(obj, other), other) for other in candidates]
    scored = [pair for pair in scored if pair[0] > SIMILAR_FLOOR]
    scored.sort(key=lambda pair: (-pair[0], pair[1]["id"]))
    return [
        {"object": other, "score": points}
        for points, other in scored[offset : offset + limit]
    ]


def flagged_duplicates(conn, object_ids):
    """Every flagged duplicate of the given objects, keyed by object id."""
    if not object_ids:
        return {}
    found = {}
    for object_id in object_ids:
        obj = get(conn, object_id)
        if obj is None:
            continue
        found[object_id] = [
            entry["object"]
            for entry in similar(conn, obj, limit=50)
            if entry["score"] >= DUPLICATE_THRESHOLD
        ]
    return found
