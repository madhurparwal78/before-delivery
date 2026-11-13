// Move commands. Each is decided atomically against the move's current status (the store is
// synchronous), checks in the published order, and raises `version` by one per stored change.
import { MINUTE_MS, portStamp } from "../../shared/portTime.js";
import type { MoveStatus, TurnEntry } from "../../shared/types.js";
import type { App } from "../app.js";
import { ApiError, illegalTransition, invalid, notFound } from "../errors.js";
import type { DutyRecord, MoveRecord, Store, UserRecord, VesselRecord } from "../store.js";
import { type Boarding, DUTY_MESSAGE, Fields, objectBody, orderValues } from "../validate.js";
import { raiseBillingEvent } from "./billing.js";
import { turnFor } from "./eligibility.js";
import { boardingInstant, detained, noticeOf } from "./moveClock.js";
import { PLANNED, permits, TRANSITIONS } from "./moveRules.js";
import { assignmentNotice, assignmentWithdrawn, orderAmended, orderCancelled, orderConfirmation } from "./notices.js";
import { committedWindow, gateAt, planFor, subjectOf } from "./plan.js";

export function save(store: Store, move: MoveRecord, by: UserRecord | string, now: number, status?: MoveStatus, note?: string): MoveRecord {
  const name = typeof by === "string" ? by : by.name;
  const next: MoveRecord = { ...move, version: move.version + 1 };
  if (status) {
    next.status = status;
    next.history = [...move.history, { at: portStamp(now), status, by: name, ...(note ? { note } : {}) }];
  }
  return store.moves.put(next);
}

const dutyOf = (store: Store, ref: string): DutyRecord | undefined => store.duties.by("move_ref", ref)[0];

/** A completed or refused move's duty ends then; a duty cannot start after it ends. */
export function endDuty(store: Store, ref: string, now: number): void {
  const duty = dutyOf(store, ref);
  if (duty) store.duties.put({ ...duty, start: Math.min(duty.start, now), end: now });
}

/** Renumbers the turn list from an ordered list of pilot ids. */
function setTurn(store: Store, order: string[]): void {
  order.forEach((id, index) => {
    const pilot = store.pilots.get(id);
    if (pilot) store.pilots.put({ ...pilot, position: index + 1 });
  });
}

const turnOrder = (store: Store): string[] =>
  store.pilots
    .all()
    .sort((a, b) => a.position - b.position)
    .map((p) => p.id);

/** A released pilot goes to the head of the turn list, their duty is removed and they are told. */
function releasePilot(store: Store, move: MoveRecord): void {
  const pilotId = move.pilot_id;
  if (!pilotId) return;
  setTurn(store, [pilotId, ...turnOrder(store).filter((id) => id !== pilotId)]);
  const duty = dutyOf(store, move.ref);
  if (duty) store.duties.remove(duty.id);
  assignmentWithdrawn(store, move, pilotId);
  move.pilot_id = null;
}

export function placeOrder(app: App, user: UserRecord, vessel: VesselRecord | null, raw: unknown, now: number): MoveRecord {
  const fields = new Fields(objectBody(raw));
  if (!vessel) fields.fail("vessel_id", "Choose a vessel");
  const boarding = fields.boarding("boarding_at", now);
  const values = vessel ? orderValues(fields, vessel) : undefined;
  const duty = fields.number("duty_minutes", 30, 1440, 0, DUTY_MESSAGE);
  if (fields.failed() || !vessel || !boarding || !values || duty === undefined) throw invalid(fields.errors);
  const seq = app.store.next("move", 1011);
  const move: MoveRecord = {
    ref: `MV-${seq}`,
    seq,
    version: 1,
    status: "Ordered",
    agency_code: vessel.agency_code,
    vessel: { id: vessel.id, name: vessel.name, imo: vessel.imo, length_m: values.length_m, gross_tonnage: values.gross_tonnage, block_coefficient: values.block_coefficient },
    draught_mm: values.draught_mm,
    speed_kn: values.speed_kn,
    duty_minutes: duty,
    boarding_at: boarding.at,
    committed: null,
    pilot_id: null,
    pilots_ever: [],
    late_amendments: 0,
    detention: [],
    history: [{ at: portStamp(now), status: "Ordered", by: user.name }],
    dispatcher_notes: [],
    rest_override: null,
    ladder_reports: [],
  };
  return app.store.moves.put(move);
}

export function commitWindow(app: App, user: UserRecord, move: MoveRecord, raw: unknown, now: number): MoveRecord {
  if (!permits("commit", move)) throw illegalTransition();
  const fields = new Fields(objectBody(raw));
  const boarding = fields.boarding("boarding_at", now);
  const tideVersion = fields.number("tide_version", 0, Number.MAX_SAFE_INTEGER, 0, "Send the plan's tide version");
  const draught = fields.number("draught_mm", 0, Number.MAX_SAFE_INTEGER, 0, "Send the planned draught in whole millimetres");
  if (fields.failed() || !boarding || tideVersion === undefined || draught === undefined) throw invalid(fields.errors);
  const plan = planFor(app.store, subjectOf(move), boarding.instant);
  if (tideVersion !== app.store.tideVersion() || draught !== move.draught_mm) {
    throw new ApiError(409, "stale_plan", "The tide table or draught changed since this plan", { plan });
  }
  if (plan.window_state === "closed") {
    throw new ApiError(409, "window_closed", "The window no longer clears", { plan });
  }
  return save(
    app.store,
    { ...move, boarding_at: boarding.at, committed: committedWindow(plan, boarding.at, plan.tide_version) },
    user,
    now,
    "Window committed",
  );
}

export function turnOf(store: Store, move: MoveRecord): TurnEntry[] {
  const start = boardingInstant(move);
  return turnFor(
    { start, end: start + move.duty_minutes * MINUTE_MS, length_m: move.vessel.length_m, draught_mm: move.draught_mm },
    store.pilots.all(),
    (pilotId) => store.duties.by("pilot_id", pilotId).filter((d) => d.move_ref !== move.ref),
  );
}

export const nextEligible = (turn: TurnEntry[]): TurnEntry | undefined => turn.find((t) => t.reasons.length === 0);

/** Assignment checks, in the published order; the first that matches decides. */
export function assignPilot(app: App, user: UserRecord, move: MoveRecord, raw: unknown, now: number): MoveRecord {
  const store = app.store;
  const body = objectBody(raw);
  const turn = turnOf(store, move);
  const next = nextEligible(turn);
  const fresh = { turn, next_eligible: next?.pilot_id ?? null };
  if (!permits("assign", move)) throw illegalTransition(fresh);
  const target = turn.find((t) => t.pilot_id === body.pilot_id);
  if (!target) throw notFound();
  const reason = body.rest_override_reason;
  const supplied = typeof reason === "string";
  const resting = target.rest_breach;
  if (target.reasons.includes("licence")) {
    throw new ApiError(409, "licence_not_covering", `Pilot ${target.name} is not licensed for this vessel`, fresh);
  }
  if (resting && !supplied) throw new ApiError(409, "rest_breach", "Rest rules not met", fresh);
  if (next && target.position > next.position) {
    throw new ApiError(409, "not_next_in_turn", `Pilot ${target.name} is not next eligible`, fresh);
  }
  if (!resting && supplied) throw invalid({ rest_override_reason: "This pilot meets the rest rules; no override is needed" });
  const trimmed = supplied ? reason.trim() : "";
  if (supplied && (trimmed.length < 10 || trimmed.length > 500)) {
    throw invalid({ rest_override_reason: "Type 10 to 500 characters for a pilot breaching rest" });
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 2000) throw invalid({ note: "Keep the note under 2,000 characters" });

  const at = portStamp(now);
  turn
    .filter((t) => t.position < target.position)
    .forEach((t) => {
      const seq = store.next("skip");
      store.skips.put({ id: `SK-${seq}`, seq, pilot_id: t.pilot_id, reasons: t.reasons, move_ref: move.ref, at });
    });
  setTurn(store, [...turnOrder(store).filter((id) => id !== target.pilot_id), target.pilot_id]);
  const start = boardingInstant(move);
  store.duties.put({ id: `DU-${move.ref}`, pilot_id: target.pilot_id, move_ref: move.ref, start, end: start + move.duty_minutes * MINUTE_MS });
  let override: MoveRecord["rest_override"] = null;
  if (supplied) {
    override = { reason: trimmed, pilot_id: target.pilot_id, by: user.name, at };
    const seq = store.next("override");
    store.overrides.put({ id: `OV-${seq}`, seq, move_ref: move.ref, ...override });
  }
  const assigned = save(
    store,
    {
      ...move,
      pilot_id: target.pilot_id,
      pilots_ever: move.pilots_ever.includes(target.pilot_id) ? move.pilots_ever : [...move.pilots_ever, target.pilot_id],
      dispatcher_notes: note ? [...move.dispatcher_notes, { at, by: user.name, text: note }] : move.dispatcher_notes,
      rest_override: override ?? move.rest_override,
    },
    user,
    now,
    "Pilot assigned",
  );
  orderConfirmation(store, assigned, target.name);
  assignmentNotice(store, assigned, target.pilot_id);
  return assigned;
}

interface Amendment {
  move: MoveRecord;
  window_returned: boolean;
  late_notice: boolean;
}

/** An amendment re-checks the plan; a committed or assigned move that no longer clears returns to Ordered. */
export function amendMove(app: App, user: UserRecord, move: MoveRecord, raw: unknown, now: number): Amendment {
  const store = app.store;
  const body = objectBody(raw);
  if (!permits("amend", move)) throw new ApiError(409, "not_amendable", "This move can no longer be amended");
  const vessel = store.vessels.get(typeof body.vessel_id === "string" ? body.vessel_id : move.vessel.id);
  if (!vessel) throw notFound();
  const sameVessel = vessel.id === move.vessel.id;
  const fields = new Fields({
    speed_kn: move.speed_kn,
    ...(sameVessel
      ? { block_coefficient: move.vessel.block_coefficient, gross_tonnage: move.vessel.gross_tonnage, length_m: move.vessel.length_m }
      : {}),
    duty_minutes: move.duty_minutes,
    ...(body.draught_m === undefined && body.draught_ft === undefined && body.draught_in === undefined
      ? { draught_m: move.draught_mm / 1000 }
      : {}),
    ...body,
  });
  const changesTime = body.boarding_at !== undefined && body.boarding_at !== move.boarding_at;
  const boarding: Boarding | undefined =
    body.boarding_at === undefined ? undefined : fields.boarding("boarding_at", changesTime ? now : null);
  if (vessel.agency_code !== move.agency_code) fields.fail("vessel_id", "Choose one of the ordering agency's vessels");
  const values = orderValues(fields, vessel);
  const duty = fields.number("duty_minutes", 30, 1440, 0, DUTY_MESSAGE);
  if (fields.failed() || !values || duty === undefined) throw invalid(fields.errors);

  const late = changesTime && noticeOf(move, now).state === "late";
  const amended: MoveRecord = {
    ...move,
    vessel: { id: vessel.id, name: vessel.name, imo: vessel.imo, length_m: values.length_m, gross_tonnage: values.gross_tonnage, block_coefficient: values.block_coefficient },
    draught_mm: values.draught_mm,
    speed_kn: values.speed_kn,
    duty_minutes: duty,
    boarding_at: boarding?.at ?? move.boarding_at,
    late_amendments: move.late_amendments + (late ? 1 : 0),
  };
  let returned = false;
  if (PLANNED.includes(move.status)) {
    const gate = gateAt(store, subjectOf(amended), boardingInstant(amended));
    if (gate.window_state === "open") {
      amended.committed = committedWindow(gate, amended.boarding_at, store.tideVersion());
    } else {
      returned = true;
      amended.committed = null;
      releasePilot(store, amended);
    }
  }
  const assignedDuty = amended.pilot_id ? dutyOf(store, move.ref) : undefined;
  if (assignedDuty) {
    const start = boardingInstant(amended);
    store.duties.put({ ...assignedDuty, start, end: start + amended.duty_minutes * MINUTE_MS });
  }
  const saved = save(store, amended, user, now, returned ? "Ordered" : undefined);
  orderAmended(store, saved);
  return { move: saved, window_returned: returned, late_notice: late };
}

/** Cancellation before On board ends in Cancelled or Cancelled late by the server's notice verdict. */
export function cancelMove(app: App, user: UserRecord, move: MoveRecord, now: number): MoveRecord {
  if (!permits("cancel", move)) throw new ApiError(409, "not_cancellable", "This move can no longer be cancelled");
  const late = noticeOf(move, now).state === "late";
  const released: MoveRecord = { ...move };
  releasePilot(app.store, released);
  const cancelled = late ? raiseBillingEvent(app, released, "Cancelled late", now) : released;
  const saved = save(app.store, cancelled, user, now, late ? "Cancelled late" : "Cancelled");
  orderCancelled(app.store, saved);
  return saved;
}

export function transition(app: App, user: UserRecord, move: MoveRecord, raw: unknown, now: number): MoveRecord {
  const body = objectBody(raw);
  const to = typeof body.to === "string" ? body.to : "";
  const action = TRANSITIONS[to];
  if (!action) throw invalid({ to: "Choose Pilot away, On board or Completed" });
  if (!permits(action, move)) throw illegalTransition();
  if (action !== "complete") return save(app.store, move, user, now, to as MoveStatus);
  if (detained(move)) throw new ApiError(409, "detention_open", "Stop detention before completing the move");
  endDuty(app.store, move.ref, now);
  return save(app.store, raiseBillingEvent(app, move, "Completed", now), user, now, "Completed");
}

export function detention(app: App, user: UserRecord, move: MoveRecord, raw: unknown, now: number): MoveRecord {
  const action = objectBody(raw).action;
  if (action !== "start" && action !== "stop") throw invalid({ action: "Choose start or stop" });
  if (!permits(action === "start" ? "start_detention" : "stop_detention", move)) throw illegalTransition();
  if (action === "start") {
    if (detained(move)) throw new ApiError(409, "detention_already_open", "Detention is already running");
    return save(app.store, { ...move, detention: [...move.detention, { start: now, end: null }] }, user, now);
  }
  if (!detained(move)) throw new ApiError(409, "detention_not_open", "Detention is not running");
  return save(app.store, { ...move, detention: move.detention.map((s) => (s.end === null ? { ...s, end: now } : s)) }, user, now);
}

/** A corrected re-order after a refusal: back to Ordered at a new time, no notice check, no mail. */
export function reorderMove(app: App, user: UserRecord, move: MoveRecord, raw: unknown, now: number): MoveRecord {
  if (!permits("reorder", move)) throw illegalTransition();
  const fields = new Fields(objectBody(raw));
  const correction = fields.text("correction", 3, 500, "Describe the correction in 3 to 500 characters");
  const boarding = fields.boarding("boarding_at", now);
  if (fields.failed() || !boarding || correction === undefined) throw invalid(fields.errors);
  return save(
    app.store,
    { ...move, boarding_at: boarding.at, committed: null },
    user,
    now,
    "Ordered",
    `Corrected re-order: ${correction.trim()}`,
  );
}

/**
 * After a tide revision every committed or assigned move is recomputed at its committed time: one
 * that no longer clears returns to Ordered; one that still clears takes the new pinch, margin and version.
 */
export function recheckCommitted(app: App, user: UserRecord, now: number): string[] {
  const store = app.store;
  const returned: string[] = [];
  for (const move of [...store.moves.by("status", "Window committed"), ...store.moves.by("status", "Pilot assigned")]) {
    const gate = gateAt(store, subjectOf(move), boardingInstant(move));
    if (gate.window_state === "open") {
      save(store, { ...move, committed: committedWindow(gate, move.boarding_at, store.tideVersion()) }, user, now);
      continue;
    }
    const back: MoveRecord = { ...move, committed: null };
    releasePilot(store, back);
    const saved = save(store, back, user, now, "Ordered");
    orderAmended(store, saved);
    returned.push(move.ref);
  }
  return returned;
}

