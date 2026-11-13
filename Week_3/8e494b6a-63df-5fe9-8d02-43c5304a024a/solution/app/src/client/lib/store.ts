// A small external store: the signed-in profile, live sequence, pending writes, announcements and the ingest line.
import { useSyncExternalStore } from "react";

export interface SpaceInfo {
  slug: string;
  name: string;
  role: "viewer" | "editor" | "admin";
}

export interface Me {
  username: string;
  time_zone: string;
  space: SpaceInfo;
  spaces: SpaceInfo[];
  seq: number;
}

export interface AppState {
  me: Me | null;
  loaded: boolean;
  seq: number;
  pending: number;
  announcement: string;
  serverNowMs: number | null;
  ingest: { stored: number; failed: number } | null;
  spaceVersion: number;
  settings: { page_size: number; tail_buffer: number; query_max_len: number; query_max_depth: number; upload_max_bytes: number; sse_heartbeat_ms: number } | null;
}

let state: AppState = {
  me: null, loaded: false, seq: 0, pending: 0, announcement: "", serverNowMs: null, ingest: null, spaceVersion: 0, settings: null,
};
const listeners = new Set<() => void>();

export function update(change: Partial<AppState> | ((current: AppState) => Partial<AppState>)): void {
  state = { ...state, ...(typeof change === "function" ? change(state) : change) };
  for (const listener of listeners) listener();
}

export function useAppState<T>(select: (current: AppState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => select(state),
  );
}

let toggle = false;

/** Writes to the polite `status "Announcements"` strip; the same sentence twice still reads again. */
export function announce(sentence: string): void {
  toggle = !toggle;
  update({ announcement: toggle ? sentence : `${sentence}​` });
}
