import type { IncomingMessage, ServerResponse } from "node:http";
import { BODY_LIMIT_BYTES } from "./config";

export interface Reply {
  readonly status: number;
  /** JSON text already serialised, so a stored first response can be replayed byte for byte. */
  readonly body: string | null;
  readonly headers?: Readonly<Record<string, string>>;
}

export function json(status: number, value: unknown, headers?: Record<string, string>): Reply {
  return { status, body: JSON.stringify(value), headers };
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}): Reply {
  return json(status, { error, ...extra });
}

export const noContent: Reply = { status: 204, body: null };

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...reply.headers };
  if (reply.body !== null) headers["Content-Type"] = "application/json; charset=utf-8";
  res.writeHead(reply.status, headers);
  res.end(reply.body ?? undefined);
}

export interface JsonBody {
  readonly raw: Buffer;
  readonly value: unknown;
}

export function isReply(value: JsonBody | Reply | null): value is Reply {
  return value !== null && "status" in value;
}

/** A refusal that leaves the body unread or discarded: the connection closes after it so the next request starts clean. */
function refuseAndClose(status: number, error: string, extra: Record<string, unknown> = {}): Reply {
  return json(status, { error, ...extra }, { Connection: "close" });
}

/** Reads a JSON body: 415 for another content type, 413 above the limit, 400 for text that is not JSON. A request without a body yields null. */
export async function readJson(req: IncomingMessage): Promise<JsonBody | Reply | null> {
  const length = Number(req.headers["content-length"] ?? "0");
  const chunked = req.headers["transfer-encoding"] !== undefined;
  if (!chunked && length === 0) return null;
  const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") return refuseAndClose(415, "unsupported_media_type");
  const chunks: Buffer[] = [];
  let size = 0;
  // Read to the end even above the limit (discarding the bytes): leaving the loop early destroys the socket and stalls the next request on a kept-alive connection.
  for await (const chunk of req) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size <= BODY_LIMIT_BYTES) chunks.push(piece);
  }
  if (size > BODY_LIMIT_BYTES) return refuseAndClose(413, "body_too_large", { limit: BODY_LIMIT_BYTES });
  const raw = Buffer.concat(chunks);
  try {
    return { raw, value: JSON.parse(raw.toString("utf8")) as unknown };
  } catch {
    return fail(400, "invalid_json");
  }
}

export function cookieValue(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
