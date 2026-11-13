/**
 * DP-56: when the server ends a session while a dialog is open, the dialog stays as typed
 * and signing in again returns to the same address with the same dialog open and its
 * typed values.
 */

const STORAGE_KEY = 'ourlet.resume';

export interface Resume {
  href: string;
  dialog: string;
  values: Record<string, string>;
}

let open: { dialog: string; values: Record<string, string> } | null = null;
let pending: Resume | null = null;

/** The dialog on screen keeps its typed values here while it is open. */
export function holdDialog(dialog: string, values: Record<string, string>): void {
  open = { dialog, values };
}

export function dropDialog(dialog: string): void {
  if (open?.dialog === dialog) open = null;
}

/** Writes down where to come back to when a request answers 401 `session_ended`. */
export function rememberForSignIn(href: string): void {
  const resume: Resume = {
    href,
    dialog: open?.dialog ?? '',
    values: open?.values ?? {},
  };
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(resume));
}

export function takeRemembered(): Resume | null {
  const stored = window.sessionStorage.getItem(STORAGE_KEY);
  if (stored === null) return null;
  window.sessionStorage.removeItem(STORAGE_KEY);
  try {
    pending = JSON.parse(stored) as Resume;
    return pending;
  } catch {
    return null;
  }
}

/** A screen asks once whether it should reopen a dialog with its typed values. */
export function claimResume(dialog: string): Record<string, string> | null {
  if (pending === null || pending.dialog !== dialog) return null;
  const { values } = pending;
  pending = null;
  return values;
}
