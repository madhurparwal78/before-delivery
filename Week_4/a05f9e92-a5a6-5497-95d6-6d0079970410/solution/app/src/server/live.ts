import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { SessionUser } from "../shared/types.js";
import { now, realTime } from "./clock.js";
import { settings } from "./config.js";

interface Client {
  socket: WebSocket;
  user: SessionUser;
  topics: Set<string>;
  presence: Set<string>;
}

type Authenticate = (request: IncomingMessage) => Promise<SessionUser | null>;
type Authorize = (user: SessionUser, topic: string) => Promise<boolean>;

const clients = new Set<Client>();
const viewing = new Map<string, Map<string, { name: string; seen: number }>>();
const pendingLists = new Map<string, { numbers: Set<string>; timer: NodeJS.Timeout }>();
let authorize: Authorize = async () => false;

function frame(topic: string, event: string, data: unknown): string {
  return JSON.stringify({ topic, event, data, server_time: new Date(now()).toISOString() });
}

export function publish(topic: string, event: string, data: unknown = {}): void {
  if (topic.startsWith("list:")) {
    const entry = pendingLists.get(topic);
    const numbers = new Set<string>(entry?.numbers ?? []);
    const number = (data as { number?: string }).number;
    if (number) numbers.add(number);
    if (entry) {
      entry.numbers = numbers;
      return;
    }
    const timer = setTimeout(() => {
      const batch = pendingLists.get(topic);
      pendingLists.delete(topic);
      send(topic, "changed", { numbers: [...(batch?.numbers ?? [])] });
    }, settings.LIVE_SETTLE_MS);
    pendingLists.set(topic, { numbers, timer });
    return;
  }
  send(topic, event, data);
}

function send(topic: string, event: string, data: unknown): void {
  const prefix = topic.endsWith("*") ? topic.slice(0, -1) : null;
  for (const client of clients) {
    if (client.socket.readyState !== 1) continue;
    const topics = prefix === null ? (client.topics.has(topic) ? [topic] : []) : [...client.topics].filter((t) => t.startsWith(prefix));
    for (const t of topics) client.socket.send(frame(t, event, data));
  }
}

/** Record numbers with at least one subscriber on a topic family such as `sla:`. */
export function subscribedNumbers(prefix: string): string[] {
  const found = new Set<string>();
  for (const client of clients) for (const topic of client.topics) if (topic.startsWith(prefix)) found.add(topic.slice(prefix.length));
  return [...found];
}

export function publishTo(username: string, topic: string, event: string, data: unknown = {}): void {
  const message = frame(topic, event, data);
  for (const client of clients) {
    if (client.user.username === username && client.topics.has(topic) && client.socket.readyState === 1) client.socket.send(message);
  }
}

function presenceList(number: string): Array<{ username: string; display_name: string }> {
  return [...(viewing.get(number) ?? new Map()).entries()].map(([username, v]) => ({ username, display_name: v.name }));
}

function broadcastPresence(number: string): void {
  send(`presence:${number}`, "viewers", { users: presenceList(number) });
}

function leave(number: string, username: string): void {
  const room = viewing.get(number);
  if (room?.delete(username)) {
    if (room.size === 0) viewing.delete(number);
    broadcastPresence(number);
  }
}

function heartbeat(client: Client, number: string): void {
  const room = viewing.get(number) ?? new Map<string, { name: string; seen: number }>();
  const isNew = !room.has(client.user.username);
  room.set(client.user.username, { name: client.user.display_name, seen: realTime() });
  viewing.set(number, room);
  client.presence.add(number);
  if (isNew) broadcastPresence(number);
}

async function handle(client: Client, raw: string): Promise<void> {
  let message: { subscribe?: string[]; unsubscribe?: string[]; presence?: string };
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  for (const topic of message.subscribe ?? []) {
    if (client.topics.has(topic)) continue;
    if (!(await authorize(client.user, topic))) continue;
    client.topics.add(topic);
    if (topic.startsWith("presence:") && client.socket.readyState === 1) {
      client.socket.send(frame(topic, "viewers", { users: presenceList(topic.slice("presence:".length)) }));
    }
  }
  for (const topic of message.unsubscribe ?? []) {
    client.topics.delete(topic);
    if (topic.startsWith("presence:")) {
      const number = topic.slice("presence:".length);
      client.presence.delete(number);
      leave(number, client.user.username);
    }
  }
  if (typeof message.presence === "string") heartbeat(client, message.presence);
}

export function attach(server: Server, authenticate: Authenticate, authorizeTopic: Authorize): void {
  authorize = authorizeTopic;
  const hub = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (request.url ?? "").split("?")[0];
    if (path !== "/api/live") {
      socket.destroy();
      return;
    }
    authenticate(request).then(
      (user) => {
        if (!user) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        hub.handleUpgrade(request, socket, head, (ws) => {
          const client: Client = { socket: ws, user, topics: new Set(["session", "inbox", "approvals", "storage"]), presence: new Set() };
          clients.add(client);
          ws.on("message", (data) => void handle(client, data.toString()));
          ws.on("close", () => {
            clients.delete(client);
            for (const number of client.presence) leave(number, user.username);
          });
          ws.on("error", () => ws.close());
        });
      },
      () => socket.destroy(),
    );
  });
  setInterval(() => {
    const limit = settings.PRESENCE_TIMEOUT_SECONDS * 1000;
    for (const [number, room] of viewing) {
      for (const [username, v] of room) if (realTime() - v.seen > limit) leave(number, username);
    }
  }, 1000).unref();
}
