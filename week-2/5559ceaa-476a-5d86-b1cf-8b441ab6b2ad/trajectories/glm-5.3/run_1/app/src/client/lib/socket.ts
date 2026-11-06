export type FrameHandler = (frame: Record<string, unknown>) => void;

export class ProjectSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private queue: Record<string, unknown>[] = [];

  constructor(
    private projectId: string,
    private handler: FrameHandler,
    private onRevoked: () => void,
    private onClose: () => void,
  ) {}

  connect(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/api/projects/${this.projectId}/socket`);
    this.ws.addEventListener("message", (ev) => {
      try {
        const frame = JSON.parse(ev.data as string) as Record<string, unknown>;
        this.handler(frame);
      } catch {
        // ignore malformed frames
      }
    });
    this.ws.addEventListener("close", (ev) => {
      if (ev.code === 4403) {
        this.onRevoked();
        return;
      }
      if (!this.closed) {
        this.onClose();
      }
    });
    this.ws.addEventListener("open", () => {
      for (const f of this.queue) this.send(f);
      this.queue = [];
    });
  }

  send(frame: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    } else {
      this.queue.push(frame);
    }
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }
}
