import type {
  Placement,
  PlaytestSession,
  Prop,
  Room,
  RoomVersion,
  SessionUser,
  TriggerNode,
  Workspace,
} from '../../../shared/types.js';
import type { SaveQueue } from '../../queue.js';
import type { RoomStage } from '../../stage/stage.js';

export type Mode = 'move' | 'rotate' | 'scale';

export interface DialogHandle {
  name: string;
  element: HTMLElement;
  scrim: HTMLElement;
  opener: HTMLElement | null;
  onClose?: () => void;
}

export interface EditorState {
  me: SessionUser | null;
  workspace: Workspace | null;
  rooms: Room[];
  roomDetails: Map<string, { room: Room; placements: Placement[] }>;
  room: Room | null;
  placements: Placement[];
  nodes: TriggerNode[];
  sceneOrder: string[];
  props: Prop[];
  versions: RoomVersion[];
  sessions: PlaytestSession[];
  activeSession: PlaytestSession | null;
  latestSessionId: string | null;
  selectedPlacement: string | null;
  selectedNode: string | null;
  holders: Map<string, string>;
  mode: Mode;
  liveAvailable: boolean;
  storageAvailable: boolean;
  presence: { userId: string; displayName: string }[];
  simSteps: Map<string, number>;
  queue: SaveQueue | null;
  stage: RoomStage | null;
}

export const state: EditorState = {
  me: null,
  workspace: null,
  rooms: [],
  roomDetails: new Map(),
  room: null,
  placements: [],
  nodes: [],
  sceneOrder: [],
  props: [],
  versions: [],
  sessions: [],
  activeSession: null,
  latestSessionId: null,
  selectedPlacement: null,
  selectedNode: null,
  holders: new Map(),
  mode: 'move',
  liveAvailable: true,
  storageAvailable: true,
  presence: [],
  simSteps: new Map(),
  queue: null,
  stage: null,
};

/** What the sheets and the picker ask the editor shell to do. */
export interface EditorHooks {
  announce(text: string): void;
  paint(): void;
  reloadRoom(): Promise<void>;
  reloadRooms(): Promise<void>;
  closeDialog(): void;
  openGraph(opener: HTMLElement | null): void;
  openLibrary(opener: HTMLElement | null, focusFile: boolean): void;
  openVersions(opener: HTMLElement | null, focusLabel: boolean): void;
  openShortcuts(opener: HTMLElement | null): void;
  openNewRoom(opener: HTMLElement | null): void;
  selectNode(nodeId: string | null): void;
  openRoom(roomId: string, walkIn: boolean): Promise<void>;
  startStop(): void;
}

export const hooks: EditorHooks = {
  announce: () => undefined,
  paint: () => undefined,
  reloadRoom: async () => undefined,
  reloadRooms: async () => undefined,
  closeDialog: () => undefined,
  openGraph: () => undefined,
  openLibrary: () => undefined,
  openVersions: () => undefined,
  openShortcuts: () => undefined,
  openNewRoom: () => undefined,
  selectNode: () => undefined,
  openRoom: async () => undefined,
  startStop: () => undefined,
};

export function isOwner(): boolean {
  return state.me?.role === 'owner';
}

export function controlsSession(session: PlaytestSession | null): boolean {
  if (!session || !state.me) return false;
  return state.me.role === 'owner' || session.hostUserId === state.me.id;
}

export function targetSession(): PlaytestSession | null {
  const live = state.sessions.find(
    (session) => session.state === 'lobby' || session.state === 'running',
  );
  if (live) return live;
  const scheduled = state.sessions
    .filter((session) => session.state === 'scheduled')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return scheduled[0] ?? null;
}

export function walkInPreference(): boolean {
  return window.localStorage.getItem('kb-walk-in') !== 'false';
}

export function setWalkInPreference(value: boolean): void {
  window.localStorage.setItem('kb-walk-in', value ? 'true' : 'false');
}
