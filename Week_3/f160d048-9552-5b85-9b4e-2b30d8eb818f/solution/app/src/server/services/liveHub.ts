import type { IncomingMessage, ServerResponse } from "node:http";
import pg from "pg";
import { config } from "../config";
import { first, pool, rows } from "../db/pool";
import { isModerator, isTeam, type Viewer } from "../domain/viewer";
import { isUnlocked } from "../domain/unlock";
import type { Company } from "../../shared/api";
import { companyBySlug, companyView } from "./companyView";

type StoredEvent = {
  id: number; type: string; audience: string[]; exclude_user: string | null; data: Record<string, unknown>;
};

type Connection = { res: ServerResponse; viewer: Viewer | null; tokens: string[]; sentUpTo: number; ready: boolean };

const connections = new Set<Connection>();
const HEARTBEAT_MS = 15000;
const POLL_MS = 1000;

function tokensFor(viewer: Viewer | null): string[] {
  if (!viewer) return ["all"];
  const tokens = ["all", `user:${viewer.id}`];
  if (viewer.role === "member") tokens.push("members");
  if (isModerator(viewer)) tokens.push("moderators");
  if (isTeam(viewer) && viewer.companyId) tokens.push(`team:${viewer.companyId}`);
  return tokens;
}

function mayReceive(connection: Connection, event: StoredEvent): boolean {
  if (connection.viewer && event.exclude_user === connection.viewer.id) return false;
  return event.audience.some((token) => connection.tokens.includes(token));
}

type Rendering = Map<string, Company | undefined>;

async function render(event: StoredEvent, connection: Connection, companies: Rendering): Promise<Record<string, unknown>> {
  if (event.type === "company.changed") {
    const slug = String(event.data["slug"]);
    const unlocked = isUnlocked(connection.viewer);
    const key = `${slug}:${unlocked}`;
    if (!companies.has(key)) {
      const record = await companyBySlug(pool, slug);
      companies.set(key, record ? await companyView(pool, record, unlocked) : undefined);
    }
    return { slug, company: companies.get(key) ?? null };
  }
  if (event.type === "queue.changed") {
    const { by_user: byUser, ...visible } = event.data;
    return { ...visible, by_me: connection.viewer !== null && byUser === connection.viewer.id };
  }
  return event.data;
}

function write(connection: Connection, text: string): void {
  connection.res.write(text);
}

async function deliver(connection: Connection, event: StoredEvent, companies: Rendering): Promise<void> {
  const data = await render(event, connection, companies);
  write(connection, `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`);
  connection.sentUpTo = event.id;
  if (event.type === "member.unlocked" && connection.viewer) connection.viewer = { ...connection.viewer, unlocked: true };
}

let dispatching = false;
let dirty = false;

export async function dispatchNew(): Promise<void> {
  if (dispatching) {
    dirty = true;
    return;
  }
  dispatching = true;
  try {
    do {
      dirty = false;
      const ready = [...connections].filter((connection) => connection.ready);
      if (ready.length === 0) break;
      const floor = Math.min(...ready.map((connection) => connection.sentUpTo));
      const events = await rows<StoredEvent>(
        "SELECT id, type, audience, exclude_user, data FROM live_events WHERE id > $1 ORDER BY id",
        [floor],
      );
      const companies: Rendering = new Map();
      for (const event of events) {
        for (const connection of ready) {
          if (event.id > connection.sentUpTo && connections.has(connection) && mayReceive(connection, event)) {
            await deliver(connection, event, companies);
          } else if (event.id > connection.sentUpTo) {
            connection.sentUpTo = event.id;
          }
        }
      }
    } while (dirty);
  } catch (error) {
    console.error("live dispatch failed:", error instanceof Error ? error.message : error);
  } finally {
    dispatching = false;
  }
}

export async function latestEventId(): Promise<number> {
  const counter = await first<{ last: number }>("SELECT last FROM live_counter WHERE id = 1");
  return counter ? counter.last : 0;
}

async function replay(connection: Connection, after: number, latest: number): Promise<void> {
  const events = await rows<StoredEvent>(
    "SELECT id, type, audience, exclude_user, data FROM live_events WHERE id > $1 AND id <= $2 ORDER BY id",
    [after, latest],
  );
  const companies: Rendering = new Map();
  for (const event of events) {
    if (mayReceive(connection, event)) await deliver(connection, event, companies);
  }
  connection.sentUpTo = latest;
}

export async function openStream(req: IncomingMessage, res: ServerResponse, viewer: Viewer | null): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 1000\n\n");
  const connection: Connection = { res, viewer, tokens: tokensFor(viewer), sentUpTo: 0, ready: false };
  connections.add(connection);
  res.on("close", () => connections.delete(connection));
  const latest = await latestEventId();
  const header = req.headers["last-event-id"];
  const fromPage = new URL(req.url ?? "/", config.publicUrl).searchParams.get("after");
  const resume = typeof header === "string" ? header : fromPage;
  const after = typeof resume === "string" && /^\d+$/.test(resume) ? Number(resume) : undefined;
  const replayable = after !== undefined && after <= latest && after >= latest - config.limits.liveReplayLimit;
  if (replayable) {
    await replay(connection, after, latest);
    write(connection, `event: hello\ndata: ${JSON.stringify({ replay: "complete" })}\n\n`);
  } else {
    connection.sentUpTo = latest;
    write(connection, `event: hello\ndata: ${JSON.stringify({ replay: "reload" })}\n\n`);
  }
  connection.ready = true;
  void dispatchNew();
}

export function closeAllStreams(): number {
  const count = connections.size;
  for (const connection of connections) connection.res.end();
  connections.clear();
  return count;
}

export async function trimLiveEvents(): Promise<void> {
  await pool.query("DELETE FROM live_events WHERE id <= (SELECT last FROM live_counter WHERE id = 1) - $1", [config.limits.liveReplayLimit]);
}

async function listen(): Promise<void> {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  client.on("error", () => setTimeout(() => void listen(), 2000));
  client.on("notification", () => void dispatchNew());
  try {
    await client.connect();
    await client.query("LISTEN live");
  } catch {
    setTimeout(() => void listen(), 2000);
  }
}

export function startLiveHub(): void {
  void listen();
  setInterval(() => void dispatchNew(), POLL_MS);
  setInterval(() => {
    for (const connection of connections) write(connection, ": keep-alive\n\n");
  }, HEARTBEAT_MS);
}
