/** The shapes the server pushes and the client renders. */

export type Position = "GND" | "TWR";

export type Bay =
  | "Pending"
  | "Pushback"
  | "Taxi"
  | "Hand-off"
  | "Incoming"
  | "Holding"
  | "Line up"
  | "Departed"
  | "Arrivals"
  | "Landed";

export const GROUND_BAYS: readonly Bay[] = ["Pending", "Pushback", "Taxi", "Hand-off"];
export const TOWER_BAYS: readonly Bay[] = ["Incoming", "Holding", "Line up", "Departed", "Arrivals", "Landed"];

export const POSITIONS: readonly Position[] = ["GND", "TWR"];
export const isPosition = (value: unknown): value is Position => POSITIONS.some((p) => p === value);

export type CopyState = "active" | "offered" | "transferred";

export interface StripTimer {
  kind: "wake" | "offer" | "due" | "slot";
  text: string;
  near: boolean;
}

/** The bay a strip's forward move goes to, with the clearance line it pre-fills (null when it needs none). */
export interface ForwardMove {
  to: Bay;
  line: string | null;
}

export interface StripRow {
  callsign: string;
  board: Position;
  bay: Bay;
  frequency: Position;
  state: CopyState;
  version: number;
  cleared: string | null;
  timers: StripTimer[];
  kind: "dep" | "arr";
  type: string;
  wake: string;
  rules: string;
  stand: string | null;
  runway: string | null;
  holdingPoint: string | null;
  remarks: string;
  goAround: boolean;
  emergency: boolean;
  forward: ForwardMove | null;
  back: Bay | null;
}

/** An aircraft's position, as the replay stores it for each second. */
export interface AircraftPosition {
  callsign: string;
  status: string;
  segment: string | null;
  /** The node the segment is left from, in the direction of travel. */
  from: string | null;
  node: string | null;
  progress: number;
}

export interface AircraftRow extends AircraftPosition {
  route: string[];
}

export interface RunRow {
  callsign: string;
  position: Position;
  stop: string;
}

export interface AlertView {
  id: number;
  simTime: string;
  rule: string;
  text: string;
  severity: string;
}

export interface SeatView {
  id: string;
  name: string;
  connected: boolean;
  graceEnded: boolean;
}

/** What every client receives for a session, on load and on every push. */
export interface Payload {
  rev: number;
  status: "running" | "paused" | "ended";
  speed: 1 | 2 | 4;
  simTime: string;
  runwayInUse: string;
  runwayClosed: boolean;
  wind: { dir: number; kt: number };
  notice: string;
  emergency: string | null;
  strips: StripRow[];
  aircraft: AircraftRow[];
  runs: RunRow[];
  alerts: AlertView[];
  seats: Record<Position, SeatView | null>;
  lastReadback: { position: Position; text: string } | null;
}
