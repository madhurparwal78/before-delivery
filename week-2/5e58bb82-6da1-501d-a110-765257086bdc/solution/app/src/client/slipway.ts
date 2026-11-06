// Slipway state the phone holds: line-file transfers with progress, the one held upload, and the offline queue.
import { currentEpoch, NoResponse, Stale, type ApiError } from "./api";
import { onSignOut } from "./session";

const RESUMABLE_OVER = 8_000_000;

interface Sent {
  status: number;
  body: (ApiError & Record<string, unknown>) | null;
}

function xhr(method: string, url: string, body: Blob | string, headers: Record<string, string>, onProgress: (sent: number) => void): Promise<Sent> {
  const epoch = currentEpoch();
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url);
    for (const [k, v] of Object.entries(headers)) request.setRequestHeader(k, v);
    request.upload.onprogress = (e) => onProgress(e.loaded);
    request.onload = () => {
      if (epoch !== currentEpoch()) return reject(new Stale());
      let parsed: Sent["body"] = null;
      try {
        parsed = request.responseText ? JSON.parse(request.responseText) : null;
      } catch {
        parsed = null;
      }
      resolve({ status: request.status, body: parsed });
    };
    request.onerror = () => reject(epoch !== currentEpoch() ? new Stale() : new NoResponse());
    request.onabort = request.onerror;
    request.send(body);
  });
}

/**
 * Sends a line file: one PUT, or resumable 4,000,000-byte parts for files over 8,000,000 bytes.
 * `onPercent` never reports above 99 before the server answers.
 */
export async function sendLineFile(lineId: string, file: File, sha: string, onPercent: (n: number) => void): Promise<Sent> {
  const percent = (done: number) => onPercent(Math.min(99, Math.floor((done / Math.max(1, file.size)) * 100)));
  if (file.size <= RESUMABLE_OVER) {
    return xhr("PUT", `/api/lines/${lineId}/file`, file, {
      "Content-Type": "application/octet-stream", "X-Line-File-Name": file.name, "X-Content-SHA256": sha,
    }, percent);
  }
  const open = () => xhr("POST", `/api/lines/${lineId}/uploads`, JSON.stringify({ size_bytes: file.size, sha256: sha }), { "Content-Type": "application/json" }, () => undefined);
  let session = await open();
  for (;;) {
    // A refusal, or the replay of an identical file already stored, ends the transfer.
    const upload = session.body as { upload_id?: string; part_bytes?: number; received_bytes?: number } | null;
    if (session.status >= 300 || !upload?.upload_id) return session;
    let received = Number(upload.received_bytes ?? 0);
    percent(received);
    try {
      for (;;) {
        const part = file.slice(received, Math.min(file.size, received + Number(upload.part_bytes ?? 4_000_000)));
        const r = await xhr("PUT", `/api/lines/${lineId}/uploads/${upload.upload_id}`, part, {
          "Content-Type": "application/octet-stream", "Content-Range": `bytes ${received}-${received + part.size - 1}/${file.size}`, "X-Line-File-Name": file.name,
        }, (n) => percent(received + n));
        if (r.status !== 200) return r;
        received = Number((r.body as { received_bytes?: number } | null)?.received_bytes ?? received);
        percent(received);
      }
    } catch (error) {
      if (!(error instanceof NoResponse)) throw error;
      session = await open();
    }
  }
}

// --- the one held upload: waiting for storage to return ---

export interface Held {
  lineId: string;
  label: string;
  missionId: string;
  file: File;
  sha: string;
}

let held: Held | null = null;
const heldListeners = new Set<() => void>();

export const heldUpload = () => held;
export function setHeld(next: Held | null): void {
  held = next;
  for (const l of heldListeners) l();
}
export function onHeldChange(listener: () => void): () => void {
  heldListeners.add(listener);
  return () => heldListeners.delete(listener);
}

// --- actions taken while the phone is offline ---

export type QueuedAction = "afloat" | "recovered" | "service";

export interface Queued {
  id: string;
  vesselId: string;
  vesselName: string;
  action: QueuedAction;
  key: string;
  note?: string;
  at: number;
}

const queueKey = (userId: string) => `swathdeck.waiting.${userId}`;

export function readQueue(userId: string): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(queueKey(userId)) ?? "[]");
  } catch {
    return [];
  }
}

export function writeQueue(userId: string, items: Queued[]): void {
  if (items.length) localStorage.setItem(queueKey(userId), JSON.stringify(items));
  else localStorage.removeItem(queueKey(userId));
}

onSignOut(() => {
  setHeld(null);
  for (const key of Object.keys(localStorage)) if (key.startsWith("swathdeck.waiting.")) localStorage.removeItem(key);
});
