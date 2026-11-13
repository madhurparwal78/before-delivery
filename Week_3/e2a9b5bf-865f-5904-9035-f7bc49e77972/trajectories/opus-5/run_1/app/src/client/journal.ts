import type { SyncChange, SyncChangeKind } from '../shared/types.js';
import { all, put, remove, STORE_JOURNAL } from './idb.js';
import { appState, setWaiting } from './state.js';

/** How a change's result is announced once the server answers it. */
export type ChangeOrigin = 'online_save' | 'queued';

export interface JournalEntry {
  client_op_id: string;
  account_id: string;
  seq: number;
  kind: SyncChangeKind;
  change: SyncChange;
  origin: ChangeOrigin;
  /** Enough to name the change in a sentence without reaching the server. */
  designation: string | null;
  evening_date: string | null;
  observation_id: string | null;
  session_id: string | null;
}

const channel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('lowlamp');

export type JournalMessage =
  | { type: 'journal' }
  | { type: 'copy'; account_id: string }
  | { type: 'account'; account_id: string | null }
  | { type: 'sentences'; account_id: string; sentences: string[] };

const messageListeners = new Set<(message: JournalMessage) => void>();

if (channel) {
  channel.onmessage = (event: MessageEvent<JournalMessage>) => {
    for (const listener of [...messageListeners]) listener(event.data);
  };
}

export function onBroadcast(listener: (message: JournalMessage) => void): void {
  messageListeners.add(listener);
}

export function broadcast(message: JournalMessage): void {
  channel?.postMessage(message);
}

let nextSeq = Date.now();

function allocateSeq(): number {
  nextSeq += 1;
  return nextSeq;
}

let cached: JournalEntry[] = [];

export async function reloadJournal(): Promise<JournalEntry[]> {
  const entries = await all<JournalEntry>(STORE_JOURNAL).catch(() => []);
  const account = appState().account;
  cached = entries
    .filter((entry) => account !== null && entry.account_id === account.id)
    .sort((a, b) => a.seq - b.seq);
  setWaiting(cached.length);
  return cached;
}

export function journalEntries(): JournalEntry[] {
  return cached;
}

export interface EnqueueDetails {
  designation?: string | null;
  evening_date?: string | null;
  observation_id?: string | null;
  session_id?: string | null;
  origin?: ChangeOrigin;
}

export async function enqueue(
  change: SyncChange,
  details: EnqueueDetails = {},
): Promise<JournalEntry> {
  const account = appState().account;
  if (!account) throw new Error('a change always belongs to a signed-in account');
  const entry: JournalEntry = {
    client_op_id: change.client_op_id,
    account_id: account.id,
    seq: allocateSeq(),
    kind: change.kind,
    change,
    origin: details.origin ?? 'queued',
    designation: details.designation ?? null,
    evening_date: details.evening_date ?? null,
    observation_id: details.observation_id ?? null,
    session_id: details.session_id ?? null,
  };
  await put(STORE_JOURNAL, entry);
  await reloadJournal();
  broadcast({ type: 'journal' });
  return entry;
}

export async function dropEntry(clientOpId: string): Promise<void> {
  await remove(STORE_JOURNAL, clientOpId).catch(() => undefined);
}

export async function markQueued(clientOpId: string): Promise<void> {
  const entry = cached.find((item) => item.client_op_id === clientOpId);
  if (!entry || entry.origin === 'queued') return;
  entry.origin = 'queued';
  await put(STORE_JOURNAL, entry).catch(() => undefined);
}

/** The journal, device copies and unsaved work belong to the account that made them. */
export async function journalCountFor(accountId: string): Promise<number> {
  const entries = await all<JournalEntry>(STORE_JOURNAL).catch(() => []);
  return entries.filter((entry) => entry.account_id === accountId).length;
}
