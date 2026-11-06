// Live collaboration. The server holds one PocketBase realtime subscription and relays presence, comments
// and placement changes to every browser viewing a project through the project's event stream.
import type { ServerResponse } from "node:http";
import type { Comment, LiveEvent, Viewer } from "../shared/types.js";
import { config } from "./config.js";
import { errorCode, ProviderUnavailable } from "./errors.js";
import * as pb from "./pocketbase.js";

const RETRY_MS = 5_000;
const PRESENCE_REFRESH_MS = 10_000;
const PRESENCE_WINDOW_MS = 30_000;
const HEARTBEAT_MS = 15_000;

interface Stream {
  projectId: string;
  userId: string;
  name: string;
  res: ServerResponse;
}

const streams = new Set<Stream>();
const presenceRecords = new Map<string, string>(); // `${projectId}:${userId}` → lf_presence record id
let connected = false;
let placementRelay: (projectId: string, record: pb.PbRecord) => Promise<LiveEvent | null> = async () => null;

export function liveConnected(): boolean {
  return connected;
}

function write(stream: Stream, event: LiveEvent): void {
  stream.res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

function broadcast(projectId: string, event: LiveEvent): void {
  for (const stream of streams) if (stream.projectId === projectId) write(stream, event);
}

function projectsWithViewers(): Set<string> {
  return new Set([...streams].map((stream) => stream.projectId));
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words;
  return letters.map((word) => [...word][0]!.toUpperCase()).join("");
}

async function viewers(projectId: string): Promise<Viewer[]> {
  const records = await pb.listRecords(
    "lf_presence",
    `project_id = ${pb.quote(projectId)} && seen_at >= ${Date.now() - PRESENCE_WINDOW_MS}`,
  );
  const seen = new Map<string, Viewer>();
  for (const record of records) {
    const userId = String(record.user_id);
    if (!seen.has(userId)) seen.set(userId, { user_id: userId, name: String(record.name), initials: initials(String(record.name)) });
  }
  return [...seen.values()];
}

async function sendPresence(projectId: string): Promise<void> {
  if (!connected) return;
  try {
    broadcast(projectId, { type: "presence", data: { viewers: await viewers(projectId) } });
  } catch (error) {
    console.error("presence list failed:", errorCode(error));
  }
}

async function markPresent(stream: Stream): Promise<void> {
  const key = `${stream.projectId}:${stream.userId}`;
  const data = { project_id: stream.projectId, user_id: stream.userId, name: stream.name, seen_at: Date.now() };
  const known = presenceRecords.get(key);
  if (known) {
    await pb.updateRecord("lf_presence", known, data);
    return;
  }
  const existing = await pb.listRecords(
    "lf_presence",
    `project_id = ${pb.quote(stream.projectId)} && user_id = ${pb.quote(stream.userId)}`,
  );
  const record = existing[0]
    ? await pb.updateRecord("lf_presence", existing[0].id, data)
    : await pb.createRecord("lf_presence", data);
  presenceRecords.set(key, record.id);
}

async function refreshPresence(): Promise<void> {
  if (!connected) return;
  const unique = new Map<string, Stream>();
  for (const stream of streams) unique.set(`${stream.projectId}:${stream.userId}`, stream);
  try {
    await Promise.all([...unique.values()].map(markPresent));
  } catch (error) {
    console.error("presence refresh failed:", errorCode(error));
  }
}

function comment(record: pb.PbRecord): Comment {
  return {
    id: record.id,
    author_name: String(record.author_name),
    body: String(record.body),
    created_at: pb.isoTime(record.created),
  };
}

async function onRealtime(event: string, data: string): Promise<void> {
  const { action, record } = JSON.parse(data) as { action: string; record: pb.PbRecord };
  const projectId = String(record.project_id);
  if (!projectsWithViewers().has(projectId)) return;
  if (event === "lf_presence") await sendPresence(projectId);
  else if (event === "lf_comments" && action === "create") broadcast(projectId, { type: "comment", data: { comment: comment(record) } });
  else if (event === "lf_placements" && action === "create") {
    const relayed = await placementRelay(projectId, record);
    if (relayed) broadcast(projectId, relayed);
  }
}

function setConnected(value: boolean): void {
  if (connected === value) return;
  connected = value;
  for (const projectId of projectsWithViewers()) broadcast(projectId, { type: "status", data: { live: value } });
}

/** Opens the realtime stream and subscribes; resolves once subscribed, then keeps reading in the background. */
async function openSubscription(): Promise<void> {
  await pb.ensureCollections();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(`${config.pocketbase.url}/api/realtime`, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
  } catch {
    throw new ProviderUnavailable("pocketbase", "realtime got no reply");
  }
  if (!response.ok || !response.body) throw new ProviderUnavailable("pocketbase", `realtime answered ${response.status}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  const nextEvent = async (): Promise<{ event: string; data: string } | null> => {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        return { event, data: data.join("\n") };
      }
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += value.replace(/\r/g, "");
    }
  };
  try {
    const hello = await nextEvent();
    if (hello?.event !== "PB_CONNECT") throw new ProviderUnavailable("pocketbase", "realtime sent no client id");
    const { clientId } = JSON.parse(hello.data) as { clientId: string };
    await pb.subscribe(clientId, Object.keys(pb.COLLECTIONS));
  } catch (error) {
    controller.abort();
    throw error instanceof ProviderUnavailable ? error : new ProviderUnavailable("pocketbase", "realtime handshake failed");
  } finally {
    clearTimeout(timer);
  }
  void (async () => {
    try {
      for (let next = await nextEvent(); next; next = await nextEvent()) {
        await onRealtime(next.event, next.data).catch((error: unknown) =>
          console.error("realtime relay failed:", errorCode(error)),
        );
      }
    } catch {
      // The stream broke (PocketBase went away); the reconnect below decides what happens next.
    }
    // A stream can also end normally (PocketBase closes idle clients): reconnect at once before reporting a pause.
    void connect();
  })();
}

let connecting = false;

async function connect(): Promise<void> {
  if (connecting) return;
  connecting = true;
  try {
    await openSubscription();
    const wasConnected = connected;
    setConnected(true);
    if (!wasConnected) {
      await refreshPresence();
      for (const projectId of projectsWithViewers()) await sendPresence(projectId);
    }
  } catch (error) {
    if (connected) console.error("pocketbase unavailable:", errorCode(error));
    setConnected(false);
    setTimeout(() => void connect(), RETRY_MS);
  } finally {
    connecting = false;
  }
}

export function startLive(relay: typeof placementRelay): void {
  placementRelay = relay;
  void connect();
  setInterval(() => void refreshPresence(), PRESENCE_REFRESH_MS).unref();
  // Drop viewers whose presence aged out (a browser that vanished without closing its stream).
  setInterval(() => {
    for (const projectId of projectsWithViewers()) void sendPresence(projectId);
  }, RETRY_MS).unref();
}

export function openStream(projectId: string, userId: string, name: string, res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const stream: Stream = { projectId, userId, name, res };
  streams.add(stream);
  write(stream, { type: "status", data: { live: connected } });
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);
  if (connected) {
    void markPresent(stream)
      .then(() => sendPresence(projectId))
      .catch((error: unknown) => console.error("presence failed:", errorCode(error)));
  }
  res.on("close", () => {
    clearInterval(heartbeat);
    streams.delete(stream);
    const key = `${projectId}:${userId}`;
    const stillHere = [...streams].some((other) => other.projectId === projectId && other.userId === userId);
    const record = presenceRecords.get(key);
    if (stillHere || !record) return;
    presenceRecords.delete(key);
    if (connected) {
      void pb.deleteRecord("lf_presence", record).catch((error: unknown) =>
        console.error("presence delete failed:", errorCode(error)),
      );
    }
  });
}

/** Writes a placement change to PocketBase after the Postgres save; false when live collaboration is down. */
export async function recordPlacement(
  projectId: string,
  placementId: string,
  variantCode: string,
  xMm: number,
  yMm: number,
  action: "created" | "updated" | "deleted",
): Promise<boolean> {
  try {
    await pb.createRecord("lf_placements", {
      project_id: projectId,
      placement_id: placementId,
      variant_code: variantCode,
      x_mm: xMm,
      y_mm: yMm,
      action,
    });
    return true;
  } catch (error) {
    if (!(error instanceof ProviderUnavailable)) throw error;
    return false;
  }
}

export async function listComments(projectId: string): Promise<Comment[]> {
  return (await pb.listRecords("lf_comments", `project_id = ${pb.quote(projectId)}`, "created")).map(comment);
}

export async function postComment(projectId: string, authorId: string, authorName: string, body: string): Promise<Comment> {
  return comment(
    await pb.createRecord("lf_comments", { project_id: projectId, author_id: authorId, author_name: authorName, body }),
  );
}
