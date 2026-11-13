import type { Account } from "../../shared/types";
import { createEmitter } from "../lib/store";
import { kvDelete, kvGet, kvPut, kvRange } from "../lib/idb";
import { app, emptyServerCopy, type JournalEntry, type ServerCopy } from "./model";

/** What changed on disk, so other tabs reload only that. */
export interface Touched {
  singles?: ("kit" | "sites" | "programs" | "objects")[];
  programs?: string[];
  sessions?: string[];
  observations?: string[];
  strokes?: string[];
  removedObservations?: string[];
  journal?: boolean;
}

type BusMessage =
  | { t: "data"; account: string; touched: Touched }
  | { t: "results"; account: string; sentences: string[]; outcomes: Record<string, SaveOutcome> }
  | { t: "account" }
  | { t: "expired"; account: string };

export type SaveOutcome = "ok" | "rejected" | "storage" | "waiting";

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("lowlamp");
export const busIn = createEmitter<BusMessage>();

channel?.addEventListener("message", (event: MessageEvent<BusMessage>) => busIn.emit(event.data));

export function broadcast(message: BusMessage): void {
  channel?.postMessage(message);
}

const key = (account: string, ...parts: string[]) => [account, ...parts].join("|");

export const LS_ACTIVE = "lowlamp:active";
export const LS_SIGNED_OUT = "lowlamp:signedout";
export const lsExpired = (account: string) => `lowlamp:expired:${account}`;

export function readActiveAccount(): Account | null {
  try {
    const raw = window.localStorage.getItem(LS_ACTIVE);
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
}

export function explicitlySignedOut(): boolean {
  return window.localStorage.getItem(LS_SIGNED_OUT) === "1";
}

export async function loadAccount(account: string): Promise<{ server: ServerCopy; journal: JournalEntry[] }> {
  const server = emptyServerCopy();
  let journal: JournalEntry[] = [];
  for (const [k, value] of await kvRange(`${account}|`)) {
    const [, kind, id] = k.split("|");
    if (kind === "journal") journal = value as JournalEntry[];
    else if (kind === "kit" || kind === "sites" || kind === "programs") (server as unknown as Record<string, unknown>)[kind] = value;
    else if (kind === "program" && id) server.programDetails[id] = value as never;
    else if (kind === "session" && id) server.sessions[id] = value as never;
    else if (kind === "obs" && id) server.observations[id] = value as never;
    else if (kind === "stroke" && id) server.strokes[id] = value as string;
  }
  server.objects = (await kvGet<never>("shared|objects")) ?? null;
  return { server, journal };
}

/** Persists the touched parts of the in-memory copy and tells the other tabs. */
export async function saveTouched(account: string, touched: Touched): Promise<void> {
  const { server } = app.get();
  const puts: [string, unknown][] = [];
  const dels: string[] = [];
  for (const name of touched.singles ?? []) {
    if (name === "objects") puts.push(["shared|objects", server.objects]);
    else puts.push([key(account, name), server[name]]);
  }
  for (const id of touched.programs ?? []) puts.push([key(account, "program", id), server.programDetails[id]]);
  for (const id of touched.sessions ?? []) {
    const s = server.sessions[id];
    if (s) puts.push([key(account, "session", id), s]);
    else dels.push(key(account, "session", id));
  }
  for (const id of touched.observations ?? []) {
    const o = server.observations[id];
    if (o) puts.push([key(account, "obs", id), o]);
  }
  for (const id of touched.strokes ?? []) {
    const text = server.strokes[id];
    if (text !== undefined) puts.push([key(account, "stroke", id), text]);
  }
  for (const id of touched.removedObservations ?? []) {
    dels.push(key(account, "obs", id), key(account, "stroke", id));
  }
  await kvPut(puts);
  await kvDelete(dels);
  broadcast({ t: "data", account, touched });
}

export async function readJournal(account: string): Promise<JournalEntry[]> {
  return (await kvGet<JournalEntry[]>(key(account, "journal"))) ?? [];
}

export async function writeJournal(account: string, journal: JournalEntry[]): Promise<void> {
  await kvPut([[key(account, "journal"), journal]]);
}

/** Reloads from disk what another tab touched. */
export async function reloadTouched(account: string, touched: Touched): Promise<void> {
  const fresh = await loadAccount(account);
  app.set((state) => {
    if (state.account?.id !== account) return {};
    const server: ServerCopy = { ...state.server };
    for (const name of touched.singles ?? []) {
      if (name === "objects") server.objects = fresh.server.objects;
      else (server as unknown as Record<string, unknown>)[name] = fresh.server[name];
    }
    for (const id of touched.programs ?? []) server.programDetails = { ...server.programDetails, [id]: fresh.server.programDetails[id]! };
    if (touched.sessions?.length) {
      server.sessions = { ...server.sessions };
      for (const id of touched.sessions) {
        const s = fresh.server.sessions[id];
        if (s) server.sessions[id] = s;
        else delete server.sessions[id];
      }
    }
    if (touched.observations?.length) {
      server.observations = { ...server.observations };
      for (const id of touched.observations) {
        const o = fresh.server.observations[id];
        if (o) server.observations[id] = o;
      }
    }
    if (touched.strokes?.length) {
      server.strokes = { ...server.strokes };
      for (const id of touched.strokes) {
        const s = fresh.server.strokes[id];
        if (s !== undefined) server.strokes[id] = s;
      }
    }
    if (touched.removedObservations?.length) {
      server.observations = { ...server.observations };
      server.strokes = { ...server.strokes };
      for (const id of touched.removedObservations) {
        delete server.observations[id];
        delete server.strokes[id];
      }
    }
    return touched.journal ? { server, journal: fresh.journal } : { server };
  });
}
