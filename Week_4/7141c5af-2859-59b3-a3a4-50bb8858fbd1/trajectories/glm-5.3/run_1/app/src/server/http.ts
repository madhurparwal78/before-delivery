import type { Request, Response, NextFunction } from "express";

export type ApiErrorBody = { error: { code: string; message: string; fields?: Record<string, string> } };

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  override readonly message: string;
  readonly fields?: Record<string, string>;
  readonly headers?: Record<string, string>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>, headers?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.message = message;
    this.fields = fields;
    this.headers = headers;
  }
  body(): ApiErrorBody {
    const error: ApiErrorBody["error"] = { code: this.code, message: this.message };
    if (this.fields && Object.keys(this.fields).length) error.fields = this.fields;
    return { error };
  }
}

export const err = {
  notFound: (message = "Page not found") => new HttpError(404, "notFound", message),
  unknownRoute: () => new HttpError(404, "unknownRoute", "Page not found"),
  wrongMethod: (allow: string) => new HttpError(405, "wrongMethod", "Method not allowed", undefined, { Allow: allow }),
  tooLarge: (message: string) => new HttpError(413, "tooLarge", message),
  foreignOrigin: () => new HttpError(403, "foreignOrigin", "Not allowed"),
  limited: (retryAfterSeconds: number, message: string) => new HttpError(429, "limited", message, undefined, { "Retry-After": String(Math.max(0, Math.ceil(retryAfterSeconds))) }),
  notSignedIn: () => new HttpError(401, "notSignedIn", "Sign in to keep going."),
  sessionEnded: () => new HttpError(401, "sessionEnded", "Your session ended. Sign in again to keep going — what you typed is still here."),
  wrongPair: () => new HttpError(401, "wrongPair", "That email and password do not match."),
  gone: (message: string) => new HttpError(410, "ended", message),
  wrongType: () => new HttpError(415, "wrongType", "Use JSON."),
  malformed: () => new HttpError(400, "malformed", "That request could not be read."),
  field: (fields: Record<string, string>) => new HttpError(422, "field", Object.values(fields)[0] ?? "That request could not be read.", fields),
  state: (code: string, message: string) => new HttpError(409, code, message),
  stale: (code: string, message: string) => new HttpError(412, code, message),
  unavailable: (message: string) => new HttpError(503, "unavailable", message),
};

export function sendError(res: Response, e: HttpError): void {
  res.status(e.status).set(e.headers ?? {}).json(e.body());
}

export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next);
  };
