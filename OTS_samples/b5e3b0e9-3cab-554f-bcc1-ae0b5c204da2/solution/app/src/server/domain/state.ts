import type { Layout } from "./layout.ts";
import type { PathStep } from "./graph.ts";
import type { Bay, CopyState, Position } from "../../shared/wire.ts";
import type { Speed, Wake } from "./rules.ts";

export type { Bay } from "../../shared/wire.ts";

export type AircraftStatus =
  | "parked"
  | "pushing"
  | "ready"
  | "taxiing"
  | "stopped"
  | "holding"
  | "crossing"
  | "lining-up"
  | "lined-up"
  | "rolling"
  | "airborne"
  | "final"
  | "landing"
  | "vacated";

export type SessionStatus = "running" | "paused" | "ended";

export interface TrafficItem {
  callsign: string;
  type: string;
  wake: Wake;
  rules: "VFR" | "IFR";
  kind: "dep" | "arr";
  stand: string | null;
  holdingPoint: string | null;
  runway: string | null;
  appearAt: number;
  dueSeconds: number | null;
  slotSeconds: number | null;
  overrunsHold: boolean;
}

export interface ScheduledEvent {
  at: number;
  kind: EventKind;
  callsign?: string;
  windDir?: number;
  windKt?: number;
}

export const EVENT_KINDS = ["closure", "reopen", "go-around", "emergency", "end-emergency", "wind"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Frozen copy of the scenario and aerodrome a session was started from. */
export interface SessionSetup {
  scenarioName: string;
  aerodromeName: string;
  layout: Layout;
  traffic: TrafficItem[];
  events: ScheduledEvent[];
  seed: number;
  readbackErrorEvery: number | null;
  scenarioStart: number;
  durationSeconds: number;
}

export interface ReadbackError {
  at: number;
  subject: "RUNWAY" | "HP";
  value: string;
}

export interface Aircraft extends TrafficItem {
  appeared: boolean;
  status: AircraftStatus;
  frequency: Position;
  segment: string | null;
  node: string | null;
  progress: number;
  path: PathStep[];
  /** Seconds left in pushing, lining-up, rolling, crossing or landing. */
  phaseLeft: number;
  /** Seconds to the threshold while on final. */
  due: number | null;
  takeoffStart: number | null;
  /** Sim time and order in which the aircraft went onto the runway. */
  occupiedAt: number | null;
  occupiedOrder: number;
  readbackError: ReadbackError | null;
  /** Seconds left of an open handoff offer. */
  offerLeft: number | null;
  /** The seat whose accepted taxi clearance lights this aircraft's route, and the holding point it ends at. */
  run: { position: Position; stop: string } | null;
}

export interface StripData {
  version: number;
  cleared: string | null;
  holdingPoint: string | null;
  remarks: string;
  goAround: boolean;
  emergency: boolean;
}

export interface StripCopy {
  callsign: string;
  board: Position;
  bay: Bay;
  frequency: Position;
  state: CopyState;
  entered: number;
}

export interface SessionState {
  status: SessionStatus;
  speed: Speed;
  simTime: number;
  firstSimTime: number;
  runwayInUse: string;
  runwayClosed: boolean;
  wind: { dir: number; kt: number };
  notice: string;
  /** Whether the notice is the countdown of a runway change, which each tick rewrites. */
  noticeIsCountdown: boolean;
  windChange: { target: string; left: number } | null;
  emergency: string | null;
  readbackCount: number;
  sequence: number;
  aircraft: Aircraft[];
  strips: Record<string, StripData>;
  copies: StripCopy[];
  lastReadback: { position: Position; text: string } | null;
}

export interface LogEntry {
  simTime: number;
  position: "GND" | "TWR" | "INS";
  kind: "command" | "readback" | "alert" | "event" | "note";
  text: string;
  rule?: string;
  severity?: string;
  callsign?: string;
}
