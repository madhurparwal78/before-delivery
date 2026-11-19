// One live socket per page: replay from the last sequence, reconnect on its own, announce notices once.
import { Lot, HistoryRow, Notice, announce } from "./lib";

export interface LotFrame {
  seq: number;
  type: "lot_changed";
  cause: string;
  lot: Lot;
  history: HistoryRow[];
}

export interface NoticeFrame {
  seq: number;
  type: "notice";
  notice: Notice;
}

export type Frame = LotFrame | NoticeFrame;
export type SocketState = "connecting" | "open" | "down";

type CoverKind = "price" | "close";

const COVERS: Record<string, CoverKind> = { outbid: "price", won: "close", lot_closed: "close", lot_result: "close" };

class Live {
  state: SocketState = "connecting";
  private socket: WebSocket | null = null;
  private lastSeq: number | null = null;
  private timer: number | undefined;
  private failures = 0;
  private started = false;
  private seen = new Set<string>();
  private covered = new Set<string>();
  private frameListeners = new Set<(f: Frame) => void>();
  private stateListeners = new Set<() => void>();

  /** start opens the page's one socket, asking for every event after `since` when it is known. */
  start(since: number | null): void {
    if (this.started) return;
    this.started = true;
    this.lastSeq = since;
    this.connect();
  }

  onFrame(fn: (f: Frame) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  onState(fn: () => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  /** takeCover says whether a notice already announced this kind of change for the lot. */
  takeCover(lotId: string, kind: CoverKind): boolean {
    return this.covered.delete(`${lotId}:${kind}`);
  }

  retryNow(): void {
    window.clearTimeout(this.timer);
    const old = this.socket;
    this.socket = null;
    old?.close();
    this.connect();
  }

  private setState(next: SocketState): void {
    if (this.state === next) return;
    this.state = next;
    this.stateListeners.forEach((fn) => fn());
  }

  private connect(): void {
    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    const query = this.lastSeq === null ? "" : `?since=${this.lastSeq}`;
    const socket = new WebSocket(`${scheme}//${window.location.host}/api/live${query}`);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.failures = 0;
      this.setState("open");
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.receive(JSON.parse(String(event.data)) as Frame);
    };
    const lost = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setState("down");
      const delay = this.failures === 0 ? 1000 : 2000;
      this.failures += 1;
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
    socket.onclose = lost;
    socket.onerror = lost;
  }

  private receive(frame: Frame): void {
    this.lastSeq = Math.max(this.lastSeq ?? 0, frame.seq);
    if (frame.type === "notice") {
      const { notice } = frame;
      if (this.seen.has(notice.id)) return;
      this.seen.add(notice.id);
      const cover = COVERS[notice.kind];
      if (cover && notice.lot_id) this.covered.add(`${notice.lot_id}:${cover}`);
      announce(notice.text);
    }
    this.frameListeners.forEach((fn) => fn(frame));
  }
}

export const live = new Live();
