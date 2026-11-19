import { createHash } from 'node:crypto';
import * as store from '../db/store.js';
import { getObject, putObject } from './object-store.js';
import { buildPdf } from './pdf.js';
import { shipDayBounds, type VesselClock } from '../domain/ship-time.js';
import { shipDayStatus } from '../domain/day-state.js';
import {
  formatInstant,
  monthOfShipDate,
  monthShipDates,
  oneDecimal,
  shipDateRange,
} from '../domain/time.js';
import {
  dayCellsPayload,
  dayRestHours,
  loadCrewContext,
  type CrewContext,
} from './crew-records.js';

type MonthReadiness = {
  ready: boolean;
  blockingDates: string[];
  loggedDates: string[];
};

const MONTH_STATE_LABELS: Record<store.MonthRow['state'], string> = {
  open: 'Open',
  awaiting_archive: 'Awaiting archive',
  sealed: 'Sealed',
};

function recordKeyFor(vesselId: string, crewId: string, month: string): string {
  return `records/${vesselId}/${crewId}/${month}/record.pdf`;
}

function copyKeyFor(vesselId: string, crewId: string, month: string): string {
  return `records/${vesselId}/${crewId}/${month}/seafarer-copy.pdf`;
}

export function inspectionKeyFor(linkId: string): string {
  return `inspections/${linkId}/document.pdf`;
}

/** Decides whether a month may be sealed, naming the ship's dates that block it. */
export async function monthReadiness(
  crew: store.Crew,
  clock: VesselClock,
  month: string,
  nowMs: number,
): Promise<MonthReadiness> {
  const { first, last } = monthShipDates(month);
  const loggedDates = await store.shipDatesWithCells(crew.id, first, last);
  const signatures = await store.listSignatures(crew.id, first, last);
  const blockingDates = loggedDates.filter((shipDate) => {
    const status = shipDayStatus(
      shipDayBounds(clock, shipDate),
      signatures.get(shipDate) ?? null,
      nowMs,
    );
    return status.state !== 'countersigned';
  });
  const lastDayClosed =
    shipDayStatus(shipDayBounds(clock, last), signatures.get(last) ?? null, nowMs).state !== 'open';
  return {
    ready: loggedDates.length > 0 && lastDayClosed && blockingDates.length === 0,
    blockingDates,
    loggedDates,
  };
}

export async function monthPayload(
  crew: store.Crew,
  clock: VesselClock,
  month: string,
  nowMs: number,
): Promise<Record<string, unknown>> {
  const state = await store.findMonth(crew.id, month);
  const readiness = await monthReadiness(crew, clock, month, nowMs);
  return {
    month,
    state: state.state,
    label: MONTH_STATE_LABELS[state.state],
    blocking_dates: readiness.blockingDates,
    record_key: state.recordKey,
    record_sha256: state.recordSha256,
    copy_key: state.copyKey,
    sealed_at_utc: state.sealedAtMs === null ? null : formatInstant(state.sealedAtMs),
  };
}

async function recordLines(
  context: CrewContext,
  month: string,
  nowMs: number,
): Promise<string[]> {
  const { first, last } = monthShipDates(month);
  const dates = shipDateRange(first, last);
  const signatures = await store.listSignatures(context.crew.id, first, last);
  const notes = (await store.listNotesForCrew(context.crew.id)).filter(
    (note) => monthOfShipDate(note.shipDate) === month,
  );
  const breaches = await store.listBreaches(context.crew.id, null, null);
  const lines: string[] = [];
  lines.push(`Crew member: ${context.crew.name}, ${context.crew.rank}`);
  lines.push(`Vessel: ${context.vessel.name}`);
  lines.push(`Month: ${month}`);
  lines.push(`Written at: ${formatInstant(nowMs)}`);
  lines.push('');
  lines.push("Ship's days");
  for (const shipDate of dates) {
    const cells = dayCellsPayload(context, shipDate);
    const logged = cells.some((cell) => cell.state !== 'not_logged');
    if (!logged) continue;
    const signature = signatures.get(shipDate) ?? null;
    const lateCells = cells.filter((cell) => cell.late).length;
    lines.push(
      `${shipDate}: ${oneDecimal(dayRestHours(cells))} hours of rest, ` +
        `${cells.length} cells, signed ${
          signature?.signedAtMs == null ? 'not yet' : formatInstant(signature.signedAtMs)
        }, countersigned ${
          signature?.countersignedAtMs == null
            ? 'not yet'
            : formatInstant(signature.countersignedAtMs)
        }${lateCells > 0 ? `, ${lateCells} cells from a Late entry` : ''}`,
    );
  }
  lines.push('');
  lines.push('Late entries');
  const lateEntries = context.entries.filter(
    (entry) => entry.late && monthOfShipDate(entry.shipDate) === month,
  );
  if (lateEntries.length === 0) lines.push('None.');
  for (const entry of lateEntries) {
    lines.push(
      `${entry.shipDate}: Late entry, ${formatInstant(entry.startMs)} to ${formatInstant(
        entry.endMs,
      )}, ${entry.kind}, received ${formatInstant(entry.receivedAtMs)}` +
        `${entry.applied ? '' : ', hours unchanged'}`,
    );
  }
  lines.push('');
  lines.push('Recorded breaches');
  const monthBreaches = breaches.filter((breach) => {
    const start = formatInstant(breach.windowStartMs).slice(0, 7);
    return start === month;
  });
  if (monthBreaches.length === 0) lines.push('None.');
  for (const breach of monthBreaches) {
    lines.push(
      `${formatInstant(breach.windowStartMs)}, ${breach.windowHours} hours: ${breach.rule}, ` +
        `${oneDecimal(breach.restHours)} hours of rest, judged under ${breach.ruleSet}`,
    );
  }
  lines.push('');
  lines.push('Notes');
  if (notes.length === 0) lines.push('None.');
  for (const note of notes) {
    lines.push(`${note.shipDate} (${note.authorRole}): ${note.text}`);
  }
  return lines;
}

/**
 * Writes the record and the seafarer's copy, then reads the record back and compares its digest.
 * Only a verified upload seals the month, and only one attempt at a time writes its objects.
 */
export async function trySealMonth(crewId: string, month: string): Promise<void> {
  await store.withMonthArchiveLock(crewId, month, () => archiveMonth(crewId, month));
}

async function archiveMonth(crewId: string, month: string): Promise<void> {
  const state = await store.findMonth(crewId, month);
  if (state.state !== 'awaiting_archive') return;
  const crew = await store.findCrewById(crewId);
  if (crew === null) return;
  const { first, last } = monthShipDates(month);
  const vessel = (await store.findVesselById(crew.vesselId)) as store.Vessel;
  const clock = await store.loadVesselClock(vessel);
  const context = await loadCrewContext(
    crew,
    shipDayBounds(clock, first).startMs,
    shipDayBounds(clock, last).endMs,
  );
  const nowMs = Date.now();
  const lines = await recordLines(context, month, nowMs);
  const title = `Hours of rest, ${crew.name}, ${context.vessel.name}, ${month}`;
  const record = buildPdf(title, lines);
  const copy = buildPdf(`${title} (seafarer's copy)`, lines);
  const digest = createHash('sha256').update(record).digest('hex');
  const recordKey = recordKeyFor(context.vessel.id, crew.id, month);
  const copyKey = copyKeyFor(context.vessel.id, crew.id, month);
  await putObject(recordKey, record);
  await putObject(copyKey, copy);
  const readBack = await getObject(recordKey);
  const readBackDigest = createHash('sha256').update(readBack).digest('hex');
  if (readBackDigest !== digest) return;
  await store.markMonthSealed(crew.id, month, recordKey, digest, copyKey, Date.now());
}

export async function retryAwaitingMonths(): Promise<void> {
  const months = await store.listMonthsAwaitingArchive();
  for (const month of months) {
    try {
      await trySealMonth(month.crewId, month.month);
    } catch {
      // The month stays awaiting_archive and is tried again on the next pass.
    }
  }
}
