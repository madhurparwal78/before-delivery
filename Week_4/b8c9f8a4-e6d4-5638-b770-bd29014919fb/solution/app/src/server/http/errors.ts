// One refusal shape for the whole API.

interface Refusal {
  error: string;
  message: string;
  [extra: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: Refusal;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = { error: code, message, ...extra };
  }
}

export function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new ApiError(status, code, message, extra);
}

export function invalid(errors: Record<string, string>): never {
  throw new ApiError(422, 'validation', 'Some fields need attention.', { errors });
}

