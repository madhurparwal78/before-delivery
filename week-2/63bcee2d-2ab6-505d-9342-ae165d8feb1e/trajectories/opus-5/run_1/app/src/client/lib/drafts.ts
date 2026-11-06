/**
 * Typed input kept across an ended session. A form's values are saved for that
 * member and form, then put back once the same member signs in again.
 */

export type DraftValues = Record<string, unknown>;

function draftKey(memberId: string, formKey: string): string {
  return `plumbline.draft.${memberId}.${formKey}`;
}

function restoreKey(memberId: string): string {
  return `plumbline.restore.${memberId}`;
}

export interface PendingRestore {
  formKey: string;
  path: string;
}

export function saveDraft(memberId: string, formKey: string, values: DraftValues): void {
  window.localStorage.setItem(draftKey(memberId, formKey), JSON.stringify(values));
}

export function readDraft(memberId: string, formKey: string): DraftValues | null {
  const stored = window.localStorage.getItem(draftKey(memberId, formKey));
  if (!stored) return null;
  try {
    return JSON.parse(stored) as DraftValues;
  } catch {
    return null;
  }
}

export function clearDraft(memberId: string, formKey: string): void {
  window.localStorage.removeItem(draftKey(memberId, formKey));
}

export function markPendingRestore(memberId: string, restore: PendingRestore): void {
  window.localStorage.setItem(restoreKey(memberId), JSON.stringify(restore));
}

export function takePendingRestore(memberId: string): PendingRestore | null {
  const stored = window.localStorage.getItem(restoreKey(memberId));
  if (!stored) return null;
  window.localStorage.removeItem(restoreKey(memberId));
  try {
    return JSON.parse(stored) as PendingRestore;
  } catch {
    return null;
  }
}

/** Everything unsaved goes when a member's access is removed. */
export function discardAllDrafts(memberId: string): void {
  const prefix = `plumbline.draft.${memberId}.`;
  const doomed: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key && key.startsWith(prefix)) doomed.push(key);
  }
  for (const key of doomed) window.localStorage.removeItem(key);
  window.localStorage.removeItem(restoreKey(memberId));
}

const ENQUIRY_DRAFT = 'plumbline.enquiry';

export function saveEnquiryDraft(values: DraftValues): void {
  window.sessionStorage.setItem(ENQUIRY_DRAFT, JSON.stringify(values));
}

export function readEnquiryDraft(): DraftValues | null {
  const stored = window.sessionStorage.getItem(ENQUIRY_DRAFT);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as DraftValues;
  } catch {
    return null;
  }
}

export function clearEnquiryDraft(): void {
  window.sessionStorage.removeItem(ENQUIRY_DRAFT);
}
