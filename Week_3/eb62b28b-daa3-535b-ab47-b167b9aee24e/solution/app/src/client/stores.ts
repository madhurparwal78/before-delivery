// Small shared stores: the address, the session, Announcements, the open dialog and what was typed.

import { useSyncExternalStore } from "react";
import type { SessionView } from "../shared/api";

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: (): T => value,
    set(next: T): void {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// The address.

interface Address {
  path: string;
  search: string;
}

const readAddress = (): Address => ({ path: window.location.pathname, search: window.location.search });
const addressStore = createStore<Address>(readAddress());

window.addEventListener("popstate", () => addressStore.set(readAddress()));

export const useAddress = (): Address => useSyncExternalStore(addressStore.subscribe, addressStore.get);

let headingFocusWanted = false;

export function takeHeadingFocus(): boolean {
  const wanted = headingFocusWanted;
  headingFocusWanted = false;
  return wanted;
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  headingFocusWanted = true;
  window.scrollTo({ top: 0, behavior: "instant" });
  addressStore.set(readAddress());
}

// A history entry on the current screen, such as the catalog's search and open categories.
export function pushSearch(search: string): void {
  window.history.pushState(null, "", `${window.location.pathname}${search}`);
  addressStore.set(readAddress());
}

// The session.

type SessionState = { kind: "loading" } | { kind: "none" } | { kind: "live"; view: SessionView };

const sessionStore = createStore<SessionState>({ kind: "loading" });
export const setSession = sessionStore.set;
export const useSession = (): SessionState => useSyncExternalStore(sessionStore.subscribe, sessionStore.get);

// Announcements.

interface Announcement {
  text: string;
  signInAgain: boolean;
}

const announcementStore = createStore<Announcement>({ text: "", signInAgain: false });
export const useAnnouncement = (): Announcement => useSyncExternalStore(announcementStore.subscribe, announcementStore.get);

export function announce(text: string): void {
  announcementStore.set({ text, signInAgain: announcementStore.get().signInAgain });
}

// The dialog, and where its opener is. The page behind is inert while one is open, and usable the moment it closes.

interface OpenDialog {
  id: string;
  opener: HTMLElement | null;
}

const dialogStore = createStore<OpenDialog | null>(null);
const closingDialogs = new Set<string>();

function setPageInert(inert: boolean): void {
  const page = document.getElementById("app");
  if (page) page.inert = inert;
}

export const useOpenDialogId = (): string | null =>
  useSyncExternalStore(dialogStore.subscribe, () => dialogStore.get()?.id ?? null);

export function openDialog(id: string, opener: HTMLElement | null): void {
  if (!closingDialogs.has(id)) clearForm(id);
  setPageInert(true);
  dialogStore.set({ id, opener });
}

export function focusHeading(): void {
  document.querySelector<HTMLElement>("h1")?.focus({ preventScroll: false });
}

function isUsable(element: HTMLElement): boolean {
  return element.isConnected && !element.matches(":disabled, [aria-disabled='true']") && element.getClientRects().length > 0;
}

export function closeDialog(): void {
  const open = dialogStore.get();
  if (!open) return;
  setPageInert(false);
  dialogStore.set(null);
  if (open.opener && isUsable(open.opener)) open.opener.focus();
  else focusHeading();
}

export function markClosing(id: string, closing: boolean): void {
  if (closing) closingDialogs.add(id);
  else closingDialogs.delete(id);
}

// What was typed, kept across refreshes and across signing in again.

const formStore = createStore(0);
const typed = new Map<string, Map<string, string>>();

function formValues(form: string): Map<string, string> {
  const known = typed.get(form);
  if (known) return known;
  const made = new Map<string, string>();
  typed.set(form, made);
  return made;
}

export function seedForm(form: string, values: Readonly<Record<string, string>>): void {
  const known = formValues(form);
  for (const [name, value] of Object.entries(values)) {
    if (!known.has(name)) known.set(name, value);
  }
}

export function readField(form: string, name: string): string {
  return typed.get(form)?.get(name) ?? "";
}

export function writeField(form: string, name: string, value: string): void {
  formValues(form).set(name, value);
  formStore.set(formStore.get() + 1);
}

export function clearForm(form: string): void {
  typed.delete(form);
  formStore.set(formStore.get() + 1);
}

export const useFormVersion = (): number => useSyncExternalStore(formStore.subscribe, formStore.get);

// A session the server ended. The screen and its typed values stay; signing in again returns to them.

interface Resume {
  address: string;
  dialog: OpenDialog | null;
}

let resume: Resume | null = null;

export function sessionEnded(copy: string): void {
  resume = resume ?? { address: `${window.location.pathname}${window.location.search}`, dialog: dialogStore.get() };
  announcementStore.set({ text: copy, signInAgain: true });
}

export const isSessionEnded = (): boolean => resume !== null;

// Following a link is the person's next action, so what was announced before it goes. A session that ended stays said.
export function clearAnnouncement(): void {
  if (resume === null) announcementStore.set({ text: "", signInAgain: false });
}

export function leaveForSignIn(): void {
  setPageInert(false);
  dialogStore.set(null);
  navigate("/signin");
}

// Back to the same address, with the same dialog open again. `null` when there is nothing to return to.
export function resumeAfterSignIn(): boolean {
  const saved = resume;
  resume = null;
  announcementStore.set({ text: "", signInAgain: false });
  if (!saved) return false;
  navigate(saved.address);
  if (saved.dialog) {
    setPageInert(true);
    dialogStore.set({ id: saved.dialog.id, opener: null });
  }
  return true;
}

export function forgetEverythingTyped(): void {
  typed.clear();
  resume = null;
  announcementStore.set({ text: "", signInAgain: false });
  formStore.set(formStore.get() + 1);
}
