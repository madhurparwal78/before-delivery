// The unsaved doc edit that outlives a lost session: kept in this tab's session storage and handed
// back only to the person who wrote it.
const KEY = "tr_doc_draft";

interface DocDraft {
  doc_id: string;
  person_id: string;
  title: string;
  body: string;
  base_version: number;
}

let unsaved: (() => DocDraft | null) | null = null;

/** The open editor reports its unsaved edit through `read`; the returned function stops that. */
export function trackUnsaved(read: () => DocDraft | null): () => void {
  unsaved = read;
  return () => {
    if (unsaved === read) unsaved = null;
  };
}

/** Stores the open editor's unsaved edit, if any, and returns its doc id. */
export function keepUnsaved(): string | null {
  const draft = unsaved?.() ?? null;
  if (!draft) return null;
  sessionStorage.setItem(KEY, JSON.stringify(draft));
  return draft.doc_id;
}

export function dropDraft(): void {
  unsaved = null;
  sessionStorage.removeItem(KEY);
}

function stored(): DocDraft | null {
  const text = sessionStorage.getItem(KEY);
  return text ? (JSON.parse(text) as DocDraft) : null;
}

/** A different person signing in on this tab never sees the draft. */
export function settleDraftOwner(personId: string): void {
  if (stored() && stored()?.person_id !== personId) sessionStorage.removeItem(KEY);
}

export function draftFor(docId: string, personId: string): DocDraft | null {
  settleDraftOwner(personId);
  const draft = stored();
  return draft?.doc_id === docId ? draft : null;
}
