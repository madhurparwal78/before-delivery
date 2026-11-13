/** RFC 9110 conditional and single byte-range evaluation for download routes. */

import { preconditionFailed, rangeNotSatisfiable } from "../errors.js";
import { header, sendError, type Context } from "./context.js";

export type Representation = {
  bytes: Buffer;
  etag: string;
  contentType: string;
  disposition: string;
  reprDigest?: string;
  extraHeaders?: Record<string, string>;
};

function etagList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function weakMatch(candidate: string, etag: string): boolean {
  const strip = (value: string): string => (value.startsWith("W/") ? value.slice(2) : value);
  return strip(candidate) === strip(etag);
}

type RangeRequest = { first: number; last: number } | "invalid" | "multiple" | null;

function parseRange(value: string | null, size: number): RangeRequest {
  if (value === null) {
    return null;
  }
  const match = /^bytes=(.+)$/.exec(value.trim());
  if (!match) {
    return "invalid";
  }
  const parts = match[1].split(",").map((part) => part.trim());
  if (parts.length > 1) {
    return "multiple";
  }
  const spec = parts[0];
  const suffix = /^-(\d+)$/.exec(spec);
  if (suffix) {
    const length = Number(suffix[1]);
    if (length === 0) {
      return "invalid";
    }
    const first = Math.max(0, size - length);
    return { first, last: size - 1 };
  }
  const explicit = /^(\d+)-(\d*)$/.exec(spec);
  if (!explicit) {
    return "invalid";
  }
  const first = Number(explicit[1]);
  const last = explicit[2] === "" ? size - 1 : Math.min(Number(explicit[2]), size - 1);
  if (first > last) {
    return { first, last: -1 };
  }
  return { first, last };
}

export function sendRepresentation(context: Context, representation: Representation): void {
  const { bytes, etag } = representation;
  const size = bytes.length;
  const baseHeaders: Record<string, string> = {
    ...context.extraHeaders,
    "content-type": representation.contentType,
    "accept-ranges": "bytes",
    etag,
    "content-disposition": representation.disposition,
    ...(representation.reprDigest ? { "repr-digest": representation.reprDigest } : {}),
    ...(representation.extraHeaders ?? {}),
  };

  const ifMatch = header(context, "if-match");
  if (ifMatch !== null) {
    const matches = etagList(ifMatch).some(
      (candidate) => candidate === "*" || candidate === etag,
    );
    if (!matches) {
      sendError(context, preconditionFailed());
      return;
    }
  }

  const ifNoneMatch = header(context, "if-none-match");
  if (ifNoneMatch !== null) {
    const matches = etagList(ifNoneMatch).some(
      (candidate) => candidate === "*" || weakMatch(candidate, etag),
    );
    if (matches) {
      context.response.writeHead(304, {
        ...context.extraHeaders,
        etag,
        ...(representation.extraHeaders ?? {}),
      });
      context.response.end();
      return;
    }
  }

  const rangeHeader = header(context, "range");
  const ifRange = header(context, "if-range");
  const ignoreRange = ifRange !== null && rangeHeader !== null && ifRange.trim() !== etag;
  const range = ignoreRange ? null : parseRange(rangeHeader, size);

  if (range && range !== "invalid" && range !== "multiple") {
    if (range.last < range.first || range.first >= size) {
      sendError(context, rangeNotSatisfiable(size));
      return;
    }
    const slice = bytes.subarray(range.first, range.last + 1);
    context.response.writeHead(206, {
      ...baseHeaders,
      "content-length": slice.length,
      "content-range": `bytes ${range.first}-${range.last}/${size}`,
    });
    context.response.end(context.method === "HEAD" ? undefined : slice);
    return;
  }

  context.response.writeHead(200, { ...baseHeaders, "content-length": size });
  context.response.end(context.method === "HEAD" ? undefined : bytes);
}
