import { formatInstantSeconds } from '../../domain/porttime.ts';
import {
  amendmentAllowed,
  cancellationAllowed,
  commitAllowed,
  detentionAllowed,
  holdsCommittedWindow,
  type PilotTransition,
  pilotTransitionAllowed,
  reorderAllowed,
} from '../../domain/moves.ts';
import { noticeState } from '../../domain/notice.ts';
import type { App } from '../app.ts';
import { recordBillingEvent } from '../charges.ts';
import {
  detentionSeconds,
  moveBoardingInstant,
  planForMove,
  revisionForBoarding,
} from '../derive.ts';
import { conflict, forbidden, invalid, notFound, versionRequired, staleVersion } from '../errors.ts';
import {
  assignmentWithdrawn,
  orderAmended,
  orderCancelled,
  type NoticeFactory,
} from '../notices.ts';
import type { MoveRecord, StoreState, UserRecord } from '../store/types.ts';
import { isAssignedPilot, moveView } from '../views.ts';
import {
  BLOCK_RANGE,
  DUTY_RANGE,
  FieldErrors,
  LENGTH_RANGE,
  SPEED_RANGE,
  TONNAGE_RANGE,
  asRecord,
  boardingTimeField,
  definite,
  draughtField,
  numberField,
  stringField,
  wholeNumberField,
} from './validate.ts';

export type ActionResult = { status: number; json: Record<string, unknown> };

function factory(app: App, state: StoreState, move: MoveRecord, now: number): NoticeFactory {
  return { state, move, now, nextId: (counter, prefix) => app.store.nextId(counter, prefix) };
}

export function requireMoveVersion(
  app: App,
  move: MoveRecord,
  user: UserRecord,
  ifMatch: string | undefined,
  now: number,
): void {
  if (ifMatch === undefined || ifMatch.trim() === '') throw versionRequired();
  const requested = Number(ifMatch.replace(/^W\//, '').replace(/"/g, ''));
  if (!Number.isInteger(requested) || requested !== move.version) {
    throw staleVersion(moveView(app.store.read(), move, user, now));
  }
}

/** A released pilot goes to the head of the turn list, and the duty is removed. */
function releasePilot(
  app: App,
  state: StoreState,
  move: MoveRecord,
  now: number,
  notify: boolean,
): void {
  const pilotId = move.pilot_id;
  if (pilotId === null) return;
  move.pilot_id = null;
  move.duty = null;
  state.turn_order = [pilotId, ...state.turn_order.filter((entry) => entry !== pilotId)];
  if (notify) assignmentWithdrawn(factory(app, state, move, now), pilotId);
}

function historyEntry(move: MoveRecord, now: number, by: string): void {
  move.history.push({ at: formatInstantSeconds(now), status: move.status, by });
}

/** An amendment or tide revision after which the window no longer clears returns a move to Ordered. */
export function recheckCommittedWindow(
  app: App,
  state: StoreState,
  move: MoveRecord,
  now: number,
): boolean {
  if (!holdsCommittedWindow(move.status)) return false;
  const plan = planForMove(state, move, moveBoardingInstant(move));
  const pinch = plan.waypoints.find((waypoint) => waypoint.id === plan.pinch.waypoint_id);
  if (plan.window_state === 'open') {
    move.committed = {
      boarding_at: move.boarding_at,
      pinch_waypoint: pinch?.name ?? '',
      margin_mm: plan.pinch.margin_mm,
      tide_version: state.tide_version,
    };
    return false;
  }
  move.committed = null;
  move.status = 'Ordered';
  releasePilot(app, state, move, now, true);
  return true;
}

export function createMove(app: App, user: UserRecord, body: unknown): ActionResult {
  if (user.role !== 'agent') throw forbidden();
  const now = Date.now();
  const fields = asRecord(body);
  const state = app.store.read();
  const vesselId = fields.vessel_id;
  const vessel = state.vessels.find((entry) => entry.id === vesselId);
  if (vessel === undefined || vessel.agency_code !== user.agency_code) throw notFound();
  const errors = new FieldErrors();
  const boardingField = boardingTimeField(fields, errors, { mustBeFuture: true, now });
  const draught = draughtField(fields, errors) ?? vessel.draught_mm;
  const speed = numberField(fields, 'speed_kn', errors, SPEED_RANGE) ?? vessel.speed_kn;
  const dutyField = wholeNumberField(fields, 'duty_minutes', errors, DUTY_RANGE);
  const block =
    numberField(fields, 'block_coefficient', errors, BLOCK_RANGE) ?? vessel.block_coefficient;
  const length = numberField(fields, 'length_m', errors, LENGTH_RANGE) ?? vessel.length_m;
  const tonnage =
    wholeNumberField(fields, 'gross_tonnage', errors, TONNAGE_RANGE) ?? vessel.gross_tonnage;
  errors.throwIfAny();
  const boarding = definite(boardingField, 'boarding_at');
  const duty = definite(dutyField, 'duty_minutes');

  const move = app.store.mutate((live): MoveRecord => {
    const record: MoveRecord = {
      ref: app.store.nextId('move', 'MV'),
      version: 1,
      status: 'Ordered',
      agency_code: vessel.agency_code,
      vessel_id: vessel.id,
      length_m: length,
      gross_tonnage: tonnage,
      block_coefficient: block,
      draught_mm: draught,
      speed_kn: speed,
      duty_minutes: duty,
      boarding_at: boarding.text,
      committed: null,
      pilot_id: null,
      pilot_history: [],
      duty: null,
      late_amendments: 0,
      detention_open_since: null,
      detention_seconds: 0,
      notice_ids: [],
      billing_events: [],
      ladder_report_ids: [],
      history: [{ at: formatInstantSeconds(now), status: 'Ordered', by: user.name }],
      corrections: [],
      dispatcher_notes: [],
      rest_override_id: null,
      created_at: formatInstantSeconds(now),
    };
    live.moves.push(record);
    return record;
  });
  return { status: 201, json: moveView(app.store.read(), move, user, now) };
}

export function amendMove(
  app: App,
  user: UserRecord,
  move: MoveRecord,
  body: unknown,
  ifMatch: string | undefined,
): ActionResult {
  if (user.role !== 'agent' && user.role !== 'dispatcher') throw forbidden();
  const now = Date.now();
  requireMoveVersion(app, move, user, ifMatch, now);
  if (!amendmentAllowed(move.status)) {
    throw conflict('not_amendable', 'This move can no longer be amended');
  }
  const fields = asRecord(body);
  const state = app.store.read();
  const errors = new FieldErrors();
  const vesselId = fields.vessel_id;
  let vessel = state.vessels.find((entry) => entry.id === move.vessel_id);
  if (vesselId !== undefined) {
    const chosen = state.vessels.find((entry) => entry.id === vesselId);
    if (
      chosen === undefined ||
      (user.role === 'agent' && chosen.agency_code !== user.agency_code)
    ) {
      throw notFound();
    }
    vessel = chosen;
  }
  const boardingChanged =
    typeof fields.boarding_at === 'string' && fields.boarding_at.slice(0, 16) !== move.boarding_at;
  const boarding = boardingTimeField(fields, errors, { mustBeFuture: boardingChanged, now });
  const draught = draughtField(fields, errors);
  const speed = numberField(fields, 'speed_kn', errors, SPEED_RANGE);
  const duty = wholeNumberField(fields, 'duty_minutes', errors, DUTY_RANGE);
  const block = numberField(fields, 'block_coefficient', errors, BLOCK_RANGE);
  const length = numberField(fields, 'length_m', errors, LENGTH_RANGE);
  const tonnage = wholeNumberField(fields, 'gross_tonnage', errors, TONNAGE_RANGE);
  errors.throwIfAny();

  const previousBoarding = moveBoardingInstant(move);
  const late = boardingChanged && noticeState(previousBoarding, now) === 'late';

  const result = app.store.mutate(() => {
    if (vessel !== undefined && vessel.id !== move.vessel_id) {
      move.vessel_id = vessel.id;
      move.agency_code = vessel.agency_code;
    }
    if (boarding !== null) move.boarding_at = boarding.text;
    if (draught !== null) move.draught_mm = draught;
    if (speed !== null) move.speed_kn = speed;
    if (duty !== null) move.duty_minutes = duty;
    if (block !== null) move.block_coefficient = block;
    if (length !== null) move.length_m = length;
    if (tonnage !== null) move.gross_tonnage = tonnage;
    if (late) move.late_amendments += 1;
    if (move.duty !== null) {
      const start = moveBoardingInstant(move);
      move.duty = {
        pilot_id: move.duty.pilot_id,
        start_at: formatInstantSeconds(start),
        end_at: formatInstantSeconds(start + move.duty_minutes * 60_000),
      };
    }
    const returned = recheckCommittedWindow(app, state, move, now);
    move.version += 1;
    historyEntry(move, now, user.name);
    orderAmended(factory(app, state, move, now));
    return returned;
  });
  void app.steps.runPending();
  return {
    status: 200,
    json: {
      ...moveView(app.store.read(), move, user, now),
      window_returned: result,
      late_notice: late,
    },
  };
}

export function commitWindow(
  app: App,
  user: UserRecord,
  move: MoveRecord,
  body: unknown,
  ifMatch: string | undefined,
): ActionResult {
  if (user.role !== 'dispatcher') throw forbidden();
  const now = Date.now();
  requireMoveVersion(app, move, user, ifMatch, now);
  if (!commitAllowed(move.status)) {
    throw conflict('illegal_transition', 'This move cannot take a committed window now');
  }
  const fields = asRecord(body);
  const errors = new FieldErrors();
  const boardingField = boardingTimeField(fields, errors, { mustBeFuture: true, now });
  const tideVersionField = wholeNumberField(fields, 'tide_version', errors, {
    min: 1,
    max: 1_000_000,
  });
  const draughtMmField = wholeNumberField(fields, 'draught_mm', errors, {
    min: 2000,
    max: 16000,
  });
  errors.throwIfAny();
  const boarding = definite(boardingField, 'boarding_at');
  const tideVersion = definite(tideVersionField, 'tide_version');
  const draughtMm = definite(draughtMmField, 'draught_mm');

  const state = app.store.read();
  const plan = planForMove(state, move, boarding.instant);
  const planJson = {
    tide_version: state.tide_version,
    boarding_at: plan.boarding_at,
    draught_mm: plan.draught_mm,
    required_mm: plan.required_mm,
    waypoints: plan.waypoints,
    pinch: plan.pinch,
    window_state: plan.window_state,
    estimate: {
      tariff_revision: revisionForBoarding(state, boarding.instant).label,
      lines: [],
      total_cents: 0,
    },
  };
  if (tideVersion !== state.tide_version || draughtMm !== move.draught_mm) {
    throw conflict('stale_plan', 'The tide table or draught changed', { plan: planJson });
  }
  if (plan.window_state === 'closed') {
    throw conflict('window_closed', 'The window no longer clears', { plan: planJson });
  }

  const pinch = plan.waypoints.find((waypoint) => waypoint.id === plan.pinch.waypoint_id);
  app.store.mutate(() => {
    move.boarding_at = boarding.text;
    move.committed = {
      boarding_at: boarding.text,
      pinch_waypoint: pinch?.name ?? '',
      margin_mm: plan.pinch.margin_mm,
      tide_version: state.tide_version,
    };
    move.status = 'Window committed';
    move.version += 1;
    historyEntry(move, now, user.name);
  });
  return { status: 200, json: moveView(app.store.read(), move, user, now) };
}

export function cancelMove(app: App, user: UserRecord, move: MoveRecord): ActionResult {
  if (user.role !== 'agent' && user.role !== 'dispatcher') throw forbidden();
  const now = Date.now();
  if (!cancellationAllowed(move.status)) {
    throw conflict('not_cancellable', 'This move can no longer be cancelled');
  }
  const state = app.store.read();
  const late = noticeState(moveBoardingInstant(move), now) === 'late';
  app.store.mutate(() => {
    move.status = late ? 'Cancelled late' : 'Cancelled';
    releasePilot(app, state, move, now, true);
    move.committed = null;
    move.version += 1;
    historyEntry(move, now, user.name);
    orderCancelled(factory(app, state, move, now));
    if (late) {
      recordBillingEvent({
        state,
        move,
        kind: 'Cancelled late',
        now,
        detentionUnitSeconds: app.config.detentionUnitSeconds,
        nextId: (counter, prefix) => app.store.nextId(counter, prefix),
      });
    }
  });
  void app.steps.runPending();
  return { status: 200, json: moveView(app.store.read(), move, user, now) };
}

export function reorderMove(
  app: App,
  user: UserRecord,
  move: MoveRecord,
  body: unknown,
): ActionResult {
  if (user.role !== 'agent') throw forbidden();
  const now = Date.now();
  if (!reorderAllowed(move.status)) {
    throw conflict('illegal_transition', 'This move cannot take a corrected re-order');
  }
  const fields = asRecord(body);
  const errors = new FieldErrors();
  const boardingField = boardingTimeField(fields, errors, { mustBeFuture: true, now });
  const correctionField = stringField(fields, 'correction', errors, {
    min: 3,
    max: 500,
    message: 'A correction of 3 to 500 characters is required',
  });
  errors.throwIfAny();
  const boarding = definite(boardingField, 'boarding_at');
  const correction = definite(correctionField, 'correction');

  app.store.mutate(() => {
    move.boarding_at = boarding.text;
    move.committed = null;
    move.pilot_id = null;
    move.duty = null;
    move.status = 'Ordered';
    move.version += 1;
    move.corrections.push({ at: formatInstantSeconds(now), by: user.name, text: correction });
    historyEntry(move, now, user.name);
  });
  return { status: 200, json: moveView(app.store.read(), move, user, now) };
}

const PILOT_TRANSITIONS: PilotTransition[] = ['Pilot away', 'On board', 'Completed'];

export function pilotTransition(
  app: App,
  user: UserRecord,
  move: MoveRecord,
  body: unknown,
): ActionResult {
  if (user.role !== 'dispatcher' && !isAssignedPilot(user, move)) throw forbidden();
  const now = Date.now();
  const fields = asRecord(body);
  const to = fields.to;
  if (typeof to !== 'string' || !PILOT_TRANSITIONS.includes(to as PilotTransition)) {
    throw invalid({ to: 'A status of Pilot away, On board or Completed is required' });
  }
  const target = to as PilotTransition;
  if (!pilotTransitionAllowed(move.status, target)) {
    throw conflict('illegal_transition', "This action is not available for the move's status");
  }
  if (target === 'Completed' && move.detention_open_since !== null) {
    throw conflict('detention_open', 'Stop detention before completing the move');
  }
  const state = app.store.read();
  app.store.mutate(() => {
    move.status = target;
    move.version += 1;
    historyEntry(move, now, user.name);
    if (target === 'Completed') {
      if (move.duty !== null) move.duty = { ...move.duty, end_at: formatInstantSeconds(now) };
      recordBillingEvent({
        state,
        move,
        kind: 'Completed',
        now,
        detentionUnitSeconds: app.config.detentionUnitSeconds,
        nextId: (counter, prefix) => app.store.nextId(counter, prefix),
      });
    }
  });
  void app.steps.runPending();
  return { status: 200, json: moveView(app.store.read(), move, user, now) };
}

export function detentionAction(
  app: App,
  user: UserRecord,
  move: MoveRecord,
  body: unknown,
): ActionResult {
  if (user.role !== 'dispatcher' && !isAssignedPilot(user, move)) throw forbidden();
  const now = Date.now();
  const fields = asRecord(body);
  const action = fields.action;
  if (action !== 'start' && action !== 'stop') {
    throw invalid({ action: 'An action of start or stop is required' });
  }
  if (!detentionAllowed(move.status)) {
    throw conflict('illegal_transition', 'Detention runs only while the move is on board');
  }
  if (action === 'start' && move.detention_open_since !== null) {
    throw conflict('detention_already_open', 'Detention is already running');
  }
  if (action === 'stop' && move.detention_open_since === null) {
    throw conflict('detention_not_open', 'Detention is not running');
  }
  app.store.mutate(() => {
    if (action === 'start') {
      move.detention_open_since = formatInstantSeconds(now);
    } else {
      move.detention_seconds = detentionSeconds(move, now);
      move.detention_open_since = null;
    }
    move.version += 1;
  });
  return { status: 200, json: moveView(app.store.read(), move, user, now) };
}
