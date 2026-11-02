/** Every error the API answers, in the one published shape. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }

  body(): { error: { code: string; message: string; fields?: Record<string, string> } } {
    const error: { code: string; message: string; fields?: Record<string, string> } = {
      code: this.code,
      message: this.message,
    };
    if (this.fields) error.fields = this.fields;
    return { error };
  }
}

export const unauthenticated = () => new ApiError(401, "unauthenticated", "Sign in to continue.");
export const forbidden = () => new ApiError(403, "forbidden", "You don't have permission to do that.");
export const notFound = () => new ApiError(404, "not_found", "Not found.");
export const methodNotAllowed = () => new ApiError(405, "method_not_allowed", "This action isn't allowed.");
export const payloadTooLarge = () => new ApiError(413, "payload_too_large", "Request body is too large.");
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const internalError = () => new ApiError(500, "internal", "Something went wrong. Try again.");
export const evidenceUnavailable = () =>
  new ApiError(503, "evidence_unavailable", "Evidence storage is unreachable. The asset stays in draft; try again shortly.");

/**
 * The published error precedence (API: Error precedence), decided here and nowhere else. Every
 * request names its checks by the rule they enforce and `inPrecedence` runs them in this order, so
 * the first rule that fails answers and a refused request changes nothing. The router supplies
 * `size` and `session`, `idempotent` supplies `replay`, `commitWrite` repeats `session` and
 * `permission` at commit, and each route supplies the rest. A `dependency` failure (503) can only
 * come from the work itself, which runs after every check has passed.
 */
const PRECEDENCE = ["size", "session", "replay", "existence", "permission", "state", "validation", "dependency"] as const;

export type Rule = (typeof PRECEDENCE)[number];

/**
 * A request's checks, keyed by the rule each enforces. A check refuses by throwing its ApiError; the
 * replay check may instead answer by returning the stored reply, which ends the run.
 */
export type Checks<T = never> = { readonly [R in Rule]?: () => T | void | Promise<T | void> };

export async function inPrecedence<T = never>(checks: Checks<T>): Promise<T | undefined> {
  for (const rule of PRECEDENCE) {
    const answer = await checks[rule]?.();
    if (answer !== undefined) return answer as T;
  }
  return undefined;
}

/** 422 with one message per invalid field. */
export function invalid(fields: Record<string, string>, message = "Check the highlighted fields."): ApiError {
  return new ApiError(422, "validation", message, fields);
}

/** Collects field errors and throws them together. */
export class FieldErrors {
  readonly fields: Record<string, string> = {};
  add(field: string, message: string): void {
    if (!(field in this.fields)) this.fields[field] = message;
  }
  throwIfAny(): void {
    if (Object.keys(this.fields).length) throw invalid(this.fields);
  }
}
