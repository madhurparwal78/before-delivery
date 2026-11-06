/** One error shape for the whole API: `{"error":"<code>"}` or `422 {"errors":{"<field>":"<message>"}}`. */

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly body: { error: string } | { errors: Record<string, string> }) {
    super(JSON.stringify(body));
  }
}

export const fail = (status: number, error: string): HttpError => new HttpError(status, { error });
export const notFound = (): HttpError => fail(404, 'not_found');
export const invalid = (errors: Record<string, string>): HttpError => new HttpError(422, { errors });

/** The field messages a validator would answer with, or none when the check passes. */
export function errorsOf(check: () => void): Record<string, string> {
  try {
    check();
    return {};
  } catch (error) {
    if (error instanceof HttpError && 'errors' in error.body) return error.body.errors;
    throw error;
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function logError(error: unknown): void {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
}
