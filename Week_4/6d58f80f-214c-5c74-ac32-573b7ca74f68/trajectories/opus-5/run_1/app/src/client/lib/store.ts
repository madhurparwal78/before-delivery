import { useSyncExternalStore } from 'react';
import type {
  ClockBody,
  Folder,
  Person,
  PushedNotice,
  ServiceStatus,
  StorageTotals,
} from '../../shared/types.js';

export type UploadRowState =
  | 'uploading'
  | 'paused'
  | 'waiting'
  | 'done'
  | 'expired'
  | 'failed';

export interface UploadRow {
  key: string;
  id: string | null;
  name: string;
  size: number;
  contentType: string;
  folderId: string;
  partCount: number;
  confirmedParts: number[];
  state: UploadRowState;
}

export interface GlobalState {
  booted: boolean;
  person: Person | null;
  status: ServiceStatus;
  clock: ClockBody;
  folders: Folder[];
  storage: StorageTotals | null;
  notices: PushedNotice[];
  announcement: { seq: number; text: string } | null;
  uploads: UploadRow[];
}

const initial: GlobalState = {
  booted: false,
  person: null,
  status: { storage: 'up', directory: 'up' },
  clock: { now: new Date().toISOString(), today: '', zone: 'America/Phoenix' },
  folders: [],
  storage: null,
  notices: [],
  announcement: null,
  uploads: [],
};

let state = initial;
const listeners = new Set<() => void>();
let sequence = 0;

const emit = (): void => {
  for (const listener of listeners) listener();
};

export const getState = (): GlobalState => state;

export const setState = (patch: Partial<GlobalState> | ((current: GlobalState) => Partial<GlobalState>)): void => {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  emit();
};

export const useGlobal = <T>(select: (value: GlobalState) => T): T =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => select(state),
  );

/** The one polite region. Every async result passes through here, once each. */
export const announce = (text: string): void => {
  sequence += 1;
  setState({ announcement: { seq: sequence, text } });
};

export const addNotice = (notice: PushedNotice): void => {
  setState((current) => ({ notices: [notice, ...current.notices].slice(0, 5) }));
};

export const dismissNotice = (id: string): void => {
  setState((current) => ({ notices: current.notices.filter((notice) => notice.id !== id) }));
};

export const setUploads = (
  update: (rows: UploadRow[]) => UploadRow[],
): void => {
  setState((current) => ({ uploads: update(current.uploads) }));
};
