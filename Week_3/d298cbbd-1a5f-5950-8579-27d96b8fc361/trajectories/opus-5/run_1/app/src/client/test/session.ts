import type { TicketResponse } from '../api.js';
import { api } from '../api.js';
import { state } from '../state.js';
import {
  TypingEngine,
  accuracyFrom,
  kindOfMode,
  replay,
  roundHalfUp,
  type ApplyResult,
  type EngineFigures,
  type LogEntry,
  type TestMode,
} from '../../shared/engine.js';

export interface SessionHooks {
  onSecond(second: number): void;
  onEnd(figures: EngineFigures): void;
}

export interface RunSubmission {
  readonly ticketId: string;
  readonly text: string[];
  readonly log: LogEntry[];
  readonly duration: number;
  readonly speed: number;
  readonly raw: number;
  readonly accuracy: number;
  readonly consistency: number;
  readonly characters: {
    correct: number;
    incorrect: number;
    extra: number;
    missed: number;
  };
}

const RESEND_DELAY_MS = 5000;

/**
 * One test, from its ticket to its verdict. Every timer and request it starts is held here
 * and cancelled together in `dispose`, so a restarted test never touches the next one.
 */
export class TestSession {
  readonly ticket: TicketResponse;
  readonly mode: TestMode;
  readonly lengthMs: number | null;
  readonly engine: TypingEngine;
  readonly log: LogEntry[] = [];
  startTime: number | null = null;
  ended = false;
  disposed = false;
  resultAnnounced = false;
  private readonly hooks: SessionHooks;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private focusWarning: ReturnType<typeof setTimeout> | null = null;

  constructor(ticket: TicketResponse, mode: TestMode, lengthMs: number | null, hooks: SessionHooks) {
    this.ticket = ticket;
    this.mode = mode;
    this.lengthMs = lengthMs;
    this.hooks = hooks;
    this.engine = new TypingEngine(ticket.words, kindOfMode(mode), state.config.maxExtraLetters);
  }

  private timer(delay: number, run: () => void): ReturnType<typeof setTimeout> {
    const handle = setTimeout(() => {
      this.timers.delete(handle);
      if (!this.disposed) run();
    }, Math.max(0, delay));
    this.timers.add(handle);
    return handle;
  }

  dispose(): void {
    this.disposed = true;
    for (const handle of this.timers) clearTimeout(handle);
    this.timers.clear();
  }

  /** Logs and applies a typing key, or ignores it once the time test's length has passed. */
  press(key: string): ApplyResult | null {
    if (this.disposed || this.ended) return null;
    const now = performance.now();
    if (this.startTime === null) {
      this.startTime = now;
      this.scheduleClock();
    } else if (this.lengthMs !== null && now - this.startTime >= this.lengthMs) {
      return null;
    }
    const entry: LogEntry = { k: key, t: Math.round(now - (this.startTime as number)) };
    this.log.push(entry);
    return this.engine.apply(entry);
  }

  private scheduleClock(): void {
    const start = this.startTime as number;
    if (this.lengthMs !== null) {
      this.timer(start + this.lengthMs - performance.now(), () => this.finish());
    }
    const tick = (second: number): void => {
      this.timer(start + second * 1000 - performance.now(), () => {
        if (this.ended) return;
        this.hooks.onSecond(second);
        tick(second + 1);
      });
    };
    tick(1);
  }

  figures(): EngineFigures {
    return replay({
      words: this.ticket.words,
      kind: kindOfMode(this.mode),
      log: this.log,
      maxExtraLetters: state.config.maxExtraLetters,
      timeDurationMs: this.lengthMs,
    }).figures;
  }

  /** The live readouts: the Speed and accuracy of the keystrokes in the whole seconds so far. */
  liveReadout(second: number): { speed: number; accuracy: number } {
    const engine = new TypingEngine(
      this.ticket.words,
      kindOfMode(this.mode),
      state.config.maxExtraLetters,
    );
    for (const entry of this.log) {
      if (entry.t >= second * 1000) break;
      engine.apply(entry);
    }
    const characters = engine.correctWordCharacters('prefix');
    return {
      speed: second === 0 ? 0 : characters / 5 / (second / 60),
      accuracy: accuracyFrom(engine.keystrokes),
    };
  }

  finish(): void {
    if (this.ended || this.disposed) return;
    this.ended = true;
    this.cancelFocusWarning();
    this.hooks.onEnd(this.figures());
  }

  startFocusWarning(show: () => void): void {
    this.cancelFocusWarning();
    this.focusWarning = this.timer(state.config.focusWarningMs, show);
  }

  cancelFocusWarning(): void {
    if (this.focusWarning === null) return;
    clearTimeout(this.focusWarning);
    this.timers.delete(this.focusWarning);
    this.focusWarning = null;
  }

  submissionBody(figures: EngineFigures): RunSubmission {
    return {
      ticketId: this.ticket.ticketId,
      text: this.ticket.words,
      log: this.log,
      duration: roundHalfUp(figures.duration),
      speed: roundHalfUp(figures.speed),
      raw: roundHalfUp(figures.raw),
      accuracy: roundHalfUp(figures.accuracy),
      consistency: roundHalfUp(figures.consistency),
      characters: { ...figures.characters },
    };
  }

  /** Submits the run and keeps resending the identical body until a verdict arrives. */
  submit(body: RunSubmission, onVerdict: (status: number, verdict: unknown) => void): void {
    const attempt = (): void => {
      void api.post<unknown>('/api/runs', body).then((response) => {
        if (this.disposed) return;
        if (response.networkError || response.status >= 500) {
          this.timer(RESEND_DELAY_MS, attempt);
          return;
        }
        onVerdict(response.status, response.body);
      });
    };
    attempt();
  }
}
