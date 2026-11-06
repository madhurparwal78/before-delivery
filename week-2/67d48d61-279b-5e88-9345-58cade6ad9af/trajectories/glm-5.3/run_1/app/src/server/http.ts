import type { IncomingMessage, ServerResponse } from "node:http";
import { RuleError } from "./engine.js";

/** The one error shape and the one precedence order (DP-48). */
export function errorBody(code: string, message: string, extra: Record<string, unknown> = {}): string {
  const error: Record<string, unknown> = { code, message };
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined) error[k] = v;
  }
  return JSON.stringify({ error });
}

export function sendError(res: ServerResponse, status: number, code: string, message: string, extra: Record<string, unknown> = {}): void {
  const body = errorBody(code, message, extra);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const s = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(s),
    ...headers,
  });
  res.end(s);
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        // pause so the 413 response can be delivered before the socket closes
        req.pause();
        reject(new PayloadTooLarge());
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export class PayloadTooLarge extends Error {}

export async function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const buf = await readBody(req, limit);
  if (buf.length === 0) return {};
  try { return JSON.parse(buf.toString("utf8")) } catch { throw new RuleError("malformed_json", 400, {}) }
}
