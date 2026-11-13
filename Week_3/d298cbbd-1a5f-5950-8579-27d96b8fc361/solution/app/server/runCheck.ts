/** The 422 run checks, in published order, for a ticketed test and for a race finish. */

import { isLoggableKey, replayLog } from "../shared/engine";
import type { LogEntry, RunScore } from "../shared/engine";
import { numberHundredths, ratioHundredths } from "../shared/numbers";
import type { RefusalCode } from "../shared/protocol";
import { FAST_GAP_SHARE, config } from "./config";
import { isRecord } from "./http";

export type RunKind =
  | { readonly kind: "timed"; readonly lengthMs: number }
  | { readonly kind: "untimed" }
  | { readonly kind: "race" };

type Judgement =
  | { readonly counted: true; readonly score: RunScore; readonly log: LogEntry[] }
  | { readonly counted: false; readonly code: Exclude<RefusalCode, "ticket_expired" | "log_too_long" | "ticket_not_found"> };

/** True when the log has more entries than allowed, or an entry whose numeric time is beyond the longest test. */
export function logTooLong(body: unknown): boolean {
  if (!isRecord(body) || !Array.isArray(body.log)) return false;
  return body.log.length > config.maxLogEvents || body.log.some((entry) => isRecord(entry) && typeof entry.t === "number" && entry.t > config.maxTestMs);
}

function wellFormedLog(value: unknown, kind: RunKind): LogEntry[] | null {
  if (!Array.isArray(value)) return null;
  const log: LogEntry[] = [];
  for (const entry of value as unknown[]) {
    if (!isRecord(entry) || Object.keys(entry).length !== 2 || !isLoggableKey(entry.k) || !Number.isInteger(entry.t)) return null;
    log.push({ k: entry.k, t: entry.t as number });
  }
  const first = log[0];
  if (first !== undefined) {
    if (kind.kind === "race" ? first.t < 0 || first.t >= config.raceTimeLimitSeconds * 1000 : first.t !== 0) return null;
  }
  return log;
}

function impossibleInterval(log: readonly LogEntry[]): boolean {
  let fast = 0;
  for (let i = 1; i < log.length; i++) {
    const gap = log[i]!.t - log[i - 1]!.t;
    if (gap < 0) return true;
    if (gap < config.fastIntervalMs) fast += 1;
  }
  return log.length > 1 && fast > FAST_GAP_SHARE * (log.length - 1);
}

function sameFigures(body: Record<string, unknown>, score: RunScore): boolean {
  const matches = (submitted: unknown, hundredths: number): boolean => typeof submitted === "number" && Number.isFinite(submitted) && numberHundredths(submitted) === hundredths;
  const characters = isRecord(body.characters) ? body.characters : {};
  return (
    matches(body.speed, ratioHundredths(score.speed)) &&
    matches(body.raw, ratioHundredths(score.raw)) &&
    matches(body.accuracy, ratioHundredths(score.accuracy)) &&
    matches(body.consistency, numberHundredths(score.consistency)) &&
    characters.correct === score.characters.correct &&
    characters.incorrect === score.characters.incorrect &&
    characters.extra === score.characters.extra &&
    characters.missed === score.characters.missed
  );
}

export function judgeRun(body: unknown, words: readonly string[], kind: RunKind): Judgement {
  const input = isRecord(body) ? body : {};
  const log = wellFormedLog(input.log, kind);
  if (log === null) return { counted: false, code: "invalid_log" };
  const text = input.text;
  if (!Array.isArray(text) || text.length !== words.length || text.some((word, i) => word !== words[i])) return { counted: false, code: "wrong_text" };
  if (impossibleInterval(log)) return { counted: false, code: "impossible_interval" };
  const { score, everyKeyTyped } = replayLog(words, log, { timeLimitMs: kind.kind === "timed" ? kind.lengthMs : null, maxExtraLetters: config.maxExtraLetters });
  if (!everyKeyTyped || score === null || input.duration !== score.duration) return { counted: false, code: "duration_mismatch" };
  if (!sameFigures(input, score)) return { counted: false, code: "replay_mismatch" };
  return { counted: true, score, log };
}
