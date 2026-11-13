import type { ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

type ErrorExtras = {
  fields?: Record<string, string>;
  grant?: unknown;
  order?: unknown;
  tender?: unknown;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extras: ErrorExtras = {},
  ) {
    super(message);
  }
}

/** A refusal stored with an order is answered again, unchanged, through the same shared path. */
export function replayStored(status: number, body: { error: { code: string; message: string } } & ErrorExtras): ApiError {
  const { error, ...extras } = body;
  return new ApiError(status, error.code, error.message, extras);
}

export const unauthenticated = () => new ApiError(401, "unauthenticated", "Sign in to use the register.");
export const notFound = () => new ApiError(404, "not_found", "This record isn't on your register.");
export const forbidden = () => new ApiError(403, "forbidden", "Your role can't do that.");
export const conflict = (code: string, message: string, extras: ErrorExtras = {}) =>
  new ApiError(409, code, message, extras);
export const validation = (fields: Record<string, string>) =>
  new ApiError(422, "validation", "Some fields need attention.", { fields });
export const unavailable = (code: string, message: string, extras: ErrorExtras = {}) =>
  new ApiError(503, code, message, extras);

export const vaultUnavailable = (extras: ErrorExtras = {}) =>
  unavailable("vault_unavailable", "The document vault can't be reached. Try again shortly.", extras);
export const providerUnavailable = (extras: ErrorExtras = {}) =>
  unavailable("provider_unavailable", "The payment provider can't be reached. Nothing has been issued.", extras);

export function errorBody(error: ApiError): Record<string, unknown> {
  return { error: { code: error.code, message: error.message }, ...error.extras };
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, errorBody(error));
}

const REASON: Record<number, string> = { 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 500: "Internal Server Error" };

/** The same error shape for a WebSocket upgrade that is refused before the socket opens. */
export function refuseUpgrade(socket: Duplex, error: ApiError): void {
  const payload = JSON.stringify(errorBody(error));
  socket.write(
    `HTTP/1.1 ${error.status} ${REASON[error.status] ?? "Error"}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n\r\n${payload}`,
  );
  socket.destroy();
}

export const internalError = () =>
  new ApiError(500, "internal_error", "Something went wrong on our side. Your register has not changed.");
