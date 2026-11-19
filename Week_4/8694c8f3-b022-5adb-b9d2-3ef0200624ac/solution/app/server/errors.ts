import type { ServerResponse } from "node:http";
import { COLLAB_BANNER, STORAGE_BANNER } from "../shared/messages.ts";
import type { Fields } from "../shared/schema.ts";

type ErrorExtras = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extras: ErrorExtras;
  constructor(status: number, code: string, message: string, extras: ErrorExtras = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extras = extras;
  }
}

export const unauthenticated = () => new ApiError(401, "unauthenticated", "Sign in to continue");
export const forbidden = () => new ApiError(403, "forbidden", "You do not have permission to do this");
export const notFound = () => new ApiError(404, "not_found", "Not found");
export const tooLarge = () => new ApiError(413, "too_large", "The request body is too large");
export const unsupportedMediaType = () =>
  new ApiError(415, "unsupported_media_type", "Send application/json");
export const storageUnavailable = (extras: ErrorExtras = {}) =>
  new ApiError(503, "storage_unavailable", STORAGE_BANNER, extras);
export const collabOffline = () => new ApiError(503, "collab_offline", COLLAB_BANNER);
export const databaseNotReady = () => new ApiError(503, "unavailable", "The database is not connected yet");
export const assetNotReady = (name: string) => new ApiError(409, "asset_not_ready", `${name} is not ready`);

export function validation(fields: Fields): ApiError {
  const first = Object.values(fields)[0] ?? "Invalid request";
  return new ApiError(422, "validation", first, { fields });
}

export function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
    "cache-control": "no-store",
    ...headers,
  });
  res.end(payload);
}

export function writeError(res: ServerResponse, error: ApiError): void {
  writeJson(res, error.status, { error: { code: error.code, message: error.message, ...error.extras } });
}
