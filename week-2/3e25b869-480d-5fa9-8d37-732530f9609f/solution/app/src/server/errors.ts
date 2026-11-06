// The single API error shape: {"error": {"code", "message"[, "fields"]}}.
import type { Messages } from '../shared/copy.js';

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
    if (!this.fields) return { error: { code: this.code, message: this.message } };
    const sorted = Object.fromEntries(Object.entries(this.fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return { error: { code: this.code, message: this.message, fields: sorted } };
  }
}

export const invalid = (m: Messages, fields: Record<string, string>) => new ApiError(422, 'invalid', m.checkFields, fields);
export const notFound = (m: Messages) => new ApiError(404, 'not_found', m.notFoundApi);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
