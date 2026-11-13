import {
  changeRejected,
  CONFLICT_FIELD_NAMES,
  CONNECTION_COPY,
  conflictKept,
  conflictReplaced,
  observationDeletedSentence,
  observationSynced,
  savedOnServer,
  sessionRejected,
} from '../shared/messages.js';
import type {
  ConflictReport,
  Observation,
  ObservingSession,
  SyncResult,
} from '../shared/types.js';
import { api } from './api.js';
import {
  broadcast,
  dropEntry,
  journalEntries,
  markQueued,
  reloadJournal,
  type JournalEntry,
} from './journal.js';
import { announceSave, announceSync } from './regions.js';
import { appState, loadCopy, setOffline, setSignedOutWithWork, updateCopy } from './state.js';

const MAX_CHANGES = 200;
const SYNC_BODY_LIMIT = 5_000_000;
const IDLE_RESEND_MS = 30_000;
const SENDER_LOCK = 'lowlamp-sender';

let flushing = false;
let flushAgain = false;

/**
 * Tabs of one browser profile share one journal and one sender. The lock is
 * held only while a sync is in flight, so no change is ever in two requests at
 * once, and a tab that closes hands the sending straight on.
 */
async function withSendLock(run: () => Promise<void>): Promise<void> {
  const locks = navigator.locks;
  if (!locks) {
    await run();
    return;
  }
  await locks.request(SENDER_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    await run();
  });
}

function bodyBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

interface Announcement {
  sentences: string[];
  saveSentence: string | null;
  clearSave: boolean;
}

function conflictSentences(conflicts: ConflictReport[]): string[] {
  return conflicts.map((conflict) => {
    const field = CONFLICT_FIELD_NAMES[conflict.field] ?? conflict.field;
    return conflict.outcome === 'kept'
      ? conflictKept(field, conflict.other_device)
      : conflictReplaced(field, conflict.other_device);
  });
}

function nameOf(entry: JournalEntry, body: unknown): { designation: string; date: string } {
  const observation = body as Partial<Observation> | null;
  return {
    designation: observation?.designation ?? entry.designation ?? '',
    date: observation?.evening_date ?? entry.evening_date ?? '',
  };
}

function applyBodyToCopy(entry: JournalEntry, result: SyncResult): void {
  if (result.status < 200 || result.status >= 300) return;
  const change = entry.change;
  if (change.kind === 'session.create' || change.kind === 'session.optics') {
    const session = result.body as ObservingSession;
    updateCopy((copy) => {
      copy.sessions[session.id] = session;
    });
    return;
  }
  if (change.kind === 'observation.delete') {
    updateCopy((copy) => {
      delete copy.observations[change.observation_id];
      delete copy.stroke_files[change.observation_id];
    });
    return;
  }
  const observation = result.body as Observation;
  updateCopy((copy) => {
    copy.observations[observation.id] = observation;
    if (change.kind === 'sketch.put') copy.stroke_files[observation.id] = change.strokes;
  });
}

function announcementFor(
  entry: JournalEntry,
  result: SyncResult,
  announcedObservations: Set<string>,
  rejectedObservations: Set<string>,
): Announcement {
  const sentences: string[] = [];
  let saveSentence: string | null = null;
  let clearSave = false;
  const { designation, date } = nameOf(entry, result.body);

  if (result.status === 503) {
    const sentence =
      entry.kind === 'observation.delete'
        ? CONNECTION_COPY.storage_delete
        : CONNECTION_COPY.storage_sketch;
    sentences.push(sentence);
    if (entry.origin === 'online_save') saveSentence = sentence;
    return { sentences, saveSentence, clearSave };
  }

  if (result.status >= 400) {
    const code = String((result.body as { error?: string } | null)?.error ?? 'rejected');
    if (entry.kind === 'session.create' || entry.kind === 'session.optics') {
      sentences.push(sessionRejected(entry.evening_date ?? date, code));
    } else if (entry.observation_id && !rejectedObservations.has(entry.observation_id)) {
      rejectedObservations.add(entry.observation_id);
      sentences.push(changeRejected(designation, date, code));
    }
    if (entry.origin === 'online_save') clearSave = true;
    return { sentences, saveSentence, clearSave };
  }

  if (entry.kind === 'observation.delete') {
    sentences.push(observationDeletedSentence(designation, date));
    return { sentences, saveSentence, clearSave };
  }
  if (entry.kind === 'session.create' || entry.kind === 'session.optics') {
    return { sentences, saveSentence, clearSave };
  }

  const observationId = entry.observation_id ?? '';
  if (!announcedObservations.has(observationId)) {
    announcedObservations.add(observationId);
    if (entry.origin === 'online_save') saveSentence = savedOnServer(designation);
    else sentences.push(observationSynced(designation, date));
  }
  sentences.push(...conflictSentences(result.conflicts));
  return { sentences, saveSentence, clearSave };
}

async function applyResults(entries: JournalEntry[], results: SyncResult[]): Promise<void> {
  const sentences: string[] = [];
  const announced = new Set<string>();
  const rejected = new Set<string>();
  let saveSentence: string | null = null;
  let clearSave = false;

  for (const [index, entry] of entries.entries()) {
    const result = results[index];
    if (!result) continue;
    applyBodyToCopy(entry, result);
    const announcement = announcementFor(entry, result, announced, rejected);
    sentences.push(...announcement.sentences);
    if (announcement.saveSentence) saveSentence = announcement.saveSentence;
    if (announcement.clearSave) clearSave = true;
    if (result.status === 503) await markQueued(entry.client_op_id);
    else await dropEntry(entry.client_op_id);
  }

  await reloadJournal();
  if (sentences.length > 0) {
    announceSync(sentences);
    broadcast({ type: 'sentences', account_id: appState().account?.id ?? '', sentences });
  }
  if (clearSave) announceSave('');
  else if (saveSentence) announceSave(saveSentence);
  broadcast({ type: 'copy', account_id: appState().account?.id ?? '' });
  broadcast({ type: 'journal' });
}

function rejectAsTooLarge(entry: JournalEntry): SyncResult {
  return {
    client_op_id: entry.client_op_id,
    status: 413,
    replayed: false,
    body: { error: 'too_large' },
    conflicts: [],
  };
}

async function sendBatch(entries: JournalEntry[]): Promise<boolean> {
  if (entries.length === 0) return true;
  const body = { device: appState().deviceName, changes: entries.map((entry) => entry.change) };
  if (entries.length > 1 && bodyBytes(body) > SYNC_BODY_LIMIT) {
    return splitAndSend(entries);
  }

  const answer = await api.post<{ results: SyncResult[] }>('/api/sync', body);
  if (answer.offline) {
    setOffline(true);
    return false;
  }
  setOffline(false);
  if (answer.status === 401) {
    setSignedOutWithWork(true);
    return false;
  }
  if (answer.status === 413) {
    if (entries.length === 1) {
      await applyResults(entries, [rejectAsTooLarge(entries[0] as JournalEntry)]);
      return true;
    }
    return splitAndSend(entries);
  }
  if (answer.status !== 200 || !answer.body?.results) {
    // Anything else keeps every change for the next attempt.
    for (const entry of entries) await markQueued(entry.client_op_id);
    return false;
  }
  await applyResults(entries, answer.body.results);
  return true;
}

async function splitAndSend(entries: JournalEntry[]): Promise<boolean> {
  const firstCount = Math.ceil(entries.length / 2);
  const first = await sendBatch(entries.slice(0, firstCount));
  if (!first) return false;
  return sendBatch(entries.slice(firstCount));
}

export async function flushJournal(): Promise<void> {
  if (flushing) {
    // A save made while a sync is in flight still goes out straight after it.
    flushAgain = true;
    return;
  }
  const state = appState();
  if (!state.account || state.signedOutWithWork) return;
  flushing = true;
  try {
    await withSendLock(async () => {
      let batches = 0;
      while (journalEntries().length > 0 && batches < 50) {
        batches += 1;
        const sent = await sendBatch(journalEntries().slice(0, MAX_CHANGES));
        if (!sent) return;
      }
    });
  } finally {
    flushing = false;
    if (flushAgain) {
      flushAgain = false;
      void flushJournal();
    }
  }
}

/** Another tab's results reach this tab's regions and copy. */
export async function adoptBroadcastSentences(sentences: string[]): Promise<void> {
  announceSync(sentences);
}

export async function reloadFromDevice(): Promise<void> {
  const account = appState().account;
  if (!account) return;
  await loadCopy(account.id);
  await reloadJournal();
}

let started = false;

export function startSync(): void {
  if (started) return;
  started = true;
  void flushJournal();
  // While online, a journal that still holds changes goes out again every 30
  // seconds; a tab whose sender closed therefore takes over well inside 40.
  window.setInterval(() => {
    void flushJournal();
  }, IDLE_RESEND_MS);
  window.addEventListener('online', () => {
    setOffline(false);
    window.setTimeout(() => void flushJournal(), 500);
  });
  window.addEventListener('offline', () => setOffline(true));
}

/** Called after each save, and after signing in with work waiting. */
export function sendSoon(): void {
  window.setTimeout(() => void flushJournal(), 0);
}
