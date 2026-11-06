/** What a member typed, kept in the browser for this tab when a session ends. */

const KEY = 'lanternline.draft';

export interface Draft {
  readonly route: string;
  readonly dialog: string | null;
  readonly fields: Readonly<Record<string, string>>;
}

export function saveDraft(draft: Draft): void {
  window.sessionStorage.setItem(KEY, JSON.stringify(draft));
}

export function readDraft(route: string): Draft | null {
  const stored = window.sessionStorage.getItem(KEY);
  if (stored === null) return null;
  const draft = JSON.parse(stored) as Draft;
  return draft.route === route ? draft : null;
}

export function pendingDraft(): Draft | null {
  const stored = window.sessionStorage.getItem(KEY);
  return stored === null ? null : (JSON.parse(stored) as Draft);
}

export function clearDraft(): void {
  window.sessionStorage.removeItem(KEY);
}
