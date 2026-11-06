export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  extra?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.extra = extra;
  }
}

export function err(status: number, code: string, message: string, fields?: Record<string, string>, extra?: Record<string, unknown>): ApiError {
  return new ApiError(status, code, message, fields, extra);
}

export const unauthenticated = () => err(401, "unauthenticated", "Sign in to continue.");
export const forbidden = () => err(403, "forbidden", "You may not do that.");
export const notFound = () => err(404, "not_found", "Nothing here.");
export const validation = (fields: Record<string, string>) => err(422, "validation", "Some fields need attention.", fields);
export const conflict = (code: string, message: string, extra?: Record<string, unknown>) => err(409, code, message, undefined, extra);
export const billingUnavailable = () => err(503, "billing_unavailable", "Billing is offline right now.");
export const storageUnavailable = () => err(503, "storage_unavailable", "Document storage is not answering.");
export const contentUnavailable = () => err(503, "content_unavailable", "The programme is loading slowly.");

export function errorBody(e: ApiError): Record<string, unknown> {
  const body: Record<string, unknown> = { error: e.code, message: e.message };
  if (e.fields && Object.keys(e.fields).length > 0) body.errors = e.fields;
  if (e.extra) Object.assign(body, e.extra);
  return body;
}
