// Unsent exposures and notes, kept in this tab for the account that typed them.
const KEY = 'edgeprint.draft';

export function saveDraft(draft) {
  sessionStorage.setItem(KEY, JSON.stringify(draft));
}

export function readDraft(accountId) {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  const draft = JSON.parse(raw);
  if (accountId && draft.accountId !== accountId) return null;
  return draft;
}

export function discardDraft() {
  sessionStorage.removeItem(KEY);
}

export function discardDraftForOther(accountId) {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return;
  if (JSON.parse(raw).accountId !== accountId) sessionStorage.removeItem(KEY);
}
