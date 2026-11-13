// Serialization of domain records to the published API shapes. Private
// fields — rest figures, override reasons, dispatcher notes — never appear in
// anything a port agent can read.

import {
  formatPortDateTimeApi, formatPortStamp, formatPortDateTimeSpace, offsetStringAt,
} from './porttime.js';
import { mmToDraughtMetres, mmToFeetInches } from './numerals.js';
import type { PlanWaypoints } from './plan.js';
import type { Store } from './store.js';
import type { Line } from './tariff.js';
import type { Invoice, LadderReport, Move, User } from './types.js';
import { ROUTE } from './route.js';

export interface SerializedPlan {
  tide_version: number;
  boarding_at: string;
  draught_mm: number;
  required_mm: number;
  waypoints: {
    id: string; name: string; distance_nm: number; sounded_depth_mm: number;
    confined: boolean; speed_limit_kn: number | null; leg_speed_kn: number;
    arrival_at: string; arrival_utc_offset: string; tide_mm: number;
    squat_mm: number; clearance_mm: number; margin_mm: number; pinch: boolean;
  }[];
  pinch: { waypoint_id: string; margin_mm: number };
  window_state: 'open' | 'closed';
  estimate: { tariff_revision: string; lines: Line[]; total_cents: number };
}

export function serializePlan(
  plan: PlanWaypoints,
  estimate: { tariff_revision: string; lines: Line[]; total_cents: number },
): SerializedPlan {
  return {
    tide_version: plan.tideVersion,
    boarding_at: formatPortDateTimeApi(plan.boardingMs),
    draught_mm: plan.draughtMm,
    required_mm: plan.requiredMm,
    waypoints: plan.waypoints.map((w) => ({
      id: w.id, name: w.name, distance_nm: w.distance_nm,
      sounded_depth_mm: w.sounded_depth_mm, confined: w.confined,
      speed_limit_kn: w.speed_limit_kn, leg_speed_kn: w.leg_speed_kn,
      arrival_at: w.arrival_at, arrival_utc_offset: w.arrival_utc_offset,
      tide_mm: w.tide_mm, squat_mm: w.squat_mm, clearance_mm: w.clearance_mm,
      margin_mm: w.margin_mm, pinch: w.pinch,
    })),
    pinch: { waypoint_id: plan.pinchWaypointId, margin_mm: plan.pinchMarginMm },
    window_state: plan.gateOpen ? 'open' : 'closed',
    estimate,
  };
}

export function serializeLine(line: { label: string; quantity: number; unit_cents: number; amount_cents: number; tariff_revision: string }): Line {
  return {
    label: line.label,
    quantity: line.quantity,
    unit_cents: line.unit_cents,
    amount_cents: line.amount_cents,
    tariff_revision: line.tariff_revision,
  };
}

export interface SerializedMove {
  ref: string;
  version: number;
  status: string;
  detained: boolean;
  agency_code: string;
  vessel: { id: string; name: string; imo: string; length_m: number; gross_tonnage: number; block_coefficient: number };
  draught_mm: number;
  draught: { metres: string; feet: string };
  speed_kn: number;
  duty_minutes: number;
  boarding_at: string;
  committed: { boarding_at: string; pinch_waypoint: string; margin_mm: number; tide_version: number } | null;
  pilot: { id: string; name: string } | null;
  notice: { state: 'on_time' | 'late'; cutoff_at: string; cutoff_utc_offset: string };
  server_now: string;
  late_amendments: number;
  detention: { open: boolean; seconds: number };
  notices: { kind: string; to: string; state: 'pending' | 'sent' }[];
  billing: { state: 'none' | 'pending' | 'posted'; invoice_id: string | null; invoice_ids: string[] };
  lines: Line[];
  ladder_reports: string[];
  history: { at: string; status: string; by: string }[];
  dispatcher_notes?: string[];
  rest_override?: { reason: string } | null;
}

export function serializeMove(
  store: Store,
  move: Move,
  reader: User,
  serverNowMs: number,
): SerializedMove {
  const vessel = store.vessels.find((v) => v.id === move.vessel_id)!;
  const pilot = move.pilot_id ? store.pilots.find((p) => p.id === move.pilot_id) ?? null : null;
  const cutoffMs = move.boarding_ms - 2 * 3600_000;
  const detentionSeconds = move.detention_spans.reduce(
    (acc, s) => acc + Math.max(0, Math.floor((s.end_ms - s.start_ms) / 1000)),
    0,
  );
  const newestEvent = move.billing_events[move.billing_events.length - 1];
  const result: SerializedMove = {
    ref: move.ref,
    version: move.version,
    status: move.status,
    detained: move.detention_open,
    agency_code: move.agency_code,
    vessel: {
      id: vessel.id, name: vessel.name, imo: vessel.imo,
      length_m: move.length_m, gross_tonnage: move.gross_tonnage,
      block_coefficient: move.block_coefficient,
    },
    draught_mm: move.draught_mm,
    draught: { metres: mmToDraughtMetres(move.draught_mm), feet: mmToFeetInches(move.draught_mm) },
    speed_kn: move.speed_kn,
    duty_minutes: move.duty_minutes,
    boarding_at: formatPortDateTimeApi(move.boarding_ms),
    committed: move.committed
      ? {
          boarding_at: formatPortDateTimeApi(move.committed.boarding_ms),
          pinch_waypoint: move.committed.pinch_waypoint,
          margin_mm: move.committed.margin_mm,
          tide_version: move.committed.tide_version,
        }
      : null,
    pilot: pilot ? { id: pilot.id, name: pilot.name } : null,
    notice: {
      state: serverNowMs > cutoffMs ? 'late' : 'on_time',
      cutoff_at: `${formatPortDateTimeSpace(cutoffMs)}:00`,
      cutoff_utc_offset: offsetStringAt(cutoffMs),
    },
    server_now: formatPortStamp(serverNowMs),
    late_amendments: move.late_amendments,
    detention: { open: move.detention_open, seconds: detentionSeconds },
    notices: move.notices.map((n) => ({ kind: n.kind, to: n.to, state: n.state })),
    billing: {
      state: newestEvent ? 'posted' : 'none',
      invoice_id: newestEvent ? newestEvent.invoice_id : null,
      invoice_ids: move.billing_events.map((e) => e.invoice_id),
    },
    lines: move.billing_events.flatMap((e) => e.lines.map(serializeLine)),
    ladder_reports: move.ladder_report_ids,
    history: move.history.map((h) => ({
      at: formatPortStamp(h.at_ms), status: h.status, by: h.by,
    })),
  };
  if (reader.role === 'dispatcher') {
    result.dispatcher_notes = move.dispatcher_notes;
    result.rest_override = move.rest_override ? { reason: move.rest_override.reason } : null;
  } else if (reader.role === 'pilot' && pilot && reader.id === pilot.id) {
    result.dispatcher_notes = move.dispatcher_notes;
  }
  return result;
}

export function serializeInvoice(invoice: Invoice): {
  id: string; move_ref: string; agency_code: string; state: 'pending' | 'issued';
  number: string | null; balance_cents: number | null; lines: Line[]; total_cents: number;
  charge_state: 'pending' | 'posted';
} {
  return {
    id: invoice.id,
    move_ref: invoice.move_ref,
    agency_code: invoice.agency_code,
    state: invoice.state,
    number: invoice.number,
    balance_cents: invoice.balance_cents,
    lines: invoice.lines.map(serializeLine),
    total_cents: invoice.total_cents,
    charge_state: invoice.charge_state,
  };
}

export function serializeReport(store: Store, report: LadderReport): {
  id: string; move_ref: string; compliant: boolean; defects: string[];
  refused: boolean; location: 'deck' | 'pilot_boat'; note: string;
  photos: { photo_id: string; sha256: string; size_bytes: number }[];
  filed_by: string; filed_at: string;
} {
  const pilot = store.pilots.find((p) => p.id === report.filed_by);
  return {
    id: report.id,
    move_ref: report.move_ref,
    compliant: report.compliant,
    defects: report.defects,
    refused: report.refused,
    location: report.location,
    note: report.note,
    photos: report.photos,
    filed_by: pilot?.name ?? report.filed_by,
    filed_at: formatPortStamp(report.filed_at_ms),
  };
}

export function serializeVessel(store: Store, vesselId: string) {
  const vessel = store.vessels.find((v) => v.id === vesselId)!;
  return {
    id: vessel.id,
    name: vessel.name,
    imo: vessel.imo,
    length_m: vessel.length_m,
    gross_tonnage: vessel.gross_tonnage,
    block_coefficient: vessel.block_coefficient,
    default_speed_kn: vessel.default_speed_kn,
    default_draught_mm: vessel.default_draught_mm,
  };
}

export function serializePort(store: Store, nowMs: number) {
  return {
    port: 'Port Ansell',
    zone: 'America/Halifax',
    now: formatPortStamp(nowMs),
    store_date: store.storeDate,
    tide_version: store.tideVersion,
    step_minutes: 5,
    waypoints: ROUTE.map((w) => ({
      id: w.id,
      name: w.name,
      distance_nm: w.distance_nm,
      sounded_depth_mm: w.sounded_depth_mm,
      confined: w.confined,
      time_offset_minutes: w.time_offset_minutes,
      height_offset_mm: w.height_offset_mm,
      speed_limit_kn: w.speed_limit_kn,
    })),
  };
}
