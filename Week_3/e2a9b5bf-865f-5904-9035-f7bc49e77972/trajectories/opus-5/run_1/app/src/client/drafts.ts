import type { FieldSnapshot } from './field.js';
import { get, put, remove, STORE_DRAFTS } from './idb.js';
import { appState } from './state.js';

/** Unsaved form values, marks and the undo stack, per account and observation. */
export interface Draft {
  account_id: string;
  subject: string;
  fields: Record<string, string>;
  snapshot: FieldSnapshot | null;
}

export function newObservationKey(sessionId: string): string {
  return `new:${sessionId}`;
}

function draftKey(subject: string): string | null {
  const account = appState().account;
  return account ? `${account.id}:${subject}` : null;
}

export async function saveDraft(
  subject: string,
  fields: Record<string, string>,
  snapshot: FieldSnapshot | null,
): Promise<void> {
  const key = draftKey(subject);
  const account = appState().account;
  if (!key || !account) return;
  const draft: Draft = { account_id: account.id, subject, fields, snapshot };
  await put(STORE_DRAFTS, draft, key).catch(() => undefined);
}

export async function readDraft(subject: string): Promise<Draft | null> {
  const key = draftKey(subject);
  if (!key) return null;
  const found = await get<Draft>(STORE_DRAFTS, key).catch(() => undefined);
  return found ?? null;
}

export async function dropDraft(subject: string): Promise<void> {
  const key = draftKey(subject);
  if (!key) return;
  await remove(STORE_DRAFTS, key).catch(() => undefined);
}
