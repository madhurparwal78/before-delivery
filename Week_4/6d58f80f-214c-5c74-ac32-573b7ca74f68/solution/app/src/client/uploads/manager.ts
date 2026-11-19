// Resumable uploads in the browser (brief: Interactions, Upload). Parts go one at a time; the chosen bytes stay in
// IndexedDB until the upload finishes, so Resume after a reload needs no second file choice.
import { api, call, ApiError, newKey, putBytes } from "../api";
import { announce } from "../announce";
import { Store } from "../store";
import { onStorageBack, refreshFolders, refreshStorage, changes } from "../data";
import { events } from "../live";
import { STORAGE_OUTAGE, TOO_BIG, SOMETHING_WRONG } from "../copy";
import { PART_SIZE, type Upload } from "../../shared/api";
import { MAX_FILE_BYTES, partBytes, partCount } from "../../shared/rules";


type RowState = "uploading" | "paused" | "waiting" | "done" | "expired";

export interface UploadRow {
  key: string;
  id: string | null;
  name: string;
  size: number;
  contentType: string;
  folderId: string;
  state: RowState;
  confirmed: Set<number>;
  partCount: number;
}

export const uploads = new Store<UploadRow[]>([]);

const blobs = new Map<string, Blob>();
const running = new Set<string>();
const pauseAsked = new Set<string>();
const gone = new Set<string>();

function update(key: string, change: Partial<UploadRow>): void {
  uploads.set((rows) => rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
}

function row(key: string): UploadRow | undefined {
  return uploads.get().find((r) => r.key === key);
}

export function progress(r: UploadRow): number {
  let bytes = 0;
  for (const n of r.confirmed) bytes += partBytes(n, r.size);
  return r.size ? Math.floor((bytes / r.size) * 100) : 0;
}

const DB = "lintel-drive-uploads";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("bytes");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function keep(id: string, blob: Blob): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("bytes", "readwrite");
    tx.objectStore("bytes").put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function recall(id: string): Promise<Blob | null> {
  const db = await database();
  return new Promise((resolve) => {
    const request = db.transaction("bytes").objectStore("bytes").get(id);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => resolve(null);
  });
}

async function forget(id: string): Promise<void> {
  const db = await database();
  db.transaction("bytes", "readwrite").objectStore("bytes").delete(id);
}

function fromServer(upload: Upload): UploadRow {
  return {
    key: upload.id, id: upload.id, name: upload.name, size: upload.size, contentType: upload.contentType, folderId: upload.folderId,
    state: upload.state === "abandoned" ? "expired" : upload.state === "paused" ? "paused" : "uploading",
    confirmed: new Set(upload.confirmedParts), partCount: upload.partCount,
  };
}

function waitForStorage(key: string): void {
  update(key, { state: "waiting" });
}

/** Sends the parts not yet confirmed, then completes; stops at a pause, a cancel or a storage outage. */
async function run(key: string): Promise<void> {
  if (running.has(key)) return;
  running.add(key);
  try {
    let current = row(key);
    if (!current) return;
    if (!current.id) {
      try {
        const body = await api<{ upload: Upload }>("POST", "/api/uploads",
          { folderId: current.folderId, name: current.name, size: current.size, contentType: current.contentType }, { "Idempotency-Key": key });
        const blob = blobs.get(key);
        if (blob) {
          blobs.set(body.upload.id, blob);
          await keep(body.upload.id, blob).catch(() => undefined);
        }
        update(key, { id: body.upload.id, partCount: body.upload.partCount, state: "uploading" });
      } catch (failure) {
        if (!(failure instanceof ApiError)) throw failure;
        if (failure.code === "storage_unavailable") {
          waitForStorage(key);
          announce(STORAGE_OUTAGE);
        } else {
          uploads.set((rows) => rows.filter((r) => r.key !== key));
          announce(failure.body.fields?.size ?? SOMETHING_WRONG);
        }
        return;
      }
    }
    current = row(key);
    if (!current?.id) return;
    const id = current.id;
    const blob = blobs.get(id) ?? blobs.get(key) ?? await recall(id);
    if (!blob) {
      update(key, { state: "paused" });
      return;
    }
    blobs.set(id, blob);
    for (let n = 1; n <= current.partCount; n++) {
      if (gone.has(key)) return;
      if (pauseAsked.has(key)) {
        pauseAsked.delete(key);
        await call("POST", `/api/uploads/${id}/pause`).catch(() => undefined);
        update(key, { state: "paused" });
        return;
      }
      if (row(key)?.confirmed.has(n)) continue;
      try {
        const body = await putBytes<{ upload: Upload }>(`/api/uploads/${id}/parts/${n}`, blob.slice((n - 1) * PART_SIZE, n * PART_SIZE));
        if (gone.has(key)) return;
        update(key, { confirmed: new Set(body.upload.confirmedParts) });
      } catch (failure) {
        if (!(failure instanceof ApiError) || gone.has(key)) return;
        if (failure.code === "storage_unavailable" || failure.status === 0) waitForStorage(key);
        else if (failure.code === "upload_paused") update(key, { state: "paused" });
        else if (failure.code === "upload_abandoned") update(key, { state: "expired" });
        else announce(SOMETHING_WRONG);
        return;
      }
    }
    if (pauseAsked.has(key)) {
      pauseAsked.delete(key);
      await call("POST", `/api/uploads/${id}/pause`).catch(() => undefined);
      update(key, { state: "paused" });
      return;
    }
    try {
      await call("POST", `/api/uploads/${id}/complete`);
    } catch (failure) {
      if (!(failure instanceof ApiError) || gone.has(key)) return;
      if (failure.code === "storage_unavailable" || failure.status === 0) waitForStorage(key);
      else if (failure.code === "upload_abandoned") update(key, { state: "expired" });
      else announce(SOMETHING_WRONG);
      return;
    }
    update(key, { state: "done", confirmed: new Set(Array.from({ length: current.partCount }, (_, i) => i + 1)) });
    blobs.delete(id);
    blobs.delete(key);
    void forget(id).catch(() => undefined);
    announce(`Uploaded ${current.name}`);
    void refreshFolders();
    void refreshStorage();
    changes.emit("change", "files");
  } finally {
    running.delete(key);
  }
}

export function addFiles(files: File[], folderId: string): void {
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      announce(TOO_BIG);
      continue;
    }
    const key = newKey();
    blobs.set(key, file);
    uploads.set((rows) => [...rows, {
      key, id: null, name: file.name, size: file.size, contentType: file.type || "application/octet-stream", folderId,
      state: "uploading", confirmed: new Set(), partCount: partCount(file.size),
    }]);
    void run(key);
  }
}

export async function pause(key: string): Promise<void> {
  const current = row(key);
  if (!current) return;
  update(key, { state: "paused" });
  if (running.has(key)) {
    pauseAsked.add(key);
    return;
  }
  if (current.id) await call("POST", `/api/uploads/${current.id}/pause`).catch(() => undefined);
}

export async function resume(key: string): Promise<void> {
  const current = row(key);
  if (!current) return;
  pauseAsked.delete(key);
  update(key, { state: "uploading" });
  if (current.id) {
    try {
      await call("POST", `/api/uploads/${current.id}/resume`);
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "upload_abandoned") {
        update(key, { state: "expired" });
        return;
      }
    }
  }
  void run(key);
}

export async function cancel(key: string): Promise<void> {
  const current = row(key);
  if (!current) return;
  gone.add(key);
  pauseAsked.delete(key);
  if (current.id) {
    try {
      await call("DELETE", `/api/uploads/${current.id}`);
    } catch (failure) {
      if (!(failure instanceof ApiError) || failure.status !== 404) {
        gone.delete(key);
        announce(SOMETHING_WRONG);
        return;
      }
    }
    void forget(current.id).catch(() => undefined);
  }
  uploads.set((rows) => rows.filter((r) => r.key !== key));
  announce(`Cancelled upload of ${current.name}`);
}

export async function dismiss(key: string): Promise<void> {
  const current = row(key);
  if (!current) return;
  if (current.state === "expired" && current.id) {
    await call("DELETE", `/api/uploads/${current.id}`).catch(() => undefined);
    void forget(current.id).catch(() => undefined);
  }
  uploads.set((rows) => rows.filter((r) => r.key !== key));
}

/** After a reload: the person's unfinished uploads from the server; ones that were sending carry on. */
export async function restore(): Promise<void> {
  const body = await api<{ uploads: Upload[] }>("GET", "/api/uploads").catch(() => ({ uploads: [] as Upload[] }));
  const known = new Set(uploads.get().map((r) => r.id));
  const fresh = body.uploads.filter((u) => !known.has(u.id)).map(fromServer);
  uploads.set((rows) => [...rows, ...fresh]);
  for (const r of fresh) if (r.state === "uploading") void run(r.key);
}

export function startUploads(): () => void {
  onStorageBack(() => {
    const waiting = uploads.get().filter((r) => r.state === "waiting");
    for (const r of waiting) {
      update(r.key, { state: "uploading" });
      void run(r.key);
    }
    return waiting.length;
  });
  return events.on("upload", ({ upload, expired }) => {
    const existing = uploads.get().find((r) => r.id === upload.id);
    if (!expired) return;
    if (existing?.state === "expired") return;
    if (existing) update(existing.key, { state: "expired" });
    else uploads.set((rows) => [...rows, fromServer(upload)]);
    gone.add(existing?.key ?? upload.id);
    announce(`Upload of ${upload.name} expired`);
  });
}
