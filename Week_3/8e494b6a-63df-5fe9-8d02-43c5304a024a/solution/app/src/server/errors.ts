// Every API error leaves the server through ApiError and the one body shape.
interface ErrorBody {
  error: string;
  message: string;
  position?: number;
  fields?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: { position?: number; fields?: Record<string, string>; retryAfter?: number } = {},
  ) {
    super(message);
  }

  body(): ErrorBody {
    const body: ErrorBody = { error: this.code, message: this.message };
    if (this.extra.position !== undefined) body.position = this.extra.position;
    if (this.extra.fields) body.fields = this.extra.fields;
    return body;
  }
}

export const errors = {
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in to continue."),
  badCredentials: () => new ApiError(401, "bad_credentials", "Username or password is wrong."),
  keyInvalid: () => new ApiError(401, "key_invalid", "This API key isn't valid."),
  keyExpired: () => new ApiError(401, "key_expired", "This API key has expired."),
  keyRevoked: () => new ApiError(401, "key_revoked", "This API key was revoked."),
  forbidden: () => new ApiError(403, "forbidden", "Your role in this space can't do this."),
  keyScope: (action: string, stream: string) => new ApiError(403, "key_scope", `This key can't ${action} stream ${stream}.`),
  notFound: () => new ApiError(404, "not_found", "Not found."),
  nameTaken: (fields?: Record<string, string>) => new ApiError(409, "name_taken", "That name is already used.", { fields }),
  mappingExists: (field: string, generation: number) =>
    new ApiError(409, "mapping_exists", `Field ${field} already has a type in generation ${generation}.`),
  generationReadOnly: (generation: number, phase: string) =>
    new ApiError(409, "generation_read_only", `Generation ${generation} is ${phase} and read-only.`),
  caseFlow: (from: string, to: string) => new ApiError(409, "case_flow", `A case can't go from ${from} to ${to}.`),
  snapshotExpired: () =>
    new ApiError(410, "snapshot_expired", "This snapshot expired. Results may have changed. Start a new search."),
  bodyTooLarge: (limit: number) => new ApiError(413, "body_too_large", `Request body is larger than ${limit} bytes.`),
  uploadTooLarge: (limit: number) => new ApiError(413, "upload_too_large", `Upload is larger than ${limit} bytes.`),
  uploadKind: () => new ApiError(415, "upload_kind", "Only .ndjson files can be uploaded."),
  queryTooLong: (limit: number) => new ApiError(422, "query_too_long", `Query is longer than ${limit} characters.`),
  resultWindow: (window: number) => new ApiError(422, "result_window", `Results past ${window} need a snapshot.`),
  invalid: (fields: Record<string, string>) => new ApiError(422, "invalid", "Check the highlighted fields.", { fields }),
  fieldConflict: (sentence: string) => new ApiError(422, "field_conflict", sentence),
  querySyntax: (sentence: string, position: number) => new ApiError(422, "query_syntax", sentence, { position }),
  pipeSyntax: (sentence: string, position?: number) => new ApiError(422, "pipe_syntax", sentence, { position }),
  unknownPipeline: (name: string) => new ApiError(422, "unknown_pipeline", `Pipeline ${name} doesn't exist.`),
  traceInvalid: (sentence: string) => new ApiError(422, "trace_invalid", sentence),
  rateLimited: (seconds: number) =>
    new ApiError(429, "rate_limited", `Too many requests. Try again in ${seconds} seconds.`, { retryAfter: seconds }),
  storageUnavailable: () => new ApiError(503, "storage_unavailable", "Storage is unavailable. Nothing was stored."),
  databaseUnavailable: () => new ApiError(503, "database_unavailable", "The event store is unavailable. Try again shortly."),
};
