import type { AircraftStatus, Bay, LogPosition, Position, SessionStatus } from '../../shared/types.js';

export type Wake = 'L' | 'M' | 'H' | 'J';

export interface TrafficItem {
  callsign: string;
  type: string;
  wake: Wake;
  rules: 'VFR' | 'IFR';
  kind: 'dep' | 'arr';
  stand: string | null;
  holdingPoint: string | null;
  runway: string | null;
  appearAt: number;
  dueSeconds: number | null;
  slotSeconds: number | null;
  overrunsHold: boolean;
}

export type EventKind = 'closure' | 'reopen' | 'go-around' | 'emergency' | 'end-emergency' | 'wind';
export const EVENT_KINDS: EventKind[] = ['closure', 'reopen', 'go-around', 'emergency', 'end-emergency', 'wind'];

export interface SimEvent {
  kind: EventKind;
  callsign?: string;
  windDir?: number;
  windKt?: number;
}

export interface ScheduledEvent extends SimEvent {
  at: number;
}

export interface Scenario {
  name: string;
  aerodrome: string;
  runwayInUse: string;
  windDir: number;
  windKt: number;
  startSimTime: string;
  durationSeconds: number;
  seed: number;
  readbackErrorEvery: number | null;
  traffic: TrafficItem[];
  events: ScheduledEvent[];
}

export interface Leg {
  kind: 'seg' | 'cross';
  id: string;
  from: string;
  to: string;
}

export interface Aircraft {
  callsign: string;
  status: AircraftStatus;
  segment: string | null;
  node: string | null;
  progress: number;
  legs: Leg[];
  stop: string | null;
  routeBy: Position | null;
  timer: number;
  due: number | null;
  landClear: boolean;
  takeoffStart: number | null;
  runwayEntry: number | null;
  emergency: boolean;
}

export interface Offer {
  expiresAt: number;
  seq: number;
}

export interface Strip {
  callsign: string;
  bay: Bay;
  frequency: Position;
  version: number;
  signature: string;
  cleared: string | null;
  holdingPoint: string | null;
  runway: string | null;
  remarks: string;
  emergency: boolean;
  goAround: boolean;
  offer: Offer | null;
  transferredSeq: number | null;
  seq: number;
}

export interface ReadbackError {
  callsign: string;
  deadline: number;
  kind: 'HP' | 'RUNWAY';
  value: string;
}

export type LogKind = 'command' | 'readback' | 'alert' | 'event' | 'note';

export interface LogRow {
  simTime: number;
  position: LogPosition;
  kind: LogKind;
  text: string;
  callsign: string | null;
  rule: RuleId | null;
  penalty: number | null;
}

export interface SimState {
  firstTime: number;
  startTime: number;
  now: number;
  status: SessionStatus;
  speed: 1 | 2 | 4;
  runwayInUse: string;
  wind: { dir: number; kt: number };
  closed: boolean;
  notice: string;
  runwayChange: { to: string; remaining: number } | null;
  emergency: string | null;
  lastTakeoff: { callsign: string; wake: Wake; start: number } | null;
  eligibleReadbacks: number;
  readbackErrors: ReadbackError[];
  aircraft: Record<string, Aircraft>;
  strips: Record<string, Strip>;
  seq: number;
  log: LogRow[];
  endTime: number | null;
}

export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8';

export const RULES: Record<RuleId, { severity: 'critical' | 'warning' | 'advisory'; penalty: number }> = {
  R1: { severity: 'critical', penalty: 20 },
  R2: { severity: 'warning', penalty: 15 },
  R3: { severity: 'warning', penalty: 15 },
  R4: { severity: 'warning', penalty: 10 },
  R5: { severity: 'critical', penalty: 30 },
  R6: { severity: 'advisory', penalty: 5 },
  R7: { severity: 'advisory', penalty: 10 },
  R8: { severity: 'critical', penalty: 20 },
};

/** Wake minimum in seconds, leader by follower. */
export const WAKE_MINIMUM: Record<Wake, Record<Wake, number>> = {
  J: { L: 180, M: 180, H: 120, J: 120 },
  H: { L: 120, M: 120, H: 90, J: 90 },
  M: { L: 90, M: 60, H: 60, J: 60 },
  L: { L: 60, M: 60, H: 60, J: 60 },
};

export const PASS_MARK = 75;

export const OCCUPYING: AircraftStatus[] = ['lining-up', 'lined-up', 'rolling', 'crossing', 'landing'];

export interface Alert {
  rule: RuleId;
  text: string;
  callsign: string;
}
