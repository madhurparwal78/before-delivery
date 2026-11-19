import type { IncomingMessage, ServerResponse } from 'node:http';

export const MAX_BODY_BYTES = 1048576;

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export interface ReadBodyResult {
  tooLarge: boolean;
  bytes: Buffer;
}

/** Reads at most MAX_BODY_BYTES; a larger body is drained so the 413 is read. */
export async function readBody(request: IncomingMessage): Promise<ReadBodyResult> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(buffer);
  }
  return { tooLarge, bytes: tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks) };
}

/** Every error the API answers with carries one of the published shapes. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`api error ${status}`);
  }
}

export function notSignedIn(): ApiError {
  return new ApiError(401, { error: 'Sign in to continue.' });
}

export function notFound(): ApiError {
  return new ApiError(404, { error: 'Not found' });
}

export function forbidden(copy: string): ApiError {
  return new ApiError(403, { error: copy });
}

export function unprocessable(field: string, message: string): ApiError {
  return new ApiError(422, { errors: { [field]: message } });
}

export function conflict(copy: string): ApiError {
  return new ApiError(409, { error: copy });
}

export function storageUnavailable(copy: string): ApiError {
  return new ApiError(503, { error: copy });
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  response.end(text);
}

export function sendEmpty(response: ServerResponse, status: number): void {
  response.writeHead(status, { 'cache-control': 'no-store' });
  response.end();
}

export function sessionCookie(token: string): string {
  return `fs_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export function clearedSessionCookie(): string {
  return 'fs_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}
