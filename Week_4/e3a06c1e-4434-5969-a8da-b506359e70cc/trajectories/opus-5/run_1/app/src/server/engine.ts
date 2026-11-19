import { config } from './config.js';
import { query } from './db/pool.js';
import { averageChannels, audioMsFromSamples, readWav } from './domain/audio.js';
import { buildQuota, currentPeriod } from './domain/quota.js';
import { ROWS_PER_SECOND, SAMPLE_RATE, SpectrumStream } from './domain/spectrum.js';
import type { SidecarCue } from './domain/sidecar.js';
import { publish } from './events.js';
import { createSegment, loadSegmentViews, recomputeWer } from './review.js';
import { getObject, putObject, sessionKeys } from './services/storage.js';
import { loadProject, loadSession, projectUsage, type SessionRow } from './store.js';
import { billableSeconds } from '../shared/billing.js';
import type { CloseReason, Plan, SessionSource, SessionState } from '../shared/types.js';

const FLUSH_MS = Math.round(1000 / ROWS_PER_SECOND);
const PERSIST_MS = 500;
const QUOTA_MS = 2000;
const HALT_TICK_MS = 400;

export type EndState = Extract<SessionState, 'closed' | 'idle_closed' | 'quota_halted' | 'revoked'>;

export interface RunnerOptions {
  readonly sessionId: string;
  readonly projectId: string;
  readonly orgId: string;
  readonly channels: number;
  readonly plan: Plan;
  readonly source: SessionSource;
  readonly keyId: string | null;
}

/** Carries one open session's audio through the recognizer and the server's state machine. */
class Runner {
  readonly options: RunnerOptions;
  private readonly chunks: Buffer[] = [];
  private readonly spectrum = new SpectrumStream();
  private cues: readonly SidecarCue[] = [];
  private nextCue = 0;
  private published = -1;
  private liveAt: number | null = null;
  private lastAudioAt = Date.now();
  private lastPersist = 0;
  private lastQuota = 0;
  private ticker: NodeJS.Timeout | null = null;
  private finishing = false;
  private feeder: (() => void) | null = null;

  constructor(options: RunnerOptions) {
    this.options = options;
  }

  setCues(cues: readonly SidecarCue[]): void {
    this.cues = cues;
  }

  setFeederStop(stop: () => void): void {
    this.feeder = stop;
  }

  get audioMs(): number {
    return audioMsFromSamples(this.spectrum.sampleCount);
  }

  snapshot(): { frame: number; peak: number; rows: number[][]; mean: number[] } {
    return {
      frame: this.spectrum.frame,
      peak: this.spectrum.peak,
      rows: this.spectrum.rows,
      mean: this.spectrum.mean,
    };
  }

  async goLive(): Promise<void> {
    this.liveAt = Date.now();
    this.lastAudioAt = Date.now();
    await query("update sessions set state = 'live', live_at = now() where id = $1 and state = 'connecting'", [
      this.options.sessionId,
    ]);
    this.emitState('live', null);
    this.ticker = setInterval(() => {
      void this.tick();
    }, FLUSH_MS);
  }

  private emitState(state: SessionState, reason: CloseReason | null): void {
    publish(this.options.sessionId, { type: 'state', state, close_reason: reason });
  }

  /** Audio arrives as interleaved 16-bit PCM and advances the spectrum row by row. */
  ingest(pcm: Buffer, retain: boolean): void {
    if (this.finishing) return;
    if (retain) this.chunks.push(Buffer.from(pcm));
    this.lastAudioAt = Date.now();
    this.spectrum.push(averageChannels(pcm, this.options.channels));
  }

  /** A segment becomes final when the received audio passes its end time. */
  private async finaliseSegments(atClose: boolean): Promise<void> {
    const audioMs = this.audioMs;
    while (this.nextCue < this.cues.length) {
      const cue = this.cues[this.nextCue] as SidecarCue;
      const ready = atClose ? cue.startMs < audioMs : audioMs >= cue.endMs;
      if (!ready) break;
      const index = this.nextCue;
      this.nextCue += 1;
      const segment = await createSegment(this.options.sessionId, cue, index);
      publish(this.options.sessionId, { type: 'segment', segment });
    }
  }

  private async persist(): Promise<void> {
    await query(
      `update sessions set audio_ms = $2, received_samples = $3, frame = $4, peak_bin = $5,
         spectrum_rows = $6::jsonb, spectrum_sum = $7::jsonb, spectrum_count = $8
       where id = $1`,
      [
        this.options.sessionId,
        this.audioMs,
        this.spectrum.sampleCount,
        this.spectrum.frame,
        this.spectrum.peak,
        JSON.stringify(this.spectrum.rows),
        JSON.stringify(this.spectrum.sumVector),
        this.spectrum.count,
      ],
    );
  }

  private async emitQuota(): Promise<void> {
    const project = await loadProject(this.options.projectId);
    if (project === null) return;
    const now = new Date();
    const usage = await projectUsage([this.options.projectId], now);
    const usedSeconds = usage.get(this.options.projectId)?.usedSeconds ?? 0;
    const quota = buildQuota(project.monthly_quota_minutes, usedSeconds, currentPeriod(now), now);
    publish(this.options.sessionId, { type: 'quota', quota });
  }

  private async tick(): Promise<void> {
    if (this.finishing) return;
    const now = Date.now();
    const latest = this.spectrum.latestRow;
    if (latest !== null && latest.frame !== this.published) {
      this.published = latest.frame;
      publish(this.options.sessionId, {
        type: 'frame',
        frame: latest.frame,
        audio_ms: this.audioMs,
        peak_bin: latest.peak,
        bins: latest.bins,
      });
    }
    await this.finaliseSegments(false);
    if (now - this.lastPersist >= PERSIST_MS) {
      this.lastPersist = now;
      await this.persist();
    }
    if (now - this.lastQuota >= QUOTA_MS) {
      this.lastQuota = now;
      await this.emitQuota();
    }
    if (this.audioMs >= config.sessionCapSeconds * 1000) {
      await this.finish('closed', 'cap');
      return;
    }
    if (this.liveAt !== null && now - this.liveAt >= config.sessionCapSeconds * 1000) {
      await this.finish('closed', 'cap');
      return;
    }
    if (now - this.lastAudioAt >= config.idleSeconds * 1000) await this.finish('idle_closed', null);
  }

  /** Only the server moves a session between states. */
  async finish(state: EndState, reason: CloseReason | null): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
    if (this.feeder !== null) this.feeder();
    runners.delete(this.options.sessionId);

    await this.finaliseSegments(true);
    const audioMs = this.audioMs;
    const seconds = billableSeconds(this.options.plan, audioMs, this.options.channels);
    await query(
      `update sessions set state = $2, close_reason = $3, ended_at = now(), audio_ms = $4,
         received_samples = $5, frame = $6, peak_bin = $7, spectrum_rows = $8::jsonb,
         spectrum_sum = $9::jsonb, spectrum_count = $10, billable_seconds = $11, billing_state = $12
       where id = $1 and state in ('connecting','live')`,
      [
        this.options.sessionId,
        state,
        reason,
        audioMs,
        this.spectrum.sampleCount,
        this.spectrum.frame,
        this.spectrum.peak,
        JSON.stringify(this.spectrum.rows),
        JSON.stringify(this.spectrum.sumVector),
        this.spectrum.count,
        seconds,
        seconds > 0 ? 'pending' : 'not_billable',
      ],
    );
    if (this.options.source === 'live') {
      const keys = sessionKeys(this.options.orgId, this.options.projectId, this.options.sessionId);
      await putObject(keys.capture, Buffer.concat(this.chunks)).catch(() => undefined);
    }
    await recomputeWer(this.options.sessionId);
    await writeMachineTranscript(this.options.sessionId).catch(() => undefined);
    this.emitState(state, reason);
    void settleBilling(this.options.sessionId);
  }
}

const runners = new Map<string, Runner>();

export const runnerFor = (sessionId: string): Runner | undefined => runners.get(sessionId);

export const createRunner = (options: RunnerOptions): Runner => {
  const runner = new Runner(options);
  runners.set(options.sessionId, runner);
  return runner;
};

/** The machine transcript artifact is written once, at close, and never rewritten. */
export const writeMachineTranscript = async (sessionId: string): Promise<void> => {
  const session = await loadSession(sessionId);
  if (session === null || session.transcript_written) return;
  const segments = await loadSegmentViews(sessionId);
  const artifact = {
    session_id: sessionId,
    segments: segments.map((segment) => ({
      index: segment.index,
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      words: segment.machine.words,
    })),
  };
  const keys = sessionKeys(session.org_id, session.project_id, sessionId);
  await putObject(keys.transcript, Buffer.from(JSON.stringify(artifact), 'utf8'));
  await query('update sessions set transcript_written = true where id = $1', [sessionId]);
};

let settleUsage: (sessionId: string) => Promise<void> = async () => undefined;

export const onSettleBilling = (handler: (sessionId: string) => Promise<void>): void => {
  settleUsage = handler;
};

const settleBilling = async (sessionId: string): Promise<void> => {
  await settleUsage(sessionId).catch(() => undefined);
};

export const closeOpenSession = async (
  sessionId: string,
  state: EndState,
  reason: CloseReason | null,
): Promise<boolean> => {
  const runner = runners.get(sessionId);
  if (runner === undefined) return false;
  await runner.finish(state, reason);
  return true;
};

/** Revoking a key ends every open session started on it as `revoked`. */
export const revokeKeySessions = async (keyId: string): Promise<string[]> => {
  const rows = await query<{ id: string }>(
    "select id from sessions where key_id = $1 and state in ('connecting','live')",
    [keyId],
  );
  const closed: string[] = [];
  for (const row of rows) if (await closeOpenSession(row.id, 'revoked', null)) closed.push(row.id);
  return closed;
};

/** As soon as a project is exhausted, every open session on it ends as `quota_halted`. */
export const haltExhaustedProject = async (projectId: string): Promise<void> => {
  const project = await loadProject(projectId);
  if (project === null) return;
  const now = new Date();
  const usage = await projectUsage([projectId], now);
  const usedSeconds = usage.get(projectId)?.usedSeconds ?? 0;
  if (usedSeconds < project.monthly_quota_minutes * 60) return;
  const open = await query<{ id: string }>(
    "select id from sessions where project_id = $1 and state in ('connecting','live')",
    [projectId],
  );
  for (const row of open) await closeOpenSession(row.id, 'quota_halted', null);
};

let haltTicker: NodeJS.Timeout | null = null;

export const startQuotaWatch = (): void => {
  if (haltTicker !== null) return;
  haltTicker = setInterval(() => {
    void (async () => {
      const projectIds = new Set<string>();
      for (const runner of runners.values()) projectIds.add(runner.options.projectId);
      for (const projectId of projectIds) await haltExhaustedProject(projectId).catch(() => undefined);
    })();
  }, HALT_TICK_MS);
};

/** Replay and tone sessions are fed through the recognizer at real time. */
export const startReplay = async (session: SessionRow, cues: readonly SidecarCue[]): Promise<void> => {
  const keys = sessionKeys(session.org_id, session.project_id, session.id);
  const wav = await getObject(keys.upload);
  const info = readWav(wav);
  if (info === null) throw new Error('stored upload is not a readable WAV');
  const pcm = wav.subarray(info.dataOffset, info.dataOffset + info.dataBytes);
  const runner = runners.get(session.id);
  if (runner === undefined) return;
  runner.setCues(cues);
  await runner.goLive();

  const frameBytes = 2 * info.channels;
  const totalFrames = Math.floor(pcm.length / frameBytes);
  const startedAt = Date.now();
  let fed = 0;
  const timer = setInterval(() => {
    void (async () => {
      const due = Math.min(totalFrames, Math.floor(((Date.now() - startedAt) / 1000) * SAMPLE_RATE));
      if (due > fed) {
        runner.ingest(pcm.subarray(fed * frameBytes, due * frameBytes), false);
        fed = due;
      }
      if (fed >= totalFrames) {
        clearInterval(timer);
        await runner.finish('closed', 'end_of_audio');
      }
    })();
  }, 50);
  runner.setFeederStop(() => clearInterval(timer));
};

/** Feeds a whole recording through the recognizer at once, for sessions seeded as already closed. */
export const replayAtOnce = async (
  options: RunnerOptions,
  pcm: Buffer,
  cues: readonly SidecarCue[],
): Promise<void> => {
  const runner = createRunner(options);
  runner.setCues(cues);
  await query("update sessions set state = 'live', live_at = now() where id = $1", [options.sessionId]);
  runner.ingest(pcm, false);
  await runner.finish('closed', 'end_of_audio');
};
