// The single capture line-format check. Every parsed pass goes through this
// module; no route or consumer re-implements any of it.

import { deriveFromPosition, isoToEpochMs, MOON_RADIUS_M } from "../shared/format.js";

export const CAPTURE_MAX_BYTES = 5_000_000;
export const LINE_MAX_BYTES = 1024;
export const SAMPLE_CAP = 50_000;

export type LineRejectReason =
  | "line_too_long"
  | "unknown_record"
  | "too_many_samples"
  | "bad_field"
  | "out_of_order"
  | "no_samples";

export const REASON_TEXT: Record<LineRejectReason, string> = {
  line_too_long: "line is longer than 1024 bytes",
  unknown_record: "unknown record type",
  too_many_samples: "more than 50000 samples",
  bad_field: "a field cannot be read",
  out_of_order: "sample time is not after the previous sample",
  no_samples: "no sample lines",
};

export interface ParsedSample {
  utcMs: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  lat_deg: number;
  lon_deg: number;
  altitude_m: number;
  speed_m_s: number;
}

export interface ParsedLine {
  utcMs: number;
  speaker: string;
  text: string;
}

export interface ParseSuccess {
  outcome: "parsed";
  samples: ParsedSample[];
  lines: ParsedLine[];
}

export interface ParseReject {
  outcome: "rejected";
  line: number;
  reason: LineRejectReason;
}

export class ParserFailure extends Error {
  readonly line: number | null;
  constructor(message: string, line: number | null) {
    super(message);
    this.line = line;
  }
}

const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;
const BOM_IN_LINE = Buffer.from([0xef, 0xbb, 0xbf]);

function countCodePoints(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

export function parseCapture(bytes: Buffer): ParseSuccess | ParseReject {
  // A UTF-8 BOM at byte 0 is skipped by the parser and kept in the stored
  // object; it does not count toward line 1's length.
  let position = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    position = 3;
  }

  const samples: ParsedSample[] = [];
  const lines: ParsedLine[] = [];
  let lineNo = 0;
  let lastSampleUtcMs: number | null = null;

  while (position < bytes.length) {
    let lineEnd = bytes.indexOf(0x0a, position);
    if (lineEnd === -1) lineEnd = bytes.length;
    let contentEnd = lineEnd;
    if (contentEnd > position && bytes[contentEnd - 1] === 0x0d) contentEnd -= 1;
    const raw = bytes.subarray(position, contentEnd);
    lineNo += 1;

    // Step 1: per-line byte limit.
    if (raw.length > LINE_MAX_BYTES) {
      return { outcome: "rejected", line: lineNo, reason: "line_too_long" };
    }

    const text = raw.toString("utf8");

    // Step 2: comment or blank lines are ignored but counted.
    const isComment = raw.length > 0 && raw[0] === 0x23;
    if (isComment || raw.length === 0 || /^[\t ]*$/.test(text)) {
      position = lineEnd + 1;
      continue;
    }

    // Step 3: a stray mark makes the line unreadable.
    if (raw.includes(BOM_IN_LINE)) {
      return { outcome: "rejected", line: lineNo, reason: "bad_field" };
    }

    // Step 4: record type is the text before the first comma.
    const firstComma = text.indexOf(",");
    const recordType = firstComma === -1 ? text : text.slice(0, firstComma);
    if (recordType !== "S" && recordType !== "T") {
      return { outcome: "rejected", line: lineNo, reason: "unknown_record" };
    }

    if (recordType === "S") {
      // Step 5: sample cap.
      if (samples.length >= SAMPLE_CAP) {
        return { outcome: "rejected", line: lineNo, reason: "too_many_samples" };
      }
      // Step 6: exactly 8 fields.
      const fields = text.split(",");
      if (fields.length !== 8) {
        return { outcome: "rejected", line: lineNo, reason: "bad_field" };
      }
      const utcMs = isoToEpochMs(fields[1].trim());
      if (utcMs === null) {
        return { outcome: "rejected", line: lineNo, reason: "bad_field" };
      }
      const nums: number[] = [];
      for (let i = 2; i <= 7; i++) {
        if (!NUMBER_RE.test(fields[i])) {
          return { outcome: "rejected", line: lineNo, reason: "bad_field" };
        }
        const value = Number(fields[i]);
        if (!Number.isFinite(value)) {
          return { outcome: "rejected", line: lineNo, reason: "bad_field" };
        }
        nums.push(value);
      }
      // Step 7: strictly increasing UTC.
      if (lastSampleUtcMs !== null && utcMs <= lastSampleUtcMs) {
        return { outcome: "rejected", line: lineNo, reason: "out_of_order" };
      }
      lastSampleUtcMs = utcMs;
      // A sample at the Moon's centre has no latitude: a parser failure.
      if (nums[0] === 0 && nums[1] === 0 && nums[2] === 0) {
        throw new ParserFailure("position cannot be derived", lineNo);
      }
      const derived = deriveFromPosition(nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]);
      if (!Number.isFinite(derived.lat_deg) || !Number.isFinite(derived.lon_deg)) {
        throw new ParserFailure("position cannot be derived", lineNo);
      }
      samples.push({
        utcMs,
        x: nums[0],
        y: nums[1],
        z: nums[2],
        vx: nums[3],
        vy: nums[4],
        vz: nums[5],
        ...derived,
      });
    } else {
      // T,<utc>,<speaker>,<text>: the text is everything after the third comma.
      const fields = text.split(",");
      if (fields.length < 4) {
        return { outcome: "rejected", line: lineNo, reason: "bad_field" };
      }
      const utcMs = isoToEpochMs(fields[1].trim());
      if (utcMs === null) {
        return { outcome: "rejected", line: lineNo, reason: "bad_field" };
      }
      const speaker = fields[2];
      const lineText = fields.slice(3).join(",");
      const speakerLen = countCodePoints(speaker);
      if (speakerLen < 1 || speakerLen > 40) {
        return { outcome: "rejected", line: lineNo, reason: "bad_field" };
      }
      const textLen = countCodePoints(lineText);
      if (textLen < 1 || textLen > 500) {
        return { outcome: "rejected", line: lineNo, reason: "bad_field" };
      }
      lines.push({ utcMs, speaker, text: lineText });
    }

    position = lineEnd + 1;
  }

  if (samples.length === 0) {
    return { outcome: "rejected", line: lineNo + 1, reason: "no_samples" };
  }
  return { outcome: "parsed", samples, lines };
}

export const MOON_RADIUS = MOON_RADIUS_M;
