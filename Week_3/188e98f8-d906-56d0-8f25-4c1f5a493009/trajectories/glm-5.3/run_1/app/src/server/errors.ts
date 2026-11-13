export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "HttpError";
  }
}

export function signedOut(): HttpError {
  return new HttpError(401, "signed_out");
}

export function badCode(): HttpError {
  return new HttpError(401, "bad_code");
}

export function forbidden(): HttpError {
  return new HttpError(403, "forbidden");
}

export function notFound(): HttpError {
  return new HttpError(404, "not_found");
}

export function methodNotAllowed(allow: string[]): HttpError {
  const error = new HttpError(405, "method_not_allowed", {});
  (error as unknown as { allow: string[] }).allow = allow;
  return error;
}

export function conflict(
  code: string,
  extra: Record<string, unknown> = {},
): HttpError {
  return new HttpError(409, code, extra);
}

export function unprocessable(fields: Record<string, string>): HttpError {
  return new HttpError(422, "invalid", { fields });
}

export function tooLarge(): HttpError {
  return new HttpError(413, "too_large");
}

export function unsupportedType(): HttpError {
  return new HttpError(415, "unsupported_media_type");
}

export function badJson(): HttpError {
  return new HttpError(400, "bad_json");
}

export function tooManySubmits(retryAfter: number): HttpError {
  return new HttpError(429, "too_many_submits", { retry_after: retryAfter });
}

export function providerUnavailable(code: string): HttpError {
  return new HttpError(503, code);
}

export function errorBody(error: HttpError): Record<string, unknown> {
  const body: Record<string, unknown> = { error: error.code };
  if (error.status === 422 && Object.keys(error.extra["fields"] ?? {}).length > 0) {
    body["fields"] = error.extra["fields"];
  }
  if (error.status === 429) {
    body["retry_after"] = error.extra["retry_after"];
  }
  if (error.extra["count"] !== undefined) {
    body["count"] = error.extra["count"];
  }
  return body;
}
