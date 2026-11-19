"""The records the desk reasons about."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

ACTUAL = "Actual"
ESTIMATED = "Estimated"
SUBSTITUTED = "Substituted"
MISSING = "Missing"

UNSUBMITTED = "Unsubmitted"
PENDING = "Pending"
CONFIRMED = "Confirmed"
REJECTED = "Rejected"

FIXED_STATUSES = (PENDING, CONFIRMED)


@dataclass(frozen=True)
class Site:
    id: str
    name: str
    code: str
    zone: str
    time_zone: str
    meter_id: str
    target_grain: str
    target_bp: int


@dataclass
class Hour:
    hour_utc: datetime
    consumed_wh: int | None
    quality: str
    substitution_reason: str | None
    correction_version: int


@dataclass
class Lot:
    lot_id: str
    name: str
    technology: str
    zone: str
    rank: int
    excluded: bool
    battery_shifted: bool
    production_month: str
    cancel_by: datetime


@dataclass
class Bundle:
    bundle_id: str
    lot_id: str
    battery_shifted: bool
    production_hour: datetime
    discharge_hour: datetime | None
    range_start_wh: int
    range_end_wh: int

    @property
    def gross_wh(self) -> int:
        return self.range_end_wh - self.range_start_wh


@dataclass
class Line:
    line_id: str
    hour_utc: datetime
    lot_id: str
    bundle_id: str
    range_start_wh: int
    range_end_wh: int
    wh: int
    status: str
    reason: str | None = None


@dataclass
class WindowRecord:
    id: str
    base_id: str
    site: Site
    month: str
    state: str
    revision: int
    opens_at: datetime
    start_utc: datetime
    end_utc: datetime
    verifier_firm_id: str | None
    submitted_at: datetime | None
    returned_reason: str | None
    frozen_target_grain: str | None
    frozen_target_bp: int | None
    frozen_opinion: str | None
    registry_reachable: bool
    seal_status: str | None
    predecessor_id: str | None
    successor_id: str | None
    last_writer_name: str | None
    wrote_at: datetime | None
    hours: list[Hour] = field(default_factory=list)
    lots: list[Lot] = field(default_factory=list)
    bundles: list[Bundle] = field(default_factory=list)
    lines: list[Line] = field(default_factory=list)

    @property
    def target_grain(self) -> str:
        return self.frozen_target_grain or self.site.target_grain

    @property
    def target_bp(self) -> int:
        return self.site.target_bp if self.frozen_target_bp is None else self.frozen_target_bp
