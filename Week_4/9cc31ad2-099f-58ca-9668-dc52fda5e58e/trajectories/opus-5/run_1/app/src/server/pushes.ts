import type { WebSocket } from 'ws';

export interface BoardRowBody {
  rank: number;
  playerId: string;
  name: string;
  runId: string;
  carId: string;
  value: number;
  unit: 'ms' | 'points';
  gapMs: number | null;
  topSpeedMps: number;
  replaySha256: string | null;
  mine: boolean;
}

export type PlayerPush =
  | { type: 'balance'; balance: number; movementId: string; purchaseId: string | null }
  | { type: 'run'; runId: string; status: string }
  | ({ type: 'championship' } & Record<string, unknown>)
  | ({ type: 'lobby' } & Record<string, unknown>);

const connections = new Map<string, Set<WebSocket>>();

export function addConnection(playerId: string, socket: WebSocket): void {
  const existing = connections.get(playerId);
  if (existing) existing.add(socket);
  else connections.set(playerId, new Set([socket]));
}

export function removeConnection(playerId: string, socket: WebSocket): void {
  const existing = connections.get(playerId);
  if (!existing) return;
  existing.delete(socket);
  if (existing.size === 0) connections.delete(playerId);
}

export function isConnected(playerId: string): boolean {
  return connections.has(playerId);
}

export function pushToPlayer(playerId: string, message: PlayerPush): void {
  const sockets = connections.get(playerId);
  if (!sockets) return;
  const payload = JSON.stringify(message);
  for (const socket of sockets) socket.send(payload);
}

export function pushToPlayers(playerIds: string[], message: PlayerPush): void {
  for (const playerId of playerIds) pushToPlayer(playerId, message);
}

/** A board push reaches every connection; only the row's own player sees `mine`. */
export function pushBoard(
  layoutId: string,
  mode: string,
  className: string,
  row: BoardRowBody,
): void {
  for (const [playerId, sockets] of connections) {
    const payload = JSON.stringify({
      type: 'board',
      layoutId,
      mode,
      class: className,
      row: { ...row, mine: playerId === row.playerId },
    });
    for (const socket of sockets) socket.send(payload);
  }
}
