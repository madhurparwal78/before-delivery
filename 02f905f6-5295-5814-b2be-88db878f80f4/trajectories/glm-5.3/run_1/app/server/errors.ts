import type { Request, Response, NextFunction } from "express";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public extra?: Record<string, unknown>
  ) {
    super(message);
  }
}

export function errorBody(err: AppError): Record<string, unknown> {
  const body: Record<string, unknown> = { error: err.code, message: err.message };
  if (err.fields) body.fields = err.fields;
  if (err.extra) Object.assign(body, err.extra);
  return body;
}

export function sendError(res: Response, err: AppError): void {
  res.status(err.status).json(errorBody(err));
}

export const unauthenticated = (): AppError => new AppError(401, "unauthenticated", "Sign in first.");
export const forbidden = (): AppError => new AppError(403, "forbidden", "Your role can't do that.");
export const notFound = (): AppError => new AppError(404, "not_found", "Not found.");
export const methodNotAllowed = (): AppError => new AppError(405, "method_not_allowed", "Method not allowed.");
export const crossOrigin = (): AppError => new AppError(403, "cross_origin", "Cross-origin request refused.");
export const tooLarge = (): AppError => new AppError(413, "too_large", "Body too large.");
export const unsupportedType = (): AppError => new AppError(415, "unsupported_type", "Unsupported content type.");

export function validationError(fields: Record<string, string>): AppError {
  return new AppError(422, "validation_failed", "Check these fields", fields);
}

export function conflict(code: string, message: string, extra?: Record<string, unknown>): AppError {
  return new AppError(409, code, message, undefined, extra);
}

export function serviceUnavailable(code: string, message: string, extra?: Record<string, unknown>): AppError {
  return new AppError(503, code, message, undefined, extra);
}

export function fieldError(key: string, message: string): AppError {
  return validationError({ [key]: message });
}

// Error precedence: this is the single place errors map to a response.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    sendError(res, err);
    return;
  }
  if (err instanceof Error) {
    res.status(500).json({ error: "internal", message: "Something went wrong." });
    return;
  }
  res.status(500).json({ error: "internal", message: "Something went wrong." });
}
