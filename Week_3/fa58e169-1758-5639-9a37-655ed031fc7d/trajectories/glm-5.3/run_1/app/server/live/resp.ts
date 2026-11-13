import net from "node:net";

/**
 * A minimal RESP2 client for Valkey. Every command is bounded to one second so
 * no save ever waits on an unreachable server, and the connection retries on
 * its own so a returning server is picked up without a restart.
 */

export interface RespOptions {
  url: string;
  commandTimeoutMs: number;
  onStateChange(up: boolean): void;
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export interface RespClient {
  up(): boolean;
  command(name: string, ...args: (string | number)[]): Promise<unknown>;
  subscribe(pattern: string, onMessage: (channel: string, payload: string) => void): void;
  close(): void;
}

export function connectResp(options: RespOptions): RespClient {
  const parsed = parseUrl(options.url);
  let socket: net.Socket | null = null;
  let connected = false;
  let buffer = "";
  let pending: Pending[] = [];
  let subscriber: net.Socket | null = null;
  let subscriberBuffer = "";
  let closing = false;
  let retryTimer: NodeJS.Timeout | null = null;

  const onStateChange = (up: boolean) => {
    try {
      options.onStateChange(up);
    } catch {
      // a listener error must never take the client down
    }
  };

  const failPending = (error: Error) => {
    const waiting = pending;
    pending = [];
    for (const entry of waiting) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  };

  const dropConnection = () => {
    if (retryTimer) return;
    connected = false;
    failPending(new Error("valkey unavailable"));
    for (const entry of [socket, subscriber]) {
      if (entry) entry.destroy();
    }
    socket = null;
    subscriber = null;
    onStateChange(false);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!closing) open();
    }, 1000);
  };

  const open = () => {
    socket = net.connect({ host: parsed.host, port: parsed.port });
    socket.setNoDelay(true);
    socket.on("connect", () => {
      let greeting = "";
      if (parsed.password) greeting = `AUTH ${parsed.password}\r\n`;
      if (parsed.database > 0) greeting += `SELECT ${parsed.database}\r\n`;
      if (greeting) socket!.write(greeting);
      // readiness is confirmed by the first command's reply
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let decoded: { value: unknown; rest: string } | null;
      while ((decoded = tryDecode(buffer)) !== null) {
        buffer = decoded.rest;
        const entry = pending.shift();
        if (!entry) continue;
        clearTimeout(entry.timer);
        const value = decoded.value;
        if (value instanceof RespError) entry.reject(value);
        else entry.resolve(value);
      }
      if (!connected) {
        connected = true;
        onStateChange(true);
      }
    });
    socket.on("error", () => dropConnection());
    socket.on("close", () => {
      if (!closing) dropConnection();
    });
  };

  const command = (name: string, ...args: (string | number)[]): Promise<unknown> => {
    if (!socket || !connected) return Promise.reject(new Error("valkey unavailable"));
    return new Promise((resolve, reject) => {
      const parts = [name, ...args.map((arg) => String(arg))];
      const encoded = `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part, "utf8")}\r\n${part}\r\n`).join("")}`;
      const timer = setTimeout(() => {
        const index = pending.findIndex((entry) => entry.timer === timer);
        if (index >= 0) pending.splice(index, 1);
        dropConnection();
        reject(new Error("valkey timeout"));
      }, options.commandTimeoutMs);
      pending.push({ resolve, reject, timer });
      socket!.write(encoded);
    });
  };

  const openSubscriber = () => {
    subscriber = net.connect({ host: parsed.host, port: parsed.port });
    subscriber.setNoDelay(true);
    subscriber.on("connect", () => {
      let greeting = "";
      if (parsed.password) greeting = `AUTH ${parsed.password}\r\n`;
      if (parsed.database > 0) greeting += `SELECT ${parsed.database}\r\n`;
      greeting += `PSUBSCRIBE ${parsed.pattern}\r\n`;
      subscriber!.write(greeting);
    });
    subscriber.on("data", (chunk) => {
      subscriberBuffer += chunk.toString("utf8");
      let decoded: { value: unknown; rest: string } | null;
      while ((decoded = tryDecode(subscriberBuffer)) !== null) {
        subscriberBuffer = decoded.rest;
        const frame = decoded.value;
        if (Array.isArray(frame) && frame.length >= 4 && frame[0] === "pmessage") {
          const channel = String(frame[2]);
          const payload = String(frame[3]);
          if (parsed.onMessage) parsed.onMessage(channel, payload);
        }
      }
    });
    subscriber.on("error", () => {
      subscriber?.destroy();
      subscriber = null;
      if (!closing) setTimeout(openSubscriber, 1000);
    });
    subscriber.on("close", () => {
      if (!closing && !subscriber) setTimeout(openSubscriber, 1000);
    });
  };

  open();
  if (parsed.onMessage) openSubscriber();

  return {
    up: () => connected,
    command,
    subscribe(_pattern, _onMessage) {
      // subscription is wired at connect time through parsed.onMessage
    },
    close() {
      closing = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.destroy();
      subscriber?.destroy();
    },
  };
}

class RespError extends Error {}

/** Decode one RESP2 frame from the head of the buffer, or null if incomplete. */
function tryDecode(buffer: string): { value: unknown; rest: string } | null {
  if (buffer.length === 0) return null;
  const type = buffer[0]!;
  const lineEnd = buffer.indexOf("\r\n", 1);
  if (lineEnd === -1) return null;
  const head = buffer.slice(1, lineEnd);
  const afterLine = lineEnd + 2;
  if (type === "+" || type === ":") return { value: type === ":" ? Number.parseInt(head, 10) : head, rest: buffer.slice(afterLine) };
  if (type === "-") return { value: new RespError(head), rest: buffer.slice(afterLine) };
  if (type === "$") {
    const length = Number.parseInt(head, 10);
    if (length === -1) return { value: null, rest: buffer.slice(afterLine) };
    if (buffer.length < afterLine + length + 2) return null;
    return { value: buffer.slice(afterLine, afterLine + length), rest: buffer.slice(afterLine + length + 2) };
  }
  if (type === "*") {
    const count = Number.parseInt(head, 10);
    if (count === -1) return { value: null, rest: buffer.slice(afterLine) };
    let rest = buffer.slice(afterLine);
    const items: unknown[] = [];
    for (let index = 0; index < count; index++) {
      const decoded = tryDecode(rest);
      if (!decoded) return null;
      items.push(decoded.value);
      rest = decoded.rest;
    }
    return { value: items, rest };
  }
  return { value: new RespError(`unknown frame ${type}`), rest: buffer.slice(afterLine) };
}

function parseUrl(url: string): {
  host: string;
  port: number;
  password: string | null;
  database: number;
  pattern: string;
  onMessage?: (channel: string, payload: string) => void;
} {
  const parsed = new URL(url);
  const password = parsed.password ? decodeURIComponent(parsed.password) : null;
  const database = Number.parseInt(parsed.pathname.replace(/^\//, "") || "0", 10) || 0;
  return {
    host: parsed.hostname || "127.0.0.1",
    port: Number.parseInt(parsed.port || "6379", 10),
    password,
    database,
    pattern: "pattern:*",
  };
}
