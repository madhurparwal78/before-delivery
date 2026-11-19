import type { IncomingMessage, ServerResponse } from 'node:http';
import busboy from 'busboy';
import { limits } from '../config.ts';
import { badRequest, requestTooLarge, unsupportedMediaType } from './errors.ts';

/**
 * Transport-level reading of a request. Every check here happens before any
 * other precedence step, and the body limit is inclusive.
 */

export interface UploadedFile {
  field: string;
  filename: string;
  declaredType: string;
  bytes: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: UploadedFile[];
}

/** True when the request declares this media type, ignoring parameters. */
export function declaresType(request: IncomingMessage, type: string): boolean {
  const header = request.headers['content-type'];
  if (typeof header !== 'string') return false;
  return header.split(';')[0]?.trim().toLowerCase() === type;
}

export async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const declared = Number.parseInt(request.headers['content-length'] ?? '', 10);
  if (Number.isFinite(declared) && declared > limits.requestMaxBytes) {
    throw requestTooLarge();
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const part = chunk as Buffer;
    total += part.length;
    if (total > limits.requestMaxBytes) {
      request.destroy();
      throw requestTooLarge();
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!declaresType(request, 'application/json')) throw unsupportedMediaType();
  const raw = await readRawBody(request);
  if (raw.length === 0) throw badRequest();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw badRequest();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw badRequest();
  }
  return parsed as Record<string, unknown>;
}

export async function readMultipartBody(request: IncomingMessage): Promise<MultipartBody> {
  if (!declaresType(request, 'multipart/form-data')) throw unsupportedMediaType();
  const declared = Number.parseInt(request.headers['content-length'] ?? '', 10);
  if (Number.isFinite(declared) && declared > limits.requestMaxBytes) {
    throw requestTooLarge();
  }

  return new Promise<MultipartBody>((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: request.headers,
        limits: { fileSize: limits.requestMaxBytes + 1, files: 8, fields: 32 },
      });
    } catch {
      reject(badRequest());
      return;
    }

    const fields: Record<string, string> = {};
    const files: UploadedFile[] = [];
    const pending: Promise<void>[] = [];
    let total = 0;
    let settled = false;

    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      request.unpipe(parser);
      request.destroy();
      reject(error);
    };

    parser.on('field', (name, value) => {
      total += Buffer.byteLength(value);
      if (total > limits.requestMaxBytes) fail(requestTooLarge());
      fields[name] = value;
    });

    parser.on('file', (name, stream, info) => {
      pending.push(
        new Promise<void>((done, failFile) => {
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > limits.requestMaxBytes) {
              failFile(requestTooLarge());
              return;
            }
            chunks.push(chunk);
          });
          stream.on('limit', () => failFile(requestTooLarge()));
          stream.on('error', () => failFile(badRequest()));
          stream.on('end', () => {
            files.push({
              field: name,
              filename: info.filename ?? '',
              declaredType: info.mimeType ?? '',
              bytes: Buffer.concat(chunks),
            });
            done();
          });
        }),
      );
    });

    parser.on('error', () => fail(badRequest()));
    parser.on('close', () => {
      void Promise.all(pending).then(
        () => {
          if (settled) return;
          settled = true;
          resolve({ fields, files });
        },
        (error: unknown) => fail(error),
      );
    });

    request.pipe(parser);
  });
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  response.end(payload);
}

export function sendNoContent(response: ServerResponse): void {
  response.writeHead(204, { 'cache-control': 'no-store' });
  response.end();
}

export function sendRedirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location, 'cache-control': 'no-store' });
  response.end();
}

/* -- cookies ------------------------------------------------------------- */

export function readCookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) return {};
  const jar: Record<string, string> = {};
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (name) jar[name] = decodeURIComponent(value);
  }
  return jar;
}

export function setCookie(
  response: ServerResponse,
  name: string,
  value: string,
  maxAgeSeconds: number,
): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  appendSetCookie(response, parts.join('; '));
}

export function clearCookie(response: ServerResponse, name: string): void {
  appendSetCookie(response, `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function appendSetCookie(response: ServerResponse, cookie: string): void {
  const existing = response.getHeader('set-cookie');
  if (existing === undefined) {
    response.setHeader('set-cookie', cookie);
    return;
  }
  const list = Array.isArray(existing) ? existing.map(String) : [String(existing)];
  response.setHeader('set-cookie', [...list, cookie]);
}
