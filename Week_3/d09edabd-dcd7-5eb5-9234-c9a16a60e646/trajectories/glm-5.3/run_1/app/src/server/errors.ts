import type { Response } from 'express';

/** The one published error body. Validation failures carry field messages. */
export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  extra?: Record<string, unknown>;

  constructor(status: number, code: string, fields?: Record<string, string>, extra?: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.extra = extra;
  }

  send(res: Response): void {
    const body: Record<string, unknown> = { error: this.code };
    if (this.extra) Object.assign(body, this.extra);
    if (this.fields) body.errors = this.fields;
    res.status(this.status).json(body);
  }
}

export const unauthenticated = () => new ApiError(401, 'unauthenticated');
export const notFound = () => new ApiError(404, 'not_found');
export const forbidden = () => new ApiError(403, 'forbidden');
export const tooLarge = () => new ApiError(413, 'too_large');
export const crossOrigin = () => new ApiError(403, 'cross_origin');
export const validation = (fields: Record<string, string>) => new ApiError(422, 'validation', fields);
export const oneField = (field: string, message: string) => new ApiError(422, 'validation', { [field]: message });
export const dbUnavailable = () => new ApiError(503, 'database_unavailable');
export const storageUnavailable = () => new ApiError(503, 'storage_unavailable');
export const liveUnavailable = () => new ApiError(503, 'live_unavailable');
