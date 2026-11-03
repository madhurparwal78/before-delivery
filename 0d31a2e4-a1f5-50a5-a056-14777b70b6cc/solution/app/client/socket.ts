// The live connection: heartbeats every five seconds, reconnection, and dispatch of server pushes.
import { COPY } from "./copy.js";
import { onRound, onTick } from "./live.js";
import { announce } from "./notices.js";
import { addMessage, applyLobby, applyParty, me, refreshFriends, refreshParty, setPresence } from "./state.js";
import { onVoiceMessage } from "./voice.js";
import type { ServerMessage } from "../shared/api.js";

const HEARTBEAT_MS = 5000;
const RETRY_MS = 2000;

let socket: WebSocket | null = null;
let heartbeat: number | null = null;
let lost = false;

export function send(message: object): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function dispatch(message: ServerMessage): void {
  const self = me.get();
  switch (message.type) {
    case "presence":
      setPresence(message.userId, message.presence);
      break;
    case "friends":
      void refreshFriends().catch(() => undefined);
      break;
    case "party":
      applyParty(message.party);
      void refreshParty().catch(() => undefined);
      break;
    case "lobby":
      applyLobby(message.lobby, null);
      break;
    case "round":
      onRound(message.matchId, message.round);
      break;
    case "tick":
      if (self) onTick(message.matchId, message.round, message.tick, message.beans, self.id);
      break;
    case "chat":
      addMessage(message.message);
      break;
    case "voice_signal":
    case "voice_state":
      onVoiceMessage(message);
      break;
    case "input_rejected":
    case "error":
      break;
  }
}

// Opens the live connection unless one is already open or opening.
export function connect(): void {
  if (socket !== null) return;
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const next = new WebSocket(`${scheme}://${window.location.host}/ws`);
  socket = next;
  next.addEventListener("open", () => {
    send({ type: "heartbeat" });
    if (heartbeat !== null) window.clearInterval(heartbeat);
    heartbeat = window.setInterval(() => send({ type: "heartbeat" }), HEARTBEAT_MS);
    if (lost) {
      lost = false;
      announce(COPY.backOnline);
      if (me.get()?.emailVerified) {
        void refreshParty().catch(() => undefined);
        void refreshFriends().catch(() => undefined);
      }
    }
  });
  next.addEventListener("message", (event: MessageEvent<string>) => dispatch(JSON.parse(event.data) as ServerMessage));
  next.addEventListener("close", (event) => {
    if (socket !== next) return;
    socket = null;
    if (event.code === 4401) return;
    if (!lost) announce(COPY.reconnecting);
    lost = true;
    window.setTimeout(connect, RETRY_MS);
  });
}
