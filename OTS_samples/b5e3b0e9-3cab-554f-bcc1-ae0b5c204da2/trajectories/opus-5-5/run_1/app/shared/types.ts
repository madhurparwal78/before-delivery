export type Position = 'GND' | 'TWR';
export type LogPosition = Position | 'INS';
export type SessionStatus = 'running' | 'paused' | 'ended';

export type Bay =
  | 'Pending'
  | 'Pushback'
  | 'Taxi'
  | 'Hand-off'
  | 'Incoming'
  | 'Holding'
  | 'Line up'
  | 'Departed'
  | 'Arrivals'
  | 'Landed';

export const BOARD_BAYS: Record<Position, Bay[]> = {
  GND: ['Pending', 'Pushback', 'Taxi', 'Hand-off'],
  TWR: ['Incoming', 'Holding', 'Line up', 'Departed', 'Arrivals', 'Landed'],
};

export const BOARD_NAMES: Record<Position, string> = { GND: 'Ground board', TWR: 'Tower board' };

export type AircraftStatus =
  | 'parked'
  | 'pushing'
  | 'ready'
  | 'taxiing'
  | 'stopped'
  | 'holding'
  | 'lining-up'
  | 'lined-up'
  | 'rolling'
  | 'airborne'
  | 'crossing'
  | 'final'
  | 'landing'
  | 'vacated';

export interface LayoutNode {
  id: string;
  kind: 'threshold' | 'holding' | 'junction' | 'stand';
  x: number;
  y: number;
  serves?: string;
}

export interface LayoutSegment {
  id: string;
  from: string;
  to: string;
  lengthM: number;
  speedMps: number;
  taxiway: string;
}

export interface LayoutRunway {
  id: string;
  lengthM: number;
  thresholds: { id: string; node: string; heading: number }[];
}

export interface Layout {
  name: string;
  code: string;
  runways: LayoutRunway[];
  nodes: LayoutNode[];
  segments: LayoutSegment[];
}

export type TimerKind = 'wake' | 'offer' | 'due' | 'slot';

export interface TimerView {
  kind: TimerKind;
  text: string;
  near: boolean;
}

export interface StripMoveView {
  to: Bay;
  command: string | null;
}

export interface StripView {
  callsign: string;
  board: Position;
  bay: Bay;
  frequency: Position;
  state: 'active' | 'offered' | 'transferred';
  version: number;
  cleared: string | null;
  timers: TimerView[];
  kind: 'DEP' | 'ARR';
  type: string;
  wake: string;
  rules: string;
  stand: string | null;
  runway: string | null;
  holdingPoint: string | null;
  remarks: string;
  emergency: boolean;
  goAround: boolean;
  forward: StripMoveView | null;
  back: StripMoveView | null;
}

export interface AircraftPosition {
  callsign: string;
  status: AircraftStatus;
  segment: string | null;
  node: string | null;
  progress: number;
  from: string | null;
}

export interface AircraftView extends AircraftPosition {
  route: string[];
  stop: string | null;
  routeBy: Position | null;
  emergency: boolean;
}

export interface AlertView {
  simTime: string;
  rule: string;
  text: string;
  severity: 'critical' | 'warning' | 'advisory';
}

export interface SeatView {
  userId: string;
  name: string;
  connected: boolean;
  graceEnded: boolean;
}

export interface SessionStateView {
  id: string;
  seq: number;
  status: SessionStatus;
  speed: 1 | 2 | 4;
  simTime: string;
  runwayInUse: string;
  wind: { dir: number; kt: number };
  notice: string;
  closed: boolean;
  strips: StripView[];
  aircraft: AircraftView[];
  alerts: AlertView[];
  seats: Record<Position, SeatView | null>;
  layout: Layout;
  scenarioName: string;
  lastReadback: string;
}

export interface ReplayView {
  simTime: string;
  aircraft: AircraftPosition[];
  strips: { callsign: string; bay: Bay }[];
}
