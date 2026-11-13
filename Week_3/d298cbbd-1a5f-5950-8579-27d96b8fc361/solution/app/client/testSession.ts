/** One typing test in the browser: its ticket request, keystroke log, timers and the submission of its run. Everything a test starts is cancelled in `Attempt.cancel`. */

import { TypingEngine, readoutAt, replayLog } from "../shared/engine";
import { rulesFor } from "../shared/engine";
import type { EngineRules, LogEntry, RunScore } from "../shared/engine";
import { REFUSAL_REASONS, resultLine, twoDecimals } from "../shared/format";
import { fromHundredths, numberHundredths, ratioHundredths, wholeHalfUp } from "../shared/numbers";
import type { ClientConfig, RunBody, Ticket, TicketRequest } from "../shared/protocol";
import { exchange } from "./api";
import { Store } from "./store";
import { viewer } from "./viewer";

const RESEND_MS = 5000;
const SECOND_MS = 1000;

type Phase = "loading" | "ready" | "running" | "finished" | "failed" | "abandoned";

export type Seal =
  | { readonly kind: "held" }
  | { readonly kind: "counted"; readonly personalBest: boolean }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "guest" }
  | { readonly kind: "unverified" };

interface FinishedTest {
  readonly words: readonly string[];
  readonly log: readonly LogEntry[];
  readonly rules: EngineRules;
  readonly score: RunScore;
  readonly seal: Seal;
  readonly proofKey: string | null;
}

export type FocusAfter = "input" | "none";

/** Everything one ticket's test owns. Cancelling it stops every timer; a response that arrives later is discarded by the identity check. */
class Attempt {
  readonly engine: TypingEngine;
  startedAt = 0;
  blurred = false;
  seconds = 0;
  liveSpeed = "0";
  liveAccuracy = "100%";
  finished: FinishedTest | null = null;
  private endTimer: number | null = null;
  private tickTimer: number | null = null;
  private blurTimer: number | null = null;
  private resendTimer: number | null = null;
  cancelled = false;

  constructor(
    readonly ticket: Ticket,
    readonly request: TicketRequest,
    readonly rules: EngineRules,
    readonly focusAfter: FocusAfter,
  ) {
    this.engine = new TypingEngine(ticket.words, rules);
  }

  get timeLimitMs(): number | null {
    return this.rules.timeLimitMs;
  }

  at(slot: "endTimer" | "tickTimer" | "blurTimer" | "resendTimer", delay: number, work: () => void): void {
    this.clear(slot);
    if (!this.cancelled) this[slot] = window.setTimeout(work, delay);
  }

  clear(slot: "endTimer" | "tickTimer" | "blurTimer" | "resendTimer"): void {
    const timer = this[slot];
    if (timer !== null) window.clearTimeout(timer);
    this[slot] = null;
  }

  /** The one place a test's timers are stopped. */
  cancel(): void {
    this.cancelled = true;
    for (const slot of ["endTimer", "tickTimer", "blurTimer", "resendTimer"] as const) this.clear(slot);
  }
}

export class TestSession {
  /** Bumped whenever anything the page shows changes. */
  readonly changes = new Store<number>(0);
  phase: Phase = "loading";
  attempt: Attempt | null = null;
  resultAnnouncement = "";
  private requestSeq = 0;

  constructor(private readonly config: ClientConfig) {}

  private notify(): void {
    this.changes.set(this.changes.get() + 1);
  }

  /** Asks for a new ticket. Only the latest request may ever change the sheet. */
  request(request: TicketRequest, focusAfter: FocusAfter): void {
    const id = ++this.requestSeq;
    this.attempt?.cancel();
    this.attempt = null;
    this.resultAnnouncement = "";
    this.phase = "loading";
    this.notify();
    exchange("POST", "/api/tickets", request).then(
      (answer) => {
        if (id !== this.requestSeq) return;
        if (answer.status !== 201) return this.fail();
        const rules = rulesFor(request.mode, request.length, this.config.maxExtraLetters);
        this.attempt = new Attempt(answer.body as unknown as Ticket, request, rules, focusAfter);
        this.phase = "ready";
        this.notify();
      },
      () => {
        if (id === this.requestSeq) this.fail();
      },
    );
  }

  private fail(): void {
    this.phase = "failed";
    this.notify();
  }

  /** Stops the current test without submitting it; a new ticket is expected next. */
  abandon(): void {
    this.attempt?.cancel();
    this.attempt = null;
    this.phase = "abandoned";
    this.notify();
  }

  dispose(): void {
    this.requestSeq += 1;
    this.attempt?.cancel();
  }

  /** The typing input lost focus. */
  inputBlurred(): void {
    const attempt = this.attempt;
    if (!attempt || (this.phase !== "ready" && this.phase !== "running")) return;
    attempt.at("blurTimer", this.config.focusWarningMs, () => {
      attempt.blurred = true;
      this.notify();
    });
  }

  inputFocused(): void {
    const attempt = this.attempt;
    if (!attempt) return;
    attempt.clear("blurTimer");
    if (attempt.blurred) {
      attempt.blurred = false;
      this.notify();
    }
  }

  /** One logged key: the first one of a test starts its clock. */
  type(key: string): void {
    const attempt = this.attempt;
    if (!attempt || (this.phase !== "ready" && this.phase !== "running")) return;
    if (this.phase === "ready") this.begin(attempt);
    const t = Math.round(performance.now() - attempt.startedAt);
    if (!attempt.engine.apply({ k: key, t })) return this.finish(attempt);
    if (attempt.engine.ended) this.finish(attempt);
    else this.notify();
  }

  private begin(attempt: Attempt): void {
    attempt.startedAt = performance.now();
    this.phase = "running";
    if (attempt.timeLimitMs !== null) attempt.at("endTimer", attempt.timeLimitMs, () => this.finish(attempt));
    this.scheduleTick(attempt, 1);
  }

  private scheduleTick(attempt: Attempt, second: number): void {
    attempt.at("tickTimer", Math.max(0, attempt.startedAt + second * SECOND_MS - performance.now()), () => {
      this.tick(attempt, second);
      this.scheduleTick(attempt, second + 1);
    });
  }

  /** The readouts at a whole second count only the keystrokes typed before it. */
  private tick(attempt: Attempt, second: number): void {
    const readout = readoutAt(attempt.ticket.words, attempt.engine.log, attempt.rules, second);
    attempt.seconds = second;
    attempt.liveSpeed = String(wholeHalfUp(readout.speed));
    attempt.liveAccuracy = `${wholeHalfUp(readout.accuracy)}%`;
    this.notify();
  }

  private finish(attempt: Attempt): void {
    for (const slot of ["endTimer", "tickTimer", "blurTimer"] as const) attempt.clear(slot);
    attempt.blurred = false;
    const { score } = replayLog(attempt.ticket.words, attempt.engine.log, attempt.rules);
    if (score === null) return;
    const me = viewer.state.get().me;
    const seal: Seal = me === null ? { kind: "guest" } : me.verified ? { kind: "held" } : { kind: "unverified" };
    attempt.finished = { words: attempt.ticket.words, log: attempt.engine.log, rules: attempt.rules, score, seal, proofKey: null };
    this.phase = "finished";
    this.resultAnnouncement = resultLine(
      twoDecimals(fromHundredths(ratioHundredths(score.speed))),
      twoDecimals(fromHundredths(ratioHundredths(score.accuracy))),
      twoDecimals(fromHundredths(ratioHundredths(score.raw))),
      twoDecimals(fromHundredths(numberHundredths(score.consistency))),
    );
    this.notify();
    if (seal.kind === "held") void this.submit(attempt, JSON.stringify(runBody(attempt.ticket.words, score, attempt.engine.log, attempt.ticket.ticketId)));
  }

  /** Sends the run; after a network failure or a 5xx answer the identical body goes again, until the first verdict. */
  private async submit(attempt: Attempt, body: string): Promise<void> {
    const retry = (): void => attempt.at("resendTimer", RESEND_MS, () => void this.submit(attempt, body));
    let answer;
    try {
      answer = await exchange("POST", "/api/runs", body);
    } catch {
      return retry();
    }
    if (answer.status >= 500) return retry();
    if (attempt.cancelled || !attempt.finished) return;
    const code = String(answer.body.error ?? "");
    const proofKey = typeof answer.body.proofKey === "string" ? answer.body.proofKey : null;
    let seal: Seal;
    if (answer.status === 201) seal = { kind: "counted", personalBest: answer.body.personalBest === true };
    else if (answer.status === 401) seal = { kind: "guest" };
    else if (code === "email_unverified") seal = { kind: "unverified" };
    else seal = { kind: "refused", reason: REFUSAL_REASONS[code] ?? "something went wrong." };
    attempt.finished = { ...attempt.finished, seal, proofKey };
    this.notify();
  }
}

/** The body of a run: a ticket's, or without `ticketId` a race finish. */
export function runBody(words: readonly string[], score: RunScore, log: readonly LogEntry[], ticketId?: string): RunBody {
  return {
    ...(ticketId === undefined ? {} : { ticketId }),
    text: [...words],
    log: [...log],
    duration: score.duration,
    speed: fromHundredths(ratioHundredths(score.speed)),
    raw: fromHundredths(ratioHundredths(score.raw)),
    accuracy: fromHundredths(ratioHundredths(score.accuracy)),
    consistency: fromHundredths(numberHundredths(score.consistency)),
    characters: score.characters,
  };
}
