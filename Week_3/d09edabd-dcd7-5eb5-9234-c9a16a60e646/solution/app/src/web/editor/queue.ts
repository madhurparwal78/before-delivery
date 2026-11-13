import { EDITS_PAUSED } from './copy';
import { editor, say } from './state';
import { newOpId, type PlacementFields, type QueuedChange } from './model';
import type { Placement } from '../../shared/types';
import { refreshRoom } from './rooms';
import { rememberLock } from './locks';
import { putPlacement, removePlacement } from './mutate';

const KEY = 'kb-queue:';
const RETRY_MS = 5000;

let sending = false;
let retry: number | undefined;

export function loadQueue(roomId: string): QueuedChange[] {
  try {
    return JSON.parse(localStorage.getItem(KEY + roomId) ?? '[]') as QueuedChange[];
  } catch {
    return [];
  }
}

function persist(roomId: string, queue: QueuedChange[]): void {
  try {
    if (queue.length === 0) localStorage.removeItem(KEY + roomId);
    else localStorage.setItem(KEY + roomId, JSON.stringify(queue));
  } catch {
    // Storage may be unavailable; the queue then lives for this page only.
  }
}

function setQueue(roomId: string, queue: QueuedChange[]): void {
  persist(roomId, queue);
  if (editor.get().roomId === roomId) editor.set({ queue, offline: queue.length === 0 ? false : editor.get().offline });
}

/** Adds a change to the room's save queue and starts sending. */
export function enqueue(change: QueuedChange): void {
  const { roomId, queue } = editor.get();
  if (!roomId) return;
  setQueue(roomId, [...queue, change]);
  pump();
}

export function startQueue(): void {
  window.addEventListener('online', () => {
    window.clearTimeout(retry);
    retry = undefined;
    sending = false;
    pump();
  });
  pump();
}

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

async function transmit(roomId: string, change: QueuedChange): Promise<Answer> {
  const base = `/api/rooms/${roomId}/placements/${change.placementId}`;
  const headers = { 'content-type': 'application/json', 'op-id': change.opId };
  const response =
    change.kind === 'update'
      ? await fetch(base, { method: 'PATCH', headers, body: JSON.stringify({ version: change.baseVersion, ...change.fields }), credentials: 'same-origin' })
      : change.kind === 'delete'
        ? await fetch(base, { method: 'DELETE', headers, credentials: 'same-origin' })
        : await fetch(`${base}/scene-move`, { method: 'POST', headers, body: JSON.stringify({ direction: change.direction }), credentials: 'same-origin' });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

/** Sends the front change; one at a time, oldest first. */
export function pump(): void {
  const { roomId, queue } = editor.get();
  if (sending || !roomId || queue.length === 0) return;
  sending = true;
  const change = queue[0]!;
  transmit(roomId, change).then(
    (answer) => {
      sending = false;
      settle(roomId, change, answer);
      pump();
    },
    () => {
      sending = false;
      editor.set({ offline: true });
      retry = window.setTimeout(() => {
        retry = undefined;
        pump();
      }, RETRY_MS);
    },
  );
}

const deletedBy = (body: Record<string, unknown>): string => (body.deletedBy as { displayName: string } | null)?.displayName ?? 'someone';

/** Later changes to a placement are sent against the version the server just returned for it. */
function rebase(queue: QueuedChange[], placementId: string, version: number): QueuedChange[] {
  return queue.map((c) => (c.placementId === placementId && c.kind !== 'move' ? { ...c, baseVersion: version } : c));
}

function settle(roomId: string, change: QueuedChange, { status, body }: Answer): void {
  const rest = editor.get().queue.slice(1);
  if (editor.get().roomId !== roomId) {
    persist(roomId, rest);
    return;
  }
  let queue = rest;
  if (status === 200 && change.kind === 'update') {
    const placement = body.placement as Placement;
    putPlacement(placement);
    queue = rebase(queue, change.placementId, placement.version);
  } else if (status === 200) {
    editor.set({ sceneOrder: body.sceneOrder as string[] });
  } else if (status === 204) {
    removePlacement(change.placementId);
  } else if (status === 412 && change.kind !== 'move') {
    const current = body.current as Placement;
    putPlacement(current);
    queue = rebase(queue, change.placementId, current.version);
    say('Someone saved a newer change. Your view has been refreshed.');
  } else if (status === 410) {
    removePlacement(change.placementId);
    say(`${change.label} was deleted by ${deletedBy(body)}. Your change was not saved.`);
  } else if (status === 409 && body.error === 'locked') {
    const holder = body.holder as { userId: string; displayName: string };
    rememberLock('placement', change.placementId, holder, Number(body.expiresInSeconds ?? 0));
    say(`${holder.displayName} is holding this prop.`);
  } else if (status === 409 && body.error === 'playtest_running') {
    say(EDITS_PAUSED);
  } else {
    const first = Object.values((body.errors as Record<string, string> | undefined) ?? {})[0];
    if (first) say(first);
    void refreshRoom();
  }
  setQueue(roomId, queue);
}

export const updateChange = (placement: Placement, fields: Partial<PlacementFields>): QueuedChange => ({
  opId: newOpId(), kind: 'update', placementId: placement.id, label: placement.label, fields, baseVersion: placement.version,
});
