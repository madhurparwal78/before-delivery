// Shared signed-in state: who is signed in, service status, the visible folders, the storage meter, notices, the
// cut set and the homing-flight count holds. Pushed events refresh what they touch.
import { api, ApiError } from "./api";
import { announce } from "./announce";
import { events } from "./live";
import { Bus, Store } from "./store";
import { noticeCopy, STORAGE_BACK, STORAGE_OUTAGE, UPLOADS_RESUMED } from "./copy";
import type { Folder, Person, ServiceStatus } from "../shared/api";

export const session = new Store<Person | null | undefined>(undefined);
export const serviceStatus = new Store<ServiceStatus>({ storage: "up", directory: "up" });
export const folders = new Store<Folder[]>([]);
export const storageFigures = new Store<{ usedBytes: number; binBytes: number; quotaBytes: number } | null>(null);
export const notices = new Store<{ id: number; text: string }[]>([]);
/** The folder open in the centre, where New › Upload files and New folder act. */
export const currentFolder = new Store<Folder | null>(null);
/** Files marked by Ctrl X, with the folder each was in when cut. */
export const cut = new Store<{ fileId: string; fromFolderId: string }[]>([]);
/** Folder counts held at their old value while a homing flight is in the air. */
export const heldCounts = new Store<Record<string, number>>({});
/** The reduced-motion "+n" badge on a destination, until focus next moves. */
export const plusBadge = new Store<{ folderId: string | null; n: number } | null>(null);

type ChangeKind = "files" | "moved" | "folders" | "grants" | "access" | "handovers" | "policies" | "day" | "all";
/** Screens listen here and refetch what they show. */
export const changes = new Bus<{ change: ChangeKind }>();

export const isStaff = (person: Person | null | undefined): boolean => person?.kind === "staff";

let noticeId = 0;
const MAX_NOTICES = 5;

/** A notice stays in the Notices region until dismissed, five at most, newest first; it is announced once. */
export function pushNotice(text: string): void {
  notices.set((list) => [{ id: ++noticeId, text }, ...list].slice(0, MAX_NOTICES));
  announce(text);
}

export function dismissNotice(id: number): void {
  notices.set((list) => list.filter((n) => n.id !== id));
}

export async function refreshFolders(): Promise<void> {
  try {
    folders.set((await api<{ folders: Folder[] }>("GET", "/api/folders")).folders);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }
}

export async function refreshStorage(): Promise<void> {
  if (!isStaff(session.get())) return;
  try {
    storageFigures.set(await api<{ usedBytes: number; binBytes: number; quotaBytes: number }>("GET", "/api/storage"));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }
}

/** Uploads waiting for storage resume when it returns; set by the upload manager. */
let resumeWaiting: () => number = () => 0;
export function onStorageBack(handler: () => number): void {
  resumeWaiting = handler;
}

function applyStatus(next: ServiceStatus, live: boolean): void {
  const before = serviceStatus.get();
  serviceStatus.set(next);
  if (!live) return;
  if (before.storage === "up" && next.storage === "down") announce(STORAGE_OUTAGE);
  if (before.storage === "down" && next.storage === "up") {
    const resumed = resumeWaiting();
    announce(STORAGE_BACK + (resumed ? UPLOADS_RESUMED : ""));
  }
}

let statusSeen = false;

export async function loadStatus(): Promise<void> {
  try {
    applyStatus(await api<ServiceStatus>("GET", "/api/status"), false);
    statusSeen = true;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }
}

function emit(change: ChangeKind): void {
  changes.emit("change", change);
}

export function wireEvents(): void {
  events.on("status", (next) => {
    applyStatus(next, statusSeen);
    statusSeen = true;
  });
  events.on("files", (data) => {
    void refreshFolders();
    if (data.storage) void refreshStorage();
    emit("files");
  });
  events.on("moved", () => emit("moved"));
  events.on("folders", () => {
    void refreshFolders();
    emit("folders");
  });
  events.on("grants", () => emit("grants"));
  events.on("access", (data) => {
    if (data.notice) pushNotice(noticeCopy(data.notice));
    void refreshFolders();
    emit("access");
  });
  events.on("handovers", (data) => {
    if (data.notice) pushNotice(noticeCopy(data.notice));
    void refreshFolders();
    emit("handovers");
  });
  events.on("policies", () => emit("policies"));
  events.on("day", () => emit("day"));
  events.on("reconnected", () => {
    void refreshFolders();
    void refreshStorage();
    void loadStatus();
    emit("all");
  });
}

/** Coalesces bursts of pushed changes into one refetch per microtask. */
export function coalesce(work: () => void): () => void {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      work();
    });
  };
}
