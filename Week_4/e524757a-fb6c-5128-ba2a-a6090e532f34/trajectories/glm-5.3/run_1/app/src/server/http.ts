// One error shape, one catalogue, one order of checks for the whole API.

import { ServerResponse, IncomingMessage } from "http";
import { ErrorCode, errorBody, errorStatus } from "../shared/errors";

export class ApiError extends Error {
  constructor(readonly code: ErrorCode, readonly params?: Record<string, string | number>, readonly headers?: Record<string, string>) {
    super(code);
  }
  get status(): number {
    return errorStatus(this.code);
  }
  get body(): { error: string; message: string } {
    return errorBody(this.code, this.params);
  }
}

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(text);
}

export function fail(res: ServerResponse, err: ApiError): void {
  const headers: Record<string, string> = { ...err.headers };
  json(res, err.status, err.body, headers);
}

export async function readJson(req: IncomingMessage, limitBytes: number): Promise<Record<string, unknown>> {
  const buf = await readBody(req, limitBytes + 1);
  if (buf.length > limitBytes) throw new ApiError("too_large");
  if (buf.length === 0) return {};
  try {
    const parsed = JSON.parse(buf.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new ApiError("bad_request");
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError("bad_request");
  }
}

export function readBody(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > limitBytes) {
        reject(new ApiError("too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => reject(new ApiError("bad_request")));
  });
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : NaN;
}
