import { pageStatus } from "./app";

/** One WebSocket with automatic reconnects. A page that hears nothing for 5 seconds treats the connection as lost. */

export type Message = { type: string } & Record<string, unknown>;

const SILENCE_MS = 5000;
const RETRY_MS = 1000;
const WATCH_MS = 1000;

interface Socket {
  send: (message: Record<string, unknown>) => void;
  close: () => void;
}

const TAB_TOKEN_KEY = "dc-reconnect-token";

/** The reconnect token lives for this browser tab only, so a reloaded tab rejoins its seat as the same tab. */
export function reconnectToken(): string {
  let token = sessionStorage.getItem(TAB_TOKEN_KEY);
  if (!token) {
    token = crypto.randomUUID();
    sessionStorage.setItem(TAB_TOKEN_KEY, token);
  }
  return token;
}

export function connect(path: string, onMessage: (message: Message) => void, announce = false): Socket {
  let ws: WebSocket | null = null;
  let live = false;
  let lastHeard = performance.now();
  let stopped = false;
  let retry: number | undefined;

  const lose = (): void => {
    if (!live && ws === null) return;
    live = false;
    ws?.close();
    ws = null;
    if (announce) pageStatus("Connection lost. Reconnecting...", true);
    if (!stopped) retry = window.setTimeout(open, RETRY_MS);
  };

  const open = (): void => {
    if (stopped) return;
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`);
    ws = socket;
    socket.addEventListener("open", () => {
      lastHeard = performance.now();
      live = true;
      if (announce) pageStatus("", true);
    });
    socket.addEventListener("message", (event) => {
      lastHeard = performance.now();
      const message = JSON.parse(String(event.data)) as Message;
      if (message.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
      else onMessage(message);
    });
    socket.addEventListener("close", () => {
      if (ws === socket) lose();
    });
  };

  const watcher = window.setInterval(() => {
    if (live && performance.now() - lastHeard > SILENCE_MS) lose();
  }, WATCH_MS);
  open();

  return {
    send: (message) => {
      if (ws && live) ws.send(JSON.stringify(message));
    },
    close: () => {
      stopped = true;
      window.clearTimeout(retry);
      window.clearInterval(watcher);
      ws?.close();
      ws = null;
    },
  };
}
