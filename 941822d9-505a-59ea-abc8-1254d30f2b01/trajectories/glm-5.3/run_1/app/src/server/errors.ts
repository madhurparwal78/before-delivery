import type { Request, Response } from "express";

export type BodyFields = Record<string, unknown>;

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(typeof body.error === "string" ? body.error : "error");
  }
}

export const err = (status: number, code: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(status, { error: code, ...extra });

export const validationError = (errors: Record<string, string>): ApiError => new ApiError(422, { errors });

export const notFound = (): ApiError => err(404, "not_found");
export const unauthenticated = (): ApiError => err(401, "unauthenticated");
export const forbidden = (): ApiError => err(403, "forbidden");
export const methodNotAllowed = (): ApiError => err(405, "method_not_allowed");

export function sendError(res: Response, e: ApiError): void {
  res.status(e.status).json(e.body);
}

export type Ctx = {
  req: Request;
  res: Response;
  params: Record<string, string>;
  query: URLSearchParams;
  rawBody: unknown;
};
