/**
 * SRT reading and writing. An untouched canonical file comes back byte for byte.
 */
import { ApiError } from './api-error.js';
import { SRT_PROBLEM } from './errors.js';
import { framesToMilliseconds, millisecondsToFrames, type ExactRate } from './rate.js';
import { CAPTION_LINE_LIMIT } from './validate.js';

export const SRT_CUE_LIMIT = 5000;

export interface SrtFormat {
  line_ending: 'LF' | 'CRLF';
  byte_order_mark: boolean;
}

export interface ParsedCue {
  start_ms: number;
  end_ms: number;
  start_frame: number;
  end_frame: number;
  text: string;
}

export interface ParsedSrt {
  cues: ParsedCue[];
  format: SrtFormat;
}

function refuse(problem: string): never {
  throw ApiError.validation({ srt: problem });
}

const TIME_LINE = /^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3}) --> (\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/;

function toMilliseconds(hours: string, minutes: string, seconds: string, thousandths: string): number {
  return Number(hours) * 3600000 + Number(minutes) * 60000 + Number(seconds) * 1000 + Number(thousandths);
}

export function parseSrt(body: Buffer, rate: ExactRate): ParsedSrt {
  const decoded = new TextDecoder('utf-8', { fatal: true });
  let text: string;
  try {
    text = decoded.decode(body);
  } catch {
    return refuse(SRT_PROBLEM.notUtf8);
  }
  const byteOrderMark = text.startsWith('\ufeff');
  if (byteOrderMark) text = text.slice(1);
  const lineEnding: SrtFormat['line_ending'] = text.includes('\r\n') ? 'CRLF' : 'LF';
  const lines = text.split(/\r\n|\n/);
  lines.forEach((line, index) => {
    if ([...line].length > CAPTION_LINE_LIMIT) refuse(SRT_PROBLEM.lineTooLong(index + 1));
  });

  const cues: ParsedCue[] = [];
  let at = 0;
  while (at < lines.length) {
    while (at < lines.length && lines[at].trim() === '') at += 1;
    if (at >= lines.length) break;
    const cueNumber = cues.length + 1;
    if (cueNumber > SRT_CUE_LIMIT) refuse(SRT_PROBLEM.tooManyCues);
    if (!/^\d+$/.test(lines[at].trim())) refuse(SRT_PROBLEM.malformedTime(cueNumber));
    at += 1;
    const timeLine = at < lines.length ? lines[at] : '';
    const match = TIME_LINE.exec(timeLine);
    if (!match) refuse(SRT_PROBLEM.malformedTime(cueNumber));
    at += 1;
    const startMs = toMilliseconds(match[1], match[2], match[3], match[4]);
    const endMs = toMilliseconds(match[5], match[6], match[7], match[8]);
    const textLines: string[] = [];
    while (at < lines.length && lines[at].trim() !== '') {
      textLines.push(lines[at]);
      at += 1;
      if (textLines.length > 2) refuse(SRT_PROBLEM.tooManyLines(cueNumber));
    }
    if (textLines.length === 0) refuse(SRT_PROBLEM.malformedTime(cueNumber));
    if (endMs < startMs) refuse(SRT_PROBLEM.endsBeforeStart(cueNumber));
    const startFrame = millisecondsToFrames(startMs, rate);
    const endFrame = millisecondsToFrames(endMs, rate);
    if (endFrame - startFrame < 1) refuse(SRT_PROBLEM.shorterThanFrame(cueNumber));
    const previous = cues[cues.length - 1];
    if (previous && startFrame < previous.end_frame) refuse(SRT_PROBLEM.overlaps(cueNumber));
    cues.push({ start_ms: startMs, end_ms: endMs, start_frame: startFrame, end_frame: endFrame, text: textLines.join('\n') });
  }
  if (cues.length > SRT_CUE_LIMIT) refuse(SRT_PROBLEM.tooManyCues);
  return { cues, format: { line_ending: lineEnding, byte_order_mark: byteOrderMark } };
}

function writeStamp(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor(ms / 60000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  const thousandths = ms % 1000;
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${two(hours)}:${two(minutes)}:${two(seconds)},${String(thousandths).padStart(3, '0')}`;
}

export interface ExportableCue {
  start_frame: number;
  end_frame: number;
  text: string;
  import_start_ms: number | null;
  import_end_ms: number | null;
  import_start_frame: number | null;
  import_end_frame: number | null;
}

export function writeSrt(cues: readonly ExportableCue[], format: SrtFormat, rate: ExactRate): Buffer {
  const ending = format.line_ending === 'CRLF' ? '\r\n' : '\n';
  const ordered = [...cues].sort((a, b) => a.start_frame - b.start_frame);
  const parts: string[] = [];
  ordered.forEach((cue, index) => {
    const untouched =
      cue.import_start_ms !== null &&
      cue.import_end_ms !== null &&
      cue.import_start_frame === cue.start_frame &&
      cue.import_end_frame === cue.end_frame;
    const startMs = untouched ? (cue.import_start_ms as number) : framesToMilliseconds(cue.start_frame, rate);
    const endMs = untouched ? (cue.import_end_ms as number) : framesToMilliseconds(cue.end_frame, rate);
    parts.push(String(index + 1));
    parts.push(`${writeStamp(startMs)} --> ${writeStamp(endMs)}`);
    for (const line of cue.text.split('\n')) parts.push(line);
    parts.push('');
  });
  const body = parts.map((line) => `${line}${ending}`).join('');
  return Buffer.from(`${format.byte_order_mark ? '\ufeff' : ''}${body}`, 'utf8');
}
