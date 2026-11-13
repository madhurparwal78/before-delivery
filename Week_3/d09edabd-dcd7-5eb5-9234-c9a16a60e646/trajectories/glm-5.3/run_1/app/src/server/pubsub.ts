import { subscribe as sub } from './valkey.js';

/** SSE rooms stream on the room channel. */
export async function subscribeRoom(roomId: string, fn: (msg: string) => void): Promise<{ unsubscribe: () => void }> {
  const off = await sub(`room:${roomId}`, fn);
  return { unsubscribe: off };
}

/** SSE playtest streams on the session channel. */
export async function subscribeSession(sessionId: string, fn: (msg: string) => void): Promise<{ unsubscribe: () => void }> {
  const off = await sub(`playtest:${sessionId}`, fn);
  return { unsubscribe: off };
}
