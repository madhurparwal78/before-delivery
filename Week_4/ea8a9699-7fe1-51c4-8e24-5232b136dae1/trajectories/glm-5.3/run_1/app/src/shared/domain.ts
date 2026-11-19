// Domain rules that both server and client need (pure functions).

import { PLAN_NAMES, PLAN_SEATS, PLAN_PRICES } from './constants.js';

/** Non-dropframe timecode HH:MM:SS:FF from a frame index. */
export function timecodeOf(frameIndex: number, frameRate: number): string {
  const ff = frameIndex % frameRate;
  const totalSeconds = Math.floor(frameIndex / frameRate);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return [hh, mm, ss, ff].map((p) => String(p).padStart(2, '0')).join(':');
}

export function totalFramesOf(durationMs: number, frameRate: number): number {
  return Math.max(1, Math.floor((durationMs * frameRate) / 1000));
}

export function planNameOf(plan: string): string {
  return PLAN_NAMES[plan] ?? plan;
}

export function seatCapOf(plan: string): number {
  return PLAN_SEATS[plan] ?? 0;
}

export function monthlyPriceOf(plan: string): string {
  return PLAN_PRICES[plan] ?? '0.00';
}

export function stillDefaultTitle(clipTitle: string, timecode: string): string {
  return `${clipTitle} @ ${timecode}`;
}

export interface CellNeutralisation {
  needsPrefix(firstChar: string): boolean;
}

/** The characters that force formula neutralisation, per the cluster sheet rule. */
const FORMULA_PREFIX_CHARS = new Set(['=', '+', '-', '@', '\t', '\r', '\n', '＝', '＋', '－', '＠']);

export function isFormulaLeadingChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return FORMULA_PREFIX_CHARS.has(ch);
}

/** Neutralise then quote a CSV cell, per the cluster sheet rules. */
export function csvCell(value: string): string {
  let v = value;
  if (isFormulaLeadingChar(v.charAt(0))) v = `'${v}`;
  if (/[",\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
