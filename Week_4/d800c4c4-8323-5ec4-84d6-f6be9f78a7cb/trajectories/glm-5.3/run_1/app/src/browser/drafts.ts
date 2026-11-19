// The session-ended draft: kept in session storage per browser tab, labelled with the
// screen path and the signed-in user, and restored once after a successful sign-in.

export interface Draft {
  fields: Record<string, string>;
  editedHours: Record<string, { open: boolean; opens: string; closes: string }>;
  selectedLoanId: number | null;
  selectedItemId: number | null;
  waiverReason: string | null;
}

export function draftKey(path: string, userId: number | null): string {
  return `pegworth-draft:${path}:${userId ?? 'anon'}`;
}

export function saveDraft(path: string, userId: number | null, draft: Draft): void {
  try {
    sessionStorage.setItem(draftKey(path, userId), JSON.stringify(draft));
  } catch {
    // session storage may be full; the draft is best-effort
  }
}

export function loadDraft(path: string, userId: number | null): Draft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(path, userId));
    if (raw === null) return null;
    return JSON.parse(raw) as Draft;
  } catch {
    return null;
  }
}

export function clearDraft(path: string, userId: number | null): void {
  try {
    sessionStorage.removeItem(draftKey(path, userId));
  } catch {
    // ignore
  }
}

/** Delete any draft written by a different user or on another path. */
export function clearOtherDrafts(userId: number): void {
  try {
    const keys = Object.keys(sessionStorage);
    for (const key of keys) {
      if (!key.startsWith('pegworth-draft:')) continue;
      const suffix = key.split(':');
      const user = suffix[2];
      if (user !== String(userId)) sessionStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

export function emptyDraft(): Draft {
  return { fields: {}, editedHours: {}, selectedLoanId: null, selectedItemId: null, waiverReason: null };
}
