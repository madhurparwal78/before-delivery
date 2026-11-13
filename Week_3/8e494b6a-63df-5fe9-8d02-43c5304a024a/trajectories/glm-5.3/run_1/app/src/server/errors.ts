import type { NextFunction, Request, Response } from "express";
import { secondsToNextMinute } from "./clock";

/**
 * The one published error shape and the one ordering point for every API error.
 */
export interface ErrorOptions {
  position?: number | undefined;
  fields?: Record<string, string> | undefined;
}

export class ApiError extends Error {
  override readonly name = "ApiError";
  readonly status: number;
  readonly code: string;
  override readonly message: string;
  readonly options: ErrorOptions | undefined;
  constructor(status: number, code: string, message: string, options?: ErrorOptions) {
    super(message);
    this.status = status;
    this.code = code;
    this.message = message;
    this.options = options;
  }
}

export function errorBody(e: ApiError): Record<string, unknown> {
  const body: Record<string, unknown> = { error: e.code, message: e.message };
  if (e.options?.position !== undefined) body.position = e.options.position;
  if (e.options?.fields !== undefined) body.fields = e.options.fields;
  return body;
}

export function throwApi(
  status: number,
  code: string,
  message: string,
  options?: { position?: number; fields?: Record<string, string> },
): never {
  throw new ApiError(status, code, message, options);
}

export const errors = {
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in to continue."),
  badCredentials: () => new ApiError(401, "bad_credentials", "Username or password is wrong."),
  keyInvalid: () => new ApiError(401, "key_invalid", "This API key isn't valid."),
  keyExpired: () => new ApiError(401, "key_expired", "This API key has expired."),
  keyRevoked: () => new ApiError(401, "key_revoked", "This API key was revoked."),
  forbidden: () => new ApiError(403, "forbidden", "Your role in this space can't do this."),
  keyScope: (message: string) => new ApiError(403, "key_scope", message),
  notFound: () => new ApiError(404, "not_found", "Not found."),
  nameTaken: (field?: string, fieldMessage?: string) =>
    new ApiError(409, "name_taken", "That name is already used.", {
      fields: field !== undefined ? { [field]: fieldMessage ?? "That name is already used." } : undefined,
    }),
  mappingExists: (field: string, g: number) =>
    new ApiError(409, "mapping_exists", `Field ${field} already has a type in generation ${g}.`),
  generationReadOnly: (g: number, phase: string) =>
    new ApiError(409, "generation_read_only", `Generation ${g} is ${phase} and read-only.`),
  caseFlow: (from: string, to: string) =>
    new ApiError(409, "case_flow", `A case can't go from ${from} to ${to}.`),
  snapshotExpired: () =>
    new ApiError(410, "snapshot_expired", "This snapshot expired. Results may have changed. Start a new search."),
  bodyTooLarge: () => new ApiError(413, "body_too_large", "Request body is larger than 1000000 bytes."),
  uploadTooLarge: (max: number) =>
    new ApiError(413, "upload_too_large", `Upload is larger than ${max} bytes.`),
  uploadKind: () => new ApiError(415, "upload_kind", "Only .ndjson files can be uploaded."),
  invalid: (fields: Record<string, string>) =>
    new ApiError(422, "invalid", "Check the highlighted fields.", { fields }),
  queryTooLong: (max: number) => new ApiError(422, "query_too_long", `Query is longer than ${max} characters.`),
  queryTooDeep: (max: number) => new ApiError(422, "query_too_deep", `Query nests deeper than ${max} levels.`),
  queryWorkLimit: (max: number) =>
    new ApiError(422, "query_work_limit", `Query stopped: work limit of ${max} reached.`),
  queryTimeBudget: (max: number) =>
    new ApiError(422, "query_time_budget", `Query stopped: time budget of ${max} ms reached.`),
  querySyntax: (message: string, position: number) =>
    new ApiError(422, "query_syntax", message, { position }),
  resultWindow: (max: number) => new ApiError(422, "result_window", `Results past ${max} need a snapshot.`),
  fieldConflict: (sentence: string) => new ApiError(422, "field_conflict", sentence),
  pipeSyntax: (message: string, position?: number) =>
    position !== undefined
      ? new ApiError(422, "pipe_syntax", message, { position })
      : new ApiError(422, "pipe_syntax", message),
  unknownPipeline: (name: string) => new ApiError(422, "unknown_pipeline", `Pipeline ${name} doesn't exist.`),
  traceInvalid: (message: string) => new ApiError(422, "trace_invalid", message),
  rateLimited: (seconds: number) =>
    new ApiError(429, "rate_limited", `Too many requests. Try again in ${seconds} seconds.`),
  storageUnavailable: () => new ApiError(503, "storage_unavailable", "Storage is unavailable. Nothing was stored."),
  databaseUnavailable: () =>
    new ApiError(503, "database_unavailable", "The event store is unavailable. Try again shortly."),
};

export function apiErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof ApiError) {
    if (err.status === 429) {
      res.setHeader("Retry-After", String(secondsToNextMinute()));
    }
    res.status(err.status).json(errorBody(err));
    return;
  }
  if (err instanceof SyntaxError && "body" in (err as object)) {
    res.status(400).json({ error: "invalid", message: "Check the highlighted fields." });
    return;
  }
  next(err);
}
