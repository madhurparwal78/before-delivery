import * as net from "node:net";
import { config } from "../config.js";

export interface ValkeyState {
  available: boolean;
  lastCheck: number;
}

export const valkeyState: ValkeyState = { available: false, lastCheck: 0 };

const encoder = new TextEncoder();

export type Reply = string | number | null | Reply[];

interface Pending {
  resolve: (reply: Reply) => void;
  reject: (err: Error) => void;
}

function encodeCommand(args: (string | number)[]): Uint8Array {
  const parts = args.map(String);
  let out = `*${parts.length}\r\n`;
  for (const part of parts) out += `$${Buffer.byteLength(part)}\r\n${part}\r\n`;
  return encoder.encode(out);
}

/** One TCP connection to Valkey with reply parsing and a pending queue. */
class Connection {
  protected socket: net.Socket | null = null;
  protected buffer = Buffer.alloc(0);
  protected pending: Pending[] = [];
  protected connecting: Promise<void> | null = null;
  protected lastReconnect = 0;
  private readonly host: string;
  private readonly port: number;
  private readonly username: string | undefined;
  private readonly password: string | undefined;
  /** Commands run right after the greeting, before first use. */
  protected boot: Array<Array<string>> = [];
  protected onConnect: (() => void) | null = null;

  constructor(url: string) {
    const parsed = new URL(url);
    this.host = parsed.hostname;
    this.port = Number.parseInt(parsed.port || "6379", 10);
    this.username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
    this.password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  }

  /** AUTH with a username when the URL carries one. */
  protected authCommand(): Array<string> | null {
    if (!this.password) return null;
    return this.username ? ["AUTH", this.username, this.password] : ["AUTH", this.password];
  }

  protected connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed && this.socket.writable) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const now = Date.now();
    if (now - this.lastReconnect < 300) return Promise.reject(new Error("valkey-unreachable"));
    this.lastReconnect = now;
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      socket.setNoDelay(true);
      let settled = false;
      const fail = (): void => {
        if (!settled) {
          settled = true;
          this.connecting = null;
          this.socket = null;
          socket.destroy();
          valkeyState.available = false;
          valkeyState.lastCheck = Date.now();
          reject(new Error("valkey-unreachable"));
        }
      };
      socket.on("error", fail);
      socket.on("connect", () => {
        settled = true;
        this.socket = socket;
        this.connecting = null;
        valkeyState.available = true;
        valkeyState.lastCheck = Date.now();
        this.pending = [];
        const auth = this.authCommand();
        const commands: Array<Array<string>> = auth ? [auth] : [];
        commands.push(...this.boot);
        let index = 0;
        const step = (): void => {
          if (index >= commands.length) {
            this.onConnect?.();
            resolve();
            return;
          }
          const command = commands[index];
          index += 1;
          socket.write(encodeCommand(command));
          setTimeout(step, 20);
        };
        step();
      });
      socket.on("data", (chunk) => this.onData(chunk));
      socket.on("close", () => {
        this.socket = null;
        valkeyState.available = false;
        valkeyState.lastCheck = Date.now();
        for (const p of this.pending.splice(0)) p.reject(new Error("valkey-closed"));
        this.onClose();
      });
    });
    return this.connecting;
  }

  protected onClose(): void {
    /* subclasses retry as needed */
  }

  protected onData(chunk: Buffer): void {
    this.onChunkLog?.(chunk);
    // Bytes, not characters: bulk-string lengths count bytes, and payloads
    // may split a multi-byte UTF-8 sequence across chunks.
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let frame = this.parseReply();
    while (frame) {
      const { reply, consumed } = frame;
      this.buffer = this.buffer.subarray(consumed);
      const isMessage = Array.isArray(reply) && reply.length === 3 && reply[0] === "message";
      if (isMessage) {
        this.onMessage(String(reply[1]), String(reply[2]));
      } else {
        const pending = this.pending.shift();
        if (pending) pending.resolve(reply);
      }
      frame = this.parseReply();
    }
  }

  protected onMessage(_channel: string, _message: string): void {
    /* overridden by the subscription connection */
  }

  protected onChunkLog(_chunk: Buffer): void {
    /* diagnostics only */
  }

  /**
   * A parsed frame with the number of bytes it consumed. The parser works on
   * bytes: a `$N` bulk string is N bytes regardless of multi-byte characters.
   */
  private parseReply(): { reply: Reply; consumed: number } | null {
    const buffer = this.buffer;
    if (buffer.length === 0) return null;
    const first = buffer[0];
    const lineEnd = buffer.indexOf("\r\n");
    if (first === 0x2b || first === 0x2d || first === 0x3a) {
      if (lineEnd < 0) return null;
      const payload = buffer.subarray(1, lineEnd).toString("utf8");
      let reply: Reply = payload;
      if (first === 0x3a) reply = Number.parseInt(payload, 10);
      if (first === 0x2d) reply = null;
      return { reply, consumed: lineEnd + 2 };
    }
    if (first === 0x24) {
      if (lineEnd < 0) return null;
      const length = Number.parseInt(buffer.subarray(1, lineEnd).toString("utf8"), 10);
      if (length < 0) return { reply: null, consumed: lineEnd + 2 };
      if (buffer.length < lineEnd + 2 + length + 2) return null;
      const payload = buffer.subarray(lineEnd + 2, lineEnd + 2 + length).toString("utf8");
      return { reply: payload, consumed: lineEnd + 2 + length + 2 };
    }
    if (first === 0x2a) {
      if (lineEnd < 0) return null;
      const count = Number.parseInt(buffer.subarray(1, lineEnd).toString("utf8"), 10);
      if (count <= 0) return { reply: [], consumed: lineEnd + 2 };
      const items: Reply[] = [];
      let cursor = lineEnd + 2;
      let consumedTotal = lineEnd + 2;
      for (let i = 0; i < count; i++) {
        const saved = this.buffer;
        this.buffer = buffer.subarray(cursor);
        const frame = this.parseReply();
        this.buffer = saved;
        if (!frame) return null;
        items.push(frame.reply);
        cursor += frame.consumed;
        consumedTotal += frame.consumed;
      }
      return { reply: items, consumed: consumedTotal };
    }
    return null;
  }

  async call(args: (string | number)[]): Promise<Reply> {
    try {
      await this.connect();
    } catch {
      throw new Error("valkey-unreachable");
    }
    const socket = this.socket;
    if (!socket) throw new Error("valkey-unreachable");
    return new Promise<Reply>((resolve, reject) => {
      this.pending.push({ resolve, reject });
      socket.write(encodeCommand(args), (err) => {
        if (err) reject(err);
      });
      setTimeout(() => {
        const index = this.pending.findIndex((p) => p.resolve === resolve);
        if (index >= 0) {
          this.pending.splice(index, 1);
          reject(new Error("valkey-timeout"));
        }
      }, 5000);
    });
  }
}

/** The command connection: PUBLISH and presence keys. */
class CommandConnection extends Connection {
  async publish(channel: string, message: string): Promise<void> {
    try {
      const reply = await this.call(["PUBLISH", channel, message]);
      void reply;
    } catch {
      /* publishing is best-effort; saves still land in Postgres */
    }
  }
}

/** The subscription connection: its own socket, in subscribe mode. */
class SubscriptionConnection extends Connection {
  private readonly channels = new Set<string>();
  private handler: ((channel: string, message: string) => void) | null = null;

  onMessageHandler(handler: (channel: string, message: string) => void): void {
    this.handler = handler;
  }

  async subscribe(channel: string): Promise<void> {
    this.channels.add(channel);
    // The boot list carries every live channel, so a fresh connect subscribes them.
    this.boot = [...this.channels].map((name) => ["SUBSCRIBE", name]);
    const socket = this.socket;
    if (socket) {
      socket.write(encodeCommand(["SUBSCRIBE", channel]));
      return;
    }
    // A connect may already be in flight with an older boot list, so always
    // write the subscription once the socket is there.
    await this.connect().catch(() => undefined);
    const live = this.socket;
    if (live) {
      live.write(encodeCommand(["SUBSCRIBE", channel]));
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    this.channels.delete(channel);
    if (this.socket) this.socket.write(encodeCommand(["UNSUBSCRIBE", channel]));
  }

  protected override onMessage(channel: string, message: string): void {
    this.handler?.(channel, message);
  }

  protected override onClose(): void {
    // Reconnect keeps the live channel set.
    this.boot = [...this.channels].map((name) => ["SUBSCRIBE", name]);
    setTimeout(() => {
      void this.connect().catch(() => undefined);
    }, 500);
  }
}

export class Valkey {
  private readonly commands = new CommandConnection(config.valkeyUrl);
  private readonly subscription = new SubscriptionConnection(config.valkeyUrl);

  async publish(channel: string, message: string): Promise<void> {
    await this.commands.publish(channel, message);
  }

  async ensureSubscribed(channel: string): Promise<void> {
    await this.subscription.subscribe(channel);
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.subscription.unsubscribe(channel);
  }

  onMessage(handler: (channel: string, message: string) => void): void {
    this.subscription.onMessageHandler(handler);
  }

  async ping(): Promise<void> {
    await this.commands.call(["PING"]);
  }
}

export const valkey = new Valkey();

export async function valkeyAvailable(): Promise<boolean> {
  try {
    await valkey.ping();
    valkeyState.available = true;
    valkeyState.lastCheck = Date.now();
    return true;
  } catch {
    valkeyState.available = false;
    valkeyState.lastCheck = Date.now();
    return false;
  }
}
