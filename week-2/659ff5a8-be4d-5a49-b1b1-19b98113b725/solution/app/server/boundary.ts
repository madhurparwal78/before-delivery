import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env.js";
import { ApiError } from "./errors.js";

const BODY_LIMIT = 65_536;

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The app's own origin is `http://` followed by the Host header exactly as received. */
function rejectCrossOrigin(method: string, origin: string | undefined, host: string | undefined): void {
  if (STATE_CHANGING.has(method) && origin !== undefined && origin !== `http://${host}`) throw new ApiError("cross_origin");
}

async function readLimited(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_LIMIT) {
      await reader.cancel();
      throw new ApiError("payload_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A NUL byte in any key or text cannot be stored by Postgres, so a body that carries one is treated as unreadable. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw, (key, value: unknown) => {
      if (key.includes("\0") || (typeof value === "string" && value.includes("\0"))) throw new SyntaxError("NUL byte");
      return value;
    });
  } catch {
    return undefined;
  }
}

/** Precedence 1 and 2: cross origin, then media type, then size. The parsed body is kept for the handlers. */
export const boundary: MiddlewareHandler<AppEnv> = async (c, next) => {
  rejectCrossOrigin(c.req.method, c.req.header("origin"), c.req.header("host"));
  const declared = Number(c.req.header("content-length") ?? "0");
  const hasBody = STATE_CHANGING.has(c.req.method) && (declared > 0 || c.req.header("transfer-encoding") !== undefined);
  if (hasBody) {
    const mediaType = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") throw new ApiError("unsupported_media_type");
    if (declared > BODY_LIMIT) throw new ApiError("payload_too_large");
    c.set("body", parseJson(await readLimited(c.req.raw)));
  }
  await next();
};
