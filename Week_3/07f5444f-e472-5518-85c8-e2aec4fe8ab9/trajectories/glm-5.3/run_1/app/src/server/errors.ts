// The one error shape and the one error ordering.

export interface ApiErrorBody {
  error: string;
  message: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;

  constructor(status: number, error: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = { error, message, ...extra };
  }
}

export const notFound = (): ApiError =>
  new ApiError(404, "not_found", "Not found.");

export const forbidden = (): ApiError =>
  new ApiError(403, "forbidden", "You may not do that.");

export const unauthenticated = (): ApiError =>
  new ApiError(401, "unauthenticated", "Sign in first.");

export const validation = (errors: Record<string, string>): ApiError =>
  new ApiError(422, "validation", "Check the highlighted fields.", { errors });

export const conflict = (error: string, message: string, extra?: Record<string, unknown>): ApiError =>
  new ApiError(409, error, message, extra);
