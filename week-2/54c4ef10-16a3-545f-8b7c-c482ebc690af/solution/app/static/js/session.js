// The signed-in account, the unsent-draft memory and sign-out.
import { get } from './api.js';

export const session = { account: null };
const DRAFT_KEY = 'edgeprint-draft';

export async function loadSession() {
  const response = await get('/api/me', { keep401: true });
  session.account = response.ok ? response.data : null;
  return session.account;
}

export function saveDraft(draft) {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, accountId: session.account?.id }));
}

/** The kept draft when it belongs to the signed-in account; any other account starts clean. */
export function takeDraft(kind) {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  const draft = JSON.parse(raw);
  if (draft.accountId !== session.account?.id) {
    sessionStorage.removeItem(DRAFT_KEY);
    return null;
  }
  if (draft.kind !== kind) return null;
  sessionStorage.removeItem(DRAFT_KEY);
  return draft;
}

export function discardDraft() {
  sessionStorage.removeItem(DRAFT_KEY);
}
