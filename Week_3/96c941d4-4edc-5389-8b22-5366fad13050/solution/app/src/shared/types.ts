export type Difficulty = 'calm' | 'rough' | 'severe';
export type RunMode = 'campaign' | 'playtest' | 'challenge';
export type Tier = 'base' | 'upgraded';
export type Outcome = 'victory' | 'defeat';
export type CommandType = 'deploy' | 'upgrade' | 'salvage';
export type TransferReason =
  | 'initial'
  | 'harbour-generation'
  | 'collector-generation'
  | 'deploy'
  | 'upgrade'
  | 'salvage-refund'
  | 'salvage-loss';

export interface Cell {
  lane: number;
  cell: number;
}

export interface Wave {
  tick: number;
  creature: string;
  count: number;
  interval: number;
  lane: number;
}

export interface Definition {
  title: string;
  description: string;
  difficulty: Difficulty;
  seed: number;
  buildable: Cell[];
  waves: Wave[];
}

export interface Command {
  seq: number;
  tick: number;
  type: CommandType;
  lane: number;
  cell: number;
  device: string | null;
}

export interface Metrics {
  outcome: Outcome;
  breaches: number;
  completionTick: number;
  remainingCharge: number;
  health: number;
}

export interface Failure {
  tick: number;
  seq: number | null;
  reason: string;
}

export interface Transfer {
  movementId: number;
  tick: number;
  account: string;
  delta: number;
  reason: TransferReason;
  deviceId: number | null;
}

export interface FrameDevice {
  id: number;
  device: string;
  lane: number;
  cell: number;
  tier: Tier;
  installedCharge: number;
  nextFireTick: number | null;
}

export interface FrameCreature {
  id: number;
  creature: string;
  lane: number;
  position: number;
  health: number;
  movements: number;
}

export type FrameEvent =
  | {
      kind: 'damage';
      tick: number;
      deviceId: number;
      targetId: number;
      lane: number;
      cell: number;
      damage: number;
      resultingHealth: number;
    }
  | { kind: 'death'; tick: number; creatureId: number; lane: number; cell: number }
  | { kind: 'breach'; tick: number; creatureId: number; lane: number; cell: number };

export interface Frame {
  tick: number;
  rngState: number;
  nextEntityId: number;
  nextMovementId: number;
  health: number;
  breaches: number;
  reserve: number;
  source: number;
  sink: number;
  devices: FrameDevice[];
  creatures: FrameCreature[];
  spawned: number[];
  events: FrameEvent[];
  transfers: Transfer[];
  outcome: Outcome | null;
}

export interface CommandState extends Frame {
  phase: 'after-commands';
}

export interface Ticket {
  id: string;
  accountId: string;
  mode: RunMode;
  sourceId: string;
  revision: number | null;
  seed: number;
  levelDigest: string;
  loadout: string[];
  ruleset: string;
  initialReserve: number;
  initialHealth: number;
  seasonDay: string | null;
  daily: boolean;
}

export interface SimulationConfig {
  definition: Definition;
  loadout: string[];
  initialReserve: number;
  initialHealth: number;
}
