// The moves export. Standard CSV whose text cells can never run as
// spreadsheet formulas, with margins and totals as plain integers.

import { formatPortDateTimeApi } from './porttime.js';
import type { Move, User } from './types.js';
import type { Store } from './store.js';
import { estimateLines, totalOf, revisionInForce } from './tariff.js';
import { portInstant } from './porttime.js';

export interface ExportRow {
  ref: string;
  vessel: string;
  agency: string;
  status: string;
  boarding_at: string;
  pinch_waypoint: string;
  margin_mm: number | null;
  tariff_revision: string;
  total_cents: number;
}

// The moves the reader may see, in rising boarding instant with ties by
// rising ref.
export function exportRows(store: Store, reader: User): ExportRow[] {
  const visible = store.moves.filter((m) => canReadMove(store, reader, m));
  const sorted = [...visible].sort((a, b) =>
    a.boarding_ms === b.boarding_ms ? (a.ref < b.ref ? -1 : 1) : a.boarding_ms - b.boarding_ms,
  );
  return sorted.map((move) => rowFor(store, move));
}

function rowFor(store: Store, move: Move): ExportRow {
  const vessel = store.vessels.find((v) => v.id === move.vessel_id)!;
  const newest = move.billing_events[move.billing_events.length - 1];
  let tariffRevision: string;
  let totalCents: number;
  if (newest) {
    tariffRevision = newest.lines[0]?.tariff_revision ?? '';
    totalCents = newest.total_cents;
  } else {
    const revision = revisionInForce(
      store.tariffRevisions.map((r) => JSON.parse(r.body) as { label: string; effective_at: string; draft_foot_cents: number; minimum_cents: number; tonnage_bands: { from_gt: number; to_gt: number | null; cents: number }[]; night_percent: number; detention_half_hour_cents: number; detention_allowance_half_hours: number; cancellation_cents: number }),
      move.boarding_ms,
      (effectiveAt: string) => portInstant(effectiveAt.slice(0, 10), effectiveAt.slice(11, 16)),
    );
    const lines = estimateLines(revision, move.draught_mm, move.gross_tonnage, move.boarding_ms);
    tariffRevision = revision.label;
    totalCents = totalOf(lines);
  }
  return {
    ref: move.ref,
    vessel: vessel.name,
    agency: move.agency_code,
    status: move.status,
    boarding_at: formatPortDateTimeApi(move.boarding_ms),
    pinch_waypoint: move.committed?.pinch_waypoint ?? '',
    margin_mm: move.committed?.margin_mm ?? null,
    tariff_revision: tariffRevision,
    total_cents: totalCents,
  };
}

export function canReadMove(store: Store, reader: User, move: Move): boolean {
  if (reader.role === 'dispatcher' || reader.role === 'clerk') return true;
  if (reader.role === 'agent') return move.agency_code === reader.agency_code;
  if (reader.role === 'pilot') {
    const pilot = store.pilots.find((p) => p.email === reader.email);
    return pilot !== undefined && move.pilot_id === pilot.id || everAssigned(store, move, reader.id);
  }
  return false;
}

function everAssigned(store: Store, move: Move, userId: string): boolean {
  const pilot = store.pilots.find((p) => p.id === userId);
  return pilot !== undefined && store.moves.some((m) => m.ref === move.ref && m.pilot_id === pilot.id);
}

// A text value starting with a formula character gets one single quote in
// front of it; then any field holding a comma, double quote or line break is
// wrapped in double quotes with inner quotes doubled.
export function encodeCell(value: string): string {
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function renderCsv(rows: readonly ExportRow[]): string {
  const header = 'ref,vessel,agency,status,boarding_at,pinch_waypoint,margin_mm,tariff_revision,total_cents';
  const lines = [header];
  for (const row of rows) {
    lines.push(
      [
        encodeCell(row.ref),
        encodeCell(row.vessel),
        encodeCell(row.agency),
        encodeCell(row.status),
        encodeCell(row.boarding_at),
        encodeCell(row.pinch_waypoint),
        row.margin_mm === null ? '' : String(row.margin_mm),
        encodeCell(row.tariff_revision),
        String(row.total_cents),
      ].join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
