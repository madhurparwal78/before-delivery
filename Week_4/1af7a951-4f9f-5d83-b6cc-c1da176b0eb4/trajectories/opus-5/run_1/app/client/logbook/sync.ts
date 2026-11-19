import { api, type Entry } from '../api.js';
import { COPY, syncCopy } from '../copy.js';
import {
  keptEntriesOf,
  keptMemosOf,
  removeKeptEntry,
  removeKeptMemo,
  type KeptEntry,
  type KeptMemo,
} from './keep.js';

export interface SyncListeners {
  readonly syncAnnounce: (text: string) => void;
  readonly memoAnnounce: (text: string) => void;
  readonly entrySaved: (entry: Entry, keptId: string) => void;
  readonly entryRejected: (keptId: string, reason: string) => void;
  readonly entriesChanged: () => Promise<void>;
  readonly unauthorized: () => void;
}

let listeners: SyncListeners | null = null;

export function setSyncListeners(next: SyncListeners): void {
  listeners = next;
}

function entryBody(entry: KeptEntry): Record<string, unknown> {
  return {
    title: entry.title,
    text: entry.text,
    dreams_recalled: entry.dreamsRecalled,
    lucid: entry.lucid,
    wbtb: entry.wbtb,
    technique: entry.technique,
    technique_minutes: entry.techniqueMinutes,
  };
}

export type SendOutcome = 'saved' | 'rejected' | 'kept' | 'unauthorized';

export async function sendKeptEntry(entry: KeptEntry): Promise<SendOutcome> {
  const result = await api.saveEntry(entry.id, entryBody(entry));
  if (result.ok && result.body !== null) {
    removeKeptEntry(entry.id);
    listeners?.entrySaved(result.body.entry, entry.id);
    if (entry.hasMemo) await uploadMemoFor(entry.id, entry.enrollmentId);
    return 'saved';
  }
  if (result.status === 401) {
    listeners?.unauthorized();
    return 'unauthorized';
  }
  if (result.status === 409 || result.status === 422) {
    const reason =
      result.errorCode === 'entry_id_conflict'
        ? COPY.entryConflict
        : result.errorCode === 'cohort_not_started' || result.errorCode === 'cohort_closed'
          ? COPY.cohortNotOpen
          : (Object.values(result.fieldErrors ?? {})[0] ?? COPY.cohortNotOpen);
    listeners?.entryRejected(entry.id, reason);
    return 'rejected';
  }
  return 'kept';
}

export async function uploadKeptMemo(memo: KeptMemo): Promise<void> {
  listeners?.memoAnnounce(COPY.uploadingMemo);
  const result = await api.uploadMemo(memo.entryId, memo.blob, memo.durationMs);
  if (result.ok) {
    await removeKeptMemo(memo.entryId);
    await listeners?.entriesChanged();
    listeners?.memoAnnounce(COPY.memoSaved);
    return;
  }
  if (result.status === 503) {
    listeners?.memoAnnounce(COPY.memoStorageOutage);
    return;
  }
  if (result.errorCode === 'memo_exists') {
    await removeKeptMemo(memo.entryId);
    listeners?.memoAnnounce(`Not saved: ${COPY.memoExists}`);
    return;
  }
  if (result.status === 422) {
    await removeKeptMemo(memo.entryId);
    const reason = Object.values(result.fieldErrors ?? {})[0] ?? '';
    listeners?.memoAnnounce(`Not saved: ${reason}`);
    return;
  }
  listeners?.memoAnnounce(COPY.memoStorageOutage);
}

async function uploadMemoFor(entryId: string, enrollmentId: string): Promise<void> {
  const memos = await keptMemosOf(enrollmentId);
  const memo = memos.find((candidate) => candidate.entryId === entryId);
  if (memo === undefined) return;
  await uploadKeptMemo(memo);
}

export async function syncAttempt(enrollmentId: string): Promise<void> {
  const sendable = keptEntriesOf(enrollmentId).filter((entry) => entry.rejectedReason === null);
  const pendingIds = new Set(keptEntriesOf(enrollmentId).map((entry) => entry.id));
  const memos = (await keptMemosOf(enrollmentId)).filter((memo) => !pendingIds.has(memo.entryId));
  if (sendable.length === 0 && memos.length === 0) return;

  let saved = 0;
  for (const entry of sendable) {
    const outcome = await sendKeptEntry(entry);
    if (outcome === 'saved') saved += 1;
    if (outcome === 'unauthorized') return;
  }
  for (const memo of memos) await uploadKeptMemo(memo);
  listeners?.syncAnnounce(syncCopy(saved, keptEntriesOf(enrollmentId).length));
}
