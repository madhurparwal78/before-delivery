import { COPY, CONFLICT_FIELD_LABELS } from "../../shared/messages";
import type { ChangeResult, Observation, Session } from "../../shared/types";
import { createEmitter } from "../lib/store";
import { api, Unreachable } from "../lib/api";
import { app, accountId, type JournalEntry } from "./model";
import {
  broadcast,
  busIn,
  explicitlySignedOut,
  lsExpired,
  readActiveAccount,
  readJournal,
  saveTouched,
  writeJournal,
  type SaveOutcome,
  type Touched,
} from "./persist";
import { refreshDevice } from "./refresh";

const MAX_CHANGES = 200;
const MAX_BYTES = 4_900_000;
const encoder = new TextEncoder();

/** Fired when the server rejects work the open screen may still be showing. */
export const syncEvents = createEmitter<
  | { t: "rejected-create"; observationId: string }
  | { t: "gone"; observationId: string }
  | { t: "applied" }
>();

const outcomes = new Map<string, SaveOutcome>();
const outcomeWaiters = new Set<() => void>();

function recordOutcomes(found: Record<string, SaveOutcome>): void {
  for (const [id, outcome] of Object.entries(found)) outcomes.set(id, outcome);
  for (const wake of [...outcomeWaiters]) wake();
}

busIn.on((message) => {
  if (message.t === "results" && message.account === accountId()) {
    recordOutcomes(message.outcomes);
    if (message.sentences.length > 0) app.set({ syncSentences: message.sentences });
  }
});

export function canSendNow(): boolean {
  const state = app.get();
  const account = state.account;
  if (!account || !navigator.onLine) return false;
  const active = readActiveAccount();
  if (!active || active.id !== account.id || explicitlySignedOut()) return false;
  return window.localStorage.getItem(lsExpired(account.id)) !== "1";
}

let running: Promise<void> | null = null;
let again = false;

/** Sends the journal, in order, as soon as it can. Callers may await the pass. */
export function requestSync(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = pass().finally(() => {
    running = null;
    if (again) {
      again = false;
      void requestSync();
    }
  });
  return running;
}

async function pass(): Promise<void> {
  const account = accountId();
  if (!account) return;
  await navigator.locks.request("lowlamp-sender", async () => {
    await navigator.locks.request("lowlamp-account", { mode: "shared" }, async () => {
      for (;;) {
        if (accountId() !== account || !canSendNow()) return;
        const journal = await readJournal(account);
        app.set({ journal });
        if (journal.length === 0) return;
        const batch = takeBatch(journal);
        if (!(await sendBatch(account, batch))) return;
      }
    });
  });
}

function takeBatch(journal: JournalEntry[]): JournalEntry[] {
  const batch: JournalEntry[] = [];
  let bytes = 200;
  for (const entry of journal) {
    const size = encoder.encode(JSON.stringify(entry.change)).length + 1;
    if (batch.length > 0 && (batch.length >= MAX_CHANGES || bytes + size > MAX_BYTES)) break;
    batch.push(entry);
    bytes += size;
  }
  return batch;
}

function deviceName(): string {
  return app.get().deviceName.slice(0, 40) || "device";
}

/** Returns true when the whole batch got an answer and the next one may go. */
async function sendBatch(account: string, batch: JournalEntry[]): Promise<boolean> {
  let response;
  try {
    response = await api<{ results?: ChangeResult[] }>("POST", "/api/sync", {
      device: deviceName(),
      changes: batch.map((e) => e.change),
    });
  } catch (error) {
    if (error instanceof Unreachable) app.set({ reachable: false });
    return false;
  }
  if (accountId() !== account) return false;
  app.set({ reachable: true });
  if (response.status === 401) {
    window.localStorage.setItem(lsExpired(account), "1");
    app.set({ expired: true });
    broadcast({ t: "expired", account });
    return false;
  }
  if (response.status === 413) {
    if (batch.length === 1) {
      const only = batch[0]!;
      return processResults(account, batch, [
        { client_op_id: only.change.client_op_id, status: 413, replayed: false, body: { error: "too_large" }, conflicts: [] },
      ]);
    }
    const cut = Math.ceil(batch.length / 2);
    if (!(await sendBatch(account, batch.slice(0, cut)))) return false;
    return sendBatch(account, batch.slice(cut));
  }
  const results = response.status === 200 ? response.body.results : undefined;
  if (!results || results.length !== batch.length) return false;
  return processResults(account, batch, results);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Note {
  designation: string | null;
  date: string;
  session: boolean;
  synced: boolean;
  deleted: boolean;
  rejected: string | null;
  conflicts: { field: string; outcome: string; device: string }[];
  storage: "sketch" | "delete" | null;
  queued: boolean;
}

/** Applies the answers. True when at least one change got a final answer, so the next batch may go. */
async function processResults(account: string, sent: JournalEntry[], results: ChangeResult[]): Promise<boolean> {
  const touched: Touched = {};
  const server = { ...app.get().server };
  server.sessions = { ...server.sessions };
  server.observations = { ...server.observations };
  server.strokes = { ...server.strokes };
  const notes = new Map<string, Note>();
  const saveOutcomes: Record<string, SaveOutcome> = {};
  const finished = new Set<string>();
  const strokeChecks: { id: string; text: string }[] = [];

  const noteFor = (entry: JournalEntry): Note => {
    const id = entry.meta.observationId ?? `session:${entry.meta.sessionId}`;
    let note = notes.get(id);
    if (!note) {
      note = {
        designation: entry.meta.designation,
        date: entry.meta.date,
        session: entry.meta.observationId === null,
        synced: false,
        deleted: false,
        rejected: null,
        conflicts: [],
        storage: null,
        queued: false,
      };
      notes.set(id, note);
    }
    return note;
  };
  const touch = (list: "sessions" | "observations" | "strokes" | "removedObservations", id: string) => {
    (touched[list] ??= []).push(id);
  };

  sent.forEach((entry, index) => {
    const result = results[index]!;
    const op = entry.change.client_op_id;
    const note = noteFor(entry);
    if (entry.announce === "queue") note.queued = true;
    const body = asRecord(entry.change.body);
    const obsId = entry.meta.observationId;
    const reply = asRecord(result.body);
    if (result.status === 503) {
      saveOutcomes[op] = "storage";
      if (entry.change.kind === "sketch.put") note.storage = "sketch";
      if (entry.change.kind === "observation.delete") note.storage = "delete";
      return;
    }
    if (result.status >= 500) {
      saveOutcomes[op] = "waiting";
      return;
    }
    finished.add(op);
    if (result.status === 200 || result.status === 201) {
      saveOutcomes[op] = "ok";
      switch (entry.change.kind) {
        case "session.create":
        case "session.optics":
          server.sessions[String(reply.id)] = result.body as unknown as Session;
          touch("sessions", String(reply.id));
          break;
        case "observation.delete":
          if (obsId) {
            delete server.observations[obsId];
            delete server.strokes[obsId];
            touch("removedObservations", obsId);
          }
          note.deleted = true;
          break;
        default: {
          const next = result.body as unknown as Observation;
          server.observations[next.id] = next;
          touch("observations", next.id);
          note.synced = true;
          if (entry.change.kind === "sketch.put") strokeChecks.push({ id: next.id, text: String(body.strokes) });
        }
      }
      for (const c of result.conflicts) {
        if (!note.conflicts.some((x) => x.field === c.field)) note.conflicts.push({ field: c.field, outcome: c.outcome, device: c.other_device });
      }
      return;
    }
    saveOutcomes[op] = "rejected";
    const code = typeof reply.error === "string" ? reply.error : String(result.status);
    note.rejected ??= code;
    if (entry.change.kind === "observation.create" && obsId) syncEvents.emit({ t: "rejected-create", observationId: obsId });
    if (reply.error === "observation_deleted" || result.status === 404) {
      if (obsId && entry.change.kind !== "observation.create") {
        delete server.observations[obsId];
        delete server.strokes[obsId];
        touch("removedObservations", obsId);
        syncEvents.emit({ t: "gone", observationId: obsId });
      }
    } else if (entry.change.kind === "observation.delete" && reply.observation) {
      const back = reply.observation as Observation;
      server.observations[back.id] = back;
      touch("observations", back.id);
    }
  });

  for (const check of strokeChecks) {
    const current = server.observations[check.id];
    if (current?.sketch && current.sketch.strokes_sha256 === (await sha256Hex(check.text))) {
      server.strokes[check.id] = check.text;
      touch("strokes", check.id);
    }
  }

  const sentences: string[] = [];
  for (const note of notes.values()) {
    const label = note.designation ?? "";
    if (note.rejected) {
      sentences.push(note.session ? COPY.sessionRejected(note.date, note.rejected) : COPY.rejected(label, note.date, note.rejected));
    }
    if (note.deleted) sentences.push(COPY.deleted(label, note.date));
    if (note.synced && note.queued) sentences.push(COPY.synced(label, note.date));
    if (note.queued || note.conflicts.length > 0) {
      for (const c of note.conflicts) {
        const field = CONFLICT_FIELD_LABELS[c.field as keyof typeof CONFLICT_FIELD_LABELS] ?? c.field;
        sentences.push(c.outcome === "kept" ? COPY.conflictKept(field, c.device) : COPY.conflictReplaced(field, c.device));
      }
    }
    if (note.queued && note.storage === "sketch") sentences.push(COPY.storageSketch);
    if (note.queued && note.storage === "delete") sentences.push(COPY.storageDelete);
  }

  await navigator.locks.request(`lowlamp-journal:${account}`, async () => {
    const journal = await readJournal(account);
    const remaining = journal
      .filter((entry) => !finished.has(entry.change.client_op_id))
      .map((entry) =>
        sent.some((s) => s.change.client_op_id === entry.change.client_op_id) ? { ...entry, announce: "queue" as const } : entry,
      );
    await writeJournal(account, remaining);
    app.set((state) =>
      state.account?.id === account
        ? { journal: remaining, server, ...(sentences.length > 0 ? { syncSentences: sentences } : {}) }
        : {},
    );
  });
  touched.journal = true;
  await saveTouched(account, touched);
  recordOutcomes(saveOutcomes);
  broadcast({ t: "results", account, sentences, outcomes: saveOutcomes });
  syncEvents.emit({ t: "applied" });
  if (finished.size > 0) void refreshDevice();
  return finished.size > 0;
}

/** Resolves with each op's outcome once a pass has handled them (or 'waiting' when still queued). */
export async function awaitOutcomes(opIds: string[]): Promise<Record<string, SaveOutcome>> {
  const wanted = new Set(opIds);
  const have = () => opIds.every((id) => outcomes.has(id));
  if (!have()) {
    await new Promise<void>((resolve) => {
      const wake = () => {
        if (have()) {
          outcomeWaiters.delete(wake);
          resolve();
        }
      };
      outcomeWaiters.add(wake);
      void requestSync().then(async () => {
        const account = accountId();
        const journal = account ? await readJournal(account) : [];
        const stillQueued = journal.some((e) => wanted.has(e.change.client_op_id));
        if (!have() && stillQueued) {
          for (const id of opIds) if (!outcomes.has(id)) outcomes.set(id, "waiting");
          wake();
        } else if (!have()) {
          setTimeout(() => {
            for (const id of opIds) if (!outcomes.has(id)) outcomes.set(id, "ok");
            wake();
          }, 1500);
        }
      });
    });
  }
  const found: Record<string, SaveOutcome> = {};
  for (const id of opIds) {
    found[id] = outcomes.get(id) ?? "waiting";
    outcomes.delete(id);
  }
  return found;
}

const RETRY_MS = 30_000;

export function startSyncLoop(): void {
  window.addEventListener("online", () => {
    app.set({ online: true, reachable: true });
    void requestSync();
    void refreshDevice();
  });
  window.addEventListener("offline", () => app.set({ online: false }));
  window.setInterval(() => {
    if (app.get().journal.length > 0) void requestSync();
  }, RETRY_MS);
  busIn.on((message) => {
    if (message.t === "data" && message.account === accountId() && message.touched.journal) {
      void requestSync();
    }
  });
}
