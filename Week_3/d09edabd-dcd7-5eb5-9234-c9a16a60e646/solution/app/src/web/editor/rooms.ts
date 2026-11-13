import { ApiFailure, get, post } from '../api';
import { navigate } from '../nav';
import type { Room, RoomDetail, Session, User, Workspace } from '../../shared/types';
import { renderThumbnail, toPng } from '../three/thumbnail';
import type { DrawPlacement } from '../three/roomView';
import { connectLive, disconnectLive } from './live';
import { releaseAllLocks } from './locks';
import { loadQueue, pump } from './queue';
import { closeDialog, editor, openDialog } from './state';
import { beginPlay, loadSessions } from './play';

const HEALTH_MS = 3000;

export async function loadIdentity(): Promise<boolean> {
  try {
    const me = await get<{ user: User; workspace: Workspace }>('/api/me');
    editor.set({ me: me.user, workspaceName: me.workspace.name });
    return true;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 401) return false;
    throw error;
  }
}

export async function loadRooms(): Promise<void> {
  const { rooms } = await get<{ rooms: Room[] }>('/api/rooms');
  editor.set({ rooms, roomsLoaded: true });
}

async function loadLatestSession(id: string | null): Promise<void> {
  if (!id) return editor.set({ latestSession: null });
  const { session } = await get<{ session: Session }>(`/api/playtests/${id}`);
  editor.set({ latestSession: session });
}

function applyDetail(detail: RoomDetail): void {
  editor.set((s) => ({
    room: detail.room, placements: detail.placements, nodes: detail.nodes, sceneOrder: detail.sceneOrder, session: detail.activeSession,
    rooms: s.rooms.map((r) => (r.id === detail.room.id ? detail.room : r)),
    selectedId: detail.placements.some((p) => p.id === s.selectedId) ? s.selectedId : null,
  }));
  void loadLatestSession(detail.latestSessionId).catch(() => undefined);
}

/** Reloads the open room from the server (a refused or stale change redraws the room as stored). */
export async function refreshRoom(): Promise<void> {
  const id = editor.get().roomId;
  if (!id) return;
  const detail = await get<RoomDetail>(`/api/rooms/${id}`).catch(() => null);
  if (detail && editor.get().roomId === id) applyDetail(detail);
}

/** Opens a room for editing at the overview, and walks in when asked. */
export async function openRoom(id: string, walkIn: boolean): Promise<void> {
  closeDialog('picker');
  if (editor.get().roomId !== id) {
    releaseAllLocks();
    disconnectLive();
    editor.set({
      roomId: id, room: null, placements: [], nodes: [], sceneOrder: [], queue: loadQueue(id), offline: false, selectedId: null, selectedNodeId: null, session: null, latestSession: null,
      preview: null, testers: [], versions: [], sessions: [], locks: {}, dropSteps: {}, drop: null, debrief: null, mode: 'move',
      cam: { target: 'overview', yaw: 30, pitch: 35, zoom: 1, label: 'Overview', nonce: editor.get().cam.nonce + 1 },
    });
    navigate(`/app/rooms/${id}`);
    const detail = await get<RoomDetail>(`/api/rooms/${id}`);
    if (editor.get().roomId !== id) return;
    applyDetail(detail);
    connectLive(id);
    pump();
    void loadSessions().catch(() => undefined);
  }
  if (walkIn) await beginPlay();
}

let polling = false;

/** Service banners clear within 10 seconds of the service returning: health is read now and every few seconds. */
export function startHealthPolling(): void {
  if (polling) return;
  polling = true;
  const read = async (): Promise<void> => {
    try {
      const health = await get<{ services: Record<'postgres' | 'valkey' | 'minio' | 'mail', 'up' | 'down'> }>('/api/health');
      editor.set({ storageUp: health.services.minio === 'up' });
    } catch {
      // The next read will tell.
    }
  };
  void read();
  window.setInterval(() => void read(), HEALTH_MS);
}

const drawn = (placements: RoomDetail['placements']): DrawPlacement[] => placements;

const inflight = new Set<string>();

/** Card renders wait while the open room's playtest runs, so the stage is the only thing drawing then. */
function playtestOver(): Promise<void> {
  const running = (): boolean => editor.get().session?.state === 'running';
  if (!running()) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = editor.subscribe(() => {
      if (running()) return;
      stop();
      resolve();
    });
  });
}
let renders: Promise<void> = Promise.resolve();

/** A card's thumbnail: the stored picture, else a live render from the room's own primitives (also stored when storage is up), one render at a time. */
export function ensureThumbnail(room: Room): Promise<void> {
  if (room.thumbnailUrl || inflight.has(room.id)) return Promise.resolve();
  inflight.add(room.id);
  renders = renders.then(async () => {
    try {
      await playtestOver();
      await storeThumbnail(await get<RoomDetail>(`/api/rooms/${room.id}`));
    } catch {
      // The card keeps its placeholder until the next try.
    } finally {
      inflight.delete(room.id);
    }
  });
  return renders;
}

async function storeThumbnail(detail: RoomDetail): Promise<void> {
  const canvas = renderThumbnail(detail.room, drawn(detail.placements));
  if (!canvas) return;
  editor.set((s) => ({ liveThumbs: { ...s.liveThumbs, [detail.room.id]: canvas.toDataURL('image/png') } }));
  if (!editor.get().storageUp) return;
  const png = await toPng(canvas);
  // keepalive (allowed up to 64 KiB) lets the store finish when the member leaves the page mid-render instead of being aborted.
  if (png) await fetch(`/api/rooms/${detail.room.id}/thumbnail`, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png, credentials: 'same-origin', keepalive: png.size < 60_000 }).catch(() => undefined);
}

/** Re-renders the open room's thumbnail once edits have stopped. */
export async function refreshOpenThumbnail(): Promise<void> {
  const { room, placements } = editor.get();
  if (!room) return;
  await storeThumbnail({ room, placements, nodes: [], sceneOrder: [], activeSession: null, latestSessionId: null });
}

export async function createRoom(input: { name: string; widthMm: number; depthMm: number; heightMm: number }): Promise<Room> {
  const { room } = await post<{ room: Room }>('/api/rooms', input);
  editor.set((s) => ({ rooms: [...s.rooms, room].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })) }));
  return room;
}

export function openPicker(): void {
  openDialog('picker');
  void loadRooms().catch(() => undefined);
}

