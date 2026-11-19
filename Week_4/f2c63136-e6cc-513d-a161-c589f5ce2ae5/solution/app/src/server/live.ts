import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { afterCommit } from './db.ts';
import { config } from './config.ts';
import type { LiveEvent } from '../shared/types.ts';

// One WebSocket per open page, only for users who can see the repository. A WebSocket is not a pending request, so an
// open page still reaches network idle; the server only ever sends text frames.
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const subscribers = new Map<number, Set<Duplex>>();
let pending: { repoId: number; event: LiveEvent }[] = [];
let scheduled: NodeJS.Timeout | null = null;

function frame(opcode: number, payload: Buffer): Buffer {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | opcode, 127, 0, 0, 0, 0]), Buffer.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])]);
  return Buffer.concat([head, payload]);
}

export function subscribe(repoId: number, req: IncomingMessage, socket: Duplex): void {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string') {
    socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
    return;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${accept}\r\n\r\n`);
  const set = subscribers.get(repoId) ?? new Set();
  subscribers.set(repoId, set);
  set.add(socket);
  const beat = setInterval(() => socket.write(frame(0x9, Buffer.alloc(0))), 20000);
  const drop = () => {
    clearInterval(beat);
    set.delete(socket);
  };
  // Clients send nothing but control frames: answer a close, ignore the rest.
  socket.on('data', (chunk: Buffer) => {
    if ((chunk[0] & 0x0f) === 0x8) socket.end(frame(0x8, Buffer.alloc(0)));
  });
  socket.on('close', drop);
  socket.on('error', drop);
}

/** Sends everything queued so far; the clock route calls it before it answers. */
export function flushLive(): void {
  if (scheduled) clearTimeout(scheduled);
  scheduled = null;
  const batch = pending;
  pending = [];
  for (const { repoId, event } of batch) {
    const data = frame(0x1, Buffer.from(JSON.stringify(event)));
    for (const socket of subscribers.get(repoId) ?? []) socket.write(data);
  }
}

afterCommit.publish = (repoId, event) => {
  pending.push({ repoId, event });
  // Events are coalesced for a quarter of the allowed delay, which leaves the rest for the network.
  scheduled ??= setTimeout(flushLive, config.liveUpdateDelayMs / 4);
};
