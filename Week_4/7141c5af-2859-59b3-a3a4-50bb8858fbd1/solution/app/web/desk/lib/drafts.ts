import { currentAddress } from "./router.tsx";

const KEY = "semenza-draft";

/** What an ended session keeps: the address, the open dialog and what was typed in it. */
export interface Draft {
  address: string;
  dialog: string;
  values: Record<string, string>;
}

const openForms = new Map<string, () => Record<string, string>>();

export function trackForm(dialog: string, values: () => Record<string, string>): () => void {
  openForms.set(dialog, values);
  return () => void openForms.delete(dialog);
}

/** Written as the session ends: the only copy that survives the trip through sign-in. */
export function keepDrafts(): void {
  for (const [dialog, values] of openForms) {
    const draft: Draft = { address: currentAddress(), dialog, values: values() };
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  }
}

/** The kept draft for this dialog on this address, taken once. */
export function draftFor(dialog: string): Draft | null {
  const text = sessionStorage.getItem(KEY);
  if (!text) return null;
  const draft = JSON.parse(text) as Draft;
  if (draft.address !== currentAddress() || draft.dialog !== dialog) return null;
  sessionStorage.removeItem(KEY);
  return draft;
}
