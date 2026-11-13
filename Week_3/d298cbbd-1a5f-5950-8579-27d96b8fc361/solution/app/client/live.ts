/** The one live channel to the server (a WebSocket on this origin), shared by every page that watches a board or a room. */

import type { LivePush, LiveRequest } from "../shared/protocol";

const RECONNECT_MS = 1000;

interface Subscription {
  /** Builds the request to (re)send each time the channel opens, so a room can ask only for events it has not seen. */
  readonly open: () => LiveRequest;
  readonly onPush: (push: LivePush) => void;
}

class LiveChannel {
  private socket: WebSocket | null = null;
  private readonly subscriptions = new Set<Subscription>();
  private reconnect: number | null = null;

  subscribe(subscription: Subscription): () => void {
    this.subscriptions.add(subscription);
    if (this.socket === null) this.connect();
    else if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(subscription.open()));
    return () => {
      this.subscriptions.delete(subscription);
      if (this.subscriptions.size === 0) this.close();
    };
  }

  /** Sends now when open; entries typed while the channel is down are re-sent by the room page once it reconnects. */
  send(request: LiveRequest): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(request));
  }

  private connect(): void {
    const socket = new WebSocket(`${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/live`);
    this.socket = socket;
    socket.addEventListener("open", () => {
      for (const subscription of this.subscriptions) socket.send(JSON.stringify(subscription.open()));
    });
    socket.addEventListener("message", (event) => {
      const push = JSON.parse(String(event.data)) as LivePush;
      for (const subscription of [...this.subscriptions]) subscription.onPush(push);
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.subscriptions.size > 0) this.reconnect = window.setTimeout(() => this.connect(), RECONNECT_MS);
    });
  }

  private close(): void {
    if (this.reconnect !== null) window.clearTimeout(this.reconnect);
    this.reconnect = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }
}

export const live = new LiveChannel();
