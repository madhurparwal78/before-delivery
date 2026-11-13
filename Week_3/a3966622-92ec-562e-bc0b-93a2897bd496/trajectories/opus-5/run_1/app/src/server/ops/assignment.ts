import { assignmentAllowed } from '../../domain/moves.ts';
import { formatInstantSeconds } from '../../domain/porttime.ts';
import {
  type EligibilityReason,
  REST_TYPE_REASONS,
  licenceCovers,
  sortReasons,
} from '../../domain/rest.ts';
import type { App } from '../app.ts';
import { moveBoardingInstant, restVerdictFor } from '../derive.ts';
import { conflict, forbidden, invalid, notFound } from '../errors.ts';
import { assignmentNotice, orderConfirmation, type NoticeFactory } from '../notices.ts';
import type { MoveRecord, PilotRecord, StoreState, UserRecord } from '../store/types.ts';
import { moveView } from '../views.ts';
import type { ActionResult } from './moves.ts';
import { requireMoveVersion } from './moves.ts';
import { asRecord } from './validate.ts';

export type TurnEntry = {
  pilot_id: string;
  name: string;
  position: number;
  licence_class: string;
  eligible: boolean;
  reasons: EligibilityReason[];
  rest_until: string | null;
};

export type Eligibility = {
  boarding_at: string;
  next_eligible: string | null;
  turn: TurnEntry[];
};

function pilotsInTurnOrder(state: StoreState): PilotRecord[] {
  const pilots: PilotRecord[] = [];
  for (const pilotId of state.turn_order) {
    const pilot = state.pilots.find((entry) => entry.id === pilotId);
    if (pilot !== undefined) pilots.push(pilot);
  }
  return pilots;
}

/** Turn position, licence cover and rest verdict for each pilot against this move. */
export function eligibilityFor(state: StoreState, move: MoveRecord): Eligibility {
  const turn: TurnEntry[] = pilotsInTurnOrder(state).map((pilot, index) => {
    const reasons: EligibilityReason[] = [];
    if (!licenceCovers(pilot.licence_class, move.length_m, move.draught_mm)) {
      reasons.push('licence');
    }
    const verdict = restVerdictFor(state, pilot, move);
    reasons.push(...verdict.reasons);
    const ordered = sortReasons(reasons);
    return {
      pilot_id: pilot.id,
      name: pilot.name,
      position: index + 1,
      licence_class: pilot.licence_class,
      eligible: ordered.length === 0,
      reasons: ordered,
      rest_until: verdict.rest_until === null ? null : formatInstantSeconds(verdict.rest_until),
    };
  });
  const next = turn.find((entry) => entry.eligible);
  return {
    boarding_at: move.boarding_at,
    next_eligible: next === undefined ? null : next.pilot_id,
    turn,
  };
}

export function readEligibility(app: App, user: UserRecord, move: MoveRecord): ActionResult {
  if (user.role !== 'dispatcher') throw forbidden();
  return { status: 200, json: { ...eligibilityFor(app.store.read(), move) } };
}

const OVERRIDE_MESSAGE =
  'Type an immediate-safety reason of 10 to 500 characters for a pilot breaching rest';
const OVERRIDE_NOT_NEEDED = 'An override reason is only accepted for a pilot breaching rest';

export function assignPilot(
  app: App,
  user: UserRecord,
  move: MoveRecord,
  body: unknown,
  ifMatch: string | undefined,
): ActionResult {
  if (user.role !== 'dispatcher') throw forbidden();
  const now = Date.now();
  const fields = asRecord(body);
  const state = app.store.read();
  const pilotId = fields.pilot_id;
  const pilot = state.pilots.find((entry) => entry.id === pilotId);
  if (pilot === undefined) throw notFound();
  requireMoveVersion(app, move, user, ifMatch, now);

  const overrideSupplied = typeof fields.rest_override_reason === 'string';
  const overrideReason = overrideSupplied ? (fields.rest_override_reason as string) : null;
  const note = typeof fields.note === 'string' ? fields.note : '';

  const eligibility = eligibilityFor(state, move);
  const withTurn = () => ({ turn: eligibility.turn });
  if (!assignmentAllowed(move.status)) {
    throw conflict('illegal_transition', 'This move is not waiting for a pilot', withTurn());
  }
  const entry = eligibility.turn.find((candidate) => candidate.pilot_id === pilot.id);
  if (entry === undefined) throw notFound();
  if (entry.reasons.includes('licence')) {
    throw conflict('licence_not_covering', 'That licence does not cover this vessel', withTurn());
  }
  const restBreach = entry.reasons.some((reason) => REST_TYPE_REASONS.includes(reason));
  if (restBreach && overrideReason === null) {
    throw conflict('rest_breach', 'Rest rules are not met for that pilot', withTurn());
  }
  const nextPosition =
    eligibility.turn.find((candidate) => candidate.pilot_id === eligibility.next_eligible)
      ?.position ?? null;
  if (nextPosition !== null && entry.position > nextPosition) {
    throw conflict('not_next_in_turn', 'That pilot is not next eligible', withTurn());
  }
  if (!restBreach && overrideReason !== null) {
    throw invalid({ rest_override_reason: OVERRIDE_NOT_NEEDED });
  }
  if (overrideReason !== null) {
    const trimmed = overrideReason.trim();
    if (trimmed.length < 10 || trimmed.length > 500) {
      throw invalid({ rest_override_reason: OVERRIDE_MESSAGE });
    }
  }

  const skipped = eligibility.turn.filter((candidate) => candidate.position < entry.position);
  const boarding = moveBoardingInstant(move);
  const factory: NoticeFactory = {
    state,
    move,
    now,
    nextId: (counter, prefix) => app.store.nextId(counter, prefix),
  };

  app.store.mutate(() => {
    for (const candidate of skipped) {
      state.skips.push({
        pilot_id: candidate.pilot_id,
        reasons: candidate.reasons,
        move_ref: move.ref,
        at: formatInstantSeconds(now),
      });
    }
    state.turn_order = [
      ...state.turn_order.filter((id) => id !== pilot.id),
      pilot.id,
    ];
    move.pilot_id = pilot.id;
    if (!move.pilot_history.includes(pilot.id)) move.pilot_history.push(pilot.id);
    move.duty = {
      pilot_id: pilot.id,
      start_at: formatInstantSeconds(boarding),
      end_at: formatInstantSeconds(boarding + move.duty_minutes * 60_000),
    };
    move.status = 'Pilot assigned';
    move.version += 1;
    move.history.push({ at: formatInstantSeconds(now), status: move.status, by: user.name });
    if (note.trim() !== '') {
      move.dispatcher_notes.push({ at: formatInstantSeconds(now), by: user.name, note });
    }
    if (overrideReason !== null) {
      const record = {
        id: app.store.nextId('override', 'OV'),
        move_ref: move.ref,
        pilot_id: pilot.id,
        reason: overrideReason.trim(),
        by: user.name,
        at: formatInstantSeconds(now),
      };
      state.rest_overrides.push(record);
      move.rest_override_id = record.id;
    }
    orderConfirmation(factory, pilot.name);
    assignmentNotice(
      factory,
      pilot.id,
      move.committed?.pinch_waypoint ?? '',
      move.committed?.margin_mm ?? 0,
    );
  });
  void app.steps.runPending();
  return { status: 200, json: moveView(app.store.read(), move, user, now) };
}
