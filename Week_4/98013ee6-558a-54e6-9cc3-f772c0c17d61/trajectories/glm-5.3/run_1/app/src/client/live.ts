import { state } from "./core";

/** The live channel client: watch boards, pins, users and the feed. */
type Handler = (msg: Record<string, unknown>) => void;

class LiveChannel {
  ws: WebSocket | null = null;
  handlers: Handler[] = [];
  queue: string[] = [];
  boards = new Set<number>();
  pins = new Set<number>();
  users = new Set<number>();
  feed = false;
  reconnectTimer: number | undefined;

  connect(): void {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    this.ws = new WebSocket(`${proto}//${location.host}/api/live`);
    this.ws.addEventListener("open", () => {
      const pending = this.queue;
      this.queue = [];
      for (const raw of pending) this.send(JSON.parse(raw) as Record<string, unknown>);
      if (this.feed) this.send({ type: "watch", feed: true });
      for (const b of this.boards) this.send({ type: "watch", board: b });
      for (const p of this.pins) this.send({ type: "watch", pin: p });
      for (const u of this.users) this.send({ type: "watch", user: u });
    });
    this.ws.addEventListener("message", e => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(e.data as string) as Record<string, unknown>; } catch { return; }
      if (msg.type === "clock" && typeof msg.now === "string") {
        // The browser counts on from the last business now it received (DP-71).
        import("./core").then(core => core.setBusinessNow(msg.now as string));
      }
      for (const handler of this.handlers) handler(msg);
    });
    this.ws.addEventListener("close", () => {
      this.reconnectTimer = window.setTimeout(() => this.connect(), 1_000);
    });
  }

  private send(msg: Record<string, unknown>): void {
    const raw = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(raw); } catch { this.queue.push(raw); }
      return;
    }
    // Anything not yet open is queued; the open handler replays it.
    this.queue.push(raw);
  }

  watch(board?: number, pin?: number, user?: number, feed?: boolean): void {
    if (board !== undefined) { this.boards.add(board); this.send({ type: "watch", board }); }
    if (pin !== undefined) { this.pins.add(pin); this.send({ type: "watch", pin }); }
    if (user !== undefined) { this.users.add(user); this.send({ type: "watch", user }); }
    if (feed) { this.feed = true; this.send({ type: "watch", feed: true }); }
  }

  unwatch(board?: number, pin?: number, user?: number, feed?: boolean): void {
    if (board !== undefined) { this.boards.delete(board); this.send({ type: "unwatch", board }); }
    if (pin !== undefined) { this.pins.delete(pin); this.send({ type: "unwatch", pin }); }
    if (user !== undefined) { this.users.delete(user); this.send({ type: "unwatch", user }); }
    if (feed) { this.feed = false; this.send({ type: "unwatch", feed: true }); }
  }

  on(handler: Handler): void {
    this.handlers.push(handler);
  }
}

export const live = new LiveChannel();

export function connectLive(): void {
  if (state.me) live.connect();
}
