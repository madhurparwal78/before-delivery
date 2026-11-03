export type WsMessage =
  | { type: "presence"; userId: number; presence: "offline" | "online" | "in_party" | "in_match" }
  | { type: "friends" }
  | { type: "party"; party: unknown }
  | { type: "lobby"; lobby: unknown }
  | { type: "round"; matchId: number; round: unknown }
  | { type: "tick"; matchId: number; round: number; tick: number; beans: unknown[]; slotsLeft?: number }
  | { type: "input_rejected"; tick: number; reason: "late" | "early" | "not_playing" | "invalid" }
  | { type: "chat"; message: unknown }
  | { type: "voice_signal"; from?: number; to?: number; data: unknown }
  | { type: "voice_state"; userId: number; inVoice: boolean; muted: boolean; speaking: boolean }
  | { type: "match_finished"; matchId: number; winnerId: number | null }
  | { type: "error"; code: string };

type Listener = (msg: WsMessage) => void;

export class LiveSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private heartbeatTimer: number | null = null;
  private retryTimer: number | null = null;
  private closedByUs = false;

  connect(): void {
    this.closedByUs = false;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.send({ type: "heartbeat" });
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => this.send({ type: "heartbeat" }), 5000) as unknown as number;
      this.notify({ type: "friends" });
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as WsMessage;
        this.notify(msg);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this.closedByUs) return;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.connect(), 1500) as unknown as number;
    };
  }

  send(message: WsMessage | Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.closedByUs = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(msg: WsMessage): void {
    for (const listener of this.listeners) listener(msg);
  }
}
