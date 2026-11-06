"""Loading records for one account and deriving every figure on read."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from . import db
from .domain import alignment as align
from .domain import curve as curve_rules
from .domain import frames as frame_rules
from .domain.exposure import entry_figures
from .domain.rounding import round_half_away


def _float(value: Any) -> float | None:
    return None if value is None else float(value)


@dataclass
class EntryRecord:
    row: dict[str, Any]
    relative_stops: float
    relative_log_h: float

    @property
    def id(self) -> str:
        return str(self.row["id"])

    @property
    def counter(self) -> int:
        return int(self.row["counter"])


@dataclass
class FrameRecord:
    row: dict[str, Any]
    number: int

    @property
    def id(self) -> str:
        return str(self.row["id"])

    @property
    def blank_slot(self) -> bool:
        return bool(self.row["blank_slot"])

    @property
    def mean_density(self) -> float | None:
        return _float(self.row["mean_density"])

    @property
    def base_fog(self) -> float | None:
        return _float(self.row["base_fog"])

    @property
    def net_density(self) -> float | None:
        mean = self.mean_density
        base = self.base_fog
        if mean is None or base is None:
            return None
        return frame_rules.net_density(mean, base)

    @property
    def edge_number(self) -> int:
        return int(self.row["first_edge"]) + int(self.row["slot_index"])

    @property
    def flag(self) -> str:
        if self.row["accepted"]:
            return "accepted"
        return frame_rules.width_flag(
            int(self.row["x0"]),
            int(self.row["x1"]),
            self.row["format"],
            int(self.row["dpi"]),
            self.blank_slot,
        )


class RollView:
    """One roll with everything derived from its current records."""

    def __init__(self, roll: dict[str, Any]) -> None:
        self.roll = roll
        self.roll_id = str(roll["id"])
        self.account_id = str(roll["account_id"])
        self.ei = int(roll["ei"])
        self.reciprocity_p = float(roll["reciprocity_p"])
        self.entries = [
            self._entry_record(row)
            for row in db.fetch_all(
                "SELECT * FROM entries WHERE roll_id = %s ORDER BY counter",
                (self.roll_id,),
            )
        ]
        self.scans = db.fetch_all(
            "SELECT * FROM scans WHERE roll_id = %s ORDER BY position",
            (self.roll_id,),
        )
        frame_rows = db.fetch_all(
            """
            SELECT f.*, s.position, s.first_edge, s.base_fog, s.dpi, r.format
            FROM frames f
            JOIN scans s ON s.id = f.scan_id
            JOIN rolls r ON r.id = s.roll_id
            WHERE s.roll_id = %s
            ORDER BY s.position, f.x0
            """,
            (self.roll_id,),
        )
        self.frames = [
            FrameRecord(row, number) for number, row in enumerate(frame_rows, start=1)
        ]
        self.alignment = db.fetch_one(
            "SELECT * FROM alignments WHERE roll_id = %s", (self.roll_id,)
        ) or {
            "roll_id": self.roll_id,
            "version": 0,
            "offset_frames": None,
            "slip_after": None,
            "source": None,
            "proposal": None,
            "saved_at": None,
        }
        self.overrides: dict[str, str | None] = {
            str(row["entry_id"]): (
                str(row["frame_id"]) if row["frame_id"] is not None else None
            )
            for row in db.fetch_all(
                "SELECT entry_id, frame_id FROM alignment_overrides WHERE roll_id = %s",
                (self.roll_id,),
            )
        }
        self.matches = align.apply_alignment(
            self.entry_facts(),
            self.frame_facts(),
            self.alignment["offset_frames"],
            self.alignment["slip_after"],
            self.overrides,
        )

    def _entry_record(self, row: dict[str, Any]) -> EntryRecord:
        stops, log_h = entry_figures(
            metered_ev=float(row["metered_ev"]),
            aperture=row["aperture"],
            shutter=row["shutter"],
            ei=int(self.roll["ei"]),
            reciprocity_p=float(self.roll["reciprocity_p"]),
        )
        return EntryRecord(row, stops, log_h)

    def entry_facts(self) -> list[align.EntryFacts]:
        return [
            align.EntryFacts(
                id=entry.id,
                counter=entry.counter,
                misfire=bool(entry.row["misfire"]),
                relative_stops=entry.relative_stops,
            )
            for entry in self.entries
        ]

    def frame_facts(self) -> list[align.FrameFacts]:
        return [
            align.FrameFacts(
                id=frame.id,
                number=frame.number,
                net_density=frame.net_density,
                blank_slot=frame.blank_slot,
            )
            for frame in self.frames
        ]

    def frame_by_id(self, frame_id: str) -> FrameRecord | None:
        for frame in self.frames:
            if frame.id == frame_id:
                return frame
        return None

    def entry_for_frame(self, frame_id: str) -> EntryRecord | None:
        for entry in self.entries:
            if self.matches.get(entry.id) == frame_id:
                return entry
        return None

    @property
    def alignment_saved(self) -> bool:
        return int(self.alignment["version"]) > 0

    def counters(self) -> dict[str, int]:
        return align.counters(self.entry_facts(), self.frame_facts(), self.matches)

    def bracket_pairs(self) -> list[tuple[float, float]]:
        """Each bracket frame's (relative stops, net density)."""
        pairs: list[tuple[float, float]] = []
        for entry in self.entries:
            if entry.row["misfire"]:
                continue
            frame_id = self.matches.get(entry.id)
            if frame_id is None:
                continue
            frame = self.frame_by_id(frame_id)
            if frame is None or frame.net_density is None:
                continue
            pairs.append((entry.relative_stops, frame.net_density))
        return pairs

    def state(self) -> str:
        if self.roll["kind"] == "test":
            return align.test_roll_state(
                align.bracket_stops(self.entry_facts(), self.matches)
            )
        return align.normal_roll_state(
            has_scan=bool(self.scans),
            alignment_saved=self.alignment_saved,
            entries=self.entry_facts(),
            matches=self.matches,
        )

    def own_curve(self) -> curve_rules.Curve:
        """The curve of this roll read as a test roll."""
        base_fogs = [
            float(scan["base_fog"])
            for scan in self.scans
            if scan["base_fog"] is not None
        ]
        return curve_rules.build_curve(
            self.bracket_pairs(), base_fogs, self.state() == "curve-ready"
        )

    def strongest_frame_id(self) -> str | None:
        best: FrameRecord | None = None
        for frame in self.frames:
            if frame.net_density is None:
                continue
            if best is None or frame.net_density > (best.net_density or 0.0):
                best = frame
        return best.id if best else None


def load_roll(account_id: str, roll_id: str) -> dict[str, Any] | None:
    return db.fetch_one(
        "SELECT * FROM rolls WHERE id = %s AND account_id = %s", (roll_id, account_id)
    )


def load_view(account_id: str, roll_id: str) -> RollView | None:
    roll = load_roll(account_id, roll_id)
    return RollView(roll) if roll else None


def curve_view(view: RollView) -> tuple[curve_rules.Curve, str | None, float | None]:
    """The curve a roll shows, its source roll id and the roll's own meter bias."""
    if view.roll["kind"] == "test":
        return view.own_curve(), view.roll_id, None
    linked_id = view.roll["curve_roll_id"]
    if linked_id is None:
        return curve_rules.EMPTY_CURVE, None, None
    linked = load_view(view.account_id, str(linked_id))
    if linked is None:
        return curve_rules.EMPTY_CURVE, None, None
    curve = linked.own_curve()
    if not curve.ready:
        return curve, str(linked_id), None
    exposed = [
        (stops, net)
        for stops, net in view.bracket_pairs()
        if not frame_rules.is_unexposed(net)
    ]
    return curve, str(linked_id), curve_rules.meter_bias(curve, exposed)


def reading_curve(view: RollView) -> curve_rules.Curve:
    """The curve a reading's log H and zone are read through."""
    if view.roll["kind"] == "test":
        own = view.own_curve()
        return own if own.ready else curve_rules.EMPTY_CURVE
    curve, _, _ = curve_view(view)
    return curve if curve.ready else curve_rules.EMPTY_CURVE


def serialise_roll(view: RollView) -> dict[str, Any]:
    roll = view.roll
    return {
        "id": view.roll_id,
        "name": roll["name"],
        "stock": roll["stock"],
        "format": roll["format"],
        "ei": int(roll["ei"]),
        "push_pull": int(roll["push_pull"]),
        "reciprocity_p": round(float(roll["reciprocity_p"]), 2),
        "development_note": roll["development_note"],
        "kind": roll["kind"],
        "curve_roll_id": str(roll["curve_roll_id"]) if roll["curve_roll_id"] else None,
        "state": view.state(),
        "counters": view.counters(),
        "strongest_frame_id": view.strongest_frame_id(),
        "created_at": roll["created_at"].isoformat(),
    }


def entry_match_kind(view: RollView, entry: EntryRecord) -> str:
    if entry.id in view.overrides:
        return "override" if view.overrides[entry.id] is not None else "unmatched"
    return "offset" if view.matches.get(entry.id) is not None else "none"


def serialise_entry(view: RollView, entry: EntryRecord) -> dict[str, Any]:
    frame_id = view.matches.get(entry.id)
    frame = view.frame_by_id(frame_id) if frame_id else None
    return {
        "id": entry.id,
        "roll_id": view.roll_id,
        "counter": entry.counter,
        "aperture": entry.row["aperture"],
        "shutter": entry.row["shutter"],
        "metered_ev": float(entry.row["metered_ev"]),
        "note": entry.row["note"],
        "misfire": bool(entry.row["misfire"]),
        "relative_stops": round_half_away(entry.relative_stops, 2),
        "relative_log_h": round_half_away(entry.relative_log_h, 2),
        "frame_id": frame_id,
        "frame_number": frame.number if frame else None,
        "match": entry_match_kind(view, entry),
        "created_at": entry.row["created_at"].isoformat(),
    }


def serialise_frame(view: RollView, frame: FrameRecord) -> dict[str, Any]:
    net = frame.net_density
    mean = frame.mean_density
    entry = view.entry_for_frame(frame.id)
    return {
        "id": frame.id,
        "scan_id": str(frame.row["scan_id"]),
        "number": frame.number,
        "edge_number": frame.edge_number,
        "x0": int(frame.row["x0"]),
        "x1": int(frame.row["x1"]),
        "width_mm": round_half_away(
            frame_rules.width_mm(
                int(frame.row["x0"]), int(frame.row["x1"]), int(frame.row["dpi"])
            ),
            1,
        ),
        "flag": frame.flag,
        "blank_slot": frame.blank_slot,
        "mean_density": None if mean is None else round_half_away(mean, 2),
        "net_density": None if net is None else round_half_away(net, 2),
        "unexposed": net is None or frame_rules.is_unexposed(net),
        "title": frame.row["title"],
        "entry_id": entry.id if entry else None,
    }


def serialise_calibration(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "id": str(row["id"]),
        "method": row["method"],
        "area": {
            "x": int(row["area_x"]),
            "y": int(row["area_y"]),
            "w": int(row["area_w"]),
            "h": int(row["area_h"]),
        },
        "reference": _float(row["reference"]),
        "steps": row["steps"],
        "created_at": row["created_at"].isoformat(),
    }


def load_calibration(calibration_id: str | None) -> dict[str, Any] | None:
    if calibration_id is None:
        return None
    return db.fetch_one(
        "SELECT * FROM calibrations WHERE id = %s", (str(calibration_id),)
    )


def serialise_scan(scan: dict[str, Any]) -> dict[str, Any]:
    calibration = load_calibration(scan["calibration_id"])
    gamma = _float(scan["gamma"])
    base_fog = _float(scan["base_fog"])
    return {
        "id": str(scan["id"]),
        "roll_id": str(scan["roll_id"]),
        "position": int(scan["position"]),
        "filename": scan["filename"],
        "format": scan["format"],
        "size": int(scan["size"]),
        "sha256": scan["sha256"],
        "width": int(scan["width"]),
        "height": int(scan["height"]),
        "dpi": int(scan["dpi"]),
        "first_edge": int(scan["first_edge"]),
        "transfer": scan["transfer"],
        "gamma": None if gamma is None else round(gamma, 5),
        "state": scan["state"],
        "calibration": serialise_calibration(calibration),
        "base_fog": None if base_fog is None else round_half_away(base_fog, 2),
        "preview_slices": int(scan["preview_slices"]),
        "created_at": scan["created_at"].isoformat(),
    }


def serialise_reading(
    row: dict[str, Any], curve: curve_rules.Curve
) -> dict[str, Any]:
    net = float(row["net"])
    log_h = curve.invert(net) if curve.ready else None
    zone = curve_rules.zone_label(curve.zone(net)) if curve.ready else None
    return {
        "id": str(row["id"]),
        "scan_id": str(row["scan_id"]),
        "frame_id": str(row["frame_id"]),
        "entry_id": str(row["entry_id"]) if row["entry_id"] else None,
        "x": int(row["x"]),
        "y": int(row["y"]),
        "gross": round_half_away(float(row["gross"]), 2),
        "net": round_half_away(net, 2),
        "log_h": None if log_h is None else round_half_away(log_h, 2),
        "zone": zone,
        "calibration_id": str(row["calibration_id"]),
        "created_at": row["created_at"].isoformat(),
    }


def readings_for_scan(scan_id: str) -> list[dict[str, Any]]:
    return db.fetch_all(
        "SELECT * FROM readings WHERE scan_id = %s ORDER BY created_at", (scan_id,)
    )


def readings_for_frame(frame_id: str) -> list[dict[str, Any]]:
    return db.fetch_all(
        "SELECT * FROM readings WHERE frame_id = %s ORDER BY created_at", (frame_id,)
    )


def serialise_curve(view: RollView) -> dict[str, Any]:
    curve, source_roll_id, bias = curve_view(view)
    return {
        "curve_roll_id": source_roll_id,
        "ready": curve.ready,
        "points": [
            {
                "log_h": round_half_away(point.log_h, 2),
                "net": round_half_away(point.net, 2),
            }
            for point in curve.points
        ],
        "base_fog": (
            None if curve.base_fog is None else round_half_away(curve.base_fog, 2)
        ),
        "speed_point_log_h": (
            None
            if curve.speed_point_log_h is None
            else round_half_away(curve.speed_point_log_h, 2)
        ),
        "contrast_index": curve.contrast_index,
        "frames_used": curve.frames_used,
        "stops_span": round_half_away(curve.stops_span, 1),
        "meter_bias_stops": bias,
    }


def latest_aligned_frame(account_id: str) -> dict[str, Any] | None:
    """The lowest-numbered matched frame of the account's newest saved alignment."""
    rows = db.fetch_all(
        """
        SELECT r.id
        FROM rolls r
        JOIN alignments a ON a.roll_id = r.id
        WHERE r.account_id = %s AND a.saved_at IS NOT NULL
        ORDER BY a.saved_at DESC
        """,
        (account_id,),
    )
    for row in rows:
        view = load_view(account_id, str(row["id"]))
        if view is None:
            continue
        matched = [
            frame
            for frame in view.frames
            if view.entry_for_frame(frame.id) is not None
        ]
        if not matched:
            continue
        frame = min(matched, key=lambda item: item.number)
        return {
            "frame_id": frame.id,
            "scan_id": str(frame.row["scan_id"]),
            "x0": int(frame.row["x0"]),
            "x1": int(frame.row["x1"]),
        }
    return None
