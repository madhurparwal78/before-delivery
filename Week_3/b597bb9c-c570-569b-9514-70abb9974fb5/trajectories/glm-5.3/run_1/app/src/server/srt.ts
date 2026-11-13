/**
 * SRT parsing and writing. Import caps, canonical layout, byte-for-byte
 * round trip, and frames to milliseconds by the rounding rule.
 */
import { framesToSrtMs, srtMsToFrames } from '../shared/frames';

export const SRT_MAX_BYTES = 1_000_000;
export const SRT_MAX_CUES = 5_000;
export const SRT_MAX_LINE_CODEPOINTS = 42;
export const SRT_MAX_LINES_PER_CUE = 2;

export interface SrtCue {
  /** Original index line, preserved verbatim for the round trip. */
  index: string;
  startMs: number;
  endMs: number;
  lines: string[];
  startFrame: number;
  endFrame: number;
}

export interface SrtLayout {
  bom: boolean;
  crlf: boolean;
}

export interface ParsedSrt {
  cues: SrtCue[];
  layout: SrtLayout;
}

export type SrtProblem =
  | { code: 'too_many_cues' }
  | { code: 'line_long'; line: number }
  | { code: 'too_many_lines'; cue: number }
  | { code: 'bad_time'; cue: number }
  | { code: 'ends_before_starts'; cue: number }
  | { code: 'shorter_than_frame'; cue: number }
  | { code: 'overlaps'; cue: number }
  | { code: 'not_utf8' };

export function srtProblemText(p: SrtProblem): string {
  switch (p.code) {
    case 'too_many_cues':
      return 'This SRT file has more than 5,000 cues.';
    case 'line_long':
      return `Line ${p.line} is longer than 42 characters.`;
    case 'too_many_lines':
      return `Cue ${p.cue} has more than 2 text lines.`;
    case 'bad_time':
      return `Cue ${p.cue} has a malformed time line.`;
    case 'ends_before_starts':
      return `Cue ${p.cue} ends before it starts.`;
    case 'shorter_than_frame':
      return `Cue ${p.cue} is shorter than one frame.`;
    case 'overlaps':
      return `Cue ${p.cue} overlaps the cue before it.`;
    case 'not_utf8':
      return 'This file is not UTF-8 text.';
  }
}

export function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

const TIME_RE = /^(\d{2,}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2,}):(\d{2}):(\d{2}),(\d{3})$/;

function decodeUtf8(bytes: Uint8Array): { text: string; bom: boolean } | null {
  let bom = false;
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bom = true;
    start = 3;
  }
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const view = bytes.subarray(start);
    return { text: decoder.decode(view), bom };
  } catch {
    return null;
  }
}

/**
 * Parse an SRT file. Returns cues with their original milliseconds so an
 * untouched file exports byte for byte.
 */
export function parseSrt(bytes: Uint8Array, rateLabel: string): { ok: true; parsed: ParsedSrt } | { ok: false; problem: SrtProblem } {
  const decoded = decodeUtf8(bytes);
  if (decoded === null) return { ok: false, problem: { code: 'not_utf8' } };
  const raw = decoded.text;
  const crlf = raw.includes('\r\n');
  const normalised = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const physicalLines = normalised.split('\n');

  // Blank-line-separated cues.
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of physicalLines) {
    if (line.trim() === '') {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);

  const cues: SrtCue[] = [];
  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b]!;
    const cueNo = b + 1;
    if (cueNo > SRT_MAX_CUES) return { ok: false, problem: { code: 'too_many_cues' } };
    if (block.length < 2) return { ok: false, problem: { code: 'bad_time', cue: cueNo } };
    const index = block[0]!;
    if (!/^\d+$/.test(index)) return { ok: false, problem: { code: 'bad_time', cue: cueNo } };
    const timeLine = block[1]!;
    const m = TIME_RE.exec(timeLine);
    if (m === null) return { ok: false, problem: { code: 'bad_time', cue: cueNo } };
    const startMs = Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4]);
    const endMs = Number(m[5]) * 3600000 + Number(m[6]) * 60000 + Number(m[7]) * 1000 + Number(m[8]);
    if (endMs < startMs) return { ok: false, problem: { code: 'ends_before_starts', cue: cueNo } };
    const textLines = block.slice(2);
    if (textLines.length > SRT_MAX_LINES_PER_CUE) {
      return { ok: false, problem: { code: 'too_many_lines', cue: cueNo } };
    }
    if (textLines.length === 0) return { ok: false, problem: { code: 'bad_time', cue: cueNo } };
    const startFrame = srtMsToFrames(startMs, rateLabel);
    const endFrame = srtMsToFrames(endMs, rateLabel);
    if (endFrame <= startFrame) return { ok: false, problem: { code: 'shorter_than_frame', cue: cueNo } };
    if (cues.length > 0) {
      const prev = cues[cues.length - 1]!;
      if (startFrame < prev.endFrame) return { ok: false, problem: { code: 'overlaps', cue: cueNo } };
    }
    cues.push({ index, startMs, endMs, lines: textLines, startFrame, endFrame });
  }
  // Line length cap: every line of the file at most 42 code points.
  for (let i = 0; i < physicalLines.length; i++) {
    if (codePoints(physicalLines[i]!) > SRT_MAX_LINE_CODEPOINTS) {
      return { ok: false, problem: { code: 'line_long', line: i + 1 } };
    }
  }
  return { ok: true, parsed: { cues, layout: { bom: decoded.bom, crlf } } };
}

/** Validate cue text typed by hand: 1 or 2 lines of at most 42 code points. */
export function cueTextProblem(text: string): 'empty' | 'lines' | 'length' | null {
  const lines = text.split('\n');
  if (lines.length === 0) return 'empty';
  if (text.trim() === '') return 'empty';
  if (lines.length > SRT_MAX_LINES_PER_CUE) return 'lines';
  for (const line of lines) {
    if (codePoints(line) > SRT_MAX_LINE_CODEPOINTS) return 'length';
  }
  return null;
}

export interface ExportCue {
  start_frame: number;
  end_frame: number;
  text: string;
  /** Original milliseconds when this cue came from an import unchanged. */
  originalStartMs: number | null;
  originalEndMs: number | null;
}

/**
 * Write SRT: numbered in start order, times as HH:MM:SS,mmm, one empty line
 * after every cue, the line ending and BOM of the row's last import.
 */
export function writeSrt(cues: readonly ExportCue[], rateLabel: string, layout: SrtLayout): Uint8Array {
  const eol = layout.crlf ? '\r\n' : '\n';
  const sorted = [...cues].sort((a, b) => a.start_frame - b.start_frame || a.end_frame - b.end_frame);
  const parts: string[] = [];
  sorted.forEach((cue, i) => {
    const startMs = cue.originalStartMs ?? framesToSrtMs(cue.start_frame, rateLabel);
    const endMs = cue.originalEndMs ?? framesToSrtMs(cue.end_frame, rateLabel);
    parts.push(String(i + 1));
    parts.push(`${msToTime(startMs)} --> ${msToTime(endMs)}`);
    for (const line of cue.text.split('\n')) parts.push(line);
    parts.push('');
  });
  const body = parts.join(eol);
  const text = (layout.bom ? '\uFEFF' : '') + body;
  return new TextEncoder().encode(text);
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

function msToTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(rest, 3)}`;
}
