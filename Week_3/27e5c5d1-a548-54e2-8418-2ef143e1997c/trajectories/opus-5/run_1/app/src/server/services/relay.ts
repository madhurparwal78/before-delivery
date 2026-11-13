import { createConnection, type Socket } from 'node:net';
import { config } from '../config';

type Reply = string | number | null | Reply[];

function encodeCommand(parts: string[]): string {
  return parts.reduce(
    (command, part) => `${command}$${Buffer.byteLength(part)}\r\n${part}\r\n`,
    `*${parts.length}\r\n`,
  );
}

/** Reads RESP replies out of a byte stream. */
class ReplyReader {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): Reply[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const replies: Reply[] = [];
    for (;;) {
      const parsed = this.parse(0);
      if (parsed === null) break;
      replies.push(parsed.value);
      this.buffer = this.buffer.subarray(parsed.offset);
    }
    return replies;
  }

  private parse(offset: number): { value: Reply; offset: number } | null {
    const end = this.buffer.indexOf('\r\n', offset);
    if (end === -1) return null;
    const marker = String.fromCharCode(this.buffer[offset] ?? 0);
    const head = this.buffer.subarray(offset + 1, end).toString('utf8');
    if (marker === '+' || marker === '-') return { value: head, offset: end + 2 };
    if (marker === ':') return { value: Number(head), offset: end + 2 };
    if (marker === '$') {
      const length = Number(head);
      if (length === -1) return { value: null, offset: end + 2 };
      if (this.buffer.length < end + 2 + length + 2) return null;
      return { value: this.buffer.subarray(end + 2, end + 2 + length).toString('utf8'), offset: end + 2 + length + 2 };
    }
    if (marker === '*') {
      const count = Number(head);
      if (count === -1) return { value: null, offset: end + 2 };
      const items: Reply[] = [];
      let cursor = end + 2;
      for (let index = 0; index < count; index += 1) {
        const item = this.parse(cursor);
        if (item === null) return null;
        items.push(item.value);
        cursor = item.offset;
      }
      return { value: items, offset: cursor };
    }
    return null;
  }
}

interface Credentials {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}

function parseUrl(url: string): Credentials {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port === '' ? 6379 : parsed.port),
    username: parsed.username === '' ? null : decodeURIComponent(parsed.username),
    password: parsed.password === '' ? null : decodeURIComponent(parsed.password),
  };
}

const CHANNEL_PATTERN = 'kinfold:*';

type Listener = (channel: string, payload: string) => void;

/** The one seam for live fan-out between the workers. */
class Relay {
  private publisher: Socket | null = null;
  private subscriber: Socket | null = null;
  private publisherReady = false;
  private subscriberReady = false;
  private readonly listeners = new Set<Listener>();
  private readonly statusListeners = new Set<(status: 'up' | 'paused') => void>();
  private lastStatus: 'up' | 'paused' = 'paused';

  status(): 'up' | 'paused' {
    return this.publisherReady && this.subscriberReady ? 'up' : 'paused';
  }

  onMessage(listener: Listener): void {
    this.listeners.add(listener);
  }

  onStatus(listener: (status: 'up' | 'paused') => void): void {
    this.statusListeners.add(listener);
  }

  start(): void {
    this.connectPublisher();
    this.connectSubscriber();
    setInterval(() => this.announceStatus(), 1000).unref();
  }

  private announceStatus(): void {
    const status = this.status();
    if (status === this.lastStatus) return;
    this.lastStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private credentials(): Credentials {
    return parseUrl(config.valkeyUrl);
  }

  private connect(onReady: (socket: Socket) => void, onData: (reply: Reply) => void, onClose: () => void): Socket {
    const credentials = this.credentials();
    const socket = createConnection({ host: credentials.host, port: credentials.port });
    const reader = new ReplyReader();
    socket.setNoDelay(true);
    socket.on('connect', () => {
      if (credentials.password !== null) {
        const auth =
          credentials.username === null
            ? ['AUTH', credentials.password]
            : ['AUTH', credentials.username, credentials.password];
        socket.write(encodeCommand(auth));
      }
      onReady(socket);
    });
    socket.on('data', (chunk: Buffer) => {
      for (const reply of reader.push(chunk)) onData(reply);
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      onClose();
      setTimeout(() => this.reconnect(socket), 2000).unref();
    });
    return socket;
  }

  private reconnect(socket: Socket): void {
    if (socket === this.publisher) this.connectPublisher();
    if (socket === this.subscriber) this.connectSubscriber();
  }

  private connectPublisher(): void {
    this.publisher = this.connect(
      () => {
        this.publisherReady = true;
        this.announceStatus();
      },
      () => undefined,
      () => {
        this.publisherReady = false;
        this.announceStatus();
      },
    );
  }

  private connectSubscriber(): void {
    this.subscriber = this.connect(
      (socket) => {
        socket.write(encodeCommand(['PSUBSCRIBE', CHANNEL_PATTERN]));
      },
      (reply) => {
        if (!Array.isArray(reply)) return;
        const [kind] = reply;
        if (kind === 'psubscribe') {
          this.subscriberReady = true;
          this.announceStatus();
          return;
        }
        if (kind === 'pmessage' && typeof reply[2] === 'string' && typeof reply[3] === 'string') {
          for (const listener of this.listeners) listener(reply[2], reply[3]);
        }
      },
      () => {
        this.subscriberReady = false;
        this.announceStatus();
      },
    );
  }

  publish(channel: string, payload: string): void {
    const socket = this.publisher;
    if (socket === null || !this.publisherReady || socket.destroyed) return;
    socket.write(encodeCommand(['PUBLISH', channel, payload]));
  }
}

export const relay = new Relay();
export const boardChannel = (boardId: string): string => `kinfold:board:${boardId}`;
export const userChannel = (userId: string): string => `kinfold:user:${userId}`;
