import { SRT_COPY } from "../shared/copy";
import { cueLines, validCueText } from "../shared/captions";
import { codePoints } from "../shared/codepoints";
import { CUE_LINES_MAX, CUE_LINE_MAX, SRT_CUES_MAX } from "../shared/limits";
import { framesToMs, msToFrames, type FrameRate } from "../shared/rational";
import { srtTime } from "../shared/timecode";
import { query } from "./db";
import { invalid } from "./errors";
import type { ParsedCue } from "../shared/ops";

interface ParsedSrt {
  cues: ParsedCue[];
  eol: string;
  bom: boolean;
}

const TIME_LINE = /^(\d{2,}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2,}):(\d{2}):(\d{2}),(\d{3})$/;

const refuse = (message: string): never => {
  throw invalid({ srt: message });
};

function millis(parts: readonly (string | undefined)[], from: number): number {
  const [h, m, s, ms] = parts.slice(from, from + 4).map((part) => Number(part));
  return ((h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)) * 1000 + (ms ?? 0);
}

/** Reads an SRT file and refuses at the first breach or format problem, naming it. */
export function parseSrt(data: Buffer, rate: FrameRate): ParsedSrt {
  const bom = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bom ? data.subarray(3) : data);
  } catch {
    return refuse(SRT_COPY.utf8);
  }
  const firstBreak = text.indexOf("\n");
  const eol = firstBreak > 0 && text[firstBreak - 1] === "\r" ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const cues: ParsedCue[] = [];
  let at = 0;
  const tooLong = (index: number): void => {
    if (codePoints(lines[index] ?? "") > CUE_LINE_MAX) refuse(SRT_COPY.line(index + 1));
  };
  for (;;) {
    while (at < lines.length && lines[at] === "") at += 1;
    if (at >= lines.length) break;
    const number = cues.length + 1;
    if (number > SRT_CUES_MAX) refuse(SRT_COPY.cues);
    tooLong(at);
    const indexLine = lines[at] ?? "";
    at += 1;
    tooLong(at);
    const timing = TIME_LINE.exec(lines[at] ?? "");
    if (!/^\d+$/.test(indexLine) || !timing) refuse(SRT_COPY.time(number));
    at += 1;
    const startMs = millis(timing ?? [], 1);
    const endMs = millis(timing ?? [], 5);
    if (endMs < startMs) refuse(SRT_COPY.order(number));
    const start = msToFrames(rate, startMs);
    const end = msToFrames(rate, endMs);
    if (end - start < 1) refuse(SRT_COPY.short(number));
    const previous = cues[cues.length - 1];
    if (previous && start < previous.end_frame) refuse(SRT_COPY.overlap(number));
    const body: string[] = [];
    while (at < lines.length && lines[at] !== "") {
      tooLong(at);
      body.push(lines[at] ?? "");
      at += 1;
    }
    if (body.length > CUE_LINES_MAX) refuse(SRT_COPY.lines(number));
    const cueText = body.join("\n");
    if (!validCueText(cueText)) refuse(SRT_COPY.time(number));
    cues.push({ start_frame: start, end_frame: end, text: cueText, start_ms: startMs, end_ms: endMs });
  }
  return { cues, eol, bom };
}

interface CueRow {
  start_frame: number;
  end_frame: number;
  text: string;
  orig_start_ms: number | null;
  orig_end_ms: number | null;
}

/** The row's cues as SRT in the line ending and byte-order mark of its last import. */
export async function exportSrt(projectId: string, rowId: string, rate: FrameRate, eol: string, bom: boolean): Promise<Buffer> {
  const cues = await query<CueRow>(
    "SELECT start_frame, end_frame, text, orig_start_ms, orig_end_ms FROM captions WHERE project_id = $1 AND row_id = $2 ORDER BY start_frame, seq",
    [projectId, rowId],
  );
  const body = cues
    .map((cue, index) => {
      const start = cue.orig_start_ms ?? framesToMs(rate, cue.start_frame);
      const end = cue.orig_end_ms ?? framesToMs(rate, cue.end_frame);
      return `${index + 1}${eol}${srtTime(start)} --> ${srtTime(end)}${eol}${cueLines(cue.text).join(eol)}${eol}${eol}`;
    })
    .join("");
  return Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(body, "utf8")]);
}
