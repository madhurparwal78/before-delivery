import { BACKUP_POLL_WINDOW_MS } from "../shared/schemas.js";
import { nowMs } from "./clock.js";

type Entry = { seatId: string | null; stream: boolean; polledAt: number };

// Who is connected, held per process: an open stream, or a poll within the last 30 seconds on the backup link.
const rooms = new Map<string, Map<string, Entry>>();

function entries(roomId: string): Map<string, Entry> {
  let found = rooms.get(roomId);
  if (!found) {
    found = new Map();
    rooms.set(roomId, found);
  }
  return found;
}

export function streamOpened(roomId: string, clientKey: string, seatId: string | null): void {
  entries(roomId).set(clientKey, { seatId, stream: true, polledAt: nowMs() });
}

export function streamClosed(roomId: string, clientKey: string): void {
  entries(roomId).delete(clientKey);
}

export function polled(roomId: string, clientKey: string, seatId: string | null): void {
  const existing = entries(roomId).get(clientKey);
  if (existing?.stream) return;
  entries(roomId).set(clientKey, { seatId, stream: false, polledAt: nowMs() });
}

export function retire(roomId: string, clientKeys: string[]): void {
  for (const clientKey of clientKeys) entries(roomId).delete(clientKey);
}

const isConnected = (entry: Entry): boolean => entry.stream || nowMs() - entry.polledAt <= BACKUP_POLL_WINDOW_MS;

export function connectedSeats(roomId: string): Set<string> {
  const seats = new Set<string>();
  for (const entry of entries(roomId).values()) if (entry.seatId && isConnected(entry)) seats.add(entry.seatId);
  return seats;
}

export function connectedClientCount(roomId: string): number {
  return [...entries(roomId).values()].filter(isConnected).length;
}

export function openStreamClients(roomId: string): string[] {
  return [...entries(roomId)].filter(([, entry]) => entry.stream).map(([clientKey]) => clientKey);
}

export function forgetRoom(roomId: string): void {
  rooms.delete(roomId);
}
