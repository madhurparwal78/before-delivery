// The small shared stores: the address, the one live region, and what an ended session must bring back.
import { useSyncExternalStore } from "react";
import { SESSION_ENDED_COPY } from "../shared/catalog";

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: (): T => value,
    set: (next: T): void => {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const address = store(window.location.pathname + window.location.search);
window.addEventListener("popstate", () => address.set(window.location.pathname + window.location.search));

export function useAddress(): URL {
  return new URL(useSyncExternalStore(address.subscribe, address.get), window.location.origin);
}

export function navigate(path: string, { replace = false } = {}): void {
  if (path === address.get()) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", path);
  address.set(path);
  window.scrollTo(0, 0);
}

/** Changes the address without moving the page, as the rail's filters and the week buttons do. */
export function setQuery(path: string): void {
  if (path === address.get()) return;
  window.history.pushState(null, "", path);
  address.set(path);
}

interface Announcement {
  text: string;
  signIn: boolean;
}

const announcement = store<Announcement>({ text: "", signIn: false });

export const useAnnouncement = (): Announcement => useSyncExternalStore(announcement.subscribe, announcement.get);
export const announce = (text: string): void => announcement.set({ text, signIn: false });
export const announceSessionEnded = (): void => announcement.set({ text: SESSION_ENDED_COPY, signIn: true });

interface OpenForm {
  dialog: string;
  values: Record<string, string>;
}

const RESTORE_KEY = "ourlet-restore";
let openForm: OpenForm | null = null;
let restored: (OpenForm & { path: string }) | null = null;

export const noteOpenForm = (form: OpenForm | null): void => {
  openForm = form;
};

/** Called as the staff member leaves for the sign-in page. */
export function rememberPlace(): void {
  window.sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ path: address.get(), dialog: openForm?.dialog ?? "", values: openForm?.values ?? {} }));
}

/** Called after signing in: the address to return to, with the dialog to reopen, if a session ended on the way here. */
export function recallPlace(): string | null {
  const saved = window.sessionStorage.getItem(RESTORE_KEY);
  if (!saved) return null;
  window.sessionStorage.removeItem(RESTORE_KEY);
  restored = JSON.parse(saved) as OpenForm & { path: string };
  return restored.path;
}

export const dialogWasRestored = (dialog: string): boolean => restored?.dialog === dialog;

export function takeRestoredValues(dialog: string): Record<string, string> {
  if (restored?.dialog !== dialog) return {};
  const { values } = restored;
  restored = null;
  return values;
}

let headingAwaited = false;

/** Moves focus to the screen's level-1 heading, now if it is on the page, or as soon as the next screen shows it. */
export function focusHeading({ afterNavigation = false } = {}): void {
  const heading = document.querySelector("h1");
  if (heading && !afterNavigation) heading.focus();
  else headingAwaited = true;
}

export function takeHeadingFocus(): boolean {
  const awaited = headingAwaited;
  headingAwaited = false;
  return awaited;
}

export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
