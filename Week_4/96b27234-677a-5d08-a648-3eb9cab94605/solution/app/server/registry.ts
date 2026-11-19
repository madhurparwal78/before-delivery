import { WebSocket } from "ws";

/** One open socket of this instance: a room socket (sessionId set) or a person's own socket. */
export interface Conn {
  ws: WebSocket;
  personId: string;
  worldId: string;
  sessionId: string | null;
  chain: Promise<void>;
}

export const sessionConns = new Map<string, Set<Conn>>();
export const meConns = new Map<string, Set<Conn>>();

export function track(registry: Map<string, Set<Conn>>, key: string, conn: Conn): void {
  const set = registry.get(key) ?? new Set<Conn>();
  set.add(conn);
  registry.set(key, set);
}

export function untrack(registry: Map<string, Set<Conn>>, key: string, conn: Conn): void {
  const set = registry.get(key);
  set?.delete(conn);
  if (set?.size === 0) registry.delete(key);
}

export function send(conn: Conn, frame: unknown): void {
  if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(frame));
}

/** Work for one socket runs in order, so frames of one viewer never overtake each other. */
export function enqueue(conn: Conn, work: () => Promise<void>): void {
  conn.chain = conn.chain.then(work).catch(() => undefined);
}
