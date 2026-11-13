// Live connections on this process: presence from heartbeats, pushes for database events, and voice signalling.
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { query, type ServerEvent } from "./db.js";
import { instanceId } from "./instance.js";
import { sameOrigin, sessionUser } from "./http.js";
import { loadLobby } from "./lobby.js";
import { forfeitHere, handleInput } from "./live.js";
import { loadMessage } from "./chat.js";
import { loadParty, partyIdOf } from "./party.js";
import { visibleFriends } from "./users.js";
import { type PartyState, type Presence, PRESENCE_OFFLINE_MS } from "../shared/rules.js";

interface VoiceState {
  inVoice: boolean;
  muted: boolean;
  speaking: boolean;
}

interface PartyInfo {
  partyId: number;
  size: number;
  state: PartyState;
  members: number[];
}

const sockets = new Map<number, Set<WebSocket>>();
const heartbeats = new Map<number, number>();
const parties = new Map<number, PartyInfo>();
const announced = new Map<number, Presence>();
const voice = new Map<number, VoiceState>();
const PRESENCE_SWEEP_MS = 500;

// The presence rule, decided here only.
export function presenceFor(userId: number, partySize: number, partyState: PartyState): Presence {
  const beat = heartbeats.get(userId);
  if (beat === undefined || Date.now() - beat >= PRESENCE_OFFLINE_MS) return "offline";
  if (partyState === "in_match") return "in_match";
  if (partySize >= 2 || partyState === "queued" || partyState === "in_lobby") return "in_party";
  return "online";
}

export function sendTo(userId: number, message: object): void {
  const open = sockets.get(userId);
  if (open === undefined) return;
  const payload = JSON.stringify(message);
  for (const socket of open) if (socket.readyState === WebSocket.OPEN) socket.send(payload);
}

function connected(userId: number): boolean {
  return (sockets.get(userId)?.size ?? 0) > 0;
}

async function refreshParty(partyId: number): Promise<number[]> {
  const party = await loadParty(partyId);
  const members = party.members.map((member) => member.user.id);
  for (const userId of members) {
    parties.set(userId, { partyId, size: members.length, state: party.state, members });
    sendTo(userId, { type: "party", party });
  }
  return members;
}

async function learnParty(userId: number): Promise<void> {
  if (!parties.has(userId)) await refreshParty(await partyIdOf(userId));
}

async function announcePresence(userId: number): Promise<void> {
  const info = parties.get(userId);
  const presence = presenceFor(userId, info?.size ?? 1, info?.state ?? "idle");
  if (announced.get(userId) === presence) return;
  announced.set(userId, presence);
  if (presence === "offline") {
    heartbeats.delete(userId);
    announced.delete(userId);
  }
  for (const friendId of await visibleFriends(userId)) sendTo(friendId, { type: "presence", userId, presence });
}

function voiceStateMessage(userId: number, state: VoiceState): object {
  return { type: "voice_state", userId, ...state };
}

// Every party member in voice learns the voice state of every other member.
function shareVoice(members: number[]): void {
  for (const viewer of members) {
    for (const userId of members) {
      const state = voice.get(userId);
      if (userId !== viewer && state !== undefined) sendTo(viewer, voiceStateMessage(userId, state));
    }
  }
}

function sameParty(a: number, b: number): boolean {
  const info = parties.get(a);
  return info !== undefined && info.members.includes(b);
}

export async function onServerEvent(event: ServerEvent): Promise<void> {
  if (event.kind === "party") {
    const members = await refreshParty(event.partyId);
    for (const userId of members) await announcePresence(userId);
    shareVoice(members);
  } else if (event.kind === "invites") {
    if (connected(event.userId)) sendTo(event.userId, { type: "party", party: await loadParty(await partyIdOf(event.userId)) });
  } else if (event.kind === "friends") {
    sendTo(event.userId, { type: "friends" });
  } else if (event.kind === "lobby") {
    const lobby = await loadLobby(event.lobbyId);
    if (lobby !== null) for (const seat of lobby.seats) sendTo(seat.userId, { type: "lobby", lobby });
  } else if (event.kind === "forfeit") {
    await forfeitHere(event.matchId, event.userId);
  } else if (event.kind === "chat") {
    const message = await loadMessage(event.messageId);
    if (message === null) return;
    const recipients = message.channel === "party"
      ? (await query("SELECT user_id FROM party_members WHERE party_id = $1", [message.partyId])).map((row) => Number(row["user_id"]))
      : [message.fromUserId, message.toUserId ?? 0];
    for (const userId of new Set(recipients)) sendTo(userId, { type: "chat", message });
  }
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

async function onMessage(userId: number, socket: WebSocket, raw: string): Promise<void> {
  let message: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return;
    message = parsed as Record<string, unknown>;
  } catch {
    return;
  }
  const reply = (body: object): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(body));
  };
  switch (message["type"]) {
    case "heartbeat":
      heartbeats.set(userId, Date.now());
      await learnParty(userId);
      await announcePresence(userId);
      return;
    case "input": {
      const rejected = handleInput(userId, message);
      if (rejected !== null) reply({ type: "input_rejected", ...rejected });
      return;
    }
    case "voice_state": {
      await learnParty(userId);
      const was = voice.get(userId);
      const state = { inVoice: asBoolean(message["inVoice"]), muted: asBoolean(message["muted"]), speaking: asBoolean(message["speaking"]) };
      if (state.inVoice) voice.set(userId, state);
      else voice.delete(userId);
      for (const memberId of parties.get(userId)?.members ?? []) {
        if (memberId !== userId) sendTo(memberId, voiceStateMessage(userId, state));
      }
      if (state.inVoice && was === undefined) {
        for (const memberId of parties.get(userId)?.members ?? []) {
          const other = voice.get(memberId);
          if (memberId !== userId && other !== undefined) reply(voiceStateMessage(memberId, other));
        }
      }
      return;
    }
    case "voice_signal": {
      const to = Number(message["to"]);
      if (!voice.has(userId) || !voice.has(to) || !sameParty(userId, to)) {
        reply({ type: "error", code: "not_in_voice" });
        return;
      }
      sendTo(to, { type: "voice_signal", from: userId, data: message["data"] });
    }
  }
}

function leaveVoice(userId: number): void {
  if (!voice.delete(userId)) return;
  for (const memberId of parties.get(userId)?.members ?? []) {
    if (memberId !== userId) sendTo(memberId, voiceStateMessage(userId, { inVoice: false, muted: false, speaking: false }));
  }
}

export function attachHub(publicUrl: string): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  const server = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  setInterval(() => {
    for (const userId of [...heartbeats.keys()]) void announcePresence(userId).catch((error: unknown) => console.error(error));
  }, PRESENCE_SWEEP_MS);
  return (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://app.invalid").pathname !== "/ws") {
      socket.destroy();
      return;
    }
    const foreign = !sameOrigin(req, publicUrl);
    void sessionUser(req).catch(() => null).then((session) => {
      server.handleUpgrade(req, socket, head, (ws) => {
        if (foreign) {
          ws.close(4403, "bad origin");
          return;
        }
        if (session === null) {
          ws.close(4401, "unauthenticated");
          return;
        }
        const userId = session.me.id;
        let open = sockets.get(userId);
        if (open === undefined) {
          open = new Set();
          sockets.set(userId, open);
          void query("INSERT INTO socket_users (user_id, instance_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, instanceId])
            .catch((error: unknown) => console.error(error));
        }
        open.add(ws);
        ws.on("message", (data) => {
          void onMessage(userId, ws, data.toString()).catch((error: unknown) => console.error(error));
        });
        ws.on("close", () => {
          open.delete(ws);
          if (open.size === 0) {
            sockets.delete(userId);
            leaveVoice(userId);
            void query("DELETE FROM socket_users WHERE user_id = $1 AND instance_id = $2", [userId, instanceId])
              .catch((error: unknown) => console.error(error));
          }
        });
      });
    });
  };
}
