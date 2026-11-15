import { useEffect, useState } from "preact/hooks";
import type { ClientConfig, User } from "../shared/types";

export interface AppState {
  config: ClientConfig;
  user: User | null;
  accountStatus: string;
}

type Listener = () => void;

let state: AppState = {
  config: { preview_delay_ms: 500, draft_interval_ms: 5000, search_debounce_ms: 250, loop_limit: 100000, pane_limit_bytes: 200000, max_tags: 5, live_poll_ms: 1000 },
  user: null,
  accountStatus: "",
};
const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function useAppState(): AppState {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((tick) => tick + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}

const pendingKey = (userId: string) => `ashlar:verification-pending:${userId}`;

export function markVerificationPending(userId: string, pending: boolean): void {
  if (pending) localStorage.setItem(pendingKey(userId), "1");
  else localStorage.removeItem(pendingKey(userId));
}

export function verificationPending(userId: string): boolean {
  return localStorage.getItem(pendingKey(userId)) === "1";
}

/** Messages handed from one screen to the next, such as the save status after a restore. */
const flashes = new Map<string, string>();

export function setFlash(name: string, message: string): void {
  flashes.set(name, message);
}

export function takeFlash(name: string): string {
  const message = flashes.get(name) ?? "";
  flashes.delete(name);
  return message;
}
