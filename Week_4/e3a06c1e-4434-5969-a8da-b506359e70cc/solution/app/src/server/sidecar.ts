// WebVTT sidecar: one cue per segment, one `word@confidence` token line per cue.
import type { Word } from "../shared/types";
import { words } from "../shared/text";

export interface Cue {
  start_ms: number;
  end_ms: number;
  words: Word[];
}

const TIMING = /^((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})(?:\s.*)?$/;
const TOKEN = /^(.+)@(0(?:\.\d{1,2})?|1(?:\.0{1,2})?)$/;

function stamp(text: string): number {
  const parts = text.split(":");
  const [seconds, millis] = parts.pop()!.split(".");
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (minutes > 59 || Number(seconds) > 59) return Number.NaN;
  return ((hours * 60 + minutes) * 60 + Number(seconds)) * 1000 + Number(millis);
}

/** Splits a cue's span evenly: word k of n starts at start + floor(k × span / n). */
export function spreadWords(texts: readonly string[], confidences: readonly number[], start: number, end: number): Word[] {
  const span = end - start;
  const starts = texts.map((_, k) => start + Math.floor((k * span) / texts.length));
  return texts.map((text, k) => ({ text, confidence: confidences[k], start_ms: starts[k], end_ms: k + 1 < texts.length ? starts[k + 1] : end }));
}

/** The cues of a sidecar, or null when it is not WebVTT with one confidence per word, in order and without overlaps. */
export function parseSidecar(source: string): Cue[] | null {
  const lines = source.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0] ?? "")) return null;
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === "") {
      if (current.length) blocks.push(current);
      current = [];
    } else current.push(line);
  }
  if (current.length) blocks.push(current);
  const cues: Cue[] = [];
  for (const block of blocks) {
    if (/^NOTE(?:\s|$)/.test(block[0])) continue;
    const timingAt = TIMING.test(block[0]) ? 0 : 1;
    const timing = TIMING.exec(block[timingAt] ?? "");
    if (!timing || block.length !== timingAt + 2) return null;
    const start = stamp(timing[1]);
    const end = stamp(timing[2]);
    if (!(end > start)) return null;
    if (cues.length && start < cues[cues.length - 1].end_ms) return null;
    const tokens = words(block[timingAt + 1]);
    const texts: string[] = [];
    const confidences: number[] = [];
    for (const token of tokens) {
      const match = TOKEN.exec(token);
      if (!match || match[1].includes("@")) return null;
      texts.push(match[1]);
      confidences.push(Number(match[2]));
    }
    cues.push({ start_ms: start, end_ms: end, words: spreadWords(texts, confidences, start, end) });
  }
  return cues;
}
