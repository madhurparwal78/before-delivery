// The server boundary: the cross-site write check and the body size and type limits.

import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { Refusal } from "./errors.ts";

const JSON_LIMIT_BYTES = 65_536;
const EXHIBIT_LIMIT_BYTES = 10_000_000;

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** One request header by name, in whatever case the caller writes it. */
export function headerValue(request: { headers: IncomingHttpHeaders }, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/** Cross-site writes are refused before any body, authentication or state check. */
export function refuseCrossSiteWrite(method: string, headers: IncomingHttpHeaders): void {
  if (!WRITE_METHODS.has(method)) return;
  const origin = headerValue({ headers }, "Origin");
  if (origin !== undefined) {
    if (origin === "null") throw new Refusal("cross_origin");
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new Refusal("cross_origin");
    }
    if (originHost !== headerValue({ headers }, "Host")) throw new Refusal("cross_origin");
    return;
  }
  const site = headerValue({ headers }, "Sec-Fetch-Site");
  if (site === "cross-site" || site === "same-site") throw new Refusal("cross_origin");
}

type BodyKind = "json" | "pdf";

function contentTypeOf(headers: IncomingHttpHeaders): string {
  return (headerValue({ headers }, "Content-Type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

const DISCARD_CEILING_BYTES = 64_000_000;

function collect(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total <= limit) chunks.push(chunk);
      else if (total > DISCARD_CEILING_BYTES) request.destroy();
    });
    request.on("end", () => resolve(total > limit ? null : Buffer.concat(chunks)));
    request.on("error", reject);
    request.on("close", () => resolve(total > limit ? null : Buffer.concat(chunks)));
  });
}

/** Rejects a wrong media type, then reads at most the kind's limit; a larger body is 413. */
export async function readBody(request: IncomingMessage, kind: BodyKind): Promise<Buffer> {
  const expected = kind === "json" ? "application/json" : "application/pdf";
  if (contentTypeOf(request.headers) !== expected) throw new Refusal("unsupported_media_type");
  const body = await collect(request, kind === "json" ? JSON_LIMIT_BYTES : EXHIBIT_LIMIT_BYTES);
  if (body === null) throw new Refusal("payload_too_large");
  return body;
}

export function parseJsonObject(raw: Buffer): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Refusal("invalid_json");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Refusal("invalid_json");
  return Object.fromEntries(Object.entries(parsed));
}
