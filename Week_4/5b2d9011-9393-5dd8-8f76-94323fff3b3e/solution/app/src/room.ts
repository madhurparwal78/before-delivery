import { api, ApiError, NetworkError } from "./api";
import { randomId } from "./dom";
import { emit, notify } from "./state";
import type { ReportBody, ReportResult, RoomEvent, RoomState } from "./types";

const RETRY_MS = 1000;
const HEARTBEAT_MS = 1000;

/** The player's connection to one room: the snapshot stream, the report buffer and the reconnect loop. */
export class RoomClient {
  state: RoomState;
  online = true;
  lastEventSeq: number;
  private buffer: ReportBody[] = [];
  private source: EventSource | null = null;
  private retryTimer = 0;
  private readonly heartbeatTimer: number;
  private beating = false;
  private closed = false;
  private lostAt = 0;

  constructor(initial: RoomState, readonly playerId: string) {
    this.state = initial;
    this.lastEventSeq = initial.events.at(-1)?.seq ?? 0;
    this.open();
    this.heartbeatTimer = window.setInterval(() => void this.beat(), HEARTBEAT_MS);
  }

  get code(): string {
    return this.state.code;
  }

  get seat() {
    return this.state.players.find((p) => p.id === this.playerId);
  }

  /** Milliseconds the connection has been down (zero while online). */
  get offlineMs(): number {
    return this.online ? 0 : performance.now() - this.lostAt;
  }

  /** A heartbeat renews the seat lease and notices a dead connection that the open stream does not. */
  private async beat(): Promise<void> {
    if (this.beating || !this.online || this.closed) return;
    this.beating = true;
    try {
      await api<void>("POST", `/api/rooms/${this.state.code}/heartbeat`);
    } catch (error) {
      if (error instanceof NetworkError) this.lost();
    } finally {
      this.beating = false;
    }
  }

  private open(): void {
    this.source?.close();
    const source = new EventSource(`/api/rooms/${this.state.code}/stream`);
    this.source = source;
    source.addEventListener("snapshot", (event) => {
      if (this.source !== source) return;
      this.apply(JSON.parse((event as MessageEvent<string>).data) as RoomState);
    });
    source.addEventListener("error", () => {
      if (this.source === source) this.lost();
    });
  }

  private apply(next: RoomState): void {
    const fresh: RoomEvent[] = next.events.filter((e) => e.seq > this.lastEventSeq);
    this.lastEventSeq = Math.max(this.lastEventSeq, next.events.at(-1)?.seq ?? 0);
    this.state = next;
    emit("room", { state: next, events: fresh });
  }

  private lost(): void {
    if (!this.online || this.closed) return;
    this.online = false;
    this.lostAt = performance.now();
    this.source?.close();
    this.source = null;
    notify("Connection lost — reconnecting. Your seat is held.");
    emit("connection", false);
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => void this.retry(), RETRY_MS);
  }

  private async retry(): Promise<void> {
    if (this.closed) return;
    let state: RoomState;
    try {
      state = await api<RoomState>("GET", `/api/rooms/${this.state.code}`);
    } catch (error) {
      if (error instanceof ApiError && (error.code === "room_not_found" || error.code === "unauthenticated")) emit("room-gone", this.state.code);
      else this.scheduleRetry();
      return;
    }
    this.online = true;
    this.state = state;
    this.open();
    if (await this.flush()) {
      emit("connection", true);
      emit("room", { state, events: [] });
    }
  }

  /** Sends the buffered reports in one batch, in the order made, then announces the reconnect. */
  private async flush(): Promise<boolean> {
    const pending = this.buffer.splice(0);
    if (pending.length > 0) {
      try {
        const answer = await api<{ results: ReportResult[] }>("POST", `/api/rooms/${this.state.code}/reports/batch`, { reports: pending });
        for (const result of answer.results) emit("report-result", result);
      } catch {
        this.buffer.unshift(...pending);
        this.online = true;
        this.lost();
        return false;
      }
    }
    notify(`Reconnected — ${pending.length} buffered reports sent.`);
    return true;
  }

  /** Sends one report, or keeps it for the batch while the connection is down. */
  async report(body: Omit<ReportBody, "report_id">): Promise<void> {
    const full: ReportBody = { report_id: randomId(), ...body };
    if (!this.online) {
      this.buffer.push(full);
      return;
    }
    try {
      emit("report-result", await api<ReportResult>("POST", `/api/rooms/${this.state.code}/reports`, full));
    } catch (error) {
      if (error instanceof NetworkError) {
        this.buffer.push(full);
        this.lost();
      }
    }
  }

  close(): void {
    this.closed = true;
    this.source?.close();
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.heartbeatTimer);
  }
}
