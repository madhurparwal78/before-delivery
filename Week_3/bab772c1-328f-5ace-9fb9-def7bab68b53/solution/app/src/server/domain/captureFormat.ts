/** The published capture line format: the one place a capture's lines are read. */

import { parseIsoInstant } from "../../shared/doy.js";
import { derive, isDegenerate } from "../../shared/geometry.js";
import { codePointLength } from "../../shared/text.js";
import type { RejectionReason } from "../../shared/model.js";

const MAX_LINE_BYTES = 1024;
const MAX_SAMPLES = 50_000;
export const CAPTURE_LIMIT_BYTES = 5_000_000;

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

type ParsedSample = {
  line_no: number;
  utc_ms: number;
  x_m: number;
  y_m: number;
  z_m: number;
  vx_m_s: number;
  vy_m_s: number;
  vz_m_s: number;
  lat_deg: number;
  lon_deg: number;
  altitude_m: number;
  speed_m_s: number;
};

type ParsedLine = {
  line_no: number;
  utc_ms: number;
  speaker: string;
  text: string;
};

type ParseOutcome =
  | { ok: true; samples: ParsedSample[]; lines: ParsedLine[] }
  | { ok: false; line: number | null; reason: RejectionReason };

/** Thrown when the parser cannot finish: a sample at the Moon's centre, for instance. */
export class ParserFailure extends Error {}

function splitLines(bytes: Buffer): Buffer[] {
  const start = bytes.subarray(0, 3).equals(BOM) ? 3 : 0;
  const lines: Buffer[] = [];
  let from = start;
  for (let at = start; at < bytes.length; at += 1) {
    if (bytes[at] === 0x0a) {
      lines.push(bytes.subarray(from, at));
      from = at + 1;
    }
  }
  if (from < bytes.length) {
    lines.push(bytes.subarray(from));
  }
  return lines.map((line) =>
    line.length > 0 && line[line.length - 1] === 0x0d ? line.subarray(0, line.length - 1) : line,
  );
}

function parseNumber(field: string): number | null {
  return NUMBER_PATTERN.test(field) && Number.isFinite(Number(field)) ? Number(field) : null;
}

export function parseCapture(bytes: Buffer): ParseOutcome {
  const rawLines = splitLines(bytes);
  const samples: ParsedSample[] = [];
  const lines: ParsedLine[] = [];
  let previousSampleMs: number | null = null;

  for (const [index, raw] of rawLines.entries()) {
    const lineNumber = index + 1;
    if (raw.length > MAX_LINE_BYTES) {
      return { ok: false, line: lineNumber, reason: "line_too_long" };
    }
    if (raw[0] === 0x23 || raw.every((byte) => byte === 0x20 || byte === 0x09)) continue;
    let text: string;
    try {
      text = decoder.decode(raw);
    } catch {
      return { ok: false, line: lineNumber, reason: "bad_field" };
    }
    if (text.includes("\ufeff")) {
      return { ok: false, line: lineNumber, reason: "bad_field" };
    }
    const firstComma = text.indexOf(",");
    const recordType = firstComma === -1 ? text : text.slice(0, firstComma);
    if (recordType !== "S" && recordType !== "T") {
      return { ok: false, line: lineNumber, reason: "unknown_record" };
    }
    if (recordType === "S") {
      if (samples.length >= MAX_SAMPLES) {
        return { ok: false, line: lineNumber, reason: "too_many_samples" };
      }
      const fields = text.split(",");
      if (fields.length !== 8) {
        return { ok: false, line: lineNumber, reason: "bad_field" };
      }
      const utcMs = parseIsoInstant(fields[1]);
      const numbers = fields.slice(2).map(parseNumber);
      if (utcMs === null || numbers.some((value) => value === null)) {
        return { ok: false, line: lineNumber, reason: "bad_field" };
      }
      const [x, y, z, vx, vy, vz] = numbers as number[];
      if (previousSampleMs !== null && utcMs <= previousSampleMs) {
        return { ok: false, line: lineNumber, reason: "out_of_order" };
      }
      previousSampleMs = utcMs;
      const position = { x, y, z };
      if (isDegenerate(position)) {
        throw new ParserFailure("sample at the Moon's centre has no latitude");
      }
      const derived = derive(position, { x: vx, y: vy, z: vz });
      samples.push({
        line_no: lineNumber,
        utc_ms: utcMs,
        x_m: x,
        y_m: y,
        z_m: z,
        vx_m_s: vx,
        vy_m_s: vy,
        vz_m_s: vz,
        ...derived,
      });
      continue;
    }
    const parts = text.split(",");
    if (parts.length < 4) {
      return { ok: false, line: lineNumber, reason: "bad_field" };
    }
    const utcMs = parseIsoInstant(parts[1]);
    const speaker = parts[2];
    const body = parts.slice(3).join(",");
    const speakerLength = codePointLength(speaker);
    const bodyLength = codePointLength(body);
    if (
      utcMs === null ||
      speakerLength < 1 ||
      speakerLength > 40 ||
      bodyLength < 1 ||
      bodyLength > 500
    ) {
      return { ok: false, line: lineNumber, reason: "bad_field" };
    }
    lines.push({ line_no: lineNumber, utc_ms: utcMs, speaker, text: body });
  }

  if (samples.length === 0) {
    return { ok: false, line: rawLines.length + 1, reason: "no_samples" };
  }
  return { ok: true, samples, lines };
}
