import { draughtMetresFromMm, feetInchesFromMm } from '../domain/numerals.ts';
import { noticeCutoff, noticeState } from '../domain/notice.ts';
import type { PlanCore } from '../domain/plan.ts';
import { formatInstantSeconds } from '../domain/porttime.ts';
import type { Line } from '../domain/tariff.ts';
import {
  detentionSeconds,
  estimateFor,
  moveBoardingInstant,
  pilotById,
  revisionLabelForMove,
  totalCentsForMove,
} from './derive.ts';
import type {
  InvoiceRecord,
  LadderReportRecord,
  MoveRecord,
  StoreState,
  UserRecord,
  VesselRecord,
} from './store/types.ts';

export type Viewer = UserRecord;

/** Dispatchers see every move; a clerk too; an agent their own; a pilot those they hold or held. */
export function canReadMove(viewer: Viewer, move: MoveRecord): boolean {
  switch (viewer.role) {
    case 'dispatcher':
    case 'clerk':
      return true;
    case 'agent':
      return move.agency_code === viewer.agency_code;
    case 'pilot':
      return viewer.pilot_id !== null && move.pilot_history.includes(viewer.pilot_id);
  }
}

export function canReadVessel(viewer: Viewer, vessel: VesselRecord): boolean {
  switch (viewer.role) {
    case 'dispatcher':
    case 'pilot':
      return true;
    case 'agent':
      return vessel.agency_code === viewer.agency_code;
    case 'clerk':
      return false;
  }
}

export function canReadInvoice(viewer: Viewer, invoice: InvoiceRecord): boolean {
  if (viewer.role === 'clerk') return true;
  return viewer.role === 'agent' && invoice.agency_code === viewer.agency_code;
}

export function isAssignedPilot(viewer: Viewer, move: MoveRecord): boolean {
  return viewer.role === 'pilot' && viewer.pilot_id !== null && move.pilot_id === viewer.pilot_id;
}

export function moveLines(state: StoreState, move: MoveRecord): Line[] {
  const lines: Line[] = [];
  for (const event of move.billing_events) {
    const invoice = state.invoices.find((entry) => entry.id === event.invoice_id);
    if (invoice !== undefined) lines.push(...invoice.lines);
  }
  return lines;
}

function billingView(state: StoreState, move: MoveRecord): Record<string, unknown> {
  const invoiceIds = move.billing_events.map((event) => event.invoice_id);
  const newest = invoiceIds[invoiceIds.length - 1] ?? null;
  const invoice = state.invoices.find((entry) => entry.id === newest);
  return {
    state: invoice === undefined ? 'none' : invoice.charge_state,
    invoice_id: newest,
    invoice_ids: invoiceIds,
  };
}

export function moveView(
  state: StoreState,
  move: MoveRecord,
  viewer: Viewer,
  now: number,
): Record<string, unknown> {
  const vessel = state.vessels.find((entry) => entry.id === move.vessel_id);
  const boarding = moveBoardingInstant(move);
  const cutoff = noticeCutoff(boarding);
  const pilot = pilotById(state, move.pilot_id);
  const notices = move.notice_ids
    .map((id) => state.notices.find((notice) => notice.id === id))
    .filter((notice): notice is NonNullable<typeof notice> => notice !== undefined)
    .map((notice) => ({ kind: notice.kind, to: notice.to.join(', '), state: notice.state }));
  const view: Record<string, unknown> = {
    ref: move.ref,
    version: move.version,
    status: move.status,
    detained: move.detention_open_since !== null,
    agency_code: move.agency_code,
    vessel: {
      id: move.vessel_id,
      name: vessel?.name ?? move.vessel_id,
      imo: vessel?.imo ?? '',
      length_m: move.length_m,
      gross_tonnage: move.gross_tonnage,
      block_coefficient: move.block_coefficient,
    },
    draught_mm: move.draught_mm,
    draught: {
      metres: draughtMetresFromMm(move.draught_mm),
      feet: feetInchesFromMm(move.draught_mm),
    },
    speed_kn: move.speed_kn,
    duty_minutes: move.duty_minutes,
    boarding_at: move.boarding_at,
    committed: move.committed,
    pilot: pilot === undefined ? null : { id: pilot.id, name: pilot.name },
    notice: {
      state: noticeState(boarding, now),
      cutoff_at: cutoff.cutoff_at,
      cutoff_utc_offset: cutoff.cutoff_utc_offset,
    },
    server_now: formatInstantSeconds(now),
    late_amendments: move.late_amendments,
    detention: { open: move.detention_open_since !== null, seconds: detentionSeconds(move, now) },
    notices,
    billing: billingView(state, move),
    priced_by: revisionLabelForMove(state, move),
    total_cents: totalCentsForMove(state, move),
    lines: moveLines(state, move),
    ladder_reports: move.ladder_report_ids,
    corrections: move.corrections,
    history: move.history,
  };
  if (viewer.role === 'dispatcher' || isAssignedPilot(viewer, move)) {
    view.dispatcher_notes = move.dispatcher_notes;
  }
  if (viewer.role === 'dispatcher') {
    const override = state.rest_overrides.find((entry) => entry.id === move.rest_override_id);
    view.rest_override = override ?? null;
  }
  return view;
}

export function planView(
  state: StoreState,
  plan: PlanCore,
  subject: { gross_tonnage: number },
  boardingInstant: number,
): Record<string, unknown> {
  return {
    tide_version: state.tide_version,
    boarding_at: plan.boarding_at,
    draught_mm: plan.draught_mm,
    required_mm: plan.required_mm,
    waypoints: plan.waypoints,
    pinch: plan.pinch,
    window_state: plan.window_state,
    estimate: estimateFor(
      state,
      { draught_mm: plan.draught_mm, gross_tonnage: subject.gross_tonnage },
      boardingInstant,
    ),
  };
}

export function invoiceView(invoice: InvoiceRecord): Record<string, unknown> {
  return {
    id: invoice.id,
    move_ref: invoice.move_ref,
    agency_code: invoice.agency_code,
    state: invoice.state,
    number: invoice.number,
    balance_cents: invoice.balance_cents,
    balance_confirmed_at: invoice.balance_confirmed_at,
    lines: invoice.lines,
    total_cents: invoice.total_cents,
    charge_state: invoice.charge_state,
  };
}

export function reportView(
  state: StoreState,
  report: LadderReportRecord,
): Record<string, unknown> {
  return {
    id: report.id,
    move_ref: report.move_ref,
    compliant: report.compliant,
    defects: report.defects,
    refused: report.refused,
    location: report.location,
    note: report.note,
    photos: report.photo_ids.map((id) => {
      const photo = state.photos.find((entry) => entry.id === id);
      return {
        photo_id: id,
        sha256: photo?.sha256 ?? '',
        size_bytes: photo?.size_bytes ?? 0,
      };
    }),
    filed_by: report.filed_by,
    filed_at: report.filed_at,
  };
}

export function vesselView(vessel: VesselRecord, state: StoreState): Record<string, unknown> {
  const cards = state.pilot_cards.filter((card) => card.vessel_id === vessel.id);
  const latest = cards[cards.length - 1];
  return {
    id: vessel.id,
    name: vessel.name,
    imo: vessel.imo,
    agency_code: vessel.agency_code,
    length_m: vessel.length_m,
    gross_tonnage: vessel.gross_tonnage,
    block_coefficient: vessel.block_coefficient,
    speed_kn: vessel.speed_kn,
    draught_mm: vessel.draught_mm,
    pilot_card_id: latest?.card_id ?? null,
  };
}
