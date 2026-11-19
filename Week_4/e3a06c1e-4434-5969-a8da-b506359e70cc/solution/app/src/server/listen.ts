// GET /v1/listen: key-authenticated 16 kHz 16-bit PCM over a WebSocket.
import { randomUUID } from "node:crypto";
import { isRecord } from "../shared/guards";
import { ServerResponse, type IncomingMessage, type Server } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { authenticateKey } from "./access";
import { ApiError, internalError, invalid, sendError } from "./http";
import { holdStreamConnection, one, type Db } from "./db";
import { putObject, sessionPrefix, unavailableAs503 } from "./storage";
import { projectQuota } from "./quota";
import { end, feed, goLive, openSession, setCues } from "./runtime";
import { parseSidecar } from "./sidecar";
import { limited } from "../shared/text";

const MESSAGE_MAX = 64_000;
const SIDECAR_MAX = 200_000;
// Messages up to 1 MiB reach the handler, which applies the 64,000-byte limit; larger ones are cut off by ws itself.
const wss = new WebSocketServer({ noServer: true, maxPayload: 1_048_576 });

/** Answers a refused upgrade as plain HTTP through the shared error writer. */
function refuse(req: IncomingMessage, socket: Duplex, error: ApiError): void {
  const res = new ServerResponse(req);
  res.assignSocket(socket as Socket);
  res.shouldKeepAlive = false;
  res.on("finish", () => socket.end());
  sendError(res, error);
}

async function quotaOf(projectId: string, db?: Db) {
  const project = await one<{ quota_minutes: number }>("SELECT quota_minutes FROM projects WHERE id = $1", [projectId], db);
  return projectQuota(projectId, project!.quota_minutes, db);
}

/** Opens the session before the upgrade: 401 invalid_key, 429 quota_exhausted, 422, 503 storage_unavailable, in that order. */
async function prepare(req: IncomingMessage): Promise<{ id: string; projectId: string; channels: number }> {
  const key = await authenticateKey(req);
  if ((await quotaOf(key.project_id)).exhausted) throw new ApiError(429, "quota_exhausted", "This project's monthly audio minutes are used up.");
  const query = new URL(req.url ?? "/", "http://listen").searchParams;
  const fields: Record<string, string> = {};
  const channels = query.get("channels") ?? "1";
  if (channels !== "1" && channels !== "2") fields.channels = "Use 1 or 2 channels.";
  const rate = query.get("sample_rate");
  if (rate !== null && rate !== "16000") fields.sample_rate = "Use a sample rate of 16000.";
  const label = limited(query.get("label") ?? "", 0, 80);
  if (label === null) fields.label = "Enter a label of up to 80 characters.";
  if (Object.keys(fields).length) throw invalid(fields);
  const id = randomUUID();
  await unavailableAs503(putObject(`${sessionPrefix(key.org_id, key.project_id, id)}capture.pcm`, Buffer.alloc(0), "application/octet-stream"));
  await openSession({ id, projectId: key.project_id, orgId: key.org_id, keyId: key.id, kind: "live", source: "live", label: label! || "Live stream", channels: Number(channels), cues: [] });
  return { id, projectId: key.project_id, channels: Number(channels) };
}

function attach(ws: WebSocket, session: { id: string; projectId: string; channels: number }): void {
  const send = (message: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(message));
  let messages = 0;
  const connection = holdStreamConnection(session.id);
  send({ type: "session", session_id: session.id });
  send({ type: "state", state: "connecting", close_reason: null });
  const quota = setInterval(async () => {
    const current = await connection.ready.then((db) => quotaOf(session.projectId, db)).catch(() => null);
    if (current) send({ type: "quota", used_seconds: current.used_seconds, limit_seconds: current.limit_minutes * 60 });
  }, 2000);
  ws.on("message", (data: RawData, isBinary: boolean) => {
    messages++;
    const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
    if (isBinary) {
      if (bytes.length > MESSAGE_MAX) void end(session.id, "closed", "client", 1009);
      else if (bytes.length % (2 * session.channels) !== 0) void end(session.id, "closed", "client", 1007);
      else feed(session.id, bytes);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      parsed = null;
    }
    if (!isRecord(parsed)) {
      send({ type: "error", error: "invalid_message" });
      return;
    }
    const message = parsed;
    if (message.type === "close") void end(session.id, "closed", "client");
    else if (message.type === "sidecar") {
      if (messages > 1) send({ type: "error", error: "sidecar_too_late" });
      else {
        const cues = typeof message.vtt === "string" && Buffer.byteLength(message.vtt) <= SIDECAR_MAX ? parseSidecar(message.vtt) : null;
        if (cues) setCues(session.id, cues);
        else send({ type: "error", error: "invalid_sidecar" });
      }
    } else send({ type: "error", error: "invalid_message" });
  });
  ws.on("close", () => {
    clearInterval(quota);
    connection.release();
    void end(session.id, "closed", "disconnect");
  });
  // A message over ws's own cut-off is still a message over the limit: closed by the client's protocol error.
  ws.on("error", (error: Error & { code?: string }) => {
    if (error.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH") void end(session.id, "closed", "client", 1009);
    else ws.terminate();
  });
  void goLive(session.id, { socket: ws });
}

export function attachListen(server: Server): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? "/", "http://listen").pathname !== "/v1/listen") {
      socket.destroy();
      return;
    }
    socket.on("error", () => socket.destroy());
    prepare(req).then(
      (session) => wss.handleUpgrade(req, socket, head, (ws) => attach(ws, session)),
      (error: unknown) => refuse(req, socket, error instanceof ApiError ? error : internalError()),
    );
  });
}
