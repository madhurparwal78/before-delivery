// Sessions, vaults and the sync engine: revisions are encrypted at save time, queued on the
// device and pushed one at a time in save order; pulls run every 15 s, on focus and on Sync now.
import { api, apiBytes, HttpError, NetworkError } from "./api.ts";
import { createVaultKey, openNote, sealNote, unwrapVaultKey, type NotePayload } from "./crypto.ts";
import { read, readAll, remove, write } from "./device.ts";
import { SAMPLE_CASE } from "./sample.ts";
import {
  getState, LOCAL_NOTEBOOK, noteById, notebookOf, notesIn, openNote as showNote, patchNote, putNotebook, putNotes,
  remember, selectNotebook, update, type AppState, type Badge, type Note, type Notebook, type QueuedRevision, type Session,
} from "./store.ts";
import type { Account, Billing, Device, Dossier, Revision, Vault, VaultDetail } from "../shared/types.ts";

const APPROVAL_POLL_MS = 5000;
const PULL_INTERVAL_MS = 15000;
const RETRY_MS = 10000;
const PULL_PAGE = 500;

const keys = new Map<string, CryptoKey>();
const dismissedUnlocks = new Set<string>();
let approvalTimer = 0;
let pullTimer = 0;
let retryTimer = 0;
let pushing = false;
let pushAgain = false;
let queueing: Promise<void> = Promise.resolve();

// ---------- session ----------

function setSession(session: Session): void {
  update({ session });
  remember("session", session);
}

async function afterSession(): Promise<void> {
  const { session } = getState();
  window.clearInterval(approvalTimer);
  window.clearInterval(pullTimer);
  if (session.kind !== "signed_in") return;
  void loadBilling();
  void loadDossiers();
  if (!session.device.approved) {
    approvalTimer = window.setInterval(() => void pollApproval(), APPROVAL_POLL_MS);
    return;
  }
  pullTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") void pullAll();
  }, PULL_INTERVAL_MS);
  await loadVaults();
  kick();
  void pullAll();
}

async function pollApproval(): Promise<void> {
  try {
    const me = await api<{ account: Account; device: Device }>("GET", "/api/me");
    if (!me.device.approved) return;
    setSession({ kind: "signed_in", ...me });
    await afterSession();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      setSession({ kind: "signed_out" });
      window.clearInterval(approvalTimer);
    }
  }
}

async function refreshSession(): Promise<void> {
  try {
    const me = await api<{ account: Account; device: Device }>("GET", "/api/me");
    setSession({ kind: "signed_in", ...me });
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) setSession({ kind: "signed_out" });
    if (error instanceof NetworkError) {
      update({ problem: "offline" });
      window.setTimeout(() => void refreshSession(), RETRY_MS);
      return;
    }
  }
  await afterSession();
}

export type AccountResult = { ok: true } | { ok: false; error: HttpError | NetworkError };

async function signedIn(call: () => Promise<{ account: Account; device: Device }>): Promise<AccountResult> {
  try {
    const result = await call();
    const ids = (await read<Record<string, string>>("meta", "deviceIds")) ?? {};
    ids[result.account.email.toLowerCase()] = result.device.id;
    remember("deviceIds", ids);
    setSession({ kind: "signed_in", account: result.account, device: result.device });
    void afterSession();
    return { ok: true };
  } catch (error) {
    if (error instanceof HttpError || error instanceof NetworkError) return { ok: false, error };
    throw error;
  }
}

export async function signIn(email: string, password: string, deviceName: string): Promise<AccountResult> {
  const ids = (await read<Record<string, string>>("meta", "deviceIds")) ?? {};
  return signedIn(() => api("POST", "/api/sessions", { email, password, device_name: deviceName, device_id: ids[email.toLowerCase()] ?? null }));
}

export function createAccount(email: string, password: string, displayName: string, deviceName: string): Promise<AccountResult> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return signedIn(() => api("POST", "/api/accounts", { email, password, display_name: displayName, time_zone: timeZone, device_name: deviceName }));
}

export async function signOut(): Promise<void> {
  await api("DELETE", "/api/sessions/current").catch(() => undefined);
  window.clearInterval(approvalTimer);
  window.clearInterval(pullTimer);
  setSession({ kind: "signed_out" });
  update({ vaults: [], billing: null, dossiers: [], unlockVaultId: null, problem: null });
}

export async function loadBilling(): Promise<Billing | null> {
  try {
    const billing = await api<Billing>("GET", "/api/billing");
    update({ billing });
    return billing;
  } catch {
    return null;
  }
}

export async function loadDossiers(): Promise<void> {
  try {
    const { dossiers } = await api<{ dossiers: Dossier[] }>("GET", "/api/dossiers");
    update({ dossiers });
  } catch {
    // the workbench shows what it last knew
  }
}

// ---------- vaults ----------

function lockedVaults(s: AppState): Vault[] {
  return s.vaults.filter((v) => !keys.has(v.id));
}

async function loadVaults(): Promise<void> {
  try {
    const { vaults } = await api<{ vaults: Vault[] }>("GET", "/api/vaults");
    update({ vaults });
    update((s) => ({ unlockVaultId: s.unlockVaultId ?? lockedVaults(s).find((v) => !dismissedUnlocks.has(v.id))?.id ?? null }));
  } catch {
    // offline: the device keeps working with what it holds
  }
}

export function requestUnlock(vaultId: string | null): void {
  const current = getState().unlockVaultId;
  if (vaultId === null && current) dismissedUnlocks.add(current);
  update({ unlockVaultId: vaultId });
}

type UnlockResult = "unlocked" | "wrong_passphrase" | "unavailable";

export async function unlockVault(vaultId: string, passphrase: string): Promise<UnlockResult> {
  let detail: VaultDetail;
  try {
    detail = await api<VaultDetail>("GET", `/api/vaults/${vaultId}`);
  } catch {
    return "unavailable";
  }
  let key: CryptoKey;
  try {
    key = await unwrapVaultKey(passphrase, detail.key_envelope);
  } catch {
    return "wrong_passphrase";
  }
  keys.set(vaultId, key);
  await write("keys", key, vaultId);
  const notebook = getState().notebooks.find((b) => b.vaultId === vaultId)
    ?? { id: `vault:${vaultId}`, name: detail.vault.name, vaultId, cursor: 0 };
  putNotebook(notebook);
  update((s) => ({
    unlocked: [...s.unlocked, vaultId],
    unlockVaultId: lockedVaults(s).find((v) => !dismissedUnlocks.has(v.id) && v.id !== vaultId)?.id ?? null,
  }));
  await pull(vaultId);
  selectNotebook(notebook.id);
  return "unlocked";
}

/** Turns the open notebook into a new vault and queues every note's first revision. */
export async function enableSync(passphrase: string): Promise<Vault> {
  const notebook = activeNotebook();
  const { key, envelope } = await createVaultKey(passphrase);
  const { vault } = await api<{ vault: Vault }>("POST", "/api/vaults", { name: notebook.name, key_envelope: envelope });
  keys.set(vault.id, key);
  await write("keys", key, vault.id);
  putNotebook({ ...notebook, vaultId: vault.id, cursor: 0 });
  update((s) => ({ vaults: [...s.vaults, vault], unlocked: [...s.unlocked, vault.id] }));
  for (const note of notesIn(notebook.id)) await queueRevision(note);
  return vault;
}

export async function invitePartner(vaultId: string, email: string): Promise<void> {
  await api("POST", `/api/vaults/${vaultId}/invites`, { email });
}

export function activeNotebook(): Notebook {
  const s = getState();
  return s.notebooks.find((b) => b.id === s.activeNotebookId) as Notebook;
}

// ---------- notes ----------

function payload(note: Note): NotePayload {
  return { title: note.title, aliases: note.aliases, frontmatter: note.frontmatter, body: note.body, private: note.private };
}

function waitingBadge(): Badge {
  const { problem } = getState();
  return problem === "storage" || problem === "billing" ? "paused" : "pending";
}

function freshNote(id: string, notebook: Notebook, content: Partial<Note> = {}): Note {
  return {
    id, notebookId: notebook.id, title: "", aliases: [], frontmatter: {}, body: "", private: false, updatedAt: Date.now(),
    ackRev: null, badge: notebook.vaultId ? waitingBadge() : "local only", rejection: null, conflictCopyId: null, isConflictCopy: false,
    ...content,
  };
}

export function createNote(): Note {
  const note = freshNote(crypto.randomUUID(), activeNotebook());
  putNotes([note]);
  showNote(note.id);
  void queueRevision(note);
  return note;
}

/** Saves an edit on the device and, in a vault, queues its revision. */
export function saveNote(id: string, patch: Partial<Pick<Note, "title" | "body" | "private">>): void {
  const note = noteById(id);
  if (!note || (Object.keys(patch) as (keyof typeof patch)[]).every((k) => note[k] === patch[k])) return;
  const vaulted = Boolean(notebookOf(note)?.vaultId);
  const saved = patchNote(id, { ...patch, updatedAt: Date.now(), badge: vaulted ? waitingBadge() : "local only", rejection: null });
  void queueRevision(saved);
}

export function loadSampleCase(): void {
  const notebook = activeNotebook();
  const notes = SAMPLE_CASE.map((n) => freshNote(crypto.randomUUID(), notebook, { ...n, aliases: [...n.aliases], frontmatter: { ...n.frontmatter } }));
  putNotes(notes);
  showNote(notes[0].id);
  for (const note of notes) void queueRevision(note);
}

export function dismissConflict(id: string): void {
  patchNote(id, { conflictCopyId: null, badge: "synced" });
}

// ---------- the revision queue ----------

function queueRevision(note: Note): Promise<void> {
  queueing = queueing.then(async () => {
    const vaultId = notebookOf(note)?.vaultId;
    const key = vaultId ? keys.get(vaultId) : undefined;
    if (!vaultId || !key) return;
    const sealed = await sealNote(key, payload(noteById(note.id) ?? note));
    const { queue } = getState();
    const entry: QueuedRevision = {
      key: crypto.randomUUID(), seq: Math.max(Date.now(), ...queue.map((q) => q.seq + 1)), notebookId: note.notebookId, vaultId,
      noteId: note.id, base: queue.some((q) => q.noteId === note.id) ? "chain" : (noteById(note.id)?.ackRev ?? null), ...sealed,
    };
    update((s) => ({ queue: [...s.queue, entry] }));
    await write("queue", entry);
    kick();
  });
  return queueing;
}

function dropQueued(entries: QueuedRevision[]): void {
  const gone = new Set(entries.map((e) => e.key));
  update((s) => ({ queue: s.queue.filter((q) => !gone.has(q.key)) }));
  for (const entry of entries) void remove("queue", entry.key);
}

function setProblem(problem: AppState["problem"]): void {
  update({ problem });
  const waiting = new Set(getState().queue.map((q) => q.noteId));
  const badge = problem === "storage" || problem === "billing" ? "paused" : "pending";
  const changed = getState().notes.filter((n) => waiting.has(n.id) && (n.badge === "pending" || n.badge === "paused") && n.badge !== badge);
  if (changed.length) putNotes(changed.map((n) => ({ ...n, badge })));
}

function retryLater(): void {
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => {
    kick();
    void pullAll();
  }, RETRY_MS);
}

/** Starts pushing the queue unless a push is already running. */
function kick(): void {
  if (pushing) {
    pushAgain = true;
    return;
  }
  void pushQueue();
}

async function pushQueue(): Promise<void> {
  pushing = true;
  try {
    do {
      pushAgain = false;
      for (;;) {
        const s = getState();
        if (s.session.kind !== "signed_in" || !s.session.device.approved) return;
        const entry = [...s.queue].sort((a, b) => a.seq - b.seq).find((q) => keys.has(q.vaultId));
        if (!entry) break;
        update((st) => ({ inFlight: st.inFlight + 1 }));
        const next = await pushOne(entry).finally(() => update((st) => ({ inFlight: st.inFlight - 1 })));
        if (!next) return;
      }
    } while (pushAgain);
  } finally {
    pushing = false;
  }
}

/** Pushes one revision; false when pushing has to wait (outage, offline, signed out). */
async function pushOne(entry: QueuedRevision): Promise<boolean> {
  const base = entry.base === "chain" ? (noteById(entry.noteId)?.ackRev ?? null) : entry.base;
  try {
    const { revision } = await api<{ revision: Revision; cursor: number }>("POST",
      `/api/vaults/${entry.vaultId}/notes/${entry.noteId}/revisions`,
      { base_revision: base, ciphertext: entry.ciphertext, ciphertext_sha256: entry.ciphertext_sha256 },
      { "Idempotency-Key": entry.key });
    dropQueued([entry]);
    if (getState().problem) setProblem(null);
    const stillQueued = getState().queue.some((q) => q.noteId === entry.noteId);
    if (noteById(entry.noteId)) patchNote(entry.noteId, { ackRev: revision.rev, badge: stillQueued ? "pending" : "synced", rejection: null });
    return true;
  } catch (error) {
    if (error instanceof NetworkError) {
      setProblem("offline");
      retryLater();
      return false;
    }
    if (!(error instanceof HttpError)) throw error;
    if (error.status === 503) {
      setProblem(error.code === "billing_unavailable" ? "billing" : "storage");
      retryLater();
      return false;
    }
    if (error.status === 401) {
      setSession({ kind: "signed_out" });
      return false;
    }
    if (error.code === "revision_conflict") {
      await keepConflictCopy(entry, error.body?.error.head_revision ?? null);
      return true;
    }
    dropQueued([entry]);
    if (error.code === "vault_read_only") update({ problem: "read_only" });
    if (noteById(entry.noteId)) patchNote(entry.noteId, { badge: "sync error", rejection: error.message });
    return true;
  }
}

/** The push lost: load the winner into the note and keep this device's edit as a conflict copy. */
async function keepConflictCopy(entry: QueuedRevision, head: number | null): Promise<void> {
  const note = noteById(entry.noteId) as Note;
  const key = keys.get(entry.vaultId) as CryptoKey;
  const winner = head === null ? null : await openNote(key, await apiBytes(`/api/vaults/${entry.vaultId}/revisions/${head}/blob`));
  dropQueued(getState().queue.filter((q) => q.noteId === note.id));
  const s = getState();
  const deviceName = s.session.kind === "signed_in" ? s.session.device.name : "this device";
  const copy = freshNote(crypto.randomUUID(), notebookOf(note) as Notebook, {
    ...payload(note), title: `${note.title} (conflict copy, ${deviceName})`, isConflictCopy: true,
  });
  putNotes([{ ...note, ...(winner ?? {}), ackRev: head, badge: "conflict", conflictCopyId: copy.id }, copy]);
  await queueRevision(copy);
}

// ---------- pulls ----------

async function pull(vaultId: string): Promise<void> {
  const key = keys.get(vaultId);
  let notebook = getState().notebooks.find((b) => b.vaultId === vaultId);
  if (!key || !notebook) return;
  let after = notebook.cursor;
  for (;;) {
    const page = await api<{ revisions: Revision[]; next_after: number }>("GET", `/api/vaults/${vaultId}/revisions?after=${after}&limit=${PULL_PAGE}`);
    const latest = new Map<string, Revision>();
    for (const revision of page.revisions) latest.set(revision.note_id, revision);
    for (const revision of latest.values()) {
      const note = noteById(revision.note_id);
      if ((note?.ackRev ?? 0) >= revision.rev || getState().queue.some((q) => q.noteId === revision.note_id)) continue;
      try {
        const content = await openNote(key, await apiBytes(`/api/vaults/${vaultId}/revisions/${revision.rev}/blob`));
        putNotes([{ ...(note ?? freshNote(revision.note_id, notebook)), ...content, ackRev: revision.rev, badge: "synced", rejection: null }]);
      } catch (error) {
        if (error instanceof HttpError || error instanceof NetworkError) throw error;
        console.warn(`Revision r${revision.rev} could not be decrypted with this vault key.`);
      }
    }
    after = page.next_after;
    if (page.revisions.length < PULL_PAGE) break;
  }
  notebook = getState().notebooks.find((b) => b.vaultId === vaultId) as Notebook;
  putNotebook({ ...notebook, cursor: after });
}

async function pullAll(): Promise<void> {
  const s = getState();
  if (s.session.kind !== "signed_in" || !s.session.device.approved) return;
  update((st) => ({ inFlight: st.inFlight + 1 }));
  try {
    for (const notebook of s.notebooks) if (notebook.vaultId) await pull(notebook.vaultId);
    if (getState().problem === "offline") setProblem(null);
  } catch (error) {
    if (error instanceof NetworkError) {
      setProblem("offline");
      retryLater();
    }
  } finally {
    update((st) => ({ inFlight: st.inFlight - 1 }));
  }
}

export function syncNow(): void {
  kick();
  void pullAll();
}

// ---------- history ----------

export async function noteHistory(vaultId: string, noteId: string): Promise<Revision[]> {
  return (await api<{ revisions: Revision[] }>("GET", `/api/vaults/${vaultId}/notes/${noteId}/history`)).revisions;
}

/** Restores `rev` as a new head revision and loads its content into the note. */
export async function restoreRevision(note: Note, vaultId: string, rev: number, base: number): Promise<Revision> {
  const { revision } = await api<{ revision: Revision }>("POST", `/api/vaults/${vaultId}/notes/${note.id}/restore`,
    { revision: rev, base_revision: base }, { "Idempotency-Key": crypto.randomUUID() });
  const content = await openNote(keys.get(vaultId) as CryptoKey, await apiBytes(`/api/vaults/${vaultId}/revisions/${revision.rev}/blob`));
  patchNote(note.id, { ...content, ackRev: revision.rev, badge: "synced", rejection: null });
  return revision;
}

/** After a refused restore: load the note's head from the server. */
export async function reloadHead(note: Note, vaultId: string, head: number): Promise<void> {
  const content = await openNote(keys.get(vaultId) as CryptoKey, await apiBytes(`/api/vaults/${vaultId}/revisions/${head}/blob`));
  patchNote(note.id, { ...content, ackRev: head, badge: "synced" });
}

// ---------- start ----------

export async function boot(): Promise<void> {
  const [notebooks, notes, queue] = await Promise.all([
    readAll<Notebook>("notebooks"), readAll<Note>("notes"), readAll<QueuedRevision>("queue"),
  ]);
  for (const notebook of notebooks) {
    if (!notebook.vaultId) continue;
    const key = await read<CryptoKey>("keys", notebook.vaultId);
    if (key) keys.set(notebook.vaultId, key);
  }
  const s = getState();
  const allNotebooks = notebooks.some((b) => b.id === LOCAL_NOTEBOOK) ? notebooks : [...s.notebooks, ...notebooks];
  const activeNotebookId = (await read<string>("meta", "activeNotebookId")) ?? LOCAL_NOTEBOOK;
  update({
    loaded: true,
    notebooks: allNotebooks,
    notes,
    queue: queue.sort((a, b) => a.seq - b.seq),
    activeNotebookId: allNotebooks.some((b) => b.id === activeNotebookId) ? activeNotebookId : LOCAL_NOTEBOOK,
    openNoteId: (await read<string | null>("meta", "openNoteId")) ?? null,
    session: (await read<Session>("meta", "session")) ?? { kind: "signed_out" },
    unlocked: [...keys.keys()],
  });
  window.addEventListener("online", () => {
    setProblem(null);
    syncNow();
  });
  window.addEventListener("offline", () => setProblem("offline"));
  window.addEventListener("focus", () => void pullAll());
  await refreshSession();
}
