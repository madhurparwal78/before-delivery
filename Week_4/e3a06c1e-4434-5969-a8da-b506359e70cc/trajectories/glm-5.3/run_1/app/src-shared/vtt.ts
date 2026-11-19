// WebVTT sidecar parsing and the reviewed-transcript / word-error-rate rules.

import { splitWords } from './text';

export type SidecarWord = { text: string; confidence: number; start_ms: number; end_ms: number };
export type SidecarCue = { start_ms: number; end_ms: number; words: SidecarWord[] };

function parseTimestamp(t: string): number | null {
  const m = /^(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(t.trim());
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const s = Number(m[3]);
  const ms = Number(m[4]);
  if (min > 59 || s > 59) return null;
  return ((h * 60 + min) * 60 + s) * 1000 + ms;
}

/**
 * Parses the sidecar format. Returns null on a malformed file:
 * cues must be in order, must not overlap, and each must end after it starts.
 */
export function parseSidecar(vtt: string): SidecarCue[] | null {
  const lines = vtt.split(/\r\n|\r|\n/);
  if (lines.length === 0 || lines[0].trim() !== 'WEBVTT') return null;
  const cues: SidecarCue[] = [];
  let i = 1;
  // Skip header metadata lines until a blank line.
  while (i < lines.length && lines[i].trim() !== '') {
    if (lines[i].includes('-->')) { i--; break; }
    i++;
  }
  i++;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    const mm = line.split('-->');
    if (mm.length !== 2) return null;
    const start = parseTimestamp(mm[0]);
    const end = parseTimestamp(mm[1]);
    if (start === null || end === null) return null;
    if (end <= start) return null;
    if (cues.length > 0 && start < cues[cues.length - 1].end_ms) return null;
    i++;
    if (i >= lines.length || lines[i].trim() === '') return null; // must have exactly one text line
    const textLine = lines[i];
    i++;
    if (i < lines.length && lines[i].trim() !== '') return null; // more than one text line
    const tokens = textLine.split(' ').filter((t) => t.length > 0);
    const words: SidecarWord[] = [];
    for (const tok of tokens) {
      const at = tok.lastIndexOf('@');
      if (at <= 0 || at === tok.length - 1) return null;
      const conf = Number(tok.slice(at + 1));
      if (!Number.isFinite(conf) || conf < 0 || conf > 1 || !/^\d+(\.\d{1,2})?$/.test(tok.slice(at + 1))) return null;
      words.push({ text: tok.slice(0, at), confidence: Math.round(conf * 100) / 100, start_ms: 0, end_ms: 0 });
    }
    // Divide the cue's span evenly: word k of n starts at start + k×span÷n, rounded down.
    const span = end - start;
    const n = words.length;
    words.forEach((w, k) => {
      w.start_ms = Math.floor(start + (k * span) / n);
      w.end_ms = Math.floor(start + ((k + 1) * span) / n);
    });
    cues.push({ start_ms: start, end_ms: end, words });
  }
  return cues;
}

export const FLAG_CONFIDENCE_THRESHOLD = 0.85;

export function isFlagged(words: SidecarWord[]): boolean {
  return words.length > 0 && words.some((w) => w.confidence < FLAG_CONFIDENCE_THRESHOLD);
}

export type ConfidenceBand = 'high' | 'medium' | 'low';

export function confidenceBand(c: number): ConfidenceBand {
  if (c >= 0.85) return 'high';
  if (c >= 0.6) return 'medium';
  return 'low';
}

/** Normalises a word for WER: lowercase, strip .,?!;: at either end. */
function werWord(w: string): string {
  let s = w;
  while (s.length > 0 && '.,?!;:'.includes(s[0])) s = s.slice(1);
  while (s.length > 0 && '.,?!;:'.includes(s[s.length - 1])) s = s.slice(0, -1);
  return s.toLowerCase();
}

/** Word error rate between machine and reviewed words, four decimals; null when reviewed has no words. */
export function wordErrorRate(machineWords: string[], reviewedWords: string[]): number | null {
  const a = machineWords.map(werWord).filter((w) => w !== '');
  const b = reviewedWords.map(werWord).filter((w) => w !== '');
  if (b.length === 0) return null;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  const dist = prev[n];
  return Math.round((dist / n) * 10000) / 10000;
}

/** Splits transcript text into display words. */
export function textWords(text: string): string[] {
  return splitWords(text);
}

export function formatWer(wer: number | null): string {
  if (wer === null) return 'n/a';
  return `${(wer * 100).toFixed(2)}%`;
}
