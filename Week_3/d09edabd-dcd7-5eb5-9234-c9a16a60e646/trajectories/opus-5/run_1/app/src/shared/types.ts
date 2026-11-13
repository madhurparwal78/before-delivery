import type { Length } from './units.js';

export type { Length, Units } from './units.js';

export type Role = 'owner' | 'co_designer';
export type PlacementKind = 'door' | 'box' | 'cylinder' | 'prop';
export type NodeKind = 'puzzle' | 'lock' | 'cue' | 'exit';
export type SessionState = 'scheduled' | 'lobby' | 'running' | 'ended' | 'cancelled';
export type SessionKind = 'remote' | 'walk_in';
export type Outcome = 'escaped' | 'timed_out' | 'stopped';
export type VersionState = 'frozen' | 'superseded';
export type EmailStatus = 'sent' | 'queued' | 'failed';
export type ServiceState = 'up' | 'down';
export type ChangeKind = 'create' | 'update' | 'delete' | 'move' | 'undo' | 'restore';

export interface ChainFigures {
  solved: number;
  total: number;
  longestRun: number;
  props: number;
}

export interface Room {
  id: string;
  name: string;
  starter: boolean;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  version: number;
  revision: number;
  stats: ChainFigures;
  thumbnailUrl: string | null;
}

export interface Placement {
  id: string;
  kind: PlacementKind;
  label: string;
  propId: string | null;
  entry: boolean;
  xMm: number;
  yMm: number;
  zMm: number;
  rotationDeg: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  version: number;
}

export interface TriggerNode {
  id: string;
  title: string;
  kind: NodeKind;
  placementId: string | null;
  answer: string | null;
  prerequisites: string[];
  version: number;
}

export interface Prop {
  id: string;
  name: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  contentType: string;
  bytes: number;
  sha256: string;
  fileUrl: string;
}

export interface RoomVersion {
  id: string;
  roomId: string;
  number: number;
  label: string;
  state: VersionState;
  supersededBy: number | null;
  frozenAt: string;
  stats: ChainFigures;
  packUrl: string | null;
}

export interface SolveEntry {
  nodeId: string;
  title: string;
  elapsedSeconds: number;
  solvedBy: string | null;
}

export interface RosterEntry {
  inviteId: string;
  email: string;
  displayName: string | null;
  joined: boolean;
  emailStatus: EmailStatus;
}

export interface PlaytestSession {
  id: string;
  roomId: string;
  roomName: string;
  kind: SessionKind;
  state: SessionState;
  hostUserId: string;
  startsAt: string;
  startedAt: string | null;
  endedAt: string | null;
  outcome: Outcome | null;
  durationSeconds: number;
  remainingSeconds: number;
  hintCooldownSeconds: number;
  hintsUsed: number;
  serverTime: string;
  solves: SolveEntry[];
  stats: ChainFigures;
  testers: RosterEntry[];
}

export interface Debrief {
  outcome: Outcome | null;
  elapsedSeconds: number;
  stats: ChainFigures;
  puzzles: { title: string; solvedAtSeconds: number | null; waitSeconds: number | null }[];
  hintsUsed: number;
  chokePoint: { title: string; waitSeconds: number } | null;
  emailStatus: EmailStatus;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

export interface Workspace {
  id: string;
  name: string;
}

export interface HealthBody {
  status: 'ok';
  instance: string;
  services: {
    postgres: ServiceState;
    valkey: ServiceState;
    minio: ServiceState;
    mail: ServiceState;
  };
}

export interface RoomDetail {
  room: Room;
  placements: Placement[];
  nodes: TriggerNode[];
  sceneOrder: string[];
  activeSession: PlaytestSession | null;
  latestSessionId: string | null;
}

export interface PackPlacement {
  id: string;
  kind: PlacementKind;
  label: string;
  propId: string | null;
  entry: boolean;
  x: Length;
  y: Length;
  z: Length;
  width: Length;
  depth: Length;
  height: Length;
  rotationDeg: number;
}

export interface PackBody {
  version: {
    number: number;
    label: string;
    state: VersionState;
    frozenAt: string;
    supersededBy: number | null;
  };
  room: { name: string; width: Length; depth: Length; height: Length };
  placements: PackPlacement[];
  nodes: {
    title: string;
    kind: NodeKind;
    needs: string[];
    linkedPlacement: string | null;
    answer: string | null;
  }[];
  props: { id: string; name: string; bytes: number; sha256: string; downloadPath: string }[];
  stats: ChainFigures;
}

export interface TesterNode {
  id: string;
  title: string;
  kind: NodeKind;
  prerequisites: string[];
  placementId: string | null;
  needsAnswer: boolean;
  solved: boolean;
  available: boolean;
}

export interface TesterView {
  session: {
    state: SessionState;
    startsAt: string;
    remainingSeconds: number;
    hintCooldownSeconds: number;
    durationSeconds: number;
    serverTime: string;
    outcome: Outcome | null;
  };
  room: {
    name: string;
    widthMm: number;
    depthMm: number;
    heightMm: number;
    placements: Placement[];
  };
  nodes: TesterNode[];
  testers: { displayName: string; joined: boolean }[];
  me: { displayName: string | null; joined: boolean };
  hints: { text: string; sentAt: string }[];
}

export interface ChangeLogEntry {
  revision: number;
  opId: string | null;
  kind: ChangeKind;
  placementId: string | null;
  userId: string;
}
