// The browser's state: notebooks and notes on the device, the revision queue, the session and
// the sync condition. Components read it with useApp(); every change goes through update().
import { useSyncExternalStore } from "react";
import { write } from "./device.ts";
import type { Account, Billing, Device, Dossier, Vault } from "../shared/types.ts";

export type Badge = "local only" | "pending" | "synced" | "conflict" | "sync error" | "paused";

export interface Note {
  id: string;
  notebookId: string;
  title: string;
  aliases: string[];
  frontmatter: Record<string, string>;
  body: string;
  private: boolean;
  updatedAt: number;
  /** The newest revision of this note the server acknowledged and this device holds. */
  ackRev: number | null;
  badge: Badge;
  rejection: string | null;
  conflictCopyId: string | null;
  isConflictCopy: boolean;
}

export interface Notebook {
  id: string;
  name: string;
  vaultId: string | null;
  /** Highest revision pulled into this notebook. */
  cursor: number;
}

/** A queued revision: encrypted at save time, pushed in order. `base` "chain" follows the previous push of the note. */
export interface QueuedRevision {
  key: string;
  seq: number;
  notebookId: string;
  vaultId: string;
  noteId: string;
  base: number | null | "chain";
  ciphertext: string;
  ciphertext_sha256: string;
}

export type Session =
  | { kind: "signed_out" }
  | { kind: "signed_in"; account: Account; device: Device };

type SyncProblem = "offline" | "storage" | "billing" | "read_only";

export interface AppState {
  loaded: boolean;
  notebooks: Notebook[];
  activeNotebookId: string;
  notes: Note[];
  openNoteId: string | null;
  queue: QueuedRevision[];
  session: Session;
  vaults: Vault[];
  unlocked: string[];
  unlockVaultId: string | null;
  inFlight: number;
  problem: SyncProblem | null;
  billing: Billing | null;
  dossiers: Dossier[];
  workbenchDossierId: string | null;
}

export const LOCAL_NOTEBOOK = "local";

let state: AppState = {
  loaded: false,
  notebooks: [{ id: LOCAL_NOTEBOOK, name: "Case notebook", vaultId: null, cursor: 0 }],
  activeNotebookId: LOCAL_NOTEBOOK,
  notes: [],
  openNoteId: null,
  queue: [],
  session: { kind: "signed_out" },
  vaults: [],
  unlocked: [],
  unlockVaultId: null,
  inFlight: 0,
  problem: null,
  billing: null,
  dossiers: [],
  workbenchDossierId: null,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function update(change: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  state = { ...state, ...(typeof change === "function" ? change(state) : change) };
  for (const listener of listeners) listener();
}

export function useApp(): AppState {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, getState);
}

export function noteById(id: string | null): Note | undefined {
  return state.notes.find((n) => n.id === id);
}

export function notebookOf(note: Note): Notebook | undefined {
  return state.notebooks.find((b) => b.id === note.notebookId);
}

/** Replaces notes by id (adding new ones) and persists them. */
export function putNotes(changed: Note[]): void {
  const ids = new Set(changed.map((n) => n.id));
  update((s) => ({ notes: [...s.notes.filter((n) => !ids.has(n.id)), ...changed] }));
  for (const note of changed) void write("notes", note);
}

export function patchNote(id: string, patch: Partial<Note>): Note {
  const note = { ...(noteById(id) as Note), ...patch };
  putNotes([note]);
  return note;
}

export function putNotebook(notebook: Notebook): void {
  update((s) => ({ notebooks: [...s.notebooks.filter((b) => b.id !== notebook.id), notebook] }));
  void write("notebooks", notebook);
}

export function remember(key: string, value: unknown): void {
  void write("meta", value, key);
}

export function notesIn(notebookId: string): Note[] {
  return state.notes.filter((n) => n.notebookId === notebookId);
}

export function openNote(id: string | null): void {
  update({ openNoteId: id });
  remember("openNoteId", id);
}

export function selectNotebook(id: string): void {
  const first = notesIn(id).sort(byTitle)[0];
  update({ activeNotebookId: id, openNoteId: first?.id ?? null });
  remember("activeNotebookId", id);
  remember("openNoteId", first?.id ?? null);
}

export const byTitle = (a: Note, b: Note) => (a.title || "Untitled").localeCompare(b.title || "Untitled");
