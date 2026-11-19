// The session hub: the one authority for session state transitions, spectrum feeding,
// quota enforcement and event fan-out.

import type { Db } from './db';
import { billableSeconds, type PlanId } from '../src-shared/billing';
import { createSpectrumComputer, rowPeakBin, FRAME_ROWS_PER_SECOND, SAMPLE_RATE } from '../src-shared/spectrum';
import type { CloseReason, Quota, Segment, SessionState } from '../src-shared/protocol';
import type { SidecarCue } from '../src-shared/vtt';
import { randomUUID } from 'node:crypto';

export type HubClock = () => Date;

type LiveSession = {
  id: string;
  projectId: string;
  orgId: string;
  state: SessionState;
  channels: number;
  plan: PlanId;
  audioMs: number;
  frame: number;
  samples: Float32Array; // interleaved, most recent 2048×channels
  sampleCount: number; // frames per channel seen in window
  sampleMod: number;
  cues: SidecarCue[];
  finalSegments: Segment[];
  liveAt: number | null; // epoch ms
  lastAudioAt: number | null;
  subscribers: Set<(ev: HubEvent) => void>;
  quotaTimer: NodeJS.Timeout | null;
  idleTimer: NodeJS.Timeout | null;
  capTimer: NodeJS.Timeout | null;
  feeder: ReplayFeeder | null;
  captureChunks: Buffer[];
  closeReason: CloseReason;
  label: string;
  kind: 'live' | 'replay';
  keyId: string;
};

export type HubEvent =
  | { type: 'state'; state: SessionState; close_reason: CloseReason }
  | { type: 'frame'; frame: number; audio_ms: number; peak_bin: number; bins: number[] }
  | { type: 'segment'; segment: Segment }
  | { type: 'correction'; segment: Segment; wer: number }
  | { type: 'quota'; quota: Quota };

export type ReplayFeeder = {
  stop(): void;
};

const spectrum = createSpectrumComputer();

export class SessionHub {
  private sessions = new Map<string, LiveSession>();
  /** Single interval that halts exhausted projects and pulses quota events. */
  private quotaPulse: NodeJS.Timeout | null = null;

  constructor(
    private db: Db,
    private clock: HubClock,
    private idleSeconds: number,
    private capSeconds: number,
  ) {
    this.quotaPulse = setInterval(() => void this.enforceQuotas(), 500);
  }

  /** Starts the hub's timers; called once at boot. */
  static start(db: Db, clock: HubClock, idleSeconds: number, capSeconds: number): SessionHub {
    return new SessionHub(db, clock, idleSeconds, capSeconds);
  }

  async shutdown(): Promise<void> {
    if (this.quotaPulse) clearInterval(this.quotaPulse);
  }

  // ---------- session lifecycle ----------

  /** A newly created session in connecting. Storage upload completes in attachCapture/live transition. */
  register(session: {
    id: string;
    projectId: string;
    orgId: string;
    kind: 'live' | 'replay';
    label: string;
    channels: number;
    plan: PlanId;
    keyId: string;
    cues: SidecarCue[];
  }): void {
    const s: LiveSession = {
      ...session,
      state: 'connecting',
      audioMs: 0,
      frame: 0,
      samples: new Float32Array(2048 * session.channels),
      sampleCount: 0,
      sampleMod: 0,
      finalSegments: [],
      liveAt: null,
      lastAudioAt: null,
      subscribers: new Set(),
      quotaTimer: null,
      idleTimer: null,
      capTimer: null,
      feeder: null,
      captureChunks: [],
      closeReason: null,
    };
    this.sessions.set(session.id, s);
  }

  /** Transitions to live once the capture/upload object exists in storage (server-decided, DP-18). */
  async markLive(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s || s.state !== 'connecting') return;
    s.state = 'live';
    s.liveAt = this.clock().getTime();
    await this.db.query(`UPDATE sessions SET state='live', live_at=now() WHERE id=$1`, [id]);
    this.armTimers(s);
    this.emit(s, { type: 'state', state: 'live', close_reason: null });
  }

  private armTimers(s: LiveSession): void {
    this.disarmTimers(s);
    s.idleTimer = setInterval(() => {
      if (s.kind === 'live' && s.state === 'live' && s.lastAudioAt !== null) {
        const idleMs = this.clock().getTime() - s.lastAudioAt;
        if (idleMs >= this.idleSeconds * 1000) void this.finish(s.id, 'idle_closed', null);
      }
    }, 1000);
    s.capTimer = setInterval(() => {
      if (s.state !== 'live') return;
      const now = this.clock().getTime();
      const wall = s.liveAt ? now - s.liveAt : 0;
      const audio = s.audioMs;
      if (wall >= this.capSeconds * 1000 || audio >= this.capSeconds * 1000) {
        void this.finish(s.id, 'closed', 'cap');
      }
    }, 1000);
  }

  private disarmTimers(s: LiveSession): void {
    if (s.idleTimer) { clearInterval(s.idleTimer); s.idleTimer = null; }
    if (s.capTimer) { clearInterval(s.capTimer); s.capTimer = null; }
  }

  isTracked(id: string): boolean {
    return this.sessions.has(id);
  }

  subscribe(id: string, fn: (ev: HubEvent) => void): (() => void) | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    s.subscribers.add(fn);
    return () => s.subscribers.delete(fn);
  }

  emit(s: LiveSession, ev: HubEvent): void {
    for (const fn of s.subscribers) {
      try { fn(ev); } catch { /* subscriber errors never break the hub */ }
    }
  }

  /** Ends a session. Only the server calls this (DP-18). */
  async finish(id: string, state: SessionState, reason: CloseReason, override = false): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    if (s.state === 'closed' || s.state === 'idle_closed' || s.state === 'quota_halted' || s.state === 'revoked') {
      if (!override) return;
    }
    if (s.state === 'connecting' && state === 'idle_closed') return; // never live, nothing to idle-close
    s.feeder?.stop();
    this.disarmTimers(s);
    s.state = state;
    s.closeReason = reason;
    const now = this.clock().toISOString();
    const secs = billableSeconds(s.plan, s.audioMs, s.channels);
    const billingState = secs === 0 ? 'not_billable' : 'pending';
    await this.db.query(
      `UPDATE sessions SET state=$2, close_reason=$3, ended_at=now(), audio_ms=$4, frame=$5, billable_seconds=$6, billing_state=$7 WHERE id=$1`,
      [id, state, reason, Math.floor(s.audioMs), s.frame, secs, billingState],
    );
    this.emit(s, { type: 'state', state, close_reason: reason });
    this.sessions.delete(id);
  }

  // ---------- audio feeding ----------

  /** Feeds raw interleaved PCM into a live session. Protocol errors are the caller's concern. */
  feedLive(id: string, pcm: Buffer): 'ok' | 'ended' | 'unknown' {
    const s = this.sessions.get(id);
    if (!s) return 'unknown';
    if (s.state !== 'live' && s.state !== 'connecting') return 'ended';
    s.captureChunks.push(pcm);
    this.ingest(id, pcm, 'asap');
    s.lastAudioAt = this.clock().getTime();
    return 'ok';
  }

  private ingest(id: string, pcm: Buffer, pace: 'asap' | 'realtime'): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const dv = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const frames = Math.floor(pcm.length / (2 * s.channels));
    for (let f = 0; f < frames; f++) {
      let mono = 0;
      for (let c = 0; c < s.channels; c++) mono += dv.getInt16((f * s.channels + c) * 2, true) / 32768;
      mono /= s.channels;
      const idx = s.sampleCount % (2048 * s.channels);
      s.samples[idx] = mono;
      s.sampleCount++;
      s.audioMs = Math.floor((s.sampleCount * 1000) / SAMPLE_RATE);
      s.sampleMod++;
      if (s.sampleMod >= Math.floor(SAMPLE_RATE / FRAME_ROWS_PER_SECOND)) {
        s.sampleMod = 0;
        this.pushRow(s);
      }
    }
    this.finaliseSegments(s);
  }

  private pushRow(s: LiveSession): void {
    // Build a contiguous window of the most recent samples (zero-padded before the start).
    const window = new Float32Array(2048);
    const have = Math.min(s.sampleCount, 2048);
    for (let i = 0; i < have; i++) {
      // samples stored in a ring the size of 2048×channels; read back in order
      const end = s.sampleCount % (2048 * s.channels);
      const pos = (end - have + i + 2048 * s.channels) % (2048 * s.channels);
      window[i] = s.samples[pos];
    }
    const row = spectrum.row(window, have);
    const peak = rowPeakBin(row);
    const frame = s.frame++;
    // Store the row asynchronously; the frame event carries it.
    void this.db.query(
      `INSERT INTO spectrum_rows (session_id, frame, bins, peak_bin) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [s.id, frame, JSON.stringify(row), peak],
    );
    this.emit(s, { type: 'frame', frame, audio_ms: s.audioMs, peak_bin: peak, bins: row });
  }

  private finaliseSegments(s: LiveSession): void {
    for (const cue of s.cues) {
      if (s.finalSegments.some((seg) => seg.start_ms === cue.start_ms)) continue;
      if (s.audioMs >= cue.end_ms) {
        const seg = this.buildSegment(s, cue, s.finalSegments.length);
        s.finalSegments.push(seg);
        void this.persistSegment(s.id, seg);
        this.emit(s, { type: 'segment', segment: seg });
      }
    }
  }

  private buildSegment(s: LiveSession, cue: SidecarCue, index: number): Segment {
    const flagged = cue.words.some((w) => w.confidence < 0.85);
    const text = cue.words.map((w) => w.text).join(' ');
    const words = cue.words.map((w) => ({ text: w.text, confidence: w.confidence, start_ms: w.start_ms, end_ms: w.end_ms }));
    return {
      id: randomUUID(),
      index,
      start_ms: cue.start_ms,
      end_ms: cue.end_ms,
      flagged,
      machine: { text, words },
      reviewed: { text, words, source: 'machine', correction_id: null },
      open_correction: null,
    };
  }

  private async persistSegment(sessionId: string, seg: Segment): Promise<void> {
    await this.db.query(
      `INSERT INTO segments (id, session_id, index_in_session, start_ms, end_ms, machine_words)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (session_id, index_in_session) DO NOTHING`,
      [seg.id, sessionId, seg.index, seg.start_ms, seg.end_ms, JSON.stringify(seg.machine.words)],
    );
    await this.db.query(
      `UPDATE sessions SET flagged_segments = (SELECT count(*) FROM segments WHERE session_id=$1 AND jsonb_array_length(machine_words) > 0 AND EXISTS (SELECT 1 FROM jsonb_array_elements(machine_words) w WHERE (w->>'confidence')::numeric < 0.85)) WHERE id=$1`,
      [sessionId],
    );
  }

  /** Replay/tone: feeds stored audio at real time, ends at end_of_audio. */
  startReplay(id: string, wavSamples: Float32Array, channels: number): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const chunkFrames = Math.floor(SAMPLE_RATE / FRAME_ROWS_PER_SECOND); // ~533 samples
    const bytesPerFrame = 2 * channels;
    let pos = 0;
    const timer = setInterval(() => {
      if (s.state !== 'live') { clearInterval(timer); return; }
      const take = Math.min(chunkFrames, Math.floor(wavSamples.length / channels) - pos);
      if (take <= 0) {
        clearInterval(timer);
        void this.finish(id, 'closed', 'end_of_audio');
        return;
      }
      const pcm = Buffer.alloc(take * bytesPerFrame);
      const dv = new DataView(pcm.buffer);
      for (let i = 0; i < take; i++) {
        for (let c = 0; c < channels; c++) {
          const v = Math.max(-1, Math.min(1, wavSamples[(pos + i) * channels + c]));
          dv.setInt16((i * channels + c) * 2, Math.round(v * 32767), true);
        }
      }
      pos += take;
      this.ingest(id, pcm, 'realtime');
    }, Math.floor(1000 / FRAME_ROWS_PER_SECOND));
    s.feeder = { stop: () => clearInterval(timer) };
  }

  captureChunks(id: string): Buffer[] {
    return this.sessions.get(id)?.captureChunks ?? [];
  }

  /** Attaches a sidecar that arrived over the live socket after the session went live. */
  applySidecar(id: string, cues: SidecarCue[]): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.cues = cues;
    this.finaliseSegments(s);
  }

  liveChannels(id: string): number | null {
    const s = this.sessions.get(id);
    return s ? s.channels : null;
  }

  // ---------- quota ----------

  /** Derived from stored sessions on every read (DP-34). */
  async quotaFor(projectId: string, limitMinutes: number): Promise<Quota> {
    const now = this.clock();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const { rows } = await this.db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN ended_at IS NOT NULL AND ended_at >= $2 AND billable_seconds IS NOT NULL THEN billable_seconds ELSE 0 END), 0)
         + COALESCE(SUM(CASE WHEN ended_at IS NULL THEN floor(audio_ms * channels / 1000.0) ELSE 0 END), 0) AS used
       FROM sessions WHERE project_id = $1`,
      [projectId, periodStart.toISOString()],
    );
    const used = Math.floor(Number(rows[0].used ?? 0));
    return {
      limit_minutes: limitMinutes,
      used_seconds: used,
      period_start: periodStart.toISOString().replace('.000Z', 'Z').replace(/(\.\d{3})Z$/, 'Z'),
      resets_at: resetsAt.toISOString().replace('.000Z', 'Z').replace(/(\.\d{3})Z$/, 'Z'),
      exhausted: used >= limitMinutes * 60,
      server_time: now.toISOString().replace(/(\.\d{3})Z$/, 'Z'),
    };
  }

  /** Halts every open session on exhausted projects within 1s; also runs on quota saves. */
  async enforceQuotas(): Promise<void> {
    const open = [...this.sessions.values()].filter((s) => s.state === 'live' || s.state === 'connecting');
    if (open.length === 0) return;
    const byProject = new Map<string, LiveSession[]>();
    for (const s of open) {
      const list = byProject.get(s.projectId) ?? [];
      list.push(s);
      byProject.set(s.projectId, list);
    }
    for (const [projectId, list] of byProject) {
      const { rows } = await this.db.query(`SELECT monthly_quota_minutes FROM projects WHERE id=$1`, [projectId]);
      if (rows.length === 0) continue;
      const quota = await this.quotaFor(projectId, rows[0].monthly_quota_minutes);
      if (quota.exhausted) {
        for (const s of list) {
          await this.finish(s.id, 'quota_halted', null);
        }
      }
      // While live, keep every subscriber's quota object fresh (at least every 2s).
      for (const s of list) {
        if (s.state === 'live') this.emit(s, { type: 'quota', quota });
      }
    }
  }

  /** Ends every live session started on a revoked key (DP-14). */
  async revokeKey(keyId: string): Promise<string[]> {
    const closed: string[] = [];
    for (const s of [...this.sessions.values()]) {
      if (s.keyId === keyId && (s.state === 'live' || s.state === 'connecting')) {
        closed.push(s.id);
        await this.finish(s.id, 'revoked', null);
      }
    }
    return closed;
  }

  sessionsOnProject(projectId: string): string[] {
    return [...this.sessions.values()].filter((s) => s.projectId === projectId && (s.state === 'live' || s.state === 'connecting')).map((s) => s.id);
  }

  /** Broadcasts a correction event to every open view of a session (server-driven retint, DP-43). */
  broadcastCorrection(sessionId: string, segment: Segment, wer: number): void {
    const s = this.sessions.get(sessionId);
    if (s) this.emit(s, { type: 'correction', segment, wer });
  }

  /** Emits an event for an ended session too (its SSE subscribers are still attached until the final state). */
  emitFor(sessionId: string, ev: HubEvent): void {
    const s = this.sessions.get(sessionId);
    if (s) this.emit(s, ev);
  }

  stopAllForTests(): void {
    for (const s of [...this.sessions.values()]) void this.finish(s.id, 'closed', 'client');
  }
}
