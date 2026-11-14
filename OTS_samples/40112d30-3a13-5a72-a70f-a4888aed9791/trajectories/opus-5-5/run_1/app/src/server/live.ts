import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { Change, PublicUser } from "../shared/types.js";
import { sessionUser } from "./auth.js";
import { setClockOffset } from "./clock.js";
import { one, query } from "./db.js";
import { ApiError } from "./errors.js";
import { closedInfo, loadForm, roleOf, UUID_PATTERN, withClock, type FormRow } from "./forms.js";
import { keys, publish, subscriber, valkey, valkeyUp } from "./valkey.js";

const TICK_MS = 500;
const PRESENCE_REFRESH_MS = 10000;
const PRESENCE_TTL_MS = 30000;

type View = "builder" | "summary" | "response";

interface Socket {
  ws: WebSocket;
  view: View;
  formId: string;
  user: PublicUser | null;
  device: string | null;
  responseId: string | null;
}

const sockets = new Set<Socket>();
const knownStates = new Map<string, string>();

type ChangeHandler = (form: FormRow, user: PublicUser, change: Change) => Promise<void>;
let changeHandler: ChangeHandler | null = null;

export function onLiveChange(handler: ChangeHandler): void {
  changeHandler = handler;
}

function sendTo(socket: Socket, message: unknown): void {
  if (socket.ws.readyState === WebSocket.OPEN) socket.ws.send(JSON.stringify(message));
}

function socketsFor(formId: string, views: View[]): Socket[] {
  return [...sockets].filter((s) => s.formId === formId && views.includes(s.view));
}

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

/* ---------- Form state ---------- */

function formStateMessage(form: FormRow): unknown {
  return { type: "form_state", state: form.state, closed_reason: form.closed_reason, closed: closedInfo(form) };
}

/** Tells every instance's open pages about a form's new state. */
export async function announceFormState(form: FormRow): Promise<void> {
  deliverFormState(form);
  await publish(keys.formChannel(form.id), formStateMessage(form));
}

function deliverFormState(form: FormRow): void {
  const signature = `${form.state}:${form.closed_reason ?? ""}`;
  if (knownStates.get(form.id) === signature) return;
  knownStates.set(form.id, signature);
  for (const socket of socketsFor(form.id, ["builder", "summary", "response"])) sendTo(socket, formStateMessage(form));
}

async function tick(): Promise<void> {
  const clock = await one<{ offset_ms: string }>("SELECT offset_ms FROM app_clock WHERE id = 1");
  setClockOffset(clock ? Number(clock.offset_ms) : 0);
  const formIds = [...new Set([...sockets].map((s) => s.formId))];
  if (formIds.length === 0) return;
  const forms = await query<FormRow>("SELECT * FROM forms WHERE id = ANY($1::uuid[])", [formIds]);
  for (const form of forms) deliverFormState(withClock(form));
}

/* ---------- Presence ---------- */

interface PresenceEntry {
  name: string;
  joined: number;
  seen: number;
}

async function presenceList(formId: string): Promise<{ id: string; name: string }[]> {
  const raw = await valkey.hgetall(keys.presence(formId));
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  return Object.entries(raw)
    .map(([id, value]) => ({ id, ...(JSON.parse(value) as PresenceEntry) }))
    .filter((e) => e.seen >= cutoff)
    .sort((a, b) => a.joined - b.joined)
    .map((e) => ({ id: e.id, name: e.name }));
}

async function touchPresence(formId: string, users: PublicUser[]): Promise<void> {
  if (!valkeyUp()) return;
  const key = keys.presence(formId);
  for (const user of users) {
    const existing = await valkey.hget(key, user.id);
    const joined = existing ? (JSON.parse(existing) as PresenceEntry).joined : Date.now();
    await valkey.hset(key, user.id, JSON.stringify({ name: user.name, joined, seen: Date.now() }));
  }
  await valkey.pexpire(key, PRESENCE_TTL_MS);
}

async function broadcastPresence(formId: string): Promise<void> {
  if (!valkeyUp()) return;
  await publish(keys.formChannel(formId), { type: "presence", editors: await presenceList(formId) });
}

async function refreshPresence(): Promise<void> {
  const byForm = new Map<string, PublicUser[]>();
  for (const socket of sockets)
    if (socket.view === "builder" && socket.user) byForm.set(socket.formId, [...(byForm.get(socket.formId) ?? []), socket.user]);
  for (const [formId, users] of byForm) {
    await touchPresence(formId, users);
    await broadcastPresence(formId);
  }
}

/* ---------- Fan-out from Valkey ---------- */

function relay(channel: string, raw: string): void {
  const message = JSON.parse(raw) as { type: string; response?: string; device?: string };
  const summaryMatch = /^nf:summary:(.+)$/.exec(channel);
  if (summaryMatch) {
    for (const socket of socketsFor(summaryMatch[1], ["summary"])) sendTo(socket, message);
    return;
  }
  const formMatch = /^nf:form:([^:]+)$/.exec(channel);
  if (!formMatch) return;
  const formId = formMatch[1];
  switch (message.type) {
    case "applied":
    case "presence":
      for (const socket of socketsFor(formId, ["builder"])) sendTo(socket, message);
      return;
    case "moved":
      for (const socket of socketsFor(formId, ["response"]))
        if (socket.responseId === message.response && socket.device !== message.device) sendTo(socket, { type: "moved" });
      return;
    case "form_state":
      loadForm(formId).then(
        (form) => form && deliverFormState(form),
        () => undefined,
      );
      return;
  }
}

function broadcastLiveStatus(up: boolean): void {
  for (const socket of sockets) if (socket.view !== "response") sendTo(socket, { type: "live", up });
}

/* ---------- Joining ---------- */

async function join(socket: Socket, message: Record<string, unknown>, req: IncomingMessage): Promise<boolean> {
  if (typeof message.response === "string") {
    const device = cookieValue(req, "nf_device");
    if (!device || !UUID_PATTERN.test(message.response)) return false;
    const row = await one<{ form_id: string }>(
      "SELECT form_id FROM responses WHERE id = $1 AND device = $2 AND status = 'partial'",
      [message.response, device],
    );
    if (!row) return false;
    Object.assign(socket, { view: "response", formId: row.form_id, device, responseId: message.response });
    sockets.add(socket);
    sendTo(socket, { type: "joined", rev: 0 });
    return true;
  }
  const user = await sessionUser(cookieValue(req, "nf_session"));
  const view = message.view === "summary" ? "summary" : message.view === "builder" ? "builder" : null;
  if (!user || !view || typeof message.form !== "string") return false;
  const form = await loadForm(message.form);
  const role = form ? await roleOf(form, user.id) : null;
  if (!form || !role || (view === "builder" && role === "editor" && form.state === "closed")) return false;
  Object.assign(socket, { view, formId: form.id, user });
  sockets.add(socket);
  knownStates.set(form.id, `${form.state}:${form.closed_reason ?? ""}`);
  sendTo(socket, { type: "joined", rev: form.rev, live: valkeyUp() });
  if (view === "builder") {
    await touchPresence(form.id, [user]);
    await broadcastPresence(form.id);
  }
  return true;
}

async function leave(socket: Socket): Promise<void> {
  if (!sockets.delete(socket)) return;
  if (socket.view !== "builder" || !socket.user) return;
  const stillHere = [...sockets].some((s) => s.view === "builder" && s.formId === socket.formId && s.user?.id === socket.user?.id);
  if (!stillHere && valkeyUp()) {
    await valkey.hdel(keys.presence(socket.formId), socket.user.id).catch(() => undefined);
    await broadcastPresence(socket.formId);
  }
}

async function handleMessage(socket: Socket, raw: string, req: IncomingMessage): Promise<void> {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  if (message.type === "join") {
    if (!(await join(socket, message, req))) socket.ws.close(4404, "Not found");
    return;
  }
  if (message.type === "change" && socket.view === "builder" && socket.user && changeHandler) {
    const form = await loadForm(socket.formId);
    if (!form) return;
    try {
      await changeHandler(form, socket.user, message.change as Change);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      sendTo(socket, { type: "refused", error: error.body().error, ref: message.ref ?? null });
    }
  }
}

export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const wss = new WebSocketServer({ noServer: true });

export function handleUpgrade(req: IncomingMessage, socketStream: Duplex, head: Buffer): void {
  const path = new URL(req.url ?? "/", "http://local").pathname;
  if (path !== "/ws" || !sameOrigin(req)) {
    socketStream.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socketStream.destroy();
    return;
  }
  wss.handleUpgrade(req, socketStream, head, (ws) => {
    const socket: Socket = { ws, view: "response", formId: "", user: null, device: null, responseId: null };
    ws.on("message", (data) => {
      handleMessage(socket, data.toString(), req).catch(() => undefined);
    });
    ws.on("close", () => {
      leave(socket).catch(() => undefined);
    });
    ws.on("error", () => undefined);
  });
}

export function startLive(): void {
  subscriber.on("pmessage", (_pattern: string, channel: string, message: string) => {
    try {
      relay(channel, message);
    } catch {
      // A malformed message from another instance is ignored.
    }
  });
  const listen = (): void => {
    subscriber.psubscribe("nf:form:*", "nf:summary:*").catch(() => undefined);
  };
  subscriber.on("ready", listen);
  if (subscriber.status === "ready") listen();
  valkey.on("ready", () => broadcastLiveStatus(true));
  valkey.on("close", () => broadcastLiveStatus(false));
  const loop = (): void => {
    tick()
      .catch(() => undefined)
      .finally(() => setTimeout(loop, TICK_MS));
  };
  loop();
  setInterval(() => {
    refreshPresence().catch(() => undefined);
  }, PRESENCE_REFRESH_MS);
}
