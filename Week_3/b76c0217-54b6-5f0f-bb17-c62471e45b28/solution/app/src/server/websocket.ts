// The server end of a WebSocket (RFC 6455) for the live event streams: text frames go out, and only ping and close
// come in. A browser does not count an open socket as network activity, so a page that follows live events still
// reaches network idle, which a held-open event stream would not.

import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const TEXT = 0x1;
const CLOSE = 0x8;
const PING = 0x9;
const PONG = 0xa;
const LARGEST_INCOMING = 65_536;

/** What an event stream writes to: one open socket. */
export interface Sink {
  write: (text: string) => void;
  ping: () => void;
  onClose: (listener: () => void) => void;
}

function frame(opcode: number, payload: Buffer): Buffer {
  const size = payload.length;
  let head: Buffer;
  if (size < 126) {
    head = Buffer.from([0x80 | opcode, size]);
  } else if (size < 65_536) {
    head = Buffer.from([0x80 | opcode, 126, size >> 8, size & 0xff]);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(size), 2);
  }
  return Buffer.concat([head, payload]);
}

/** Read the client's frames from `buffer`; returns what is left over once whole frames are handled. */
function readFrames(buffer: Buffer, on: (opcode: number, payload: Buffer) => void): Buffer | null {
  let rest = buffer;
  while (rest.length >= 2) {
    const masked = (rest[1] ?? 0) & 0x80;
    let size = (rest[1] ?? 0) & 0x7f;
    let offset = 2;
    if (size === 126 || size === 127) {
      const width = size === 126 ? 2 : 8;
      if (rest.length < offset + width) {
        break;
      }
      size = size === 126 ? rest.readUInt16BE(offset) : Number(rest.readBigUInt64BE(offset));
      offset += width;
    }
    if (size > LARGEST_INCOMING) {
      return null;
    }
    const total = offset + (masked ? 4 : 0) + size;
    if (rest.length < total) {
      break;
    }
    const payload = Buffer.from(rest.subarray(offset + (masked ? 4 : 0), total));
    if (masked) {
      const key = rest.subarray(offset, offset + 4);
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] = (payload[index] ?? 0) ^ (key[index % 4] ?? 0);
      }
    }
    on((rest[0] ?? 0) & 0x0f, payload);
    rest = rest.subarray(total);
  }
  return rest;
}

/** Complete the opening handshake on `socket` (the caller has checked the upgrade request) and return its sink. */
export function acceptWebSocket(key: string, socket: Duplex): Sink {
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const send = (opcode: number, payload: Buffer): void => {
    if (socket.writable) {
      socket.write(frame(opcode, payload));
    }
  };
  let pending: Buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const rest = readFrames(Buffer.concat([pending, chunk]), (opcode, payload) => {
      if (opcode === PING) {
        send(PONG, payload);
      } else if (opcode === CLOSE) {
        send(CLOSE, Buffer.alloc(0));
        socket.end();
      }
    });
    if (rest === null) {
      socket.destroy();
      return;
    }
    pending = rest;
  });
  socket.on('error', () => socket.destroy());
  return {
    write: (text) => send(TEXT, Buffer.from(text)),
    ping: () => send(PING, Buffer.alloc(0)),
    onClose: (listener) => {
      socket.on('close', listener);
    },
  };
}
