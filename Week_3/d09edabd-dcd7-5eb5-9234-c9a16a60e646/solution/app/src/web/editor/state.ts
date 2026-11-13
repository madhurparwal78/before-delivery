import { useSyncExternalStore } from 'react';
import type { Debrief, Lock, LockHolder, Placement, Prop, Room, Session, TriggerNode, User, Version } from '../../shared/types';
import type { Units } from '../../shared/units';
import type { Marker } from '../three/roomView';
import type { CameraLabel, Mode, PlacementFields, QueuedChange } from './model';

export type DialogName = 'picker' | 'newRoom' | 'graph' | 'props' | 'versions' | 'playtests' | 'debrief' | 'shortcuts' | 'locked' | 'palette' | 'scene';

interface CameraState {
  target: 'overview' | 'eye';
  yaw: number;
  pitch: number;
  zoom: number;
  label: CameraLabel;
  /** Bumps when a new walk-in or return is requested. */
  nonce: number;
}

/** A lock as the editor knows it; `until` is page time (performance.now) at which it lapses. */
export type LockEntry = Lock & { until: number };

export interface LockedPrompt {
  placementId: string;
  label: string;
  holder: LockHolder;
  field: Partial<PlacementFields>;
}

interface EditorState {
  me: User | null;
  workspaceName: string;
  rooms: Room[];
  roomsLoaded: boolean;
  /** Card thumbnails rendered in this browser, by room id (data URLs). */
  liveThumbs: Record<string, string>;
  roomId: string | null;
  room: Room | null;
  placements: Placement[];
  nodes: TriggerNode[];
  sceneOrder: string[];
  queue: QueuedChange[];
  offline: boolean;
  preview: { id: string; fields: Partial<PlacementFields> } | null;
  selectedId: string | null;
  selectedNodeId: string | null;
  mode: Mode;
  locks: Record<string, LockEntry>;
  members: LockHolder[];
  live: boolean;
  storageUp: boolean;
  session: Session | null;
  sessions: Session[];
  latestSession: Session | null;
  testers: Marker[];
  versions: Version[];
  props: Prop[];
  propsLoaded: boolean;
  units: Units;
  walkIn: boolean;
  cam: CameraState;
  dialogs: Partial<Record<DialogName, boolean>>;
  highlightRoomId: string | null;
  lockedPrompt: LockedPrompt | null;
  debrief: { session: Session; detail: Debrief | null } | null;
  status: { text: string; nonce: number };
  cuesOpen: boolean;
  webgl: boolean;
  /** The selected placement's drop in progress: steps run and current height. */
  drop: { id: string; steps: number; yMm: number } | null;
  /** The last drop's final step count, kept on the Scene item until the next drop. */
  dropSteps: Record<string, number>;
}

const read = (key: string, fallback: string): string => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

const initialState = (): EditorState => ({
  me: null, workspaceName: '', rooms: [], roomsLoaded: false, liveThumbs: {}, roomId: null, room: null, placements: [], nodes: [], sceneOrder: [], queue: [], offline: false,
  preview: null, selectedId: null, selectedNodeId: null, mode: 'move', locks: {}, members: [], live: true, storageUp: true, session: null, sessions: [], latestSession: null, testers: [],
  versions: [], props: [], propsLoaded: false, units: read('kb-units', 'm') === 'ft' ? 'ft' : 'm', walkIn: read('kb-walk-in', 'true') !== 'false',
  cam: { target: 'overview', yaw: 30, pitch: 35, zoom: 1, label: 'Overview', nonce: 0 }, dialogs: {}, highlightRoomId: null, lockedPrompt: null, debrief: null,
  status: { text: '', nonce: 0 }, cuesOpen: false, webgl: true, drop: null, dropSteps: {},
});

type Listener = () => void;

class EditorStore {
  private state = initialState();
  private readonly listeners = new Set<Listener>();

  get(): EditorState {
    return this.state;
  }

  set(patch: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)): void {
    this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) };
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  reset(): void {
    this.state = initialState();
  }
}

export const editor = new EditorStore();

/** Subscribes a component to a slice of the editor state. */
export function useEditor<T>(select: (state: EditorState) => T): T {
  return useSyncExternalStore(editor.subscribe, () => select(editor.get()));
}

/** Announces a message in Editor status; each new message replaces the previous one. */
export function say(text: string): void {
  editor.set((s) => ({ status: { text, nonce: s.status.nonce + 1 } }));
}

export function openDialog(name: DialogName): void {
  editor.set((s) => ({ dialogs: { ...s.dialogs, [name]: true } }));
}

export function closeDialog(name: DialogName): void {
  editor.set((s) => ({ dialogs: { ...s.dialogs, [name]: false } }));
}
