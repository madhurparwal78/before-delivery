export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(JSON.stringify(body));
    this.status = status;
    this.body = body;
  }
}

export function notFound(): ApiError {
  return new ApiError(404, { error: 'Not found' });
}

export function unauthorized(): ApiError {
  return new ApiError(401, { error: 'Authentication required' });
}

export function forbidden(message: string): ApiError {
  return new ApiError(403, { error: message });
}

export function conflict(message: string): ApiError {
  return new ApiError(409, { error: message });
}

export function staleHead(currentHead: string): ApiError {
  return new ApiError(409, { error: 'Stale head', current_head: currentHead });
}

export function invalid(field: string, message: string): ApiError {
  return new ApiError(422, { errors: { [field]: message } });
}

export function invalidFields(errors: Record<string, string>): ApiError {
  return new ApiError(422, { errors });
}

export function tooLarge(limit: number): ApiError {
  return new ApiError(413, { error: `Request body exceeds ${limit} bytes` });
}

export function unavailable(message: string): ApiError {
  return new ApiError(503, { error: message });
}
