"""JSON shapes of the published objects. Every figure is rounded here, once, half away from zero."""

from typing import Any

import asyncpg

from . import alignment, curves
from .context import RollContext, curve_of_test_roll, roll_state, stops_of, strongest_frame_id
from .densitometry import width_mm
from .exposure import half_away, relative_log_h
from .http import iso


def entry_view(ctx: RollContext, entry: asyncpg.Record) -> dict[str, Any]:
    stops = stops_of(ctx.roll, entry)
    frame_id, kind = ctx.matched[str(entry["id"])]
    return {
        "id": str(entry["id"]), "roll_id": str(entry["roll_id"]), "counter": entry["counter"],
        "aperture": entry["aperture"], "shutter": entry["shutter"], "metered_ev": entry["metered_ev"],
        "note": entry["note"], "misfire": entry["misfire"], "relative_stops": half_away(stops, 2),
        "relative_log_h": half_away(relative_log_h(stops), 2), "frame_id": frame_id, "match": kind,
        "created_at": iso(entry["created_at"]),
    }


def roll_view(ctx: RollContext) -> dict[str, Any]:
    roll = ctx.roll
    own_curve = curve_of_test_roll(ctx) if roll["kind"] == "test" else None
    return {
        "id": str(roll["id"]), "name": roll["name"], "stock": roll["stock"], "format": roll["format"],
        "ei": roll["ei"], "push_pull": roll["push_pull"], "reciprocity_p": float(roll["reciprocity_p"]),
        "development_note": roll["development_note"], "kind": roll["kind"],
        "curve_roll_id": str(roll["curve_roll_id"]) if roll["curve_roll_id"] else None,
        "state": roll_state(ctx, own_curve), "counters": ctx.counters,
        "strongest_frame_id": strongest_frame_id(ctx), "created_at": iso(roll["created_at"]),
    }


def calibration_view(row: asyncpg.Record) -> dict[str, Any]:
    return {"id": str(row["id"]), "method": row["method"], "area": row["area"], "reference": row["reference"],
            "steps": row["steps"], "created_at": iso(row["created_at"])}


def scan_view(row: asyncpg.Record, calibration: asyncpg.Record | None) -> dict[str, Any]:
    return {
        "id": str(row["id"]), "roll_id": str(row["roll_id"]), "position": row["position"],
        "filename": row["filename"], "format": row["format"], "size": row["size"], "sha256": row["sha256"],
        "width": row["width"], "height": row["height"], "dpi": row["dpi"], "first_edge": row["first_edge"],
        "transfer": row["transfer"], "gamma": None if row["gamma"] is None else half_away(row["gamma"], 5),
        "state": row["state"], "calibration": calibration_view(calibration) if calibration else None,
        "base_fog": row["base_fog"],
        "preview_slices": row["preview_slices"], "created_at": iso(row["created_at"]),
    }


def frame_view(frame: asyncpg.Record, scan: asyncpg.Record, entry_id: str | None) -> dict[str, Any]:
    return {
        "id": str(frame["id"]), "scan_id": str(frame["scan_id"]), "number": frame["number"],
        "edge_number": frame["edge_number"], "x0": frame["x0"], "x1": frame["x1"],
        "width_mm": half_away(width_mm(frame["x0"], frame["x1"], scan["dpi"]), 1), "flag": frame["flag"],
        "blank_slot": frame["blank_slot"], "mean_density": half_away(frame["mean_density"], 2),
        "net_density": half_away(frame["net_density"], 2), "unexposed": frame["unexposed"],
        "title": frame["title"], "entry_id": entry_id,
    }


def frames_view(ctx: RollContext, scan_id: Any) -> list[dict[str, Any]]:
    scans = {s["id"]: s for s in ctx.scans}
    entry_of_frame = {frame_id: entry_id for entry_id, (frame_id, _) in ctx.matched.items() if frame_id}
    return [frame_view(f, scans[f["scan_id"]], entry_of_frame.get(str(f["id"])))
            for f in ctx.frames if f["scan_id"] == scan_id]


def curve_position(curve: curves.Curve | None, net: float) -> tuple[float | None, str | None]:
    """(log H, zone) of a net density on a curve; both None when there is no ready curve."""
    if curve is None or not curve.ready:
        return None, None
    inverted = curves.invert(curve.points, net)
    return (None if inverted is None else half_away(inverted, 2)), curves.zone(curve, net)


def reading_view(row: asyncpg.Record, curve: curves.Curve | None) -> dict[str, Any]:
    log_h, zone = curve_position(curve, row["net"])
    return {
        "id": str(row["id"]), "scan_id": str(row["scan_id"]), "frame_id": str(row["frame_id"]),
        "entry_id": str(row["entry_id"]) if row["entry_id"] else None, "x": row["x"], "y": row["y"],
        "gross": row["gross"], "net": row["net"], "log_h": log_h, "zone": zone,
        "calibration_id": str(row["calibration_id"]), "created_at": iso(row["created_at"]),
    }


def proposal_body(proposal: alignment.Proposal) -> dict[str, Any]:
    def shown(candidate: alignment.Candidate, with_slip: bool) -> dict[str, Any]:
        body = {"offset": candidate.offset, "rho": None if candidate.rho is None else half_away(candidate.rho, 4),
                "pairs": candidate.pairs}
        return {**body, "slip_after": candidate.slip_after} if with_slip else body

    return {"proposed_offset": proposal.proposed_offset, "proposed_slip_after": proposal.proposed_slip_after,
            "candidates": [shown(c, False) for c in proposal.candidates],
            "slip_candidates": [shown(c, True) for c in proposal.slip_candidates]}


def curve_body(curve: curves.Curve | None, curve_roll_id: Any, bias: float | None) -> dict[str, Any]:
    """The /curve answer; a roll with no curve at all reports the empty body."""
    if curve is None:
        return {"curve_roll_id": None, "ready": False, "points": [], "base_fog": None, "speed_point_log_h": None,
                "contrast_index": None, "frames_used": 0, "stops_span": 0, "meter_bias_stops": None}
    return {
        "curve_roll_id": str(curve_roll_id), "ready": curve.ready,
        "points": [{"log_h": half_away(h, 4), "net": half_away(d, 4)} for h, d in curve.points],
        "base_fog": None if curve.base_fog is None else half_away(curve.base_fog, 2),
        "speed_point_log_h": None if curve.speed_point is None else half_away(curve.speed_point, 2),
        "contrast_index": None if curve.contrast_index is None else half_away(curve.contrast_index, 2),
        "frames_used": curve.frames_used, "stops_span": half_away(curve.stops_span, 1),
        "meter_bias_stops": None if bias is None else half_away(bias, 1)}
