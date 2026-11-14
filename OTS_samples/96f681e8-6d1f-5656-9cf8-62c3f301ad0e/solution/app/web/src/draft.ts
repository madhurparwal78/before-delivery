/**
 * The slot dialog draft kept in this tab's session storage when the session ends during Hold slot, Open match or
 * Pay now. It is tagged with the username that was signed in, and only that username ever gets it back.
 */
export interface SlotDraft {
  username: string;
  day: string;
  court: number;
  /** The cell's club start time, HH:MM. */
  time: string;
  minutes: number;
  split: boolean;
  emails: string[];
  note: string;
  openMatch: boolean;
  low: string;
  high: string;
  bookingId: string | null;
}

const storageKey = "yardline:slot-draft";

export function saveDraft(draft: SlotDraft): void {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
  } catch {
    // Without session storage the person signs in again and starts the dialog afresh.
  }
}

export function readDraft(): SlotDraft | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as SlotDraft) : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Nothing was kept.
  }
}

/** Removes a draft kept for anyone but `username`, before the page first paints for them. */
export function keepDraftOnlyFor(username: string | null): void {
  const draft = readDraft();
  if (draft && draft.username !== username) clearDraft();
}

/** The Courts address that reopens a cell: `/courts?day=<date>&cell=<n>-<HH:MM>`. */
export function cellPath(day: string, court: number, time: string): string {
  return `/courts?day=${day}&cell=${court}-${time}`;
}

/** Sends the browser to sign-in, returning to `path` (a same-origin path and query) afterwards. */
export function signInReturningTo(path: string): void {
  const login = `/login?return=${encodeURIComponent(path)}`;
  // The address reads the sign-in address at once, then the browser loads it (the server sends it on to Keycloak).
  window.history.replaceState(null, "", login);
  window.location.replace(login);
}

export function currentPath(): string {
  return window.location.pathname + window.location.search;
}
