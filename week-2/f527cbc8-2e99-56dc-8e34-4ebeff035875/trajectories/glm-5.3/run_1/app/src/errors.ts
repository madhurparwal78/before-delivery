import type { ServerResponse } from 'node:http';

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): Record<string, unknown> {
    return { error: this.code, ...this.extra };
  }
}

/** 422 validation error. */
export class ValidationError extends AppError {
  readonly errors: Record<string, string>;
  constructor(errors: Record<string, string>) {
    super(422, 'validation');
    this.errors = errors;
  }
  override body(): Record<string, unknown> {
    return { error: 'validation', errors: this.errors };
  }
}

export class ImportInvalidError extends AppError {
  readonly errors: { line: number; column: string; code: string }[];
  constructor(errors: { line: number; column: string; code: string }[]) {
    super(422, 'import_invalid');
    this.errors = errors;
  }
  override body(): Record<string, unknown> {
    return { error: 'import_invalid', errors: this.errors };
  }
}

export class IllegalTransition extends AppError {
  constructor(from: string, action: string) {
    super(409, 'illegal_transition', { from, action });
  }
}

export class StaleMarks extends AppError {
  readonly current: unknown;
  constructor(current: unknown) {
    super(412, 'stale_marks');
    this.current = current;
  }
  override body(): Record<string, unknown> {
    return { error: 'stale_marks', current: this.current };
  }
}

/** Thrown by handlers to abort the request. `handled` marks a response already sent (stream or media). */
export class Handled {
  constructor(readonly handled: true) {}
}

export function sendError(res: ServerResponse, requestId: string, err: unknown): void {
  if (err instanceof AppError) {
    res.writeHead(err.status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': requestId });
    res.end(JSON.stringify(err.body()));
  } else {
    process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'internal_error', request_id: requestId, error: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) }) + '\n');
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': requestId });
    res.end(JSON.stringify({ error: 'internal_error' }));
  }
}
