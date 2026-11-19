import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

/** RFC 6455 text frames for the live channel: the server pushes snapshots, the browser sends its focus. */
const HANDSHAKE_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MESSAGE_LIMIT = 4096;
const TEXT = 0x1;
const CLOSE = 0x8;
const PING = 0x9;
const PONG = 0xa;

export interface LiveSocket {
  send(text: string): void;
  ping(): void;
  close(): void;
}

interface SocketEvents {
  text(message: string): void;
  heard(): void;
  closed(): void;
}

function frame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  const head = length < 126 ? Buffer.alloc(2) : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (length < 126) head[1] = length;
  else if (length < 65536) {
    head[1] = 126;
    head.writeUInt16BE(length, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([head, payload]);
}

/** Completes the upgrade handshake and reads the browser's masked frames. */
export function acceptSocket(req: IncomingMessage, socket: Duplex, events: SocketEvents): LiveSocket {
  const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"] ?? ""}${HANDSHAKE_GUID}`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);

  let pending = Buffer.alloc(0);
  let open = true;
  const write = (opcode: number, payload: Buffer) => {
    if (open) socket.write(frame(opcode, payload));
  };
  const close = () => {
    if (!open) return;
    write(CLOSE, Buffer.alloc(0));
    open = false;
    socket.end();
  };

  socket.on("data", (chunk: Buffer) => {
    events.heard();
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2) {
      const opcode = pending[0] & 0x0f;
      const finished = (pending[0] & 0x80) !== 0;
      const masked = (pending[1] & 0x80) !== 0;
      let length = pending[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (pending.length < 4) return;
        length = pending.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        close();
        return;
      }
      if (!finished || !masked || length > MESSAGE_LIMIT) {
        close();
        return;
      }
      if (pending.length < offset + 4 + length) return;
      const mask = pending.subarray(offset, offset + 4);
      const payload = Buffer.from(pending.subarray(offset + 4, offset + 4 + length));
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      pending = pending.subarray(offset + 4 + length);
      if (opcode === TEXT) events.text(payload.toString("utf8"));
      else if (opcode === PING) write(PONG, payload);
      else if (opcode === CLOSE) close();
    }
  });
  socket.on("close", () => {
    open = false;
    events.closed();
  });
  socket.on("error", () => socket.destroy());

  return {
    send: (text) => write(TEXT, Buffer.from(text, "utf8")),
    ping: () => write(PING, Buffer.alloc(0)),
    close,
  };
}
