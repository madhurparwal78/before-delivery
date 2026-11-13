// Conditional and range request evaluation (RFC 9110), written once and used
// by the capture download routes.

export interface ByteRange {
  first: number;
  last: number;
}

export interface ConditionalResult {
  status: "full" | "not_modified" | "precondition_failed" | "range" | "range_not_satisfiable";
  range: ByteRange | null;
  contentTypeRange: string | null;
}

export function evaluateConditional(
  headers: {
    ifMatch: string | null;
    ifNoneMatch: string | null;
    ifRange: string | null;
    range: string | null;
  },
  etag: string,
  size: number,
): ConditionalResult {
  // 1. If-Match, strong comparison.
  if (headers.ifMatch !== null) {
    if (!strongMatch(headers.ifMatch, etag)) {
      return { status: "precondition_failed", range: null, contentTypeRange: null };
    }
  }
  // 2. If-None-Match, weak comparison.
  if (headers.ifNoneMatch !== null) {
    if (weakMatch(headers.ifNoneMatch, etag)) {
      return { status: "not_modified", range: null, contentTypeRange: null };
    }
  }
  // 3. If-Range mismatch ignores Range and serves the full body.
  const hasRange = headers.range !== null;
  if (headers.ifRange !== null && hasRange) {
    if (!strongMatch(headers.ifRange, etag)) {
      return { status: "full", range: null, contentTypeRange: null };
    }
  }
  if (!hasRange) {
    return { status: "full", range: null, contentTypeRange: null };
  }
  // 4. Only single byte ranges in the bytes unit are honoured.
  const parsed = parseRange(headers.range as string, size);
  if (parsed === null || parsed === "multiple") {
    return { status: "full", range: null, contentTypeRange: null };
  }
  if (parsed === "unsatisfiable") {
    return { status: "range_not_satisfiable", range: null, contentTypeRange: null };
  }
  return {
    status: "range",
    range: parsed,
    contentTypeRange: `bytes ${parsed.first}-${parsed.last}/${size}`,
  };
}

function strongMatch(header: string, etag: string): boolean {
  if (header.trim() === "*") return true;
  for (const part of splitETagList(header)) {
    if (part.weak) continue;
    if (part.value === etag) return true;
  }
  return false;
}

function weakMatch(header: string, etag: string): boolean {
  const trimmed = header.trim();
  if (trimmed === "*") return true;
  for (const part of splitETagList(header)) {
    if (part.value === etag) return true;
  }
  return false;
}

interface ETagPart {
  value: string;
  weak: boolean;
}

function splitETagList(header: string): ETagPart[] {
  const parts: ETagPart[] = [];
  for (const raw of header.split(",")) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    const weak = trimmed.startsWith("W/");
    const value = weak ? trimmed.slice(2) : trimmed;
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      parts.push({ value, weak });
    }
  }
  return parts;
}

export function parseRange(
  header: string,
  size: number,
): ByteRange | "unsatisfiable" | "multiple" | null {
  const trimmed = header.trim();
  if (trimmed === "") return null;
  const match = /^bytes=(.+)$/i.exec(trimmed);
  if (!match) return null;
  const spec = match[1];
  if (spec.includes(",")) return "multiple";
  const single = spec.trim();
  const suffix = /^(\d+)$/.exec(single);
  if (suffix) {
    const length = Number(suffix[1]);
    if (length === 0) return "unsatisfiable";
    const first = Math.max(0, size - length);
    if (size === 0) return "unsatisfiable";
    return { first, last: size - 1 };
  }
  const range = /^(\d+)-(\d*)$/.exec(single);
  if (!range) return null;
  const first = Number(range[1]);
  if (first >= size) return "unsatisfiable";
  if (range[2] === "") {
    return { first, last: size - 1 };
  }
  const last = Number(range[2]);
  if (last < first) return null;
  return { first, last: Math.min(last, size - 1) };
}
