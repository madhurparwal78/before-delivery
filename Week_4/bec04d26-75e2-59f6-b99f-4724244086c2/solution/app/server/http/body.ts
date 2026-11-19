import type { MiddlewareHandler } from "hono";
import { badJson, crossOrigin, tooLarge, unsupportedMediaType } from "./errors";
import type { Env } from "./context";

const BODY_LIMIT = 100_000;
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function readLimited(request: Request): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > BODY_LIMIT) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  if (request.body) {
    for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > BODY_LIMIT) throw tooLarge();
      chunks.push(Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks);
}

/** Same origin only, then the body limits, content type and JSON syntax: all before the error order starts. */
export const boundary: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.req.path.startsWith("/api/") || !WRITES.has(c.req.method)) return next();
  const origin = c.req.header("origin");
  if (origin && URL.parse(origin)?.host !== c.req.header("host")) throw crossOrigin();
  const raw = await readLimited(c.req.raw);
  if (raw.length === 0) {
    c.set("body", undefined);
    return next();
  }
  if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) throw unsupportedMediaType();
  try {
    c.set("body", JSON.parse(raw.toString("utf8")));
  } catch {
    throw badJson();
  }
  return next();
};
