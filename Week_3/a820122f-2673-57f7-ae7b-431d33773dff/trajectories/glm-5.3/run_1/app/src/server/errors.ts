import type { Response } from "express";

/**
 * The single API error shape. Validation failures use
 * `422 {"errors":{"<field>":"<message>"}}`; every other failure is
 * `<status> {"error":"<code>","message":"<sentence>"}`.
 */
export function sendError(res: Response, status: number, code: string, message: string, extra?: Record<string, unknown>): void {
  res.status(status).json({ error: code, message, ...(extra ?? {}) });
}

export function sendValidation(res: Response, errors: Record<string, string>): void {
  res.status(422).json({ errors });
}
