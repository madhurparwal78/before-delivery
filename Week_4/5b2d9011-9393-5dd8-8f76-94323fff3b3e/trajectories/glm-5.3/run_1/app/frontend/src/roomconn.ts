// The room connection: the snapshot stream, buffered reports through a
// disconnect, and the input/report/pose/purchase calls.
import { api, type RoomState, type ReportResult, type VehicleState, type PlayerState } from "./api";

export interface ReportBody {
  report_id: string;
  type: "shot" | "reload" | "grenade" | "revive";
  aim?: number;
  target?: { x: number; z: number };
  target_player?: string;
}

export interface RoomConn {
  state: RoomState | null;
  connected: boolean;
  buffered: ReportBody[];
  seq: number;
  close: () => void;
  sendInput: (moveX: number, moveZ: number, aim: number) => void;
  sendReport: (report: ReportBody) => Promise<ReportResult | null>;
  sendPose: (x: number, z: number, heading: number) => Promise<void>;
  purchase: (purchaseId: string, item: string) => Promise<{ ok: boolean; message?: string }>;
  onSnapshot: (state: RoomState) => void;
  onDisconnect: () => void;
  onReconnect: (n: number) => void;
}

export function connectRoom(code: string, opts: {
  onSnapshot: (state: RoomState) => void;
  onDisconnect: () => void;
  onReconnect: (n: number) => void;
}): RoomConn {
  let es: EventSource | null = null;
  let closed = false;
  let buffered: ReportBody[] = [];
  let seq = 0;
  let lastAim = 90;
  let lastMoveX = 0;
  let lastMoveZ = 0;
  let state: RoomState | null = null;
  let connected = true;
  let reportSeq = 0;

  function openStream(): void {
    es = new EventSource(`/api/rooms/${encodeURIComponent(code)}/stream`);
    es.addEventListener("snapshot", (ev) => {
      if (!connected) {
        connected = true;
        void flush();
      }
      try {
        state = JSON.parse((ev as MessageEvent).data) as RoomState;
        opts.onSnapshot(state);
      } catch { /* skip a malformed frame */ }
    });
    es.onerror = () => {
      if (closed) return;
      es?.close();
      es = null;
      connected = false;
      opts.onDisconnect();
      // Retry about every second.
      setTimeout(() => { if (!closed && !connected) openStream(); }, 1000);
    };
  }

  async function flush(): Promise<void> {
    if (buffered.length === 0) return;
    const batch = buffered;
    buffered = [];
    const res = await api.post<{ results: (ReportResult | { error: unknown })[] }>(
      `/rooms/${encodeURIComponent(code)}/reports/batch`, { reports: batch });
    if (res.status === 200 && res.body) {
      opts.onReconnect(batch.length);
    } else {
      // Put them back at the front to retry in order.
      buffered = batch.concat(buffered);
    }
  }

  openStream();

  const conn: RoomConn = {
    get state(): RoomState { return state as RoomState; },
    get connected(): boolean { return connected; },
    get buffered(): ReportBody[] { return buffered; },
    get seq(): number { return seq; },
    close(): void {
      closed = true;
      es?.close();
      void api.post(`/rooms/${encodeURIComponent(code)}/leave`).catch(() => undefined);
    },
    onSnapshot: opts.onSnapshot,
    onDisconnect: opts.onDisconnect,
    onReconnect: opts.onReconnect,
    sendInput(moveX: number, moveZ: number, aim: number): void {
      seq += 1;
      lastAim = aim;
      lastMoveX = moveX;
      lastMoveZ = moveZ;
      void api.post(`/rooms/${encodeURIComponent(code)}/input`, {
        seq, move: { x: moveX, z: moveZ }, aim,
      }).catch(() => undefined);
    },
    async sendReport(report: ReportBody): Promise<ReportResult | null> {
      reportSeq += 1;
      const body = { ...report, report_id: report.report_id || `r${Date.now()}-${reportSeq}` };
      if (!connected) {
        buffered.push(body);
        return null;
      }
      const res = await api.post<ReportResult>(`/rooms/${encodeURIComponent(code)}/reports`, body);
      if (res.status === 0) {
        buffered.push(body);
        return null;
      }
      return res.body ?? null;
    },
    async sendPose(x: number, z: number, heading: number): Promise<void> {
      seq += 1;
      await api.post(`/rooms/${encodeURIComponent(code)}/pose`, { seq, x, z, heading }).catch(() => undefined);
    },
    async purchase(purchaseId: string, item: string): Promise<{ ok: boolean; message?: string }> {
      const res = await api.post(`/rooms/${encodeURIComponent(code)}/purchases`, { purchase_id: purchaseId, item });
      if (res.status === 201) return { ok: true };
      if (res.error) return { ok: false, message: res.error.message };
      return { ok: false, message: "Something went wrong on the server. Try again." };
    },
  };
  return conn;
}

export type { RoomState, ReportResult, VehicleState, PlayerState };
