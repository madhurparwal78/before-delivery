import type { FieldChange, FieldValue, RecordChange, RecordState, SyncRequest, SyncResponse } from "../../shared/sync.ts";
import { syncStatus } from "../domain/syncStatus.ts";
import type { SyncStatus } from "../domain/syncStatus.ts";
import type { WorkspaceRecord } from "../domain/types.ts";
import { recordKey } from "../domain/types.ts";
import { purgeDocument, settleAttachment } from "./actions.ts";
import { announce, showConfirmation } from "./announcer.ts";
import { readFile } from "./deviceStore.ts";
import type { AccountSession, UploadChoice } from "./deviceStore.ts";
import { location, navigate } from "./router.ts";
import { subscribeable } from "./subscribeable.ts";
import { allRecords, blocksOf, commit, connectorsOf, getMeta, getRecord, isDirty, isSyncing, isWaitingAttachment, notesOf, onDurable, onRemoved, session, setMeta, subscribeWorkspace, waitingAttachments, waitingCount } from "./workspace.ts";

const CHECK_MS = 5000;
const SYNCING_HOLD_MS = 500;
const BATCH_RECORDS = 500;
const BATCH_BYTES = 3_000_000;

export const storageAvailable = subscribeable(true);

let online = navigator.onLine;
let serviceAvailable = true;
let leader = false;
let exchanging = false;
let exchangeAgain = false;

export const status = subscribeable<SyncStatus>({ state: "offline", sentence: "" });
let syncingShownAt: number | null = null;
let holdTimer: ReturnType<typeof setTimeout> | null = null;

function refreshStatus(): void {
  const next = syncStatus({ syncing: isSyncing(), online, serviceAvailable, waiting: waitingCount() });
  if (syncingShownAt !== null && next.state !== "syncing") {
    const left = syncingShownAt + SYNCING_HOLD_MS - Date.now();
    if (left > 0) {
      holdTimer ??= setTimeout(() => {
        holdTimer = null;
        refreshStatus();
      }, left);
      return;
    }
  }
  syncingShownAt = next.state === "syncing" ? (syncingShownAt ?? Date.now()) : null;
  const shown = status.get();
  if (next.sentence === shown.sentence) return;
  status.set(next);
  if (shown.sentence) announce(next.sentence);
}

function setServiceAvailable(available: boolean): void {
  serviceAvailable = available;
  refreshStatus();
}

const parentOf = (record: WorkspaceRecord): string | null =>
  record.kind === "document" || record.kind === "table" ? null : record.kind === "row" ? record.fields.tableId : record.fields.documentId;

/** A delete offers the text version its device saw, so an edit it never saw wins. */
function baseOf(record: WorkspaceRecord, name: string): number {
  return record.sync.versions[name === "deleted" && record.kind === "block" ? "text" : name] ?? 0;
}

function toChange(record: WorkspaceRecord): RecordChange {
  const values = record.fields as Record<string, FieldValue>;
  const fields: Record<string, FieldChange> = {};
  for (const [name, mode] of Object.entries(record.sync.dirty)) {
    fields[name] = { value: values[name] ?? null, base: baseOf(record, name), mode };
  }
  if (record.sync.uploading) {
    for (const [name, value] of Object.entries(values)) {
      fields[name] ??= { value, base: baseOf(record, name), mode: "create" };
    }
  }
  return { kind: record.kind, id: record.id, parentId: parentOf(record), fields };
}

const isDeletedDocument = (record: WorkspaceRecord): boolean => record.kind === "document" && record.fields.deletedForever;

function nextRequest(cursor: number): SyncRequest {
  const changes: RecordChange[] = [];
  const deletedForever: string[] = [];
  let bytes = 0;
  for (const record of allRecords()) {
    if (isDeletedDocument(record)) deletedForever.push(record.id);
    else if ((isDirty(record) || record.sync.uploading) && !isWaitingAttachment(record)) {
      const change = toChange(record);
      bytes += JSON.stringify(change).length;
      changes.push(change);
      if (changes.length >= BATCH_RECORDS || bytes >= BATCH_BYTES) break;
    }
  }
  return { since: cursor, changes, deletedForever };
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function confirmedSent(change: RecordChange): WorkspaceRecord | null {
  const record = getRecord(change.kind, change.id);
  if (!record) return null;
  const values = record.fields as Record<string, FieldValue>;
  const dirty = { ...record.sync.dirty };
  for (const [name, sent] of Object.entries(change.fields)) {
    if (sameValue(values[name], sent.value)) delete dirty[name];
  }
  return { ...record, sync: { ...record.sync, dirty, uploading: false } };
}

function appliedState(local: WorkspaceRecord | undefined, state: RecordState, deviceId: string): WorkspaceRecord {
  const empty = { kind: state.kind, id: state.id, fields: {}, sync: { versions: {}, dirty: {}, bothKept: {}, uploading: false } };
  const record = local ?? (empty as WorkspaceRecord);
  const fields = { ...record.fields } as Record<string, FieldValue>;
  const versions = { ...record.sync.versions };
  const dirty = { ...record.sync.dirty };
  const bothKept = { ...record.sync.bothKept };
  for (const [name, field] of Object.entries(state.fields)) {
    const held = dirty[name];
    const heldBack = held === "edit" || held === "pick" || (held === "slot" && field.value === null);
    if (heldBack) {
      if (field.device === deviceId) versions[name] = field.version;
      continue;
    }
    fields[name] = field.value;
    versions[name] = field.version;
    delete dirty[name];
    if (field.bothKept) bothKept[name] = field.bothKept;
    else delete bothKept[name];
  }
  return { ...record, fields, sync: { ...record.sync, versions, dirty, bothKept } } as WorkspaceRecord;
}

const hasPersonsEdit = (record: WorkspaceRecord): boolean => Object.values(record.sync.dirty).some((mode) => mode === "edit" || mode === "pick");

/** Drops a document the account deleted forever; a person's unsent edits earn the published notice. */
function dropDeletedDocument(id: string): void {
  const document = getRecord("document", id);
  if (!document) return;
  const local = [document, ...blocksOf(id), ...notesOf(id), ...connectorsOf(id)];
  const removed = [recordKey("document", id), ...purgeDocument(id)];
  if (!document.fields.deletedForever && local.some(hasPersonsEdit)) {
    addNotice(`"${document.fields.title}" was deleted forever on another device, so your changes to it were not kept.`);
  }
  commit([], removed);
}

function addNotice(text: string): void {
  const meta = getMeta();
  if (!meta.notices.includes(text)) setMeta({ ...meta, notices: [...meta.notices, text] });
}

export function dismissNotice(text: string): void {
  const meta = getMeta();
  setMeta({ ...meta, notices: meta.notices.filter((notice) => notice !== text) });
}

function applyResponse(sent: SyncRequest, response: SyncResponse, account: AccountSession): void {
  for (const id of new Set([...response.deletedForever, ...sent.deletedForever])) dropDeletedDocument(id);
  const updated = new Map<string, WorkspaceRecord>();
  for (const change of sent.changes) {
    const record = confirmedSent(change);
    if (record) updated.set(recordKey(record.kind, record.id), record);
  }
  for (const state of response.records) {
    const key = recordKey(state.kind, state.id);
    updated.set(key, appliedState(updated.get(key) ?? getRecord(state.kind, state.id), state, account.device.id));
  }
  const meta = getMeta();
  setMeta({ ...meta, cursors: { ...meta.cursors, [account.user.id]: response.cursor } });
  if (updated.size) commit([...updated.values()]);
}

function finishUpload(): void {
  const meta = getMeta();
  if (!meta.uploadPending) return;
  for (const record of allRecords()) if (record.sync.uploading) return;
  setMeta({ ...meta, uploadPending: false });
  showConfirmation("Workspace uploaded.");
}

async function post(request: SyncRequest): Promise<Response> {
  return fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
}

function deviceRemoved(): void {
  const meta = getMeta();
  if (!meta.session) return;
  setMeta({ ...meta, session: null, notices: [...meta.notices, "This device was removed from your account. Your work here stays on this device."] });
  refreshStatus();
}

async function exchangeChanges(): Promise<void> {
  const account = session();
  if (!account || !isSyncing()) return;
  let more = true;
  while (more) {
    const request = nextRequest(getMeta().cursors[account.user.id] ?? 0);
    const answer = await post(request);
    if (answer.status === 401) return deviceRemoved();
    if (!answer.ok) throw new Error("sync refused");
    const response = (await answer.json()) as SyncResponse;
    setServiceAvailable(true);
    applyResponse(request, response, account);
    more = response.more || request.changes.length >= BATCH_RECORDS;
  }
  finishUpload();
}

async function sendWaitingFiles(): Promise<void> {
  for (const attachment of waitingAttachments()) {
    const file = await readFile(attachment.id);
    if (!file) continue;
    const answer = await fetch(`/api/attachments/${attachment.id}`, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": attachment.fields.contentType,
        "X-File-Name": encodeURIComponent(attachment.fields.name),
        "X-Document-Id": attachment.fields.documentId,
      },
    });
    settleAttachment(attachment, answer.status);
    storageAvailable.set(answer.status !== 503);
  }
}

/** One round with the account; failures leave everything waiting for the next check. */
async function syncNow(): Promise<void> {
  if (!leader || !online || !isSyncing()) return;
  if (exchanging) {
    exchangeAgain = true;
    return;
  }
  exchanging = true;
  try {
    await exchangeChanges();
    if (isSyncing()) await sendWaitingFiles();
  } catch {
    setServiceAvailable(false);
  } finally {
    exchanging = false;
    if (exchangeAgain) {
      exchangeAgain = false;
      void syncNow();
    }
  }
}

async function checkAccount(): Promise<void> {
  const answer = await fetch("/api/session");
  if (!answer.ok) return;
  const body = (await answer.json()) as Partial<AccountSession>;
  if (!body.user) deviceRemoved();
}

async function check(): Promise<void> {
  if (!online) return;
  try {
    const answer = await fetch("/api/status");
    const body = (await answer.json()) as { sync: string; storage: string };
    setServiceAvailable(answer.ok && body.sync === "ok");
    storageAvailable.set(body.storage === "ok");
    if (session() && body.sync === "ok") await checkAccount();
  } catch {
    setServiceAvailable(false);
    return;
  }
  await syncNow();
}

function setOnline(value: boolean): void {
  online = value;
  refreshStatus();
  void check();
}

export function startSync(): void {
  refreshStatus();
  subscribeWorkspace(refreshStatus);
  onDurable(() => void syncNow());
  onRemoved((keys) => {
    const open = /^\/doc\/(.+)$/.exec(location.get().path)?.[1];
    if (open && keys.includes(recordKey("document", decodeURIComponent(open)))) navigate("/");
  });
  window.addEventListener("online", () => setOnline(true));
  window.addEventListener("offline", () => setOnline(false));
  void navigator.locks.request("oddment-sync", () => {
    leader = true;
    void syncNow();
    return new Promise(() => undefined);
  });
  void check();
  setInterval(() => void check(), CHECK_MS);
}

/** A signed-in session from the sign-in dialog. */
export function signedIn(account: AccountSession): void {
  const meta = getMeta();
  setMeta({ ...meta, session: account });
  showConfirmation(`Signed in as ${account.user.email}.`);
  void syncNow();
}

export function chooseUpload(account: AccountSession): void {
  const meta = getMeta();
  const choices: Record<string, UploadChoice> = { ...meta.choices, [account.user.id]: "upload" };
  setMeta({ ...meta, choices, uploadPending: true });
  commit([...allRecords()].filter((record) => !isDeletedDocument(record)).map((record) => ({ ...record, sync: { ...record.sync, uploading: true } })));
}

export function chooseKeep(account: AccountSession): void {
  const meta = getMeta();
  setMeta({ ...meta, choices: { ...meta.choices, [account.user.id]: "keep" } });
  showConfirmation("Keeping this workspace on this device.");
}

export async function signOut(): Promise<boolean> {
  try {
    const answer = await fetch("/api/session", { method: "DELETE" });
    if (!answer.ok && answer.status !== 401) return false;
  } catch {
    return false;
  }
  setMeta({ ...getMeta(), session: null });
  showConfirmation("Signed out. This workspace stays on this device.");
  return true;
}
