import type { Lock, LockHolder, Placement, RoomDetail, Room, Session, TriggerNode, Version } from '../../shared/types';
import { forgetLock, lostLock, rememberLock } from './locks';
import { putNode, putPlacement, putVersion, removeNode, removePlacement } from './mutate';
import { applySessionEvent } from './play';
import { editor, say } from './state';
import { refreshRoom } from './rooms';

let source: EventSource | null = null;

export function disconnectLive(): void {
  source?.close();
  source = null;
}

const json = <T>(event: Event): T => JSON.parse((event as MessageEvent<string>).data) as T;

function listen<T>(es: EventSource, name: string, handler: (data: T) => void): void {
  es.addEventListener(name, (event) => handler(json<T>(event)));
}

function applyRoom(room: Room): void {
  editor.set((s) => ({ room: s.roomId === room.id ? room : s.room, rooms: s.rooms.map((r) => (r.id === room.id ? room : r)) }));
}

export function connectLive(roomId: string): void {
  disconnectLive();
  const es = new EventSource(`/api/rooms/${roomId}/events`);
  source = es;
  let opened = false;
  es.onopen = () => {
    if (opened) void refreshRoom();
    opened = true;
  };
  listen<{ available: boolean }>(es, 'live', ({ available }) => editor.set({ live: available }));
  listen<{ members: LockHolder[] }>(es, 'presence', ({ members }) => editor.set({ members }));
  listen<{ placement: Placement } | { deletedId: string }>(es, 'placement', (data) => ('placement' in data ? putPlacement(data.placement) : removePlacement(data.deletedId)));
  listen<{ node: TriggerNode; chainOrder: string[] } | { deletedId: string; chainOrder: string[] }>(es, 'node', (data) =>
    'node' in data ? putNode(data.node, data.chainOrder) : removeNode(data.deletedId, data.chainOrder),
  );
  listen<{ room: Room; sceneOrder?: string[] }>(es, 'room', ({ room, sceneOrder }) => {
    applyRoom(room);
    if (sceneOrder) editor.set({ sceneOrder });
  });
  listen<{ lock: Lock; takenFrom?: LockHolder } | { released: { targetType: Lock['targetType']; targetId: string } }>(es, 'lock', (data) => {
    if ('released' in data) return forgetLock(data.released.targetType, data.released.targetId);
    const { lock, takenFrom } = data;
    rememberLock(lock.targetType, lock.targetId, lock.holder, lock.expiresInSeconds);
    if (takenFrom?.userId === editor.get().me?.id) {
      lostLock(lock.targetType, lock.targetId);
      const label = lock.targetType === 'placement' ? editor.get().placements.find((p) => p.id === lock.targetId)?.label : editor.get().nodes.find((n) => n.id === lock.targetId)?.title;
      say(`${lock.holder.displayName} took over ${label ?? 'it'}.`);
    }
  });
  listen<{ version: Version }>(es, 'version', ({ version }) => putVersion(version));
  listen<{ session: Session }>(es, 'session', ({ session }) => applySessionEvent(session));
  listen<{ sessionId: string; displayName: string | null; xMm: number; zMm: number; headingDeg: number }>(es, 'tester', (t) =>
    editor.set((s) => ({
      testers: [...s.testers.filter((m) => m.id !== t.displayName), { id: t.displayName ?? t.sessionId, label: t.displayName ?? 'Tester', xMm: t.xMm, zMm: t.zMm, headingDeg: t.headingDeg }],
    })),
  );
  listen<RoomDetail & { revision: number }>(es, 'restore', (restored) => {
    editor.set((s) => ({
      room: restored.room, placements: restored.placements, nodes: restored.nodes, sceneOrder: restored.sceneOrder,
      rooms: s.rooms.map((r) => (r.id === restored.room.id ? restored.room : r)),
      selectedId: restored.placements.some((p) => p.id === s.selectedId) ? s.selectedId : null,
      selectedNodeId: restored.nodes.some((n) => n.id === s.selectedNodeId) ? s.selectedNodeId : null,
    }));
  });
}

