// The sync sender: one journal, one sender per browser profile (DP-20, DP-90).
import { app, broadcast, persist } from "./app.js";
import { apiPost, networkState } from "./api.js";
import { journalFor, splitJournal, type JournalEntry } from "./store.js";
import type { SyncChange, SyncResult } from "../shared/api.js";
import { renderApp, syncResultsBuffer } from "./pages/router.js";

const SENDER_KEY = "lowlamp-sender";
const HEARTBEAT_MS = 8000;
const TAKEOVER_MS = 40_000;
const RETRY_MS = 30_000;
const AFTER_NETWORK_MS = 5_000;

let sending = false;
let lastSendAttempt = 0;
let signedOutSticky = false;

export function startSyncSender(): void {
  claimSender();
  window.addEventListener("online", () => {
    networkState.offline = false;
    signedOutSticky = false;
    window.setTimeout(() => void flushJournal(), AFTER_NETWORK_MS);
  });
  window.addEventListener("offline", () => {
    networkState.offline = true;
  });
  // While online, a journal that still holds changes is sent again every 30
  // seconds and on each new save (flushJournal is also called by saves).
  window.setInterval(() => {
    if (navigator.onLine && !signedOutSticky && journalCount() > 0 && Date.now() - lastSendAttempt > RETRY_MS) {
      void flushJournal();
    }
  }, 5000);
  // Take over within 40 seconds if the sending tab closes (DP-90).
  window.setInterval(() => {
    if (!isSender()) claimSender();
  }, TAKEOVER_MS);
}

function isSender(): boolean {
  const record = readSenderRecord();
  return record?.id === senderId();
}

function readSenderRecord(): { id: string; at: number } | null {
  const raw = localStorage.getItem(SENDER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { id: string; at: number };
  } catch {
    return null;
  }
}

function senderId(): string {
  let id = sessionStorage.getItem("lowlamp-tab-id");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("lowlamp-tab-id", id);
  }
  return id;
}

function claimSender(): void {
  const record = readSenderRecord();
  if (record) {
    const sameTab = record.id === senderId();
    const stale = Date.now() - record.at >= HEARTBEAT_MS * 2;
    if (!sameTab && !stale) return;
    if (sameTab && Date.now() - record.at < HEARTBEAT_MS) return;
  }
  localStorage.setItem(SENDER_KEY, JSON.stringify({ id: senderId(), at: Date.now() }));
  window.setInterval(() => {
    if (isSender()) localStorage.setItem(SENDER_KEY, JSON.stringify({ id: senderId(), at: Date.now() }));
  }, HEARTBEAT_MS);
}

export function journalCount(): number {
  const accountId = app.state.signedInAccountId;
  if (!accountId) return 0;
  return journalFor(app.state, accountId).length;
}

export async function flushJournal(): Promise<void> {
  const accountId = app.state.signedInAccountId;
  if (!accountId || !navigator.onLine || signedOutSticky) return;
  const journal = journalFor(app.state, accountId);
  if (journal.length === 0) return;
  if (!isSender()) return;
  if (sending) return;
  sending = true;
  lastSendAttempt = Date.now();
  try {
    // Batches too large to send are split, and a 413 splits in half.
    let entries = [...journal];
    for (const batch of splitJournal(entries)) {
      await sendBatch(accountId, batch);
    }
    entries = [];
  } finally {
    sending = false;
  }
  persist();
  renderApp();
}

async function sendBatch(accountId: string, batch: readonly JournalEntry[]): Promise<void> {
  const changes = batch.map((entry) => entry.change as SyncChange);
  try {
    const answer = await apiPost.sync(app.state.deviceName, changes);
    applyResults(accountId, batch, answer.results);
  } catch (error) {
    if ((error as { status?: number }).status === 413) {
      // Split in half, with the earlier half getting the extra change.
      if (batch.length === 1) {
        applyRejected(accountId, batch[0]!, "too_large");
        return;
      }
      const middle = Math.ceil(batch.length / 2);
      const earlier = batch.slice(0, middle);
      const later = batch.slice(middle);
      await sendBatch(accountId, earlier);
      await sendBatch(accountId, later);
      return;
    }
    if ((error as { status?: number }).status === 401) {
      // Signed out with changes waiting (DP-67): stop automatic sends.
      signedOutSticky = true;
      app.syncRefused = true;
      broadcast({ type: "journal", accountId });
      renderApp();
      return;
    }
    if ((error as { status?: number }).status === 0) {
      networkState.offline = true;
      return;
    }
    // Any other answer keeps every change for the next attempt.
    return;
  }
}

function applyResults(accountId: string, batch: readonly JournalEntry[], results: readonly SyncResult[]): void {
  const journal = app.state.journals[accountId] ?? [];
  const remaining: JournalEntry[] = [];
  const handledIds = new Set<string>();
  for (const entry of journal) {
    const index = batch.findIndex((candidate) => candidate.change.client_op_id === entry.change.client_op_id);
    if (index >= 0) {
      const result = results[index];
      if (result) {
        handledIds.add(entry.change.client_op_id);
        announceResult(result, entry);
        if (result.status === 503) {
          remaining.push(entry);
        }
      } else {
        remaining.push(entry);
      }
    } else {
      remaining.push(entry);
    }
  }
  app.state.journals[accountId] = remaining;
  persist();
  broadcast({ type: "sync-results", accountId, results: results.filter((result) => handledIds.has(result.client_op_id)) });
  void syncResultsBuffer;
}

function applyRejected(accountId: string, entry: JournalEntry, code: string): void {
  const journal = app.state.journals[accountId] ?? [];
  app.state.journals[accountId] = journal.filter((candidate) => candidate.change.client_op_id !== entry.change.client_op_id);
  announceResult(
    { client_op_id: entry.change.client_op_id, status: 422, replayed: false, body: { error: code }, conflicts: [] },
    entry,
  );
  persist();
}

function announceResult(result: SyncResult, entry: JournalEntry): void {
  const body = result.body as Record<string, unknown>;
  const designation = typeof body === "object" && body !== null && "designation" in body ? String(body["designation"]) : null;
  const evening = typeof body === "object" && body !== null && "evening_date" in body ? String(body["evening_date"]) : null;
  if (designation && evening) {
    if (result.status < 300) {
      syncResultsBuffer.push(result);
    } else if (result.status >= 400) {
      syncResultsBuffer.push(result);
    }
    return;
  }
  if (entry.kind === "observation.delete") {
    syncResultsBuffer.push(result);
    return;
  }
  if (entry.kind === "session.create" || entry.kind === "session.optics") {
    syncResultsBuffer.push(result);
  }
}
