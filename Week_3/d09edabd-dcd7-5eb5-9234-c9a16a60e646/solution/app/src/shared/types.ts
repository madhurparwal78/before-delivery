import type { Length } from './units.js';
import type { Outcome, Stats } from './format.js';

export type Role = 'owner' | 'co_designer';
export type PlacementKind = 'door' | 'box' | 'cylinder' | 'prop';
export type NodeKind = 'puzzle' | 'lock' | 'cue' | 'exit';
export type SessionState = 'scheduled' | 'lobby' | 'running' | 'ended' | 'cancelled';
export type EmailStatus = 'sent' | 'queued' | 'failed';
export type LockTarget = 'placement' | 'node';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

export interface Workspace {
  id: string;
  name: string;
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
  stats: Stats;
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

export interface Solve {
  nodeId: string;
  title: string;
  elapsedSeconds: number;
  solvedBy: string | null;
}

export interface SessionTester {
  inviteId: string;
  email: string;
  displayName: string | null;
  joined: boolean;
  emailStatus: EmailStatus;
}

export interface Session {
  id: string;
  roomId: string;
  roomName: string;
  kind: 'remote' | 'walk_in';
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
  solves: Solve[];
  stats: Stats;
  testers: SessionTester[];
}

export interface RoomDetail {
  room: Room;
  placements: Placement[];
  nodes: TriggerNode[];
  sceneOrder: string[];
  activeSession: Session | null;
  latestSessionId: string | null;
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

export interface Version {
  id: string;
  roomId: string;
  number: number;
  label: string;
  state: 'frozen' | 'superseded';
  supersededBy: number | null;
  frozenAt: string;
  stats: Stats;
  packUrl: string | null;
}

export interface LockHolder {
  userId: string;
  displayName: string;
}

export interface Lock {
  targetType: LockTarget;
  targetId: string;
  holder: LockHolder;
  expiresInSeconds: number;
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

export interface Pack {
  version: { number: number; label: string; state: 'frozen' | 'superseded'; frozenAt: string; supersededBy: number | null };
  room: { name: string; width: Length; depth: Length; height: Length };
  placements: PackPlacement[];
  nodes: { title: string; kind: NodeKind; needs: string[]; linkedPlacement: string | null; answer: string | null }[];
  props: { id: string; name: string; bytes: number; sha256: string; downloadPath: string }[];
  stats: Stats;
}

export interface PlayNode {
  id: string;
  title: string;
  kind: NodeKind;
  prerequisites: string[];
  placementId: string | null;
  needsAnswer: boolean;
  solved: boolean;
  available: boolean;
}

export interface PlaySession {
  state: SessionState;
  startsAt: string;
  remainingSeconds: number;
  hintCooldownSeconds: number;
  durationSeconds: number;
  serverTime: string;
  outcome: Outcome | null;
}

export interface PlayView {
  session: PlaySession;
  room: { name: string; widthMm: number; depthMm: number; heightMm: number; placements: Placement[] };
  nodes: PlayNode[];
  testers: { displayName: string | null; joined: boolean }[];
  me: { displayName: string | null; joined: boolean };
  hints: { text: string; sentAt: string }[];
}

export interface Debrief {
  outcome: Outcome;
  elapsedSeconds: number;
  stats: Stats;
  puzzles: { title: string; solvedAtSeconds: number | null; waitSeconds: number | null }[];
  hintsUsed: number;
  chokePoint: { title: string; waitSeconds: number } | null;
  emailStatus: EmailStatus;
}
