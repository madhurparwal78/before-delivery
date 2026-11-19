import { useSyncExternalStore } from "react";
import { isRecord } from "../../shared/guards";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a navigation remembers: the page behind an opened pin and the card it came from. */
interface NavState {
  background?: { pathname: string; search: string };
  cardId?: number;
}

export interface Location {
  pathname: string;
  search: string;
  state: NavState | null;
}

/** The grid rectangle of the image being carried, set by the card that opens a pin and consumed by the exhibit. */
let pendingCarry: Rect | null = null;
export const setPendingCarry = (rect: Rect | null): void => {
  pendingCarry = rect;
};
export const takePendingCarry = (): Rect | null => {
  const rect = pendingCarry;
  pendingCarry = null;
  return rect;
};

history.scrollRestoration = "manual";

const isNavState = (value: unknown): value is NavState => isRecord(value);
const read = (): Location => ({ pathname: window.location.pathname, search: window.location.search, state: isNavState(history.state) ? history.state : null });
let current: Location = read();
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((listener) => listener());

window.addEventListener("popstate", () => {
  current = read();
  emit();
});

export function navigate(to: string, options: { replace?: boolean; state?: NavState } = {}): void {
  const previous = current;
  if (options.replace) history.replaceState(options.state ?? null, "", to);
  else history.pushState(options.state ?? null, "", to);
  current = read();
  if (current.pathname !== previous.pathname && !options.state?.background) window.scrollTo(0, 0);
  emit();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useLocation = (): Location => useSyncExternalStore(subscribe, () => current);

export function params(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

/** Only same-site paths are followed after sign-in. */
export function safeNext(value: string | null): string {
  return value !== null && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
}
