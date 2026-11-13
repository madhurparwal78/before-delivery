export type PlacementKind = 'door' | 'box' | 'cylinder' | 'prop';
export type NodeKind = 'puzzle' | 'lock' | 'cue' | 'exit';
export type SessionState = 'scheduled' | 'lobby' | 'running' | 'ended' | 'cancelled';
export type Outcome = 'escaped' | 'timed_out' | 'stopped';
export type VersionState = 'frozen' | 'superseded';
export type EmailStatus = 'sent' | 'queued' | 'failed';

export type ChainFigures = { solved: number; total: number; longestRun: number; props: number };

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'owner' | 'co_designer';
}
export interface Workspace {
  id: string;
  name: string;
}
export interface Me {
  user: User;
  workspace: Workspace;
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

export interface LockInfo {
  targetType: 'placement' | 'node';
  targetId: string;
  holder: { userId: string; displayName: string };
  expiresInSeconds: number;
}

export interface Version {
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

export interface TesterRef {
  inviteId: string;
  email: string;
  displayName: string;
  joined: boolean;
  emailStatus: EmailStatus;
}

export interface SolveEntry {
  nodeId: string;
  title: string;
  elapsedSeconds: number;
  solvedBy: string | null;
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
  solves: SolveEntry[];
  stats: ChainFigures;
  testers: TesterRef[];
}

export interface Invite {
  id: string;
  email: string;
  emailStatus: EmailStatus;
  joinUrl: string;
}

export interface Hint {
  text: string;
  sentAt: string;
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

export interface PlayPage {
  session: {
    state: SessionState;
    startsAt: string;
    remainingSeconds: number;
    hintCooldownSeconds: number;
    durationSeconds: number;
    serverTime: string;
    outcome: Outcome | null;
  };
  room: { name: string; widthMm: number; depthMm: number; heightMm: number; placements: Placement[] };
  nodes: PlayNode[];
  testers: Array<{ displayName: string; joined: boolean }>;
  me: { displayName: string; joined: boolean };
  hints: Hint[];
}

export interface LengthVal { mm: number; m: string; ft: string }

export interface PackPage {
  version: { number: number; label: string; state: VersionState; frozenAt: string; supersededBy: number | null };
  room: { name: string; width: LengthVal; depth: LengthVal; height: LengthVal };
  placements: Array<{
    id: string;
    kind: PlacementKind;
    label: string;
    propId: string | null;
    entry: boolean;
    x: LengthVal; y: LengthVal; z: LengthVal;
    width: LengthVal; depth: LengthVal; height: LengthVal;
    rotationDeg: number;
  }>;
  nodes: Array<{ title: string; kind: NodeKind; needs: string[]; linkedPlacement: string | null; answer: string | null }>;
  props: Array<{ id: string; name: string; bytes: number; sha256: string; downloadPath: string }>;
  stats: ChainFigures;
}

export interface Debrief {
  outcome: Outcome;
  elapsedSeconds: number;
  stats: ChainFigures;
  puzzles: Array<{ title: string; solvedAtSeconds: number | null; waitSeconds: number | null }>;
  hintsUsed: number;
  chokePoint: { title: string; waitSeconds: number } | null;
  emailStatus: EmailStatus;
}
