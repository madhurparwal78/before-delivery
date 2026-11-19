import { isFlagged } from '../../shared/confidence.js';
import { splitWords } from '../../shared/text.js';
import type { Word } from '../../shared/types.js';
import { spreadWords } from './transcript.js';

export interface SidecarCue {
  readonly startMs: number;
  readonly endMs: number;
  readonly words: readonly Word[];
}

const timingLine = /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3}) --> (?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/;
const confidenceValue = /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/;

const toMs = (hours: string | undefined, minutes: string, seconds: string, millis: string): number =>
  (Number(hours ?? '0') * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000 + Number(millis);

/** Parses a WebVTT sidecar of `word@confidence` cues. Returns null when the file is invalid. */
export const parseSidecar = (text: string): SidecarCue[] | null => {
  const body = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = body.split('\n');
  const first = lines[0];
  if (first === undefined || !/^WEBVTT(\s.*)?$/.test(first)) return null;

  const cues: SidecarCue[] = [];
  let index = 1;
  while (index < lines.length) {
    const line = (lines[index] ?? '').trim();
    if (line === '') {
      index += 1;
      continue;
    }
    const timing = timingLine.exec(line);
    if (timing === null) return null;
    const startMs = toMs(timing[1], timing[2] as string, timing[3] as string, timing[4] as string);
    const endMs = toMs(timing[5], timing[6] as string, timing[7] as string, timing[8] as string);
    if (endMs <= startMs) return null;
    const last = cues[cues.length - 1];
    if (last !== undefined && startMs < last.endMs) return null;

    const textLine = lines[index + 1];
    if (textLine === undefined || textLine.trim() === '') return null;
    const tokens = splitWords(textLine.trim());
    if (tokens.length === 0) return null;
    const parsed: { text: string; confidence: number }[] = [];
    for (const token of tokens) {
      const at = token.lastIndexOf('@');
      if (at <= 0 || at === token.length - 1) return null;
      const word = token.slice(0, at);
      const rawConfidence = token.slice(at + 1);
      if (!confidenceValue.test(rawConfidence)) return null;
      const confidence = Number(rawConfidence);
      if (!(confidence >= 0 && confidence <= 1)) return null;
      parsed.push({ text: word, confidence });
    }
    cues.push({ startMs, endMs, words: spreadWords(parsed, startMs, endMs) });

    const after = lines[index + 2];
    if (after !== undefined && after.trim() !== '') return null;
    index += 3;
  }
  if (cues.length === 0) return null;
  return cues;
};

export const cueText = (words: readonly Word[]): string => words.map((word) => word.text).join(' ');

export const cueFlagged = (words: readonly Word[]): boolean => isFlagged(words.map((word) => word.confidence));
