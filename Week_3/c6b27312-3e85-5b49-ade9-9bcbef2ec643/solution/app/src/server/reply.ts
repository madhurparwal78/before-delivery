import { ApiError } from "./errors";

export interface Reply {
  status: number;
  headers?: Record<string, string>;
  body?: Buffer;
}

const JSON_TYPE = "application/json; charset=utf-8";

export function jsonReply(status: number, body: unknown, headers: Record<string, string> = {}): Reply {
  return { status, headers: { "Content-Type": JSON_TYPE, ...headers }, body: Buffer.from(JSON.stringify(body)) };
}

export function errorReply(error: ApiError): Reply {
  return jsonReply(error.status, { error: error.code, message: error.message, ...error.extra }, error.headers);
}

export function redirect(location: string, headers: Record<string, string> = {}): Reply {
  return { status: 303, headers: { Location: location, ...headers } };
}

export const noContent: Reply = { status: 204 };
