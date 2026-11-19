/**
 * The draft a screen keeps for this browser tab when a write is refused because
 * the session ended, so signing in again brings the typed work back.
 */
export interface ScreenDraft {
  readonly path: string;
  readonly email: string;
  readonly fields: Record<string, string>;
  readonly hourRows: Record<string, { open: boolean; opens: string; closes: string }>;
  readonly waiverReason: string | null;
  readonly selectedLoanId: number | null;
  readonly selectedItemId: number | null;
}

const KEY = 'pegworth.draft';

export function saveDraft(draft: ScreenDraft): void {
  window.sessionStorage.setItem(KEY, JSON.stringify(draft));
}

export function takeDraft(path: string, email: string): ScreenDraft | null {
  const stored = window.sessionStorage.getItem(KEY);
  if (stored === null) return null;
  window.sessionStorage.removeItem(KEY);
  try {
    const draft = JSON.parse(stored) as ScreenDraft;
    if (draft.path !== path || draft.email !== email) return null;
    return draft;
  } catch {
    return null;
  }
}
