import type { IncomingMessage } from "node:http";
import { payloadTooLarge } from "./errors.js";

export function declaredLength(req: IncomingMessage): number {
  const declared = Number(req.headers["content-length"] ?? 0);
  return Number.isFinite(declared) ? declared : 0;
}

// The whole request body, refused as soon as it passes the limit.
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  if (declaredLength(req) > limit) throw payloadTooLarge();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > limit) throw payloadTooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
