/** The one published error shape: every refusal is an ApiError, written only by `sendError` in http.ts. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors?: Record<string, string>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const STORE_DOWN = 'Could not reach the table';

export function validationFailed(errors: Record<string, string>): ApiError {
  return new ApiError(422, 'validation_failed', 'Check these fields', errors);
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found', 'Nothing here.');
}

export function tierLocked(minLevel: number): ApiError {
  return new ApiError(403, 'level_locked', `Reach level ${minLevel}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids arrive in URLs: a malformed one is simply a resource that does not exist. */
export function assertUuid(id: string): void {
  if (!UUID.test(id)) throw notFound();
}

export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown }).code === '23505';
}
