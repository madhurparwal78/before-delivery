import { useSyncExternalStore } from "react";
import type { ClockView, Me, ServiceView } from "../shared/types";

interface AppState {
  /** `undefined` until the first answer from the server, `null` when signed out. */
  me: Me | null | undefined;
  clock: ClockView | null;
  services: ServiceView;
}

let state: AppState = { me: undefined, clock: null, services: { mail: true, pdf: true } };
const listeners = new Set<() => void>();

export function setApp(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function useApp<T>(select: (current: AppState) => T): T {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => select(state));
}
