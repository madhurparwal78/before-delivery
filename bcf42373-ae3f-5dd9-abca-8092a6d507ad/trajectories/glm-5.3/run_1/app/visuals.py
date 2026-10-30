"""Deterministic generated visuals, derived from each record's stored fields."""
import hashlib


def record_key(record, kind):
    """A stable seed from a record's identity, so the same record always draws the same visual."""
    basis = "|".join([kind, str(record.get("slug") or record.get("award") or record.get("value", "")),
                      str(record.get("discipline") or record.get("title") or "")])
    return int.from_bytes(hashlib.sha256(basis.encode("utf-8")).digest()[:4], "big")


def _rand(seed):
    """A tiny deterministic generator: three rounds of xorshift."""
    state = seed & 0xFFFFFFFF or 1
    while True:
        state ^= (state << 13) & 0xFFFFFFFF
        state ^= state >> 17
        state ^= (state << 5) & 0xFFFFFFFF
        yield state & 0xFFFFFFFF


def hex_hue(base, seedgen):
    """Blend the deep blood red toward warm black, per record."""
    shifts = ((18, -6, -8), (28, -10, -14), (12, -2, -4))
    r, g, b = shifts[next(seedgen) % 3]
    base_r, base_g, base_b = base
    rr = max(60, min(190, base_r + r))
    gg = max(14, min(80, base_g + g))
    bb = max(16, min(100, base_b + b))
    return f"#{rr:02x}{gg:02x}{bb:02x}"


def case_cover(record, width=800, height=500):
    """A card cover: crossed hairlines, a centered frame and layered glows."""
    seed = record_key(record, "case")
    rnd = _rand(seed)
    lines = []
    for _ in range(3):
        x1 = next(rnd) % width
        y1 = next(rnd) % height
        x2 = next(rnd) % width
        y2 = next(rnd) % height
        lines.append((x1, y1, x2, y2))
    frame_x = 200 + (next(rnd) % 200)
    frame_y = 100 + (next(rnd) % 150)
    deep = hex_hue((140, 20, 32), rnd)
    dark = hex_hue((60, 12, 18), rnd)
    return {
        "lines": lines,
        "frame": (frame_x, frame_y, width - frame_x - 150, height - frame_y - 100),
        "deep": deep,
        "dark": dark,
    }


def journal_cover(record, width=640, height=400):
    seed = record_key(record, "journal")
    rnd = _rand(seed)
    layers = []
    for _ in range(4):
        layers.append((next(rnd) % width, next(rnd) % height, 80 + next(rnd) % 180))
    angle = next(rnd) % 180
    return {"blobs": layers, "angle": angle, "deep": hex_hue((150, 24, 36), rnd)}


def service_picture(index, width=360, height=240):
    seed = 0x5A11 + index * 7919
    rnd = _rand(seed)
    rungs = []
    for _ in range(6):
        rungs.append((next(rnd) % width, next(rnd) % height, next(rnd) % width, next(rnd) % height))
    return {"rungs": rungs, "deep": hex_hue((150, 24, 36), rnd)}


def case_stage(record, size=640):
    """The centered visual for a case study page."""
    cover = case_cover(record, width=size, height=size)
    seed = record_key(record, "stage")
    rnd = _rand(seed)
    inner = 120 + next(rnd) % 200
    return {**cover, "inner": inner, "size": size}


def small_visual(record, offset, size=300):
    seed = record_key(record, "small") + offset
    rnd = _rand(seed)
    return {"lines": [(next(rnd) % size, next(rnd) % size, next(rnd) % size, next(rnd) % size)
                      for _ in range(2)],
            "deep": hex_hue((150, 24, 36), rnd)}


def recognition_visual(record, width=400, height=520):
    seed = record_key(record, "recognition")
    rnd = _rand(seed)
    facets = []
    for _ in range(7):
        facets.append((next(rnd) % width, height - 40 - next(rnd) % 60,
                       next(rnd) % 90, next(rnd) % 60))
    return {"facets": facets, "deep": hex_hue((150, 24, 36), rnd), "width": width, "height": height}

