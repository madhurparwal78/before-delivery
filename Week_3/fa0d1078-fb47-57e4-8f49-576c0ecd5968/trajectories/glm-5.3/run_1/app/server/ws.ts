import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';

// A minimal RFC 6455 WebSocket server implementation: just enough for the
// app's one socket per page, text frames only, server-side close.

const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface WebSocket {
  send(text: string): void;
  close(code: number, reason: string): void;
  onMessage(handler: (data: Buffer) => void): void;
  onClose(handler: () => void): void;
}

interface Frame {
  opcode: number;
  payload: Buffer;
  fin: boolean;
}

export class WebSocketServer {
  private handler: ((client: WebSocket, req: IncomingMessage) => void) | null = null;

  constructor(server: import('node:http').Server) {
    const typed = server as unknown as {
      on(event: string, fn: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): void;
      once(event: string, fn: () => void): void;
    };
    typed.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));
    void typed.once;
  }

  onConnection(handler: (client: WebSocket, req: IncomingMessage) => void): void {
    this.handler = handler;
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string' || !key) {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(key + MAGIC).digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const client = new SocketClient(socket, head);
    if (this.handler) this.handler(client, req);
  }
}

class SocketClient implements WebSocket {
  private messageHandler: ((data: Buffer) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private buffer: Buffer;
  private closed = false;
  private closeEmitted = false;

  constructor(private readonly socket: Duplex, head: Buffer) {
    this.buffer = head;
    socket.on('data', (chunk: Buffer) => {
      if (this.closed) return;
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.pump();
    });
    socket.on('close', () => this.emitClose());
    socket.on('error', () => {
      this.closed = true;
      this.emitClose();
    });
    (socket as import('node:net').Socket).setNoDelay(true);
  }

  private emitClose(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    this.closed = true;
    this.closeHandler?.();
  }

  private pump(): void {
    for (;;) {
      const frame = this.readFrame();
      if (frame === null) return;
      if (frame.opcode === 0x8) {
        // A close frame from the client.
        this.sendCloseFrame(1000);
        this.closed = true;
        this.emitClose();
        this.socket.end();
        return;
      }
      if (frame.opcode === 0x9) {
        // A ping is answered with a pong.
        this.writeFrame(0xa, frame.payload);
        continue;
      }
      if (frame.opcode === 0x1 || frame.opcode === 0x0) {
        this.messageHandler?.(frame.payload);
      }
    }
  }

  private readFrame(): Frame | null {
    if (this.buffer.length < 2) return null;
    const b0 = this.buffer[0];
    const b1 = this.buffer[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (this.buffer.length < 4) return null;
      len = this.buffer.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (this.buffer.length < 10) return null;
      const big = this.buffer.readBigUInt64BE(2);
      if (big > 16 * 1024 * 1024) return null;
      len = Number(big);
      offset = 10;
    }
    let mask: Buffer | null = null;
    if (masked) {
      if (this.buffer.length < offset + 4) return null;
      mask = this.buffer.subarray(offset, offset + 4);
      offset += 4;
    }
    if (this.buffer.length < offset + len) return null;
    let payload = this.buffer.subarray(offset, offset + len);
    if (mask) {
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
      payload = out;
    }
    this.buffer = this.buffer.subarray(offset + len);
    return { opcode, payload, fin };
  }

  private writeFrame(opcode: number, payload: Buffer): void {
    const len = payload.length;
    let header: Buffer;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  send(text: string): void {
    if (this.closed) return;
    this.writeFrame(0x1, Buffer.from(text, 'utf8'));
  }

  private sendCloseFrame(code: number): void {
    const payload = Buffer.allocUnsafe(2);
    payload.writeUInt16BE(code, 0);
    this.writeFrame(0x8, payload);
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.sendCloseFrame(code);
    void reason;
    this.closed = true;
    this.emitClose();
    this.socket.end();
  }

  onMessage(handler: (data: Buffer) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }
}
