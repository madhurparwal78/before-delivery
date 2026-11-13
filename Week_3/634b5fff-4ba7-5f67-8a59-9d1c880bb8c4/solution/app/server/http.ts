import multipart from "@fastify/multipart";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ERRORS, type ErrorCode } from "../shared/copy.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody: Buffer | null;
  }
}

interface FailOptions {
  number?: number;
  message?: string;
  extra?: Record<string, unknown>;
  headers?: Record<string, string>;
  fields?: Record<string, string>;
}

/** A NUL byte names nothing and no text column can hold one: it stops at the boundary, in the address or in JSON. */
const NUL_IN_JSON = "\\u0000";

export class ApiError extends Error {
  constructor(readonly code: ErrorCode, readonly options: FailOptions = {}) {
    super(code);
  }
}

export function fail(code: ErrorCode, options: FailOptions = {}): never {
  throw new ApiError(code, options);
}

/** The one place that builds an error body in the published shape. */
export const errorBody = (code: ErrorCode, options: FailOptions = {}): Record<string, unknown> => ({
  error: { code, message: options.message ?? ERRORS[code].message(options.number), ...(options.fields ? { fields: options.fields } : {}) },
  ...(options.extra ?? {}),
});

const sendError = (reply: FastifyReply, error: ApiError): FastifyReply =>
  reply.code(ERRORS[error.code].status).headers(error.options.headers ?? {}).send(errorBody(error.code, error.options));

export const statusOf = (code: ErrorCode): number => ERRORS[code].status;

const JSON_LIMIT = 64000;
const ART_MULTIPART_LIMIT = 5100000;

const isForeignOrigin = (request: FastifyRequest): boolean => {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.headers.host;
  } catch {
    return true;
  }
};

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({
    bodyLimit: JSON_LIMIT,
    routerOptions: { ignoreTrailingSlash: true },
    frameworkErrors: (_error, _request, reply) => sendError(reply, new ApiError("not_found")),
  });
  app.decorateRequest("rawBody", null);
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: JSON_LIMIT }, (request, body, done) => {
    const raw = body as Buffer;
    request.rawBody = raw;
    if (raw.length === 0) return done(null, undefined);
    if (raw.includes(NUL_IN_JSON)) return done(new ApiError("validation_failed"));
    try {
      done(null, JSON.parse(raw.toString("utf8")));
    } catch {
      done(new ApiError("validation_failed"));
    }
  });
  await app.register(multipart, { limits: { fileSize: ART_MULTIPART_LIMIT, files: 1, fields: 4 } });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    if (request.url.includes("%00")) fail("not_found");
  });
  app.addHook("preHandler", async (request) => {
    if (MUTATING.has(request.method) && !request.url.startsWith("/api/gateway/callbacks") && isForeignOrigin(request))
      fail("origin_refused");
  });

  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    if (error instanceof ApiError) return sendError(reply, error);
    if (error.code === "FST_REQ_FILE_TOO_LARGE") return sendError(reply, new ApiError("art_too_large"));
    if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE")
      return sendError(reply, new ApiError(request.url.startsWith("/api/staff/plates/") ? "art_too_large" : "body_too_large"));
    if (error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") return sendError(reply, new ApiError("unsupported_media_type"));
    if (error.code === "FST_ERR_NOT_FOUND") return sendError(reply, new ApiError("not_found"));
    if (error.code === "FST_INVALID_MULTIPART_CONTENT_TYPE") return sendError(reply, new ApiError("unsupported_media_type"));
    if (error.statusCode && error.statusCode < 500) return sendError(reply, new ApiError("validation_failed"));
    request.log.error(error);
    return sendError(reply, new ApiError("internal_error"));
  });
  app.setNotFoundHandler((_request, reply) => sendError(reply, new ApiError("not_found")));
  return app;
};
