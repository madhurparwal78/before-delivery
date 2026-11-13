import { type PlanSubject, computePlan, type PlanCore } from '../domain/plan.ts';
import {
  type Wall,
  formatInstantSeconds,
  instantToWall,
  parsePortDateTime,
  wallToInstant,
} from '../domain/porttime.ts';
import { type DutySpan, type RestVerdict, restVerdict } from '../domain/rest.ts';
import {
  type Line,
  type TariffRevision,
  billedHalfHours,
  estimateLines,
  linesTotal,
  revisionInForce,
} from '../domain/tariff.ts';
import { type TideTable, tideTableFrom } from '../domain/tide.ts';
import type { MoveRecord, PilotRecord, StoreState, UserRecord } from './store/types.ts';

export function portInstantOf(text: string): number {
  const wall = parsePortDateTime(text);
  if (wall === null) throw new Error(`stored time ${text} is not a port time`);
  const instant = wallToInstant(wall);
  if (instant === null) throw new Error(`stored time ${text} does not exist in port time`);
  return instant;
}

export function tideTableOf(state: StoreState): TideTable {
  return tideTableFrom(
    new Map(state.tide_revisions.map((revision) => [revision.date, revision.events])),
  );
}

export function tariffEffectiveInstants(state: StoreState): Map<string, number> {
  return new Map(
    state.tariff_revisions.map((revision) => [revision.id, portInstantOf(revision.effective_at)]),
  );
}

export function revisionForBoarding(state: StoreState, boardingInstant: number): TariffRevision {
  return revisionInForce(state.tariff_revisions, tariffEffectiveInstants(state), boardingInstant);
}

export function planSubjectOf(move: MoveRecord): PlanSubject {
  return {
    draught_mm: move.draught_mm,
    speed_kn: move.speed_kn,
    block_coefficient: move.block_coefficient,
  };
}

export function planForMove(state: StoreState, move: MoveRecord, boardingInstant: number): PlanCore {
  return computePlan(tideTableOf(state), planSubjectOf(move), boardingInstant);
}

export function moveBoardingInstant(move: MoveRecord): number {
  return portInstantOf(move.boarding_at);
}

/** Detention accrues by the server's clock and counts only time at or after the ordered time. */
export function detentionSeconds(move: MoveRecord, now: number): number {
  if (move.detention_open_since === null) return move.detention_seconds;
  const from = Math.max(portInstantOf(move.detention_open_since), moveBoardingInstant(move));
  return move.detention_seconds + Math.max(0, Math.floor((now - from) / 1000));
}

export function detentionBilledHalfHours(
  state: StoreState,
  move: MoveRecord,
  now: number,
  unitSeconds: number,
): number {
  const revision = revisionForBoarding(state, moveBoardingInstant(move));
  return billedHalfHours(
    detentionSeconds(move, now),
    revision.detention_allowance_half_hours,
    unitSeconds,
  );
}

export type EstimateView = { tariff_revision: string; lines: Line[]; total_cents: number };

export function estimateFor(
  state: StoreState,
  subject: { draught_mm: number; gross_tonnage: number },
  boardingInstant: number,
): EstimateView {
  const revision = revisionForBoarding(state, boardingInstant);
  const lines = estimateLines(revision, {
    draught_mm: subject.draught_mm,
    gross_tonnage: subject.gross_tonnage,
    boarding: instantToWall(boardingInstant),
    detention_half_hours: 0,
    late_amendments: 0,
  });
  return { tariff_revision: revision.label, lines, total_cents: linesTotal(lines) };
}

export type PilotDuty = DutySpan & { move_ref: string | null };

/** Every duty of a pilot: the seeded ones and those of moves they hold or held. */
export function dutiesOfPilot(state: StoreState, pilotId: string): PilotDuty[] {
  const duties: PilotDuty[] = [];
  for (const duty of state.seeded_duties) {
    if (duty.pilot_id !== pilotId) continue;
    const start = portInstantOf(duty.start_at);
    duties.push({ start, end: start + duty.minutes * 60_000, move_ref: null });
  }
  for (const move of state.moves) {
    if (move.duty === null || move.duty.pilot_id !== pilotId) continue;
    duties.push({
      start: portInstantOf(move.duty.start_at),
      end: portInstantOf(move.duty.end_at),
      move_ref: move.ref,
    });
  }
  return duties.sort((left, right) => left.start - right.start);
}

export function prospectiveDuty(move: MoveRecord): DutySpan {
  const start = moveBoardingInstant(move);
  return { start, end: start + move.duty_minutes * 60_000 };
}

export function restVerdictFor(
  state: StoreState,
  pilot: PilotRecord,
  move: MoveRecord,
): RestVerdict {
  const others = dutiesOfPilot(state, pilot.id).filter((duty) => duty.move_ref !== move.ref);
  return restVerdict(others, prospectiveDuty(move));
}

/** The revision of the move's newest stored lines, or the one in force at its boarding instant. */
export function revisionLabelForMove(state: StoreState, move: MoveRecord): string {
  for (let index = move.billing_events.length - 1; index >= 0; index -= 1) {
    const event = move.billing_events[index];
    if (event === undefined) continue;
    const invoice = state.invoices.find((entry) => entry.id === event.invoice_id);
    const line = invoice?.lines[0];
    if (line !== undefined) return line.tariff_revision;
  }
  return revisionForBoarding(state, moveBoardingInstant(move)).label;
}

/** The newest billing event's total, or before any event the estimate total. */
export function totalCentsForMove(state: StoreState, move: MoveRecord): number {
  const newest = move.billing_events[move.billing_events.length - 1];
  if (newest !== undefined) {
    const invoice = state.invoices.find((entry) => entry.id === newest.invoice_id);
    if (invoice !== undefined) return invoice.total_cents;
  }
  return estimateFor(
    state,
    { draught_mm: move.draught_mm, gross_tonnage: move.gross_tonnage },
    moveBoardingInstant(move),
  ).total_cents;
}

export function userByEmail(state: StoreState, email: string): UserRecord | undefined {
  return state.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
}

export function pilotOfUser(state: StoreState, user: UserRecord): PilotRecord | undefined {
  return state.pilots.find((pilot) => pilot.id === user.pilot_id);
}

export function pilotById(state: StoreState, pilotId: string | null): PilotRecord | undefined {
  if (pilotId === null) return undefined;
  return state.pilots.find((pilot) => pilot.id === pilotId);
}

export function moveByRef(state: StoreState, ref: string): MoveRecord | undefined {
  return state.moves.find((move) => move.ref === ref);
}

export function nowWall(): Wall {
  return instantToWall(Date.now());
}

export function serverNowText(): string {
  return formatInstantSeconds(Date.now());
}
