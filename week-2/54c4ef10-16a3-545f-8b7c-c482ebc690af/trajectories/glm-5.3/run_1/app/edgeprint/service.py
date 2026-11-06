"""The domain service layer: every screen and endpoint's decision, in one flow."""
from __future__ import annotations

from dataclasses import dataclass

from . import alignment as al
from .exposure import (LOG_H_PER_STOP, ROMAN, parse_aperture, parse_shutter,
                       relative_stops, round_half_away)


@dataclass
class Refused:
    """A refusal with the published status and code."""

    status: int
    code: str
    fields: dict[str, str] | None = None
    extra: dict | None = None


class NotFound(Refused):
    def __init__(self) -> None:
        super().__init__(status=404, code="not_found")


def fetch_roll(cur, roll_id: str, account_id: str) -> dict | None:
    cur.execute("SELECT * FROM rolls WHERE id=%s AND account_id=%s", (roll_id, account_id))
    return cur.fetchone()


def fetch_entry(cur, entry_id: str, account_id: str) -> dict | None:
    cur.execute("""
        SELECT e.* FROM entries e
        JOIN rolls r ON r.id = e.roll_id
        WHERE e.id=%s AND r.account_id=%s""", (entry_id, account_id))
    return cur.fetchone()


def fetch_scan(cur, scan_id: str, account_id: str) -> dict | None:
    cur.execute("""
        SELECT s.* FROM scans s
        JOIN rolls r ON r.id = s.roll_id
        WHERE s.id=%s AND r.account_id=%s""", (scan_id, account_id))
    return cur.fetchone()


def fetch_frame(cur, frame_id: str, account_id: str) -> dict | None:
    cur.execute("""
        SELECT f.* FROM frames f
        JOIN scans s ON s.id = f.scan_id
        JOIN rolls r ON r.id = s.roll_id
        WHERE f.id=%s AND r.account_id=%s""", (frame_id, account_id))
    return cur.fetchone()


def fetch_calibration(cur, scan_id: str) -> dict | None:
    cur.execute("""
        SELECT * FROM calibrations WHERE scan_id=%s
        ORDER BY created_at DESC, id DESC LIMIT 1""", (scan_id,))
    return cur.fetchone()


def roll_entries(cur, roll_id: str) -> list[dict]:
    cur.execute("SELECT * FROM entries WHERE roll_id=%s ORDER BY counter", (roll_id,))
    return list(cur.fetchall())


def roll_scans(cur, roll_id: str) -> list[dict]:
    cur.execute("SELECT * FROM scans WHERE roll_id=%s ORDER BY position", (roll_id,))
    return list(cur.fetchall())


def roll_frames(cur, roll_id: str) -> list[dict]:
    cur.execute("""
        SELECT f.* FROM frames f
        JOIN scans s ON s.id = f.scan_id
        WHERE s.roll_id=%s ORDER BY f.number""", (roll_id,))
    return list(cur.fetchall())


def scan_frames(cur, scan_id: str) -> list[dict]:
    cur.execute("SELECT * FROM frames WHERE scan_id=%s ORDER BY number", (scan_id,))
    return list(cur.fetchall())


def roll_overrides(cur, roll_id: str) -> dict[str, str | None]:
    cur.execute("""
        SELECT entry_id, frame_id FROM alignment_overrides WHERE roll_id=%s""",
        (roll_id,))
    return {str(row["entry_id"]): (str(row["frame_id"]) if row["frame_id"] else None)
            for row in cur.fetchall()}


def stops_for(entry: dict, roll: dict) -> float | None:
    """Relative stops derived on every read from the roll's current EI and exponent."""
    aperture = parse_aperture(entry["aperture"])
    shutter = parse_shutter(entry["shutter"])
    if aperture is None or shutter is None:
        return None
    return relative_stops(
        metered_ev=float(entry["metered_ev"]), ei=roll["ei"], aperture=aperture,
        t_seconds=shutter, reciprocity_p=float(roll["reciprocity_p"]))


def serialise_entry(entry: dict, roll: dict, match: al.MatchedPair | None) -> dict:
    stops = stops_for(entry, roll)
    if stops is None:
        stops = 0.0
    return {
        "id": str(entry["id"]),
        "roll_id": str(entry["roll_id"]),
        "counter": entry["counter"],
        "aperture": entry["aperture"],
        "shutter": entry["shutter"],
        "metered_ev": float(entry["metered_ev"]),
        "note": entry["note"],
        "misfire": entry["misfire"],
        "relative_stops": round_half_away(stops, 2),
        "relative_log_h": round_half_away(stops * LOG_H_PER_STOP, 2),
        "frame_id": match.frame_id if match else None,
        "match": match.source if match else "none",
        "created_at": entry["created_at"].isoformat(),
    }


def entry_views(entries: list[dict], roll: dict) -> list[al.EntryView]:
    views = []
    for entry in entries:
        stops = stops_for(entry, roll)
        views.append(al.EntryView(
            id=str(entry["id"]), counter=entry["counter"],
            misfire=entry["misfire"],
            relative_stops=stops if stops is not None else 0.0))
    return views


def frame_views(frames: list[dict]) -> list[al.FrameView]:
    return [al.FrameView(
        id=str(f["id"]), number=f["number"],
        net_density=None if f["net_density"] is None else float(f["net_density"]),
        unexposed=f["unexposed"]) for f in frames]


def roll_matches(cur, roll: dict, entries: list[dict],
                 frames: list[dict]) -> dict[str, al.MatchedPair]:
    if roll["align_offset"] is None:
        return {}
    overrides = roll_overrides(cur, str(roll["id"]))
    return al.match_entries(entry_views(entries, roll), frame_views(frames),
                            roll["align_offset"], roll["align_slip_after"], overrides)


def counters_for(cur, roll: dict, entries: list[dict],
                 frames: list[dict]) -> dict[str, int]:
    matches = roll_matches(cur, roll, entries, frames)
    return al.counters(frame_views(frames), entry_views(entries, roll), matches)


def serialise_calibration(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "method": row["method"],
        "area": {"x": row["area_x"], "y": row["area_y"],
                 "w": row["area_w"], "h": row["area_h"]},
        "reference": None if row["reference"] is None else float(row["reference"]),
        "steps": row["steps"],
        "created_at": row["created_at"].isoformat(),
    }


def serialise_scan(scan: dict, calibration: dict | None) -> dict:
    return {
        "id": str(scan["id"]),
        "roll_id": str(scan["roll_id"]),
        "position": scan["position"],
        "filename": scan["filename"],
        "format": scan["format"],
        "size": scan["size"],
        "sha256": scan["sha256"],
        "width": scan["width"],
        "height": scan["height"],
        "dpi": scan["dpi"],
        "first_edge": scan["first_edge"],
        "transfer": scan["transfer"],
        "gamma": None if scan["gamma"] is None else float(scan["gamma"]),
        "state": scan["state"],
        "calibration": serialise_calibration(calibration) if calibration else None,
        "base_fog": None if scan["base_fog"] is None else float(scan["base_fog"]),
        "preview_slices": scan["preview_slices"],
        "created_at": scan["created_at"].isoformat(),
    }


def serialise_frame(frame: dict, matched_entry: dict | None) -> dict:
    return {
        "id": str(frame["id"]),
        "scan_id": str(frame["scan_id"]),
        "number": frame["number"],
        "edge_number": frame["edge_number"],
        "x0": frame["x0"],
        "x1": frame["x1"],
        "width_mm": float(frame["width_mm"]),
        "flag": frame["flag"],
        "blank_slot": frame["blank_slot"],
        "mean_density": None if frame["mean_density"] is None else round_half_away(float(frame["mean_density"]), 2),
        "net_density": None if frame["net_density"] is None else round_half_away(float(frame["net_density"]), 2),
        "unexposed": frame["unexposed"],
        "title": frame["title"],
        "entry_id": str(matched_entry["id"]) if matched_entry else None,
    }


def serialise_reading(row: dict, log_h: float | None, zone: int | None) -> dict:
    return {
        "id": str(row["id"]),
        "scan_id": str(row["scan_id"]),
        "frame_id": str(row["frame_id"]) if row["frame_id"] else None,
        "entry_id": str(row["entry_id"]) if row["entry_id"] else None,
        "x": row["x"],
        "y": row["y"],
        "gross": float(row["gross"]),
        "net": float(row["net"]),
        "log_h": log_h,
        "zone": None if zone is None else ROMAN[zone],
        "calibration_id": str(row["calibration_id"]),
        "created_at": row["created_at"].isoformat(),
    }


def serialise_roll(cur, roll: dict, entries: list[dict] | None = None,
                   frames: list[dict] | None = None,
                   scans: list[dict] | None = None) -> dict:
    if entries is None:
        entries = roll_entries(cur, str(roll["id"]))
    if frames is None:
        frames = roll_frames(cur, str(roll["id"]))
    if scans is None:
        scans = roll_scans(cur, str(roll["id"]))
    matches = roll_matches(cur, roll, entries, frames)
    counter_values = al.counters(frame_views(frames), entry_views(entries, roll), matches)
    bracket = _bracket_stops(entries, roll, matches)
    if roll["kind"] == "test":
        span = (max(bracket) - min(bracket)) if bracket else 0.0
        state = ("curve-ready" if len(bracket) >= al.CURVE_MIN_FRAMES
                 and span >= al.CURVE_MIN_SPAN else "logging")
    else:
        state = "logging" if not scans else (
            "aligned" if roll["align_offset"] is not None and entries
            and all(matches.get(str(e["id"])) and matches[str(e["id"])].frame_id
                    for e in entries) else "developed")
    strongest = _strongest_frame(frames)
    return {
        "id": str(roll["id"]),
        "name": roll["name"],
        "stock": roll["stock"],
        "format": roll["format"],
        "ei": roll["ei"],
        "push_pull": roll["push_pull"],
        "reciprocity_p": float(roll["reciprocity_p"]),
        "development_note": roll["development_note"],
        "kind": roll["kind"],
        "curve_roll_id": str(roll["curve_roll_id"]) if roll["curve_roll_id"] else None,
        "state": state,
        "counters": counter_values,
        "strongest_frame_id": str(strongest["id"]) if strongest else None,
        "created_at": roll["created_at"].isoformat(),
    }


def _strongest_frame(frames: list[dict]) -> dict | None:
    exposed = [f for f in frames if f["net_density"] is not None and not f["blank_slot"]]
    if not exposed:
        return None
    return max(exposed, key=lambda f: float(f["net_density"]))


def _bracket_stops(entries: list[dict], roll: dict,
                   matches: dict[str, al.MatchedPair]) -> list[float]:
    """The relative stops of a test roll's matched, non-misfire entries."""
    stops: list[float] = []
    for entry in entries:
        if entry["misfire"]:
            continue
        match = matches.get(str(entry["id"]))
        if not match or not match.frame_id:
            continue
        value = stops_for(entry, roll)
        if value is not None:
            stops.append(value)
    return stops


def roll_curve(cur, roll: dict) -> dict:
    """A test roll's own curve, or the linked test roll's plus meter bias."""
    if roll["kind"] == "test":
        curve = _curve_of_test_roll(cur, roll)
        curve["curve_roll_id"] = str(roll["id"])
        curve["meter_bias_stops"] = None
        return curve
    if not roll["curve_roll_id"]:
        return {"curve_roll_id": None, "ready": False, "points": [], "base_fog": None,
                "speed_point_log_h": None, "contrast_index": None,
                "frames_used": 0, "stops_span": 0.0, "meter_bias_stops": None}
    linked = fetch_roll(cur, str(roll["curve_roll_id"]), str(roll["account_id"]))
    if linked is None or linked["kind"] != "test":
        return {"curve_roll_id": None, "ready": False, "points": [], "base_fog": None,
                "speed_point_log_h": None, "contrast_index": None,
                "frames_used": 0, "stops_span": 0.0, "meter_bias_stops": None}
    curve = _curve_of_test_roll(cur, linked)
    curve["curve_roll_id"] = str(linked["id"])
    curve["meter_bias_stops"] = (_meter_bias(cur, roll, curve)
                                 if curve["ready"] else None)
    return curve


def _curve_of_test_roll(cur, roll: dict) -> dict:
    entries = roll_entries(cur, str(roll["id"]))
    frames = roll_frames(cur, str(roll["id"]))
    matches = roll_matches(cur, roll, entries, frames)
    frames_by_id = {str(f["id"]): f for f in frames}
    bracket_stops: list[float] = []
    bracket_nets: list[float] = []
    for entry in entries:
        if entry["misfire"]:
            continue
        match = matches.get(str(entry["id"]))
        if not match or not match.frame_id:
            continue
        frame = frames_by_id[match.frame_id]
        if frame["unexposed"] or frame["net_density"] is None:
            continue
        stops = stops_for(entry, roll)
        if stops is None:
            continue
        bracket_stops.append(stops)
        bracket_nets.append(float(frame["net_density"]))
    curve = al.build_curve(bracket_stops, bracket_nets)
    curve["base_fog"] = _median_base_fog(cur, str(roll["id"]))
    return curve


def _median_base_fog(cur, roll_id: str) -> float | None:
    cur.execute("SELECT base_fog FROM scans WHERE roll_id=%s AND base_fog IS NOT NULL",
                (roll_id,))
    values = [float(row["base_fog"]) for row in cur.fetchall()]
    if not values:
        return None
    ordered = sorted(values)
    n = len(ordered)
    if n % 2 == 1:
        return round_half_away(ordered[n // 2], 2)
    return round_half_away((ordered[n // 2 - 1] + ordered[n // 2]) / 2, 2)


def _meter_bias(cur, roll: dict, curve: dict) -> float | None:
    entries = roll_entries(cur, str(roll["id"]))
    frames = roll_frames(cur, str(roll["id"]))
    matches = roll_matches(cur, roll, entries, frames)
    frames_by_id = {str(f["id"]): f for f in frames}
    points = curve["points"]
    differences: list[float] = []
    for entry in entries:
        if entry["misfire"]:
            continue
        match = matches.get(str(entry["id"]))
        if not match or not match.frame_id:
            continue
        frame = frames_by_id[match.frame_id]
        if frame["unexposed"] or frame["net_density"] is None:
            continue
        log_h = al.invert_curve(points, float(frame["net_density"]))
        if log_h is None:
            continue
        stops = stops_for(entry, roll)
        if stops is None:
            continue
        differences.append(log_h / LOG_H_PER_STOP - stops)
    return al.meter_bias(differences)


def reading_log_h(cur, roll: dict, net: float) -> tuple[float | None, int | None]:
    """A reading's log H and zone derived from its stored net through the curve."""
    curve = roll_curve(cur, roll)
    if not curve["ready"]:
        return None, None
    log_h = al.invert_curve(curve["points"], net)
    zone = al.zone_for(log_h, curve["speed_point_log_h"], curve["points"])
    return (None if log_h is None else round_half_away(log_h, 2)), zone
