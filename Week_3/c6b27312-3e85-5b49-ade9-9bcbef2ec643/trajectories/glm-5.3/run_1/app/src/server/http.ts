import type { Request, Response, NextFunction } from "express";

export interface HttpError {
  status: number;
  body: Record<string, unknown>;
}

export function httpError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): HttpError {
  return { status, body: { error: code, message, ...extra } };
}

/** The one error shape, plus extras named by the endpoint. */
export function sendError(res: Response, e: HttpError): void {
  if (res.headersSent) { res.end(); return; }
  res.status(e.status).json(e.body);
}

export const ERR = {
  unauthenticated: (): HttpError => httpError(401, "unauthenticated", "Sign in to continue."),
  notFound: (): HttpError => httpError(404, "not_found", "Not found."),
  forbidden: (): HttpError => httpError(403, "forbidden", "You can't do that on this part."),
  crossOrigin: (): HttpError => httpError(403, "cross_origin", "Requests must come from Tinework."),
  tooLarge: (limit: number): HttpError => httpError(413, "too_large", `Request body is larger than ${limit} bytes.`),
  invalid: (errors: Record<string, string>): HttpError => httpError(422, "invalid", "Check the highlighted fields.", { errors }),
  valueGrammar: (field: string, message: string): HttpError => httpError(422, "value_grammar", message, { field }),
  invalidIdempotencyKey: (): HttpError => httpError(400, "invalid_idempotency_key", "Idempotency-Key must be 1 to 255 printable characters."),
  preconditionRequired: (): HttpError => httpError(428, "precondition_required", "Send If-Match with the revision history's ETag."),
  headMoved: (headRevisionId: string, label: string, head: unknown): HttpError =>
    httpError(412, "head_moved", `This part changed since you opened it. ${label} is now the latest revision.`, { headRevisionId, head }),
  idempotencyInProgress: (): HttpError => httpError(409, "idempotency_in_progress", "A request with this Idempotency-Key is still being processed."),
  keyReused: (): HttpError => httpError(422, "key_reused", "This Idempotency-Key was already used for a different request."),
  storageDownload: (copy: string): HttpError => httpError(503, "storage_unavailable", copy, {}),
  preflightLimit: (retryAfter: number): HttpError => {
    const e = httpError(429, "preflight_limit", "Sign in to run more pre-flight reports.", {});
    (e.body as Record<string, unknown>).retryAfter = retryAfter;
    return e;
  },
};

export const STORAGE_OUTAGE_COPY = {
  download: "Downloads are paused: part storage is unreachable. Your parts are safe; try again in a few minutes.",
  save: "Saving is paused: part storage is unreachable. Your parts are safe; try again in a few minutes.",
  replay: "Replay is paused: part storage is unreachable.",
};

/** Wrap an async handler so rejections map to the one error shape. */
export function wrap(handler: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

/** Read a body up to limit bytes, answering 413 above it. */
export function readBodyBytes(req: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        reject(ERR.tooLarge(limit));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on("error", () => { if (!done) { done = true; reject(ERR.notFound()); } });
  });
}
