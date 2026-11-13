// Move state machine and the domain actions behind each keyed route. Each
// transition is decided atomically against the move's current status.

import { ApiError } from './api-util.js';
import { notFound } from './api-util.js';
import { validationError } from './validate.js';

import {
  boardingAtOf, requireBoardingAt, draughtMmOf, speedKnOf, dutyMinutesOf,
  numberInRange, positiveNumber, nonNegativeNumber, versionOf, applyOrderFields,
} from './validate.js';
import { formatPortDateTimeApi, formatPortDateTimeSpace } from './porttime.js';
import { computePlan } from './plan.js';
import { estimateLines, totalOf } from './tariff.js';
import { reasonsFor } from './rest.js';
import { serializeMove, serializePlan, serializeReport } from './serialize.js';
import { makeNotice, enqueueNotice } from './steps.js';
import type { Move, MoveStatus, User } from './types.js';
import type { Store } from './store.js';
import type { LadderReport } from './types.js';
import type { HttpEnv } from './router.js';

export interface TariffBody {
  label: string;
  effective_at: string;
  draft_foot_cents: number;
  minimum_cents: number;
  tonnage_bands: { from_gt: number; to_gt: number | null; cents: number }[];
  night_percent: number;
  detention_half_hour_cents: number;
  detention_allowance_half_hours: number;
  cancellation_cents: number;
}

export class Actions {
  constructor(private readonly env: HttpEnv) {}

  private get store() { return this.env.store; }
  private get now() { return this.env.now(); }

  // ---- creating an order (DP-01) ----
  async createMove(user: User, body: Record<string, unknown>): Promise<Move> {
    const store = this.store;
    const vesselId = String(body.vessel_id ?? '');
    const vessel = store.vessels.find((v) => v.id === vesselId);
    if (!vessel) throw validationError({ vessel_id: 'Choose a vessel' });
    if (user.role === 'agent' && vessel.agency_code !== user.agency_code) throw notFound();

    const boardingAt = boardingAtOf(body);
    const boardingMs = requireBoardingAt(boardingAt, this.now, true);

    const draughtMm = draughtMmOf(body);
    const speedKn = speedKnOf(body);
    const dutyMinutes = dutyMinutesOf(body);
    const blockCoefficient = numberInRange(body.block_coefficient, 0.4, 0.95, vessel.block_coefficient);
    const lengthM = positiveNumber(body.length_m, vessel.length_m);
    const grossTonnage = nonNegativeNumber(body.gross_tonnage, vessel.gross_tonnage);

    const ref = store.nextRef();
    const move: Move = {
      ref,
      version: 1,
      status: 'Ordered',
      agency_code: vessel.agency_code,
      vessel_id: vessel.id,
      draught_mm: draughtMm,
      speed_kn: speedKn,
      duty_minutes: dutyMinutes,
      block_coefficient: blockCoefficient,
      length_m: lengthM,
      gross_tonnage: grossTonnage,
      boarding_ms: boardingMs,
      committed: null,
      pilot_id: null,
      notices: [],
      billing_events: [],
      late_amendments: 0,
      detention_spans: [],
      detention_open: false,
      ladder_report_ids: [],
      history: [{ at_ms: this.now, status: 'Ordered', by: user.name }],
      dispatcher_notes: [],
      rest_override: null,
      correction: null,
      created_ms: this.now,
    };
    store.moves.push(move);
    await store.save();
    return move;
  }

  // ---- the live plan (DP-03, DP-65) ----
  async planFromBody(body: Record<string, unknown>): Promise<unknown> {
    const store = this.store;
    const vesselId = String(body.vessel_id ?? '');
    const vessel = store.vessels.find((v) => v.id === vesselId);
    if (!vessel) throw validationError({ vessel_id: 'Choose a vessel' });
    const boardingAt = boardingAtOf(body);
    const boardingMs = requireBoardingAt(boardingAt, this.now, false);
    const draughtMm = draughtMmOf(body);
    const speedKn = speedKnOf(body);
    const blockCoefficient = numberInRange(body.block_coefficient, 0.4, 0.95, vessel.block_coefficient);
    const grossTonnage = nonNegativeNumber(body.gross_tonnage, vessel.gross_tonnage);
    const plan = computePlan({
      draught_mm: draughtMm,
      speed_kn: speedKn,
      block_coefficient: blockCoefficient,
      boardingMs,
      tideEventsFor: (date: string) => store.eventsForDate(date),
      tideVersion: store.tideVersion,
    });
    const revision = store.tariffForInstant(boardingMs);
    const lines = estimateLines(revision, draughtMm, grossTonnage, boardingMs);
    return serializePlan(plan, { tariff_revision: revision.label, lines, total_cents: totalOf(lines) });
  }

  // ---- amending (DP-27, DP-31) ----
  async patchMove(user: User, move: Move, ifMatch: string | null, body: Record<string, unknown>): Promise<PendingMoveAction> {
    const store = this.store;
    const version = versionOf(ifMatch);
    if (version === null) {
      throw new ApiError(428, 'version_required', 'If-Match is required');
    }
    if (version !== move.version) {
      throw staleVersion(move);
    }
    if (move.status !== 'Ordered' && move.status !== 'Window committed' && move.status !== 'Pilot assigned') {
      throw new ApiError(409, 'not_amendable', 'This move can no longer be amended');
    }

    const changesBoarding = body.boarding_at !== undefined;
    const boardingAt = changesBoarding ? boardingAtOf(body) : null;
    if (boardingAt !== null) {
      const boardingMs = requireBoardingAt(boardingAt, this.now, true);
      move.boarding_ms = boardingMs;
    }
    const late = boardingAt !== null && this.now > move.boarding_ms - 2 * 3600_000;

    applyOrderFields(move, body);

    let windowReturned = false;
    if (move.status === 'Window committed' || move.status === 'Pilot assigned') {
      const plan = this.planOf(move);
      if (plan.gateOpen) {
        move.committed = {
          boarding_ms: move.boarding_ms,
          pinch_waypoint: plan.waypoints.find((w) => w.pinch)!.name,
          margin_mm: plan.pinchMarginMm,
          tide_version: store.tideVersion,
        };
        move.status = 'Window committed';
      } else {
        releasePilot(store, move, user);
        move.committed = null;
        move.status = 'Ordered';
        windowReturned = true;
        store.addHistory(move, 'Ordered', user.name);
      }
    }
    if (late) move.late_amendments += 1;
    store.addHistory(move, move.status, user.name);
    await store.save();
    const body2: Record<string, unknown> = serializeMove(store, move, user, this.now) as unknown as Record<string, unknown>;
    if (windowReturned) body2.window_returned = true;
    if (late) body2.late_notice = true;
    return { status: 200, body: body2 };
  }

  // ---- cancelling (DP-28, DP-29) ----
  async cancelMove(user: User, move: Move): Promise<PendingMoveAction> {
    const store = this.store;
    if (move.status !== 'Ordered' && move.status !== 'Window committed' &&
        move.status !== 'Pilot assigned' && move.status !== 'Pilot away') {
      throw new ApiError(409, 'not_cancellable', 'This move can no longer be cancelled');
    }
    const late = this.now > move.boarding_ms - 2 * 3600_000;
    const status: MoveStatus = late ? 'Cancelled late' : 'Cancelled';
    releasePilot(store, move, user);
    move.committed = null;
    move.status = status;
    store.addHistory(move, status, user.name);
    if (status === 'Cancelled late') this.store.raiseBillingEvent(move, 'Cancelled late');
    const vessel = store.vessels.find((v) => v.id === move.vessel_id)!;
    const agent = store.users.find((u) => u.role === 'agent' && u.agency_code === move.agency_code)!;
    const notice = makeNotice(
      move, 'Order cancelled', agent.email,
      `Pilot order cancelled: ${vessel.name}`,
      `Vessel: ${vessel.name}\nBoarding: ${formatPortDateTimeSpace(move.boarding_ms)} port time\nStatus: ${move.status}\nMove reference: ${move.ref}`,
    );
    enqueueNotice(store, move, notice);
    await store.save();
    await this.env.runPendingDue();
    return { status: 200, body: serializeMove(store, move, user, this.now) };
  }

  // ---- corrected re-order (DP-38) ----
  async reorderMove(user: User, move: Move, body: Record<string, unknown>): Promise<PendingMoveAction> {
    const store = this.store;
    if (move.status !== 'Refused at ladder') {
      throw new ApiError(409, 'illegal_transition', 'This move can no longer be re-ordered');
    }
    const correction = typeof body.correction === 'string' ? body.correction.trim() : '';
    if (correction.length < 3 || correction.length > 500) {
      throw validationError({ correction: 'Correction must be 3 to 500 characters' });
    }
    const boardingAt = boardingAtOf(body);
    const boardingMs = requireBoardingAt(boardingAt, this.now, true);
    move.boarding_ms = boardingMs;
    move.committed = null;
    move.pilot_id = null;
    move.status = 'Ordered';
    move.correction = correction;
    store.addHistory(move, 'Ordered', user.name);
    await store.save();
    return { status: 200, body: serializeMove(store, move, user, this.now) };
  }

  // ---- committing a window (DP-13, DP-14) ----
  async commitWindow(user: User, move: Move, ifMatch: string | null, body: Record<string, unknown>): Promise<PendingMoveAction> {
    const store = this.store;
    const version = versionOf(ifMatch);
    if (version === null) {
      throw new ApiError(428, 'version_required', 'If-Match is required');
    }
    if (version !== move.version) {
      throw staleVersion(move);
    }
    if (move.status !== 'Ordered' && move.status !== 'Window committed') {
      throw new ApiError(409, 'illegal_transition', 'This move can no longer be committed');
    }
    const boardingAt = boardingAtOf({ boarding_at: body.boarding_at });
    const boardingMs = requireBoardingAt(boardingAt, this.now, true);
    const draughtMm = move.draught_mm;
    const tideVersion = Number(body.tide_version ?? store.tideVersion);

    const stalePlan = tideVersion !== store.tideVersion || Number(body.draught_mm ?? draughtMm) !== draughtMm;
    if (stalePlan) {
      const plan = this.planAt(move, boardingMs);
      throw new ApiError(409, 'stale_plan', 'The tide table or draught changed', undefined, {
        plan: this.serializePlanFor(move, plan),
      });
    }
    const plan = this.planAt(move, boardingMs);
    if (!plan.gateOpen) {
      const pinch = plan.waypoints.find((w) => w.pinch)!;
      throw new ApiError(409, 'window_closed', `The window no longer clears at ${pinch.name}`, undefined, {
        plan: this.serializePlanFor(move, plan),
      });
    }
    move.boarding_ms = boardingMs;
    move.committed = {
      boarding_ms: boardingMs,
      pinch_waypoint: plan.waypoints.find((w) => w.pinch)!.name,
      margin_mm: plan.pinchMarginMm,
      tide_version: store.tideVersion,
    };
    move.status = 'Window committed';
    store.addHistory(move, 'Window committed', user.name);
    await store.save();
    return { status: 200, body: serializeMove(store, move, user, this.now) };
  }

  // ---- eligibility and assignment (DP-18 to DP-23) ----
  eligibility(move: Move): unknown {
    const store = this.store;
    const target = {
      lengthM: move.length_m,
      draughtMm: move.draught_mm,
      boardingMs: move.boarding_ms,
      dutyMinutes: move.duty_minutes,
    };
    const rows = store.pilotOrder.map((id, index) => {
      const pilot = store.pilots.find((p) => p.id === id)!;
      const duties = this.dutiesOf(pilot.id, move.ref);
      const reasons = reasonsFor(pilot.licence_class, duties, target);
      return {
        pilot_id: pilot.id,
        name: pilot.name,
        position: index + 1,
        licence_class: pilot.licence_class,
        eligible: reasons.length === 0,
        reasons,
        rest_until: null as string | null,
      };
    });
    const next = rows.find((r) => r.eligible);
    return {
      boarding_at: formatPortDateTimeApi(move.boarding_ms),
      next_eligible: next?.pilot_id ?? null,
      turn: rows,
    };
  }

  async assignPilot(user: User, move: Move, ifMatch: string | null, body: Record<string, unknown>): Promise<PendingMoveAction> {
    const store = this.store;
    const version = versionOf(ifMatch);
    if (version === null) {
      throw new ApiError(428, 'version_required', 'If-Match is required');
    }
    if (version !== move.version) {
      throw staleVersion(move, true);
    }
    const pilotId = String(body.pilot_id ?? '');
    const pilot = store.pilots.find((p) => p.id === pilotId);
    if (!pilot) throw validationError({ pilot_id: 'Choose a pilot' });

    const note = typeof body.note === 'string' ? body.note : '';
    const overrideSupplied = body.rest_override_reason !== undefined && typeof body.rest_override_reason === 'string';
    const overrideReason = overrideSupplied ? String(body.rest_override_reason) : '';
    const trimmed = overrideReason.trim();

    const turn = this.eligibility(move) as { next_eligible: string | null; turn: { pilot_id: string; reasons: string[] }[] };
    const reasons = turn.turn.find((r) => r.pilot_id === pilotId)?.reasons ?? [];
    const restReasons = reasons.filter((r) => r !== 'licence');
    const turnPayload = { turn: turn.turn };

    if (move.status !== 'Window committed') {
      throw new ApiError(409, 'illegal_transition', 'This move can no longer be assigned', undefined, turnPayload);
    }
    if (reasons.includes('licence')) {
      throw new ApiError(409, 'licence_not_covering', 'Pilot is not licensed for this vessel', undefined, turnPayload);
    }
    if (restReasons.length > 0 && !overrideSupplied) {
      throw new ApiError(409, 'rest_breach', 'Rest rules not met', undefined, turnPayload);
    }
    const nextEligible = turn.next_eligible;
    const positionOf = (id: string) => store.pilotOrder.indexOf(id);
    if (nextEligible !== null && pilotId !== nextEligible) {
      const aheadOfNext = overrideSupplied && restReasons.length > 0
        ? positionOf(pilotId) < positionOf(nextEligible)
        : true;
      if (aheadOfNext) {
        throw new ApiError(409, 'not_next_in_turn', 'Pilot is not next eligible', undefined, turnPayload);
      }
    }
    if (restReasons.length === 0 && overrideSupplied) {
      throw validationError({ rest_override_reason: 'This pilot meets the rest rules' });
    }
    if (overrideSupplied && (trimmed.length < 10 || trimmed.length > 500)) {
      throw validationError({ rest_override_reason: 'Override reason must be 10 to 500 characters' });
    }

    // Assign: skipped pilots keep their positions, the assigned one moves to
    // the end of the turn list.
    const assignedPosition = positionOf(pilotId);
    for (const id of store.pilotOrder.slice(0, assignedPosition)) {
      const row = turn.turn.find((r) => r.pilot_id === id);
      if (row && row.reasons.length > 0) {
        store.skips.push({
          pilot_id: id,
          reasons: row.reasons,
          move_ref: move.ref,
          at_ms: this.now,
        });
      }
    }
    store.pilotOrder = [...store.pilotOrder.filter((id) => id !== pilotId), pilotId];
    move.pilot_id = pilotId;
    move.status = 'Pilot assigned';
    if (note !== '') move.dispatcher_notes.push(note);
    if (overrideSupplied && restReasons.length > 0) {
      store.overrides.push({
        id: store.nextOverrideId(),
        move_ref: move.ref,
        pilot_id: pilotId,
        reason: trimmed,
        by: user.name,
        at_ms: this.now,
      });
      move.rest_override = { reason: trimmed, by: user.name, at_ms: this.now };
    }
    store.addHistory(move, 'Pilot assigned', user.name);

    const vessel = store.vessels.find((v) => v.id === move.vessel_id)!;
    const agent = store.users.find((u) => u.role === 'agent' && u.agency_code === move.agency_code)!;
    const boarding = `${formatPortDateTimeSpace(move.boarding_ms)} port time`;
    const plan = this.planOf(move);
    const pinch = plan.waypoints.find((w) => w.pinch)!;
    const agentNotice = makeNotice(
      move, 'Order confirmation', agent.email,
      `Pilot order confirmed: ${vessel.name}`,
      `Vessel: ${vessel.name}\nBoarding: ${boarding}\nPilot: ${pilot.name}\nMove reference: ${move.ref}`,
    );
    enqueueNotice(store, move, agentNotice);
    const pilotNotice = makeNotice(
      move, 'Assignment notice', pilot.email,
      `Assignment: ${vessel.name} ${formatPortDateTimeSpace(move.boarding_ms)}`,
      `Vessel: ${vessel.name}\nBoarding: ${boarding}\nPinch waypoint: ${pinch.name}\nPinch margin: ${pinch.margin_mm} mm\nMove reference: ${move.ref}`,
    );
    enqueueNotice(store, move, pilotNotice);
    await store.save();
    await this.env.runPendingDue();
    return { status: 200, body: serializeMove(store, move, user, this.now) };
  }

  // ---- status transitions (DP-32, DP-33, DP-45) ----
  async transition(user: User, move: Move, body: Record<string, unknown>): Promise<PendingMoveAction> {
    const store = this.store;
    const to = String(body.to ?? '');
    const order: Record<string, MoveStatus> = {
      'Pilot away': 'Pilot assigned',
      'On board': 'Pilot away',
      'Completed': 'On board',
    };
    const expected = order[to];
    if (expected === undefined) throw validationError({ to: 'Unknown status' });
    if (move.status !== expected) {
      throw new ApiError(409, 'illegal_transition', 'This action is not available for the move\'s current status');
    }
    const target = to as MoveStatus;
    if (target === 'Completed' && move.detention_open) {
      throw new ApiError(409, 'detention_open', 'Stop detention before completing the move');
    }
    if (target === 'Completed') {
      // Close any open duty at completion.
      move.status = 'Completed';
      store.addHistory(move, 'Completed', user.name);
      this.store.raiseBillingEvent(move, 'Completed');
    } else {
      move.status = target;
      store.addHistory(move, target, user.name);
    }
    await store.save();
    await this.env.runPendingDue();
    return { status: 200, body: serializeMove(store, move, user, this.now) };
  }

  async detention(user: User, move: Move, body: Record<string, unknown>): Promise<PendingMoveAction> {
    const store = this.store;
    const action = String(body.action ?? '');
    if (action === 'start') {
      if (move.status !== 'On board') {
        throw new ApiError(409, 'illegal_transition', 'Detention is a sub-state of On board');
      }
      if (move.detention_open) {
        throw new ApiError(409, 'detention_already_open', 'Detention is already open');
      }
      move.detention_open = true;
      move.detention_spans.push({ start_ms: this.now, end_ms: this.now });
      store.addHistory(move, move.status, user.name);
    } else if (action === 'stop') {
      if (!move.detention_open) {
        throw new ApiError(409, 'detention_not_open', 'Detention is not open');
      }
      const span = move.detention_spans[move.detention_spans.length - 1]!;
      // A span counts only time at or after the ordered time.
      span.end_ms = Math.max(this.now, span.start_ms);
      move.detention_open = false;
      store.addHistory(move, move.status, user.name);
    } else {
      throw validationError({ action: 'Action must be start or stop' });
    }
    await store.save();
    return { status: 200, body: serializeMove(store, move, user, this.now) };
  }

  // ---- ladder reports (DP-37, DP-38, DP-39) ----
  async fileReport(user: User, move: Move, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    const store = this.store;
    if (move.status !== 'Pilot away' && move.status !== 'On board') {
      throw new ApiError(409, 'illegal_transition', 'A ladder report is not available for the move\'s current status');
    }
    const compliant = typeof body.compliant === 'boolean' ? body.compliant : undefined;
    if (compliant === undefined) throw validationError({ compliant: 'Choose the ladder state' });
    const defects = Array.isArray(body.defects)
      ? (body.defects as unknown[]).map((d) => String(d))
      : [];
    for (const defect of defects) {
      if (!(LADDER_DEFECT_CODES as readonly string[]).includes(defect)) {
        throw validationError({ defects: 'Unknown defect' });
      }
    }
    const refuseBoarding = body.refuse_boarding === true;
    const location = body.location === 'pilot_boat' ? 'pilot_boat' : 'deck';
    const note = typeof body.note === 'string' ? body.note : '';
    const photoIds = Array.isArray(body.photo_ids) ? (body.photo_ids as unknown[]).map((p) => String(p)) : [];

    if (compliant && defects.length > 0) {
      throw validationError({ defects: 'A compliant ladder has no defects' });
    }
    if (!compliant && defects.length === 0) {
      throw validationError({ defects: 'Mark at least one defect' });
    }
    if (compliant && refuseBoarding) {
      throw validationError({ refuse_boarding: 'A compliant ladder needs boarding' });
    }
    if (refuseBoarding && move.status !== 'Pilot away') {
      throw validationError({ refuse_boarding: 'Boarding can only be refused from Pilot away' });
    }
    for (const photoId of photoIds) {
      const photo = store.photos.find((p) => p.id === photoId);
      if (!photo || !photo.stored || photo.move_ref !== move.ref) {
        throw notFound();
      }
    }
    const reportId = store.nextReportId();
    const photos = photoIds.map((photoId) => {
      const photo = store.photos.find((p) => p.id === photoId)!;
      return { photo_id: photo.id, sha256: photo.sha256, size_bytes: photo.size_bytes };
    });
    const report: LadderReport = {
      id: reportId,
      move_ref: move.ref,
      compliant,
      defects,
      refused: refuseBoarding,
      location,
      note,
      photos,
      filed_by: user.id,
      filed_at_ms: this.now,
    };
    store.ladderReports.push(report);
    move.ladder_report_ids.push(reportId);
    if (refuseBoarding) {
      move.status = 'Refused at ladder';
      store.addHistory(move, 'Refused at ladder', user.name);
      this.store.raiseBillingEvent(move, 'Refused at ladder');
    }
    if (!compliant) {
      const vessel = store.vessels.find((v) => v.id === move.vessel_id)!;
      const agent = store.users.find((u) => u.role === 'agent' && u.agency_code === move.agency_code)!;
      const defectNames = defects.map((d) => LADDER_DEFECT_NAME[d] ?? d).join(', ');
      const checksums = photos.map((p) => p.sha256).join(', ');
      const bodyText = [
        `Move reference: ${move.ref}`,
        `Vessel: ${vessel.name}`,
        `Defects: ${defectNames}`,
        `Report id: ${report.id}`,
        `Photos: ${checksums}`,
      ].join('\n');
      const notice = makeNotice(
        move, 'Ladder notice', agent.email,
        `Non-compliant boarding ladder: ${vessel.name}`,
        bodyText,
        photos.map((p) => `ladder-photos/${p.photo_id}`),
      );
      enqueueNotice(store, move, notice);
      const authority = makeNotice(
        move, 'Ladder notice', 'harbourmaster@port-ansell.example',
        `Non-compliant boarding ladder: ${vessel.name}`,
        bodyText,
        photos.map((p) => `ladder-photos/${p.photo_id}`),
      );
      enqueueNotice(store, move, authority);
    }
    store.addHistory(move, move.status, user.name);
    await store.save();
    await this.env.runPendingDue();
    return { status: 201, body: serializeReport(store, report) };
  }

  // ---- helpers ----
  planOf(move: Move) {
    return computePlan({
      draught_mm: move.draught_mm,
      speed_kn: move.speed_kn,
      block_coefficient: move.block_coefficient,
      boardingMs: move.boarding_ms,
      tideEventsFor: (date: string) => this.store.eventsForDate(date),
      tideVersion: this.store.tideVersion,
    });
  }

  planAt(move: Move, boardingMs: number) {
    return computePlan({
      draught_mm: move.draught_mm,
      speed_kn: move.speed_kn,
      block_coefficient: move.block_coefficient,
      boardingMs,
      tideEventsFor: (date: string) => this.store.eventsForDate(date),
      tideVersion: this.store.tideVersion,
    });
  }

  serializePlanFor(move: Move, plan: ReturnType<Actions['planOf']>): unknown {
    const revision = this.store.tariffForInstant(move.boarding_ms);
    const lines = estimateLines(revision, move.draught_mm, move.gross_tonnage, move.boarding_ms);
    return serializePlan(plan, { tariff_revision: revision.label, lines, total_cents: totalOf(lines) });
  }

  dutiesOf(pilotId: string, excludeMoveRef?: string): DutyRecordList {
    const store = this.store;
    const duties: DutyRecordList = [];
    for (const seed of store.seededDuties[pilotId] ?? []) {
      duties.push({ startMs: seed.start_ms, endMs: seed.start_ms + seed.minutes * 60_000, open: false });
    }
    for (const move of store.moves) {
      if (move.pilot_id !== pilotId) continue;
      if (excludeMoveRef && move.ref === excludeMoveRef) continue;
      if (move.status === 'Cancelled' || move.status === 'Cancelled late') continue;
      if (move.status === 'Refused at ladder') {
        const report = store.ladderReports.find((r) => r.move_ref === move.ref && r.refused);
        duties.push({ startMs: move.boarding_ms, endMs: report?.filed_at_ms ?? move.boarding_ms, open: false });
        continue;
      }
      if (move.status === 'Completed' || move.status === 'Invoiced') {
        const entry = move.history.find((h) => h.status === 'Completed');
        duties.push({ startMs: move.boarding_ms, endMs: entry?.at_ms ?? move.boarding_ms + move.duty_minutes * 60_000, open: false });
        continue;
      }
      duties.push({ startMs: move.boarding_ms, endMs: move.boarding_ms + move.duty_minutes * 60_000, open: true });
    }
    return duties;
  }
}

export const LADDER_DEFECT_CODES = [
  'side_ropes', 'steps', 'spreaders', 'securing', 'climb_height',
  'man_ropes', 'deck_access', 'lighting',
] as const;

export const LADDER_DEFECT_NAME: Record<string, string> = {
  side_ropes: 'Side ropes',
  steps: 'Steps',
  spreaders: 'Spreaders',
  securing: 'Securing points',
  climb_height: 'Climb over 9 metres',
  man_ropes: 'Man ropes',
  deck_access: 'Deck access',
  lighting: 'Lighting',
};

export type DutyRecordList = { startMs: number; endMs: number; open: boolean }[];

export interface PendingMoveAction {
  status: number;
  body: unknown;
}

// A released pilot goes to the head of the turn list, and the duty is removed.
function releasePilot(store: Store, move: Move, by: User): void {
  if (!move.pilot_id) return;
  const pilotId = move.pilot_id;
  const target = {
    lengthM: move.length_m,
    draughtMm: move.draught_mm,
    boardingMs: move.boarding_ms,
    dutyMinutes: move.duty_minutes,
  };
  const vessel = store.vessels.find((v) => v.id === move.vessel_id)!;
  const pilot = store.pilots.find((p) => p.id === pilotId)!;
  const notice = makeNotice(
    move, 'Assignment withdrawn', pilot.email,
    `Assignment withdrawn: ${vessel.name}`,
    `Vessel: ${vessel.name}\nBoarding: ${formatPortDateTimeSpace(move.boarding_ms)} port time`,
  );
  enqueueNotice(store, move, notice);
  move.pilot_id = null;
  store.pilotOrder = [pilotId, ...store.pilotOrder.filter((id) => id !== pilotId)];
  void target;
  void by;
}

function staleVersion(move: Move, withTurn = false): ApiError {
  return new ApiError(412, 'stale_version', 'This move changed', undefined, withTurn ? { turn: [] } : { current: move });
}
