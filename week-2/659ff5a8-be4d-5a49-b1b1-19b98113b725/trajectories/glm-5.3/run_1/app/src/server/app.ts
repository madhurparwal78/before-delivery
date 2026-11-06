import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyError } from "fastify";
import type { AppConfig } from "./config.js";
import type { Db } from "./db.js";
import { ApiError, errCrossOrigin, errPayloadTooLarge, errUnsupportedMedia, sendError } from "./errors.js";
import { loadUser, SESSION_COOKIE, type AppUser } from "./session.js";

const MAX_BODY_BYTES = 65_536;

/** Server boundary: same-origin, content type, size limits, and the one error shape. */
export function buildApp(db: Db, _config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: MAX_BODY_BYTES + 1, // reject at the boundary ourselves for the 413 shape
  });

  // A JSON content type with an empty body (as on a bodyless DELETE) is an
  // empty object, not a parse error.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    const text = String(body);
    if (text.trim().length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch {
      done(errUnsupportedMedia() as unknown as Error, undefined);
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    void reply;
    // 1. Cross-origin: checked before the session, per published precedence.
    if (isStateChanging(request.method) && originDiffers(request)) {
      throw errCrossOrigin();
    }
    // 2. Content type, then size.
    if (hasBody(request) && isApiRequest(request)) {
      const contentType = String(request.headers["content-type"] ?? "");
      const mime = contentType.split(";")[0].trim().toLowerCase();
      if (mime !== "application/json") throw errUnsupportedMedia();
      const length = Number(request.headers["content-length"] ?? "0");
      if (length > MAX_BODY_BYTES) throw errPayloadTooLarge();
    }

    // Session loading for every request.
    const token = readSessionCookie(request.headers.cookie);
    request.user = token ? await loadUser(db, token) : null;
  });

  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    if (error instanceof ApiError) {
      sendError(reply, error);
      return;
    }
    const fastifyError = error as FastifyError;
    if (fastifyError.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" || fastifyError.code === "FST_ERR_CTP_EMPTY_JSON_BODY") {
      sendError(reply, errUnsupportedMedia());
      return;
    }
    if (fastifyError.code === "FST_ERR_CTP_BODY_TOO_LARGE" || fastifyError.code === "FST_ERR_BODY_LIMIT") {
      sendError(reply, errPayloadTooLarge());
      return;
    }
    if (fastifyError.code === "FST_ERR_NOT_FOUND" && request.url.startsWith("/api")) {
      sendError(reply, new ApiError(404, "not_found", "Not found."));
      return;
    }
    request.log.error?.(error);
    reply.status(500).send({ error: "internal", message: "Something went wrong." });
  });

  return app;
}

export function isStateChanging(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

export function originDiffers(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return false;
  const host = request.headers.host ?? "";
  const appOrigin = `http://${host}`;
  return origin !== appOrigin;
}

export function hasBody(request: FastifyRequest): boolean {
  const length = Number(request.headers["content-length"] ?? "0");
  return length > 0;
}

export function isApiRequest(request: FastifyRequest): boolean {
  return request.url.startsWith("/api/");
}

export function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.header("set-cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header("set-cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export function jsonError(status: number, code: string, message: string): ApiError {
  return new ApiError(status, code, message);
}

export type { AppUser };
