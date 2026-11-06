// What a member typed, kept in this tab when the session ends, and put back in the same dialog after sign-in.
import { useEffect } from "preact/hooks";

const KEY = "lanternline.draft";

interface Draft {
  path: string;
  dialog: string;
  fields: Record<string, string>;
}

const open = new Map<string, () => Record<string, string>>();

/** Registers an open form so its fields can be kept if the session ends while it is open. */
export function useDraftSource(dialog: string, read: () => Record<string, string>, active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    open.set(dialog, read);
    return () => {
      open.delete(dialog);
    };
  });
}

export function saveDrafts(): void {
  const [entry] = [...open.entries()];
  if (!entry) return;
  const draft: Draft = { path: location.pathname + location.search, dialog: entry[0], fields: entry[1]() };
  sessionStorage.setItem(KEY, JSON.stringify(draft));
}

function kept(): Draft | null {
  const raw = sessionStorage.getItem(KEY);
  const draft = raw ? (JSON.parse(raw) as Draft) : null;
  return draft && draft.path === location.pathname + location.search ? draft : null;
}

/** The dialog a kept draft belongs to on this route, so the screen can reopen it. */
export function pendingDraft(): string | null {
  return kept()?.dialog ?? null;
}

/** The kept draft for this route and dialog, removed once taken. */
export function takeDraft(dialog: string): Record<string, string> | null {
  const draft = kept();
  if (!draft || draft.dialog !== dialog) return null;
  sessionStorage.removeItem(KEY);
  return draft.fields;
}
