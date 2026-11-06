/** HTTP calls to the same-origin API, and the page's single socket. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, readonly fields: Record<string, string> = {}) { super(code); }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json; charset=utf-8" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
  if (!res.ok) throw new HttpError(res.status, data.error ?? "error", data.fields ?? {});
  return data as T;
}

export type ServerFrame = { type: string; ref?: string; [k: string]: unknown };

interface Waiter { resolve: (f: ServerFrame) => void }

/**
 * One WebSocket per page (API, Socket). Replies are matched by `ref`; every other frame goes to
 * `onFrame`. An unexpected close reports `onDrop`; the page decides whether to reconnect.
 */
export class Live {
  private ws: WebSocket;
  private waiting = new Map<string, Waiter>();
  private seq = 0;
  private closedOnPurpose = false;
  private beat: number;

  constructor(private onFrame: (f: ServerFrame) => void, onOpen: () => void, private onDrop: () => void) {
    this.ws = new WebSocket(location.origin.replace(/^http/, "ws") + "/api/socket");
    this.ws.onopen = onOpen;
    this.ws.onmessage = (e) => this.receive(String(e.data));
    this.ws.onclose = () => { window.clearInterval(this.beat); if (!this.closedOnPurpose) this.onDrop(); };
    this.beat = window.setInterval(() => { if (this.open) void this.request({ type: "heartbeat" }); }, 15000);
  }

  get open(): boolean { return this.ws.readyState === WebSocket.OPEN; }

  private receive(text: string): void {
    const f = JSON.parse(text) as ServerFrame;
    if ((f.type === "ack" || f.type === "error" || f.type === "joined") && f.ref && this.waiting.has(f.ref)) {
      const w = this.waiting.get(f.ref);
      this.waiting.delete(f.ref);
      w?.resolve(f);
      return;
    }
    this.onFrame(f);
  }

  /** Sends a frame and resolves with its ack, error or joined reply. */
  request(frame: Record<string, unknown>): Promise<ServerFrame> {
    const ref = `r${++this.seq}`;
    return new Promise((resolve) => {
      this.waiting.set(ref, { resolve });
      this.ws.send(JSON.stringify({ ...frame, ref }));
    });
  }

  close(): void {
    this.closedOnPurpose = true;
    window.clearInterval(this.beat);
    this.ws.close();
  }

  /** The server closed the socket after a final frame (access ended). */
  expectClose(): void { this.closedOnPurpose = true; }
}
