import { useSyncExternalStore } from 'react';
import type { Account, BlockEntry, Config, Conversation } from '../../shared/types';
import type { LocalLetter, PeerProfile } from '../types';

export interface Toast {
  id: number;
  conversationId: string;
  text: string;
}

interface Snackbar {
  letterId: string;
  conversationId: string;
}

interface Update {
  id: number;
  text: string;
}

interface AppState {
  auth: 'loading' | 'anonymous' | 'signed_in' | 'revoked';
  config: Config | null;
  me: Account | null;
  conversations: Record<string, Conversation>;
  conversationsLoaded: boolean;
  letters: Record<string, LocalLetter>;
  /** Letters hidden by Delete for me while the undo window is open. */
  hidden: Record<string, true>;
  profiles: Record<string, PeerProfile>;
  myProfile: PeerProfile | null;
  blocks: BlockEntry[];
  blocksLoaded: boolean;
  /** The Connecting bar is showing. */
  connecting: boolean;
  /** Held letters being collected, while the Updating bar shows. */
  updating: number | null;
  outage: boolean;
  toasts: Toast[];
  snackbar: Snackbar | null;
  updates: Update[];
  /** The current path, so store modules know which conversation is open on screen. */
  route: string;
}

const initialState: AppState = {
  auth: 'loading',
  config: null,
  me: null,
  conversations: {},
  conversationsLoaded: false,
  letters: {},
  hidden: {},
  profiles: {},
  myProfile: null,
  blocks: [],
  blocksLoaded: false,
  connecting: false,
  updating: null,
  outage: false,
  toasts: [],
  snackbar: null,
  updates: [],
  route: typeof location === 'undefined' ? '/' : location.pathname,
};

let state: AppState = initialState;
const listeners = new Set<() => void>();

export const getState = (): AppState => state;

export function setState(change: Partial<AppState> | ((current: AppState) => Partial<AppState>)): void {
  state = { ...state, ...(typeof change === 'function' ? change(state) : change) };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore<T>(select: (current: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

let updateSerial = 0;

/** A polite announcement in the Letter updates region; the region keeps the latest few. */
export function announce(text: string): void {
  updateSerial += 1;
  const entry: Update = { id: updateSerial, text };
  setState((current) => ({ updates: [...current.updates, entry].slice(-4) }));
}
