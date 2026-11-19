// Voice memo rules: the audio types accepted, the leading-byte signature of each, and byte-range playback.

export const MEMO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"] as const;
const MEMO_DURATION_MAX_MS = 600_000;

/** A Content-Type compared case-insensitively and without its parameters. */
function bareType(contentType: string): string {
  return (contentType.split(";")[0] ?? "").trim().toLowerCase();
}

const ascii = (bytes: Buffer, offset: number, text: string): boolean =>
  bytes.length >= offset + text.length && bytes.toString("latin1", offset, offset + text.length) === text;

/** True when the body's leading bytes match the declared audio type. */
export function matchesSignature(contentType: string, bytes: Buffer): boolean {
  switch (bareType(contentType)) {
    case "audio/webm":
      return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case "audio/ogg":
      return ascii(bytes, 0, "OggS");
    case "audio/mp4":
      return ascii(bytes, 4, "ftyp");
    case "audio/mpeg":
      return ascii(bytes, 0, "ID3") || (bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0);
    case "audio/wav":
      return ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WAVE");
    default:
      return false;
  }
}

/** The duration header: a whole number of milliseconds from 1 to 600000, or null. */
export function memoDuration(header: string | string[] | undefined): number | null {
  if (typeof header !== "string" || !/^\d+$/.test(header)) return null;
  const value = Number(header);
  return value >= 1 && value <= MEMO_DURATION_MAX_MS ? value : null;
}

type RangeAnswer = { kind: "full" } | { kind: "slice"; first: number; last: number } | { kind: "unsatisfiable" };

/**
 * How a Range header is answered for a memo of `size` bytes: a single satisfiable range is a slice; a range that
 * starts at or past the end (or `bytes=-0`) is unsatisfiable; no header, a malformed one or several ranges get it all.
 */
export function byteRange(header: string | undefined, size: number): RangeAnswer {
  const match = header === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: "full" };
  const [, from = "", to = ""] = match;
  if (from === "" && to === "") return { kind: "full" };
  if (from === "") {
    const count = Number(to);
    if (count === 0 || size === 0) return { kind: "unsatisfiable" };
    return { kind: "slice", first: Math.max(0, size - count), last: size - 1 };
  }
  const first = Number(from);
  if (to !== "" && Number(to) < first) return { kind: "full" };
  if (first >= size) return { kind: "unsatisfiable" };
  return { kind: "slice", first, last: to === "" ? size - 1 : Math.min(Number(to), size - 1) };
}
