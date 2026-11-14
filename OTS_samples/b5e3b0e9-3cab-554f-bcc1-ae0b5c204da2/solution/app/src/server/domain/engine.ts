import { findRoute, graphOf, isRunwayHolding, nextRunwayHoldingPoint, reciprocal, routeFromSegment, segmentLength, segmentSpeed } from "./graph.ts";
import type { Graph, PathStep } from "./graph.ts";
import {
  isKnownVerb,
  parseClearance,
  parseLine,
  positionName,
  usageLine,
  verbPosition,
  type Clearance,
  type Position,
} from "./grammar.ts";
import { minutesSeconds } from "./clock.ts";
import { CLEARED_BAY, RULES, alertTexts, wakeMinimum, type RuleId, type Speed, type Timers } from "./rules.ts";
import type {
  Aircraft,
  Bay,
  EventKind,
  LogEntry,
  ScheduledEvent,
  SessionSetup,
  SessionState,
  StripCopy,
} from "./state.ts";
import { GROUND_BAYS } from "../../shared/wire.ts";

/** A refused command, move or event: the message is the exact refusal text. */
export class Refusal extends Error {}

/** An event naming an aircraft that is not on final. */
export class NotFinalRefusal extends Error {
  readonly callsign: string;
  constructor(callsign: string) {
    super("not final");
    this.callsign = callsign;
  }
}

/** A session being simulated: its frozen setup, its state and the log rows the operation has produced so far. */
export interface Sim {
  setup: SessionSetup;
  graph: Graph;
  timers: Timers;
  state: SessionState;
  log: LogEntry[];
}

interface RaisedAlert {
  rule: RuleId;
  text: string;
}

interface Accepted {
  readback: string;
  alerts: RaisedAlert[];
}

export const simOf = (setup: SessionSetup, timers: Timers, state: SessionState): Sim => ({
  setup,
  graph: graphOf(setup.layout),
  timers,
  state,
  log: [],
});

// ---------------------------------------------------------------------------------------------------------------
// Lookups and strip bookkeeping

export const findAircraft = (sim: Sim, callsign: string): Aircraft | undefined =>
  sim.state.aircraft.find((aircraft) => aircraft.callsign === callsign && aircraft.appeared);

const strip = (sim: Sim, callsign: string) => {
  const stripRecord = sim.state.strips[callsign];
  if (!stripRecord) throw new Error(`no strip for ${callsign}`);
  return stripRecord;
};

const copiesOf = (sim: Sim, callsign: string): StripCopy[] => sim.state.copies.filter((c) => c.callsign === callsign);

/** The copy that holds the aircraft now: the one that is neither an open offer nor a transferred remainder. */
const liveCopy = (sim: Sim, callsign: string): StripCopy | undefined =>
  copiesOf(sim, callsign).find((c) => c.state === "active");

const nextEntry = (sim: Sim): number => ++sim.state.sequence;

const boardOf = (bay: Bay): Position => (GROUND_BAYS.includes(bay) ? "GND" : "TWR");

const changed = (sim: Sim, callsign: string): void => {
  strip(sim, callsign).version += 1;
};

function moveLive(sim: Sim, callsign: string, bay: Bay): void {
  const copy = liveCopy(sim, callsign);
  const aircraft = mustFind(sim, callsign);
  if (copy) {
    copy.bay = bay;
    copy.board = boardOf(bay);
    copy.frequency = aircraft.frequency;
    copy.entered = nextEntry(sim);
  } else {
    sim.state.copies.push({
      callsign,
      board: boardOf(bay),
      bay,
      frequency: aircraft.frequency,
      state: "active",
      entered: nextEntry(sim),
    });
  }
}

function mustFind(sim: Sim, callsign: string): Aircraft {
  const aircraft = sim.state.aircraft.find((aircraft) => aircraft.callsign === callsign);
  if (!aircraft) throw new Error(`no aircraft ${callsign}`);
  return aircraft;
}

const entry = (sim: Sim, position: LogEntry["position"], kind: LogEntry["kind"], text: string, extra: Partial<LogEntry> = {}): void => {
  sim.log.push({ simTime: sim.state.simTime, position, kind, text, ...extra });
};

function logAlert(sim: Sim, alert: RaisedAlert, position: Position, callsign: string): void {
  entry(sim, position, "alert", alert.text, { rule: alert.rule, severity: RULES[alert.rule].severity, callsign });
}

// ---------------------------------------------------------------------------------------------------------------
// Runway state

const OCCUPYING = new Set(["lining-up", "lined-up", "rolling", "crossing", "landing"]);

const occupants = (sim: Sim, except: string): Aircraft[] =>
  sim.state.aircraft
    .filter((aircraft) => aircraft.callsign !== except && OCCUPYING.has(aircraft.status))
    .sort((aircraft, b) => (aircraft.occupiedAt ?? 0) - (b.occupiedAt ?? 0) || aircraft.occupiedOrder - b.occupiedOrder);

function occupy(sim: Sim, aircraft: Aircraft): void {
  if (aircraft.occupiedAt === null) {
    aircraft.occupiedAt = sim.state.simTime;
    aircraft.occupiedOrder = nextEntry(sim);
  }
}

const leaveRunway = (aircraft: Aircraft): void => {
  aircraft.occupiedAt = null;
};

/** The most recent takeoff, which is the only leader that counts for wake spacing. */
function lastTakeoff(sim: Sim): Aircraft | undefined {
  return sim.state.aircraft
    .filter((aircraft) => aircraft.takeoffStart !== null)
    .sort((aircraft, b) => (b.takeoffStart ?? 0) - (aircraft.takeoffStart ?? 0) || b.occupiedOrder - aircraft.occupiedOrder)[0];
}

export function wakeRemaining(sim: Sim, follower: Aircraft): number {
  const leader = lastTakeoff(sim);
  if (!leader || leader.takeoffStart === null) return 0;
  return Math.max(0, wakeMinimum(leader.wake, follower.wake) - (sim.state.simTime - leader.takeoffStart));
}

// ---------------------------------------------------------------------------------------------------------------
// Commands

interface Plan {
  clearance: Clearance;
  aircraft: Aircraft;
  line: string;
  /** The taxi route, for a TAXI clearance. */
  route: PathStep[] | null;
}

const originOf = (aircraft: Aircraft): string => aircraft.node ?? aircraft.stand ?? "";

const viaText = (via: string[]): string => via.join(" ");

/**
 * Checks a command in the published order and returns what it would do. Nothing changes: a failing check throws the
 * refusal text, and the preview and execution both call this.
 */
export function planCommand(sim: Sim, position: Position, text: string): Plan {
  const { line, words } = parseLine(text);
  const [word, verb, ...args] = words;
  if (word === undefined) throw new Refusal(usageLine);
  const aircraft = findAircraft(sim, word);
  if (!aircraft) throw new Refusal(`Unknown callsign ${word}.`);
  const cs = aircraft.callsign;
  if (aircraft.frequency !== position) throw new Refusal(`${cs} is not on your frequency.`);
  if (verb === undefined) throw new Refusal(usageLine);
  if (!isKnownVerb(verb)) throw new Refusal(`Unknown command ${verb}.`);
  const owner = verbPosition(verb);
  if (owner !== null && owner !== position) throw new Refusal(`${verb} is a ${positionName(owner)} instruction.`);
  const parsed = parseClearance(verb, args);
  if (!parsed.ok) throw new Refusal(parsed.usage);
  const clearance = parsed.clearance;

  const { graph, state } = sim;
  if ("runway" in clearance && !graph.thresholds.has(clearance.runway)) throw new Refusal(`Unknown runway ${clearance.runway}.`);
  if ("point" in clearance && graph.nodes.get(clearance.point)?.kind !== "holding") {
    throw new Refusal(`Unknown holding point ${clearance.point}.`);
  }

  let route: PathStep[] | null = null;
  if (clearance.verb === "TAXI") {
    route = routeFor(sim, aircraft, clearance);
    if (!route) {
      throw new Refusal(
        clearance.via.length > 0 ? `No route to ${clearance.point} via ${viaText(clearance.via)}.` : `No route to ${clearance.point}.`,
      );
    }
  }
  if ((clearance.verb === "LINEUP" || clearance.verb === "TAKEOFF") && clearance.runway !== state.runwayInUse) {
    throw new Refusal(`Runway ${clearance.runway} is not in use.`);
  }
  const holdsForEmergency =
    clearance.verb === "TAXI" ||
    clearance.verb === "CONTINUE" ||
    clearance.verb === "LINEUP" ||
    clearance.verb === "TAKEOFF" ||
    clearance.verb === "CROSS";
  if (holdsForEmergency && state.emergency !== null && state.emergency !== cs) {
    throw new Refusal(`All traffic is holding for ${state.emergency}.`);
  }
  if (clearance.verb === "NEGATIVE") {
    const open = aircraft.readbackError;
    if (!open) throw new Refusal(`${cs} has nothing to correct.`);
    if (open.subject !== clearance.subject || open.value !== clearance.value) throw new Refusal("That is not the clearance you gave.");
  } else if (!allowedNow(sim, aircraft, clearance)) {
    throw new Refusal(`${cs} cannot do that now.`);
  }
  return { clearance, aircraft, line, route };
}

function routeFor(sim: Sim, aircraft: Aircraft, clearance: Extract<Clearance, { verb: "TAXI" }>): PathStep[] | null {
  const head = aircraft.segment !== null ? aircraft.path.slice(0, 1) : [];
  const from = head[0]?.to ?? originOf(aircraft);
  return findRoute(sim.graph, from, clearance.point, clearance.via, head);
}

function allowedNow(sim: Sim, aircraft: Aircraft, clearance: Clearance): boolean {
  const offerOpen = aircraft.offerLeft !== null;
  switch (clearance.verb) {
    case "PUSH":
      return aircraft.status === "parked";
    case "TAXI":
      return (aircraft.status === "ready" || aircraft.status === "taxiing" || aircraft.status === "stopped") && !offerOpen;
    case "HOLD":
      return aircraft.status === "taxiing";
    case "CONTINUE":
      return aircraft.status === "stopped";
    case "CONTACT":
      return (aircraft.status === "taxiing" || aircraft.status === "stopped" || aircraft.status === "holding") && !offerOpen;
    case "LINEUP":
      return aircraft.status === "holding" && aircraft.kind === "dep" && sim.graph.nodes.get(aircraft.node ?? "")?.serves === clearance.runway;
    case "TAKEOFF":
      return aircraft.status === "lined-up";
    case "LAND":
      return aircraft.status === "final" && aircraft.runway === clearance.runway;
    case "CROSS":
      return aircraft.status === "holding" && aircraft.node === clearance.point && sim.graph.crossings.has(clearance.point);
    case "GO":
      return aircraft.status === "final";
    case "NEGATIVE":
      return true;
  }
}

/** Another aircraft a taxi route would conflict with (R4): the segments it opposes it on, and whether the point is taken. */
interface TaxiConflict {
  earlier: string;
  segments: string[];
  pointTaken: boolean;
}

/** The R4 conflicts of a route, one per other aircraft in callsign order. */
export function taxiConflicts(sim: Sim, aircraft: Aircraft, route: PathStep[], point: string): TaxiConflict[] {
  const others = sim.state.aircraft
    .filter((o) => o.callsign !== aircraft.callsign && o.appeared)
    .sort((aircraft, b) => (aircraft.callsign < b.callsign ? -1 : 1));
  return others.flatMap((other) => {
    const moving = other.status === "taxiing" || other.status === "stopped";
    const segments = moving
      ? route.flatMap((step) =>
          step.kind === "segment" &&
          other.path.some((o) => o.kind === "segment" && o.segment === step.segment && o.from === step.to && o.to === step.from)
            ? [step.segment]
            : [],
        )
      : [];
    const lastStep = other.path[other.path.length - 1];
    const pointTaken = (moving && lastStep !== undefined && lastStep.to === point) || (other.status === "holding" && other.node === point);
    return segments.length > 0 || pointTaken ? [{ earlier: other.callsign, segments, pointTaken }] : [];
  });
}

/** The places a typed route would raise R4, for the preview: shared segments in route order, then the point. */
export function previewConflicts(conflicts: TaxiConflict[], route: PathStep[], point: string): { segment: string; rule: "R4" }[] {
  const shared = new Set(conflicts.flatMap((c) => c.segments));
  const places = route.flatMap((step) => (step.kind === "segment" && shared.has(step.segment) ? [step.segment] : []));
  if (conflicts.some((c) => c.pointTaken)) places.push(point);
  return places.map((segment) => ({ segment, rule: "R4" as const }));
}

/** The alerts a clearance raises when it is accepted, in the published order. */
function clearanceAlerts(sim: Sim, plan: Plan): RaisedAlert[] {
  const { clearance, aircraft } = plan;
  const cs = aircraft.callsign;
  const alerts: RaisedAlert[] = [];
  const { state, timers } = sim;
  const add = (rule: RuleId, text: string): void => {
    alerts.push({ rule, text });
  };
  if (clearance.verb === "TAXI" && plan.route) {
    for (const conflict of taxiConflicts(sim, aircraft, plan.route, clearance.point)) {
      add("R4", alertTexts.R4(conflict.segments[0] ?? clearance.point, conflict.earlier, cs));
    }
    return alerts;
  }
  const runwayClearance =
    clearance.verb === "LINEUP" || clearance.verb === "TAKEOFF" || clearance.verb === "LAND" || clearance.verb === "CROSS";
  if (!runwayClearance) return alerts;
  if (state.runwayClosed) {
    add("R8", alertTexts.R8(clearance.runway));
    return alerts;
  }
  const occupant = occupants(sim, cs)[0];
  if (occupant) add("R1", alertTexts.R1(clearance.runway, occupant.callsign));
  if (clearance.verb === "TAKEOFF") {
    const leader = lastTakeoff(sim);
    if (leader && leader.takeoffStart !== null) {
      const required = wakeMinimum(leader.wake, aircraft.wake);
      const elapsed = state.simTime - leader.takeoffStart;
      if (elapsed < required) add("R2", alertTexts.R2(required, leader.callsign, leader.wake, elapsed));
    }
  }
  if (clearance.verb === "LINEUP" || clearance.verb === "TAKEOFF") {
    const arrival = state.aircraft
      .filter((aircraft) => aircraft.status === "final" && aircraft.due !== null && aircraft.due <= timers.arrivalProtectSeconds)
      .sort((aircraft, b) => (aircraft.due ?? 0) - (b.due ?? 0))[0];
    if (arrival && arrival.due !== null) add("R3", alertTexts.R3(arrival.callsign, arrival.due));
  }
  return alerts;
}

const ELIGIBLE: ReadonlySet<Clearance["verb"]> = new Set(["TAXI", "LINEUP", "TAKEOFF", "LAND", "CROSS"]);

function readbackText(clearance: Clearance, cs: string, wrong: boolean, sim: Sim): string {
  const runway = (rwy: string): string => (wrong ? reciprocal(sim.graph, rwy) : rwy);
  switch (clearance.verb) {
    case "PUSH":
      return `Push approved, ${cs}.`;
    case "TAXI": {
      const point = wrong ? nextRunwayHoldingPoint(sim.graph, clearance.point) : clearance.point;
      const via = clearance.via.length > 0 ? ` via ${viaText(clearance.via)}` : "";
      return `Taxi holding point ${point}${via}, ${cs}.`;
    }
    case "HOLD":
      return `Holding position, ${cs}.`;
    case "CONTINUE":
      return `Continuing taxi, ${cs}.`;
    case "CONTACT":
      return `Contact Tower, ${cs}.`;
    case "LINEUP":
      return `Line up runway ${runway(clearance.runway)}, ${cs}.`;
    case "TAKEOFF":
      return `Cleared for takeoff runway ${runway(clearance.runway)}, ${cs}.`;
    case "LAND":
      return `Cleared to land runway ${runway(clearance.runway)}, ${cs}.`;
    case "CROSS":
      return `Cross runway ${runway(clearance.runway)} at ${clearance.point}, ${cs}.`;
    case "GO":
      return `Going around, ${cs}.`;
    case "NEGATIVE":
      return clearance.subject === "RUNWAY"
        ? `Correct, runway ${clearance.value}, ${cs}.`
        : `Correct, holding point ${clearance.value}, ${cs}.`;
  }
}

/** Whether the next eligible readback carries a seeded error. */
function seededError(sim: Sim, count: number): boolean {
  const every = sim.setup.readbackErrorEvery ?? sim.timers.readbackErrorEvery;
  return every > 0 && (sim.setup.seed + sim.timers.simSeedOffset + count) % every === 0;
}

/** The text a clearance leaves in the strip's cleared field: the command without the callsign. */
const clearedText = (line: string, callsign: string): string => line.slice(callsign.length + 1);

export function executeCommand(sim: Sim, position: Position, text: string): Accepted {
  const plan = planCommand(sim, position, text);
  const { clearance, aircraft, line } = plan;
  const cs = aircraft.callsign;
  const { state } = sim;

  const alerts = clearanceAlerts(sim, plan);
  let wrong = false;
  if (ELIGIBLE.has(clearance.verb)) {
    state.readbackCount += 1;
    wrong = aircraft.readbackError === null && seededError(sim, state.readbackCount);
    if (wrong) {
      const subject = clearance.verb === "TAXI" ? "HP" : "RUNWAY";
      const value = "point" in clearance && clearance.verb === "TAXI" ? clearance.point : "runway" in clearance ? clearance.runway : "";
      aircraft.readbackError = { at: state.simTime, subject, value };
    }
  }
  const readback = readbackText(clearance, cs, wrong, sim);
  entry(sim, position, "command", line, { callsign: cs });
  entry(sim, position, "readback", readback, { callsign: cs });
  for (const alert of alerts) logAlert(sim, alert, position, cs);
  state.lastReadback = { position, text: readback };

  if (clearance.verb === "NEGATIVE") {
    aircraft.readbackError = null;
    return { readback, alerts };
  }
  applyClearance(sim, position, aircraft, clearance, plan.route);
  if (clearance.verb !== "GO") strip(sim, cs).cleared = clearedText(line, cs);
  changed(sim, cs);
  return { readback, alerts };
}

function applyClearance(sim: Sim, position: Position, aircraft: Aircraft, clearance: Clearance, route: PathStep[] | null): void {
  const { timers } = sim;
  const cs = aircraft.callsign;
  switch (clearance.verb) {
    case "PUSH":
      aircraft.status = "pushing";
      aircraft.phaseLeft = timers.pushSeconds;
      moveLive(sim, cs, CLEARED_BAY.PUSH);
      break;
    case "TAXI":
      aircraft.path = route ?? [];
      aircraft.status = "taxiing";
      aircraft.run = { position, stop: clearance.point };
      if (liveCopy(sim, cs)?.bay !== CLEARED_BAY.TAXI && aircraft.frequency === "GND") moveLive(sim, cs, CLEARED_BAY.TAXI);
      break;
    case "HOLD":
      aircraft.status = "stopped";
      break;
    case "CONTINUE":
      aircraft.status = "taxiing";
      break;
    case "CONTACT":
      openOffer(sim, aircraft);
      break;
    case "LINEUP":
      aircraft.status = "lining-up";
      aircraft.phaseLeft = timers.lineupSeconds;
      aircraft.run = null;
      occupy(sim, aircraft);
      moveLive(sim, cs, CLEARED_BAY.LINEUP);
      break;
    case "TAKEOFF":
      aircraft.status = "rolling";
      aircraft.phaseLeft = timers.takeoffRollSeconds;
      aircraft.takeoffStart = sim.state.simTime;
      occupy(sim, aircraft);
      moveLive(sim, cs, CLEARED_BAY.TAKEOFF);
      break;
    case "LAND":
      break;
    case "CROSS":
      aircraft.status = "crossing";
      aircraft.phaseLeft = timers.crossSeconds;
      occupy(sim, aircraft);
      break;
    case "GO":
      goAround(sim, aircraft);
      break;
    case "NEGATIVE":
      break;
  }
}

function goAround(sim: Sim, aircraft: Aircraft): void {
  aircraft.due = sim.timers.goAroundSeconds;
  const stripRecord = strip(sim, aircraft.callsign);
  stripRecord.goAround = true;
  stripRecord.cleared = null;
}

// ---------------------------------------------------------------------------------------------------------------
// Handoff offers and strip moves

function openOffer(sim: Sim, aircraft: Aircraft): void {
  const cs = aircraft.callsign;
  aircraft.offerLeft = sim.timers.handoffOfferSeconds;
  const live = liveCopy(sim, cs);
  if (live) {
    live.bay = CLEARED_BAY.CONTACT;
    live.state = "offered";
    live.entered = nextEntry(sim);
  }
  sim.state.copies.push({ callsign: cs, board: "TWR", bay: "Incoming", frequency: "GND", state: "offered", entered: nextEntry(sim) });
}

/** Ends an offer: its Incoming copy goes and the Hand-off copy becomes the aircraft's strip in Taxi again. */
function closeOffer(sim: Sim, aircraft: Aircraft): void {
  const cs = aircraft.callsign;
  aircraft.offerLeft = null;
  sim.state.copies = sim.state.copies.filter((c) => !(c.callsign === cs && c.bay === "Incoming" && c.state === "offered"));
  const sender = sim.state.copies.find((c) => c.callsign === cs && c.state === "offered");
  if (sender) {
    sender.bay = "Taxi";
    sender.state = "active";
    sender.entered = nextEntry(sim);
  }
  changed(sim, cs);
}

function acceptOffer(sim: Sim, aircraft: Aircraft): void {
  const cs = aircraft.callsign;
  aircraft.offerLeft = null;
  aircraft.frequency = "TWR";
  const sender = sim.state.copies.find((c) => c.callsign === cs && c.bay === "Hand-off" && c.state === "offered");
  if (sender) {
    sender.state = "transferred";
    sender.frequency = "TWR";
  }
  const incoming = sim.state.copies.find((c) => c.callsign === cs && c.bay === "Incoming");
  if (incoming) {
    incoming.bay = "Holding";
    incoming.frequency = "TWR";
    incoming.state = "active";
    incoming.entered = nextEntry(sim);
  }
  changed(sim, cs);
  entry(sim, "TWR", "event", `Handoff accepted: ${cs}.`, { callsign: cs });
}

/** Whether a strip's current version matches the one a seat acted on. */
export const isCurrent = (sim: Sim, callsign: string, version: number): boolean => strip(sim, callsign).version === version;

/** The moves that need no clearance: TWR accepting an offered strip, GND recalling one. */
export function moveStrip(sim: Sim, position: Position, callsign: string, to: string): void {
  const aircraft = mustFind(sim, callsign);
  if (aircraft.offerLeft !== null) {
    if (position === "TWR" && to === "Holding") return acceptOffer(sim, aircraft);
    if (position === "GND" && to === "Taxi") {
      closeOffer(sim, aircraft);
      entry(sim, "GND", "event", `Handoff recalled: ${callsign}.`, { callsign });
      return;
    }
  }
  if (aircraft.frequency !== position) throw new Refusal(`${callsign} is not on your frequency.`);
  throw new Refusal(`${callsign} cannot move there.`);
}

export function editStrip(sim: Sim, position: Position, callsign: string, holdingPoint: string, remarks: string): void {
  const aircraft = mustFind(sim, callsign);
  if (aircraft.frequency !== position) throw new Refusal(`${callsign} is not on your frequency.`);
  const point = holdingPoint.trim().toUpperCase();
  if (point !== "" && sim.graph.nodes.get(point)?.kind !== "holding") throw new Refusal(`Unknown holding point ${point}.`);
  const stripRecord = strip(sim, callsign);
  const next = point === "" ? null : point;
  if (next !== stripRecord.holdingPoint || remarks !== stripRecord.remarks) {
    stripRecord.holdingPoint = next;
    stripRecord.remarks = remarks;
    changed(sim, callsign);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Events

export interface InjectedEvent {
  kind: EventKind;
  callsign?: string;
  windDir?: number;
  windKt?: number;
}

const ccw = (h: number, w: number): number => {
  const d = Math.abs(h - w) % 360;
  return d > 180 ? 360 - d : d;
};

export function applyEvent(sim: Sim, event: InjectedEvent | ScheduledEvent): void {
  const { state, graph, timers } = sim;
  const runway = state.runwayInUse;
  switch (event.kind) {
    case "closure":
      state.runwayClosed = true;
      setNotice(sim, `Runway ${runway} closed`);
      entry(sim, "INS", "event", `Runway ${runway} closed.`);
      break;
    case "reopen":
      state.runwayClosed = false;
      setNotice(sim, `Runway ${runway} reopened`);
      entry(sim, "INS", "event", `Runway ${runway} reopened.`);
      break;
    case "go-around": {
      const flight = namedAircraft(sim, event.callsign);
      if (flight.status !== "final") throw new NotFinalRefusal(flight.callsign);
      goAround(sim, flight);
      changed(sim, flight.callsign);
      entry(sim, "INS", "event", `Go-around: ${flight.callsign}.`, { callsign: flight.callsign });
      break;
    }
    case "emergency": {
      const declared = namedAircraft(sim, event.callsign);
      if (state.emergency !== null) clearEmergencyMark(sim, state.emergency);
      state.emergency = declared.callsign;
      strip(sim, declared.callsign).emergency = true;
      changed(sim, declared.callsign);
      for (const other of state.aircraft) if (other.callsign !== declared.callsign && other.status === "taxiing") other.status = "stopped";
      setNotice(sim, `Emergency ${declared.callsign}: all traffic hold.`);
      entry(sim, "INS", "event", `Emergency: ${declared.callsign}.`, { callsign: declared.callsign });
      break;
    }
    case "end-emergency": {
      const ending = state.emergency;
      if (ending === null) break;
      clearEmergencyMark(sim, ending);
      state.emergency = null;
      setNotice(sim, "");
      entry(sim, "INS", "event", `Emergency ended: ${ending}.`, { callsign: ending });
      break;
    }
    case "wind": {
      const dir = event.windDir ?? state.wind.dir;
      state.wind = { dir, kt: event.windKt ?? state.wind.kt };
      entry(sim, "INS", "event", `Wind ${String(dir).padStart(3, "0")} at ${state.wind.kt} kt.`);
      const within = [...graph.thresholds.values()].filter((t) => ccw(t.heading, dir) <= 90);
      const target = within.length === 1 ? within[0]?.id : undefined;
      if (target === undefined) break;
      if (target === state.runwayInUse) {
        state.windChange = null;
        if (state.noticeIsCountdown) setNotice(sim, "");
      } else {
        state.windChange = { target, left: timers.windChangeDelaySeconds };
        setNotice(sim, windCountdown(target, timers.windChangeDelaySeconds), true);
      }
      break;
    }
  }
}

function windCountdown(target: string, left: number): string {
  return `Runway change to ${target} in ${minutesSeconds(left)}`;
}

function setNotice(sim: Sim, text: string, countdown = false): void {
  sim.state.notice = text;
  sim.state.noticeIsCountdown = countdown;
}

function clearEmergencyMark(sim: Sim, callsign: string): void {
  strip(sim, callsign).emergency = false;
  changed(sim, callsign);
}

function namedAircraft(sim: Sim, callsign: string | undefined): Aircraft {
  const word = (callsign ?? "").trim().toUpperCase();
  const aircraft = findAircraft(sim, word);
  if (!aircraft) throw new Refusal(`Unknown callsign ${word}.`);
  return aircraft;
}

export function pinNote(sim: Sim, text: string): void {
  entry(sim, "INS", "note", text);
}

export function pause(sim: Sim): void {
  if (sim.state.status === "running") sim.state.status = "paused";
}

export function resume(sim: Sim): void {
  if (sim.state.status === "paused") sim.state.status = "running";
}

export function setSpeed(sim: Sim, speed: Speed): void {
  sim.state.speed = speed;
}

export function endSession(sim: Sim): void {
  if (sim.state.status === "ended") return;
  sim.state.status = "ended";
  entry(sim, "INS", "event", "Exercise ended.");
}

// ---------------------------------------------------------------------------------------------------------------
// The tick

const finished = (aircraft: Aircraft): boolean => (aircraft.kind === "dep" ? aircraft.status === "airborne" : aircraft.status === "vacated");

/** One sim second, in the published order. Returns nothing; the log and state carry the result. */
export function tick(sim: Sim): void {
  const { state, setup } = sim;
  if (state.status !== "running") return;
  state.simTime += 1;
  for (const scheduled of setup.events) {
    if (setup.scenarioStart + scheduled.at === state.simTime) {
      try {
        applyEvent(sim, scheduled);
      } catch (refusal) {
        if (!(refusal instanceof Refusal) && !(refusal instanceof NotFinalRefusal)) throw refusal;
      }
    }
  }
  const appearing: string[] = [];
  for (const flight of state.aircraft) {
    if (!flight.appeared && setup.scenarioStart + flight.appearAt === state.simTime) {
      appear(sim, flight);
      appearing.push(flight.callsign);
    }
  }
  const tickAlerts: { rule: RuleId; text: string; callsign: string; position: Position }[] = [];
  for (const plane of state.aircraft) {
    if (plane.appeared && !appearing.includes(plane.callsign)) advance(sim, plane, tickAlerts);
  }
  runWindChange(sim);
  expireOffers(sim, tickAlerts);
  expireReadbacks(sim, tickAlerts);
  const order: RuleId[] = ["R5", "R6", "R7"];
  for (const rule of order) {
    for (const alert of tickAlerts.filter((t) => t.rule === rule)) logAlert(sim, alert, alert.position, alert.callsign);
  }
  if (state.aircraft.every(finished) || state.simTime >= setup.scenarioStart + setup.durationSeconds) endSession(sim);
}

function appear(sim: Sim, aircraft: Aircraft): void {
  aircraft.appeared = true;
  placeAtStart(sim, aircraft);
}

/** Puts an aircraft that has just appeared in its first bay. */
function placeAtStart(sim: Sim, aircraft: Aircraft): void {
  if (aircraft.kind === "dep") {
    aircraft.status = "parked";
    aircraft.node = aircraft.stand;
    aircraft.frequency = "GND";
    sim.state.copies.push({ callsign: aircraft.callsign, board: "GND", bay: "Pending", frequency: "GND", state: "active", entered: nextEntry(sim) });
  } else {
    aircraft.status = "final";
    aircraft.due = aircraft.dueSeconds;
    aircraft.node = thresholdNode(sim, aircraft.runway);
    aircraft.frequency = "TWR";
    sim.state.copies.push({ callsign: aircraft.callsign, board: "TWR", bay: "Arrivals", frequency: "TWR", state: "active", entered: nextEntry(sim) });
  }
}

const thresholdNode = (sim: Sim, threshold: string | null): string | null =>
  threshold === null ? null : (sim.graph.thresholds.get(threshold)?.node ?? null);

type TickAlert = { rule: RuleId; text: string; callsign: string; position: Position };

function advance(sim: Sim, aircraft: Aircraft, alerts: TickAlert[]): void {
  switch (aircraft.status) {
    case "pushing":
      if (--aircraft.phaseLeft <= 0) aircraft.status = "ready";
      break;
    case "lining-up":
      if (--aircraft.phaseLeft <= 0) aircraft.status = "lined-up";
      break;
    case "rolling":
      if (--aircraft.phaseLeft <= 0) {
        aircraft.status = "airborne";
        leaveRunway(aircraft);
      }
      break;
    case "landing":
      if (--aircraft.phaseLeft <= 0) {
        aircraft.status = "vacated";
        leaveRunway(aircraft);
        moveLive(sim, aircraft.callsign, CLEARED_BAY.LAND);
        changed(sim, aircraft.callsign);
      }
      break;
    case "crossing":
      if (--aircraft.phaseLeft <= 0) crossed(sim, aircraft);
      break;
    case "taxiing":
      taxi(sim, aircraft, alerts);
      break;
    case "final":
      if (aircraft.due !== null && --aircraft.due <= 0) touchdown(sim, aircraft);
      break;
    default:
      break;
  }
  if (aircraft.offerLeft !== null) aircraft.offerLeft -= 1;
}

function crossed(sim: Sim, aircraft: Aircraft): void {
  const hop = aircraft.path[0];
  leaveRunway(aircraft);
  aircraft.node = hop && hop.kind === "cross" ? hop.to : (sim.graph.crossings.get(aircraft.node ?? "") ?? aircraft.node);
  aircraft.path = hop && hop.kind === "cross" ? aircraft.path.slice(1) : aircraft.path;
  aircraft.status = aircraft.path.length > 0 ? "taxiing" : "holding";
}

function touchdown(sim: Sim, aircraft: Aircraft): void {
  const cleared = strip(sim, aircraft.callsign).cleared !== null;
  if (cleared) {
    aircraft.status = "landing";
    aircraft.due = null;
    aircraft.phaseLeft = sim.timers.landingRollSeconds;
    occupy(sim, aircraft);
    return;
  }
  goAround(sim, aircraft);
  changed(sim, aircraft.callsign);
  entry(sim, "TWR", "event", `Go-around: ${aircraft.callsign}.`, { callsign: aircraft.callsign });
}

/** One second of taxiing along the path: `speedMps` metres along the segment, with no metres carried over. */
function taxi(sim: Sim, aircraft: Aircraft, alerts: TickAlert[]): void {
  const { graph } = sim;
  let step = aircraft.path[0];
  if (!step || step.kind !== "segment") return;
  if (aircraft.segment === null) {
    aircraft.segment = step.segment;
    aircraft.node = null;
    aircraft.progress = Math.min(segmentLength(graph, step.segment), segmentSpeed(graph, step.segment));
  } else if (aircraft.progress >= segmentLength(graph, aircraft.segment)) {
    aircraft.path = aircraft.path.slice(1);
    step = aircraft.path[0];
    if (!step || step.kind !== "segment") return;
    aircraft.segment = step.segment;
    aircraft.progress = Math.min(segmentLength(graph, step.segment), segmentSpeed(graph, step.segment));
  } else {
    aircraft.progress = Math.min(segmentLength(graph, aircraft.segment), aircraft.progress + segmentSpeed(graph, aircraft.segment));
  }
  if (aircraft.progress < segmentLength(graph, aircraft.segment)) return;
  const next = aircraft.path[1];
  if (next === undefined) {
    arrive(sim, aircraft, step.to, alerts);
  } else if (next.kind === "cross") {
    stopAt(aircraft, step.to);
    aircraft.path = aircraft.path.slice(1);
  }
}

function stopAt(aircraft: Aircraft, node: string): void {
  aircraft.segment = null;
  aircraft.node = node;
  aircraft.progress = 0;
  aircraft.status = "holding";
}

/** The aircraft has completed its route and reached `node`. */
function arrive(sim: Sim, aircraft: Aircraft, node: string, alerts: TickAlert[]): void {
  const finalPoint = aircraft.kind === "dep" && isRunwayHolding(sim.graph, node);
  const position = aircraft.frequency;
  stopAt(aircraft, node);
  aircraft.path = [];
  if (finalPoint && aircraft.overrunsHold) {
    overrun(sim, aircraft, node);
    alerts.push({ rule: "R5", text: alertTexts.R5(node, aircraft.callsign), callsign: aircraft.callsign, position });
  } else if (finalPoint && aircraft.frequency === "GND") {
    alerts.push({ rule: "R6", text: alertTexts.R6Late(aircraft.callsign, node), callsign: aircraft.callsign, position });
  }
}

/** A scripted pilot error: the departure does not stop and goes onto the runway. */
function overrun(sim: Sim, aircraft: Aircraft, node: string): void {
  const cs = aircraft.callsign;
  aircraft.status = "lining-up";
  aircraft.phaseLeft = sim.timers.lineupSeconds;
  aircraft.node = node;
  aircraft.run = null;
  aircraft.offerLeft = null;
  aircraft.frequency = "TWR";
  occupy(sim, aircraft);
  sim.state.copies = sim.state.copies.filter((c) => !(c.callsign === cs && c.state === "offered"));
  moveLive(sim, cs, CLEARED_BAY.LINEUP);
  changed(sim, cs);
}

function runWindChange(sim: Sim): void {
  const { state } = sim;
  const change = state.windChange;
  if (!change) return;
  change.left -= 1;
  if (change.left > 0) {
    if (state.noticeIsCountdown) setNotice(sim, windCountdown(change.target, change.left), true);
    return;
  }
  state.runwayInUse = change.target;
  state.windChange = null;
  setNotice(sim, `Runway in use ${change.target}`);
  entry(sim, "INS", "event", `Runway in use ${change.target}.`);
  for (const flight of state.aircraft) {
    if (flight.kind === "arr" && flight.appeared) {
      flight.runway = change.target;
      flight.node = thresholdNode(sim, change.target);
      changed(sim, flight.callsign);
    }
  }
}

function expireOffers(sim: Sim, alerts: TickAlert[]): void {
  for (const flight of sim.state.aircraft) {
    if (flight.offerLeft !== null && flight.offerLeft <= 0) {
      closeOffer(sim, flight);
      alerts.push({ rule: "R6", text: alertTexts.R6Offer(flight.callsign), callsign: flight.callsign, position: flight.frequency });
    }
  }
}

function expireReadbacks(sim: Sim, alerts: TickAlert[]): void {
  for (const flight of sim.state.aircraft) {
    const open = flight.readbackError;
    if (open && sim.state.simTime >= open.at + sim.timers.readbackCorrectSeconds) {
      flight.readbackError = null;
      alerts.push({ rule: "R7", text: alertTexts.R7(flight.callsign), callsign: flight.callsign, position: flight.frequency });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Starting a session

export interface StripSeed {
  callsign: string;
  bay: Bay;
  frequency?: Position;
  segment?: string;
  progress?: number;
  node?: string;
  dueSeconds?: number;
  takeoffStart?: number;
  cleared?: string;
}

const blankAircraft = (planned: SessionSetup["traffic"][number]): Aircraft => ({
  ...planned,
  appeared: false,
  status: "parked",
  frequency: "GND",
  segment: null,
  node: null,
  progress: 0,
  path: [],
  phaseLeft: 0,
  due: null,
  takeoffStart: null,
  occupiedAt: null,
  occupiedOrder: 0,
  readbackError: null,
  offerLeft: null,
  run: null,
});

export function startSession(setup: SessionSetup, timers: Timers, runwayInUse: string, wind: { dir: number; kt: number }, firstSimTime: number, seeds: StripSeed[]): Sim {
  const state: SessionState = {
    status: "running",
    speed: 1,
    simTime: firstSimTime,
    firstSimTime,
    runwayInUse,
    runwayClosed: false,
    wind,
    notice: "",
    noticeIsCountdown: false,
    windChange: null,
    emergency: null,
    readbackCount: 0,
    sequence: 0,
    aircraft: setup.traffic.map(blankAircraft),
    strips: {},
    copies: [],
    lastReadback: null,
  };
  const sim = simOf(setup, timers, state);
  for (const flight of state.aircraft) {
    state.strips[flight.callsign] = { version: 1, cleared: null, holdingPoint: flight.holdingPoint, remarks: "", goAround: false, emergency: false };
    const seed = seeds.find((s) => s.callsign === flight.callsign);
    if (seed) {
      flight.appeared = true;
      seedPlacement(sim, flight, seed);
    } else if (setup.scenarioStart + flight.appearAt <= firstSimTime) {
      flight.appeared = true;
      placeAtStart(sim, flight);
    }
  }
  return sim;
}

/** A strip in a bay is on that board's frequency, except an Incoming copy, which is still on Ground. */
const bayFrequency = (bay: Bay): Position => (bay === "Incoming" ? "GND" : boardOf(bay));

function seedPlacement(sim: Sim, aircraft: Aircraft, seed: StripSeed): void {
  const { state, graph, timers } = sim;
  aircraft.frequency = seed.frequency ?? bayFrequency(seed.bay);
  const copy = (bay: Bay, copyState: StripCopy["state"] = "active"): void => {
    state.copies.push({ callsign: aircraft.callsign, board: boardOf(bay), bay, frequency: aircraft.frequency, state: copyState, entered: nextEntry(sim) });
  };
  const taxiToPoint = (): void => {
    aircraft.status = "taxiing";
    const target = aircraft.holdingPoint ?? "";
    if (seed.segment !== undefined) {
      aircraft.segment = seed.segment;
      aircraft.progress = seed.progress ?? 0;
      aircraft.path = routeFromSegment(graph, seed.segment, target) ?? [];
    } else {
      aircraft.node = seed.node ?? aircraft.stand;
      aircraft.path = findRoute(graph, aircraft.node ?? "", target, []) ?? [];
    }
  };
  switch (seed.bay) {
    case "Pending":
      aircraft.status = "parked";
      aircraft.node = aircraft.stand;
      copy("Pending");
      break;
    case "Pushback":
      aircraft.status = "ready";
      aircraft.node = aircraft.stand;
      copy("Pushback");
      break;
    case "Taxi":
      taxiToPoint();
      copy("Taxi");
      break;
    case "Hand-off":
    case "Incoming":
      taxiToPoint();
      aircraft.frequency = seed.frequency ?? "GND";
      aircraft.offerLeft = timers.handoffOfferSeconds;
      copy("Hand-off", "offered");
      state.copies.push({ callsign: aircraft.callsign, board: "TWR", bay: "Incoming", frequency: aircraft.frequency, state: "offered", entered: nextEntry(sim) });
      break;
    case "Holding":
      if (seed.segment !== undefined) taxiToPoint();
      else {
        aircraft.status = "holding";
        aircraft.node = seed.node ?? aircraft.holdingPoint;
      }
      copy("Holding");
      break;
    case "Line up":
      aircraft.status = "lined-up";
      aircraft.node = aircraft.holdingPoint;
      aircraft.occupiedAt = state.firstSimTime;
      aircraft.occupiedOrder = nextEntry(sim);
      copy("Line up");
      break;
    case "Departed": {
      const start = seed.takeoffStart ?? state.firstSimTime;
      aircraft.takeoffStart = start;
      aircraft.node = aircraft.holdingPoint;
      const left = timers.takeoffRollSeconds - (state.firstSimTime - start);
      if (left > 0) {
        aircraft.status = "rolling";
        aircraft.phaseLeft = left;
        aircraft.occupiedAt = start;
        aircraft.occupiedOrder = nextEntry(sim);
      } else aircraft.status = "airborne";
      copy("Departed");
      break;
    }
    case "Arrivals":
      aircraft.status = "final";
      aircraft.due = seed.dueSeconds ?? aircraft.dueSeconds;
      aircraft.node = thresholdNode(sim, aircraft.runway);
      copy("Arrivals");
      break;
    case "Landed":
      aircraft.status = "vacated";
      aircraft.node = thresholdNode(sim, aircraft.runway);
      copy("Landed");
      break;
  }
  if (seed.cleared !== undefined) strip(sim, aircraft.callsign).cleared = seed.cleared;
}
