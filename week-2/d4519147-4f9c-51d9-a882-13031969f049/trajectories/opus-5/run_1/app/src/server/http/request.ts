import type { IncomingMessage } from 'node:http';
import { config } from '../config';
import { errors } from './errors';

export function requestScheme(req: IncomingMessage): string {
  const socket = req.socket as { encrypted?: boolean };
  return socket.encrypted ? 'https' : 'http';
}

/** The published Origin rule, applied to every POST, PUT, PATCH and DELETE. */
export function passesOriginRule(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    const addressed = `${requestScheme(req)}://${req.headers.host ?? ''}`.toLowerCase();
    const candidate = origin.toLowerCase();
    return candidate === addressed || candidate === config.publicUrl.toLowerCase();
  }
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return false;
  return true;
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

export function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

export function mediaType(req: IncomingMessage): string {
  const header = req.headers['content-type'];
  if (typeof header !== 'string') return '';
  const semicolon = header.indexOf(';');
  return (semicolon === -1 ? header : header.slice(0, semicolon)).trim().toLowerCase();
}

/**
 * Reads a body up to its limit. An over-limit body is drained so the published
 * 413 still reaches the client, and abandoned once it is far past the limit.
 */
export async function readBody(req: IncomingMessage, limit: number, tooLarge: () => Error): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let overflow = false;
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        overflow = true;
        chunks.length = 0;
        if (total > limit * 4) {
          fail(tooLarge());
          req.destroy();
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (overflow) reject(tooLarge());
      else resolve(Buffer.concat(chunks));
    });
    req.on('error', (error: Error) => fail(error));
  });
}

export function parseJsonBody(body: Buffer): unknown {
  if (body.length === 0) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw errors.validation({ body: 'invalid_json' });
  }
}

export interface MultipartFile {
  fieldName: string;
  fileName: string;
  bytes: Buffer;
}

/** Reads the single `file` part of an import upload. */
export function parseMultipartFile(body: Buffer, contentType: string, partLimit: number): MultipartFile | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundaryValue = match?.[1] ?? match?.[2];
  if (!boundaryValue) return null;
  const boundary = Buffer.from(`--${boundaryValue.trim()}`);
  let cursor = body.indexOf(boundary);
  if (cursor === -1) return null;
  cursor += boundary.length;
  while (cursor < body.length) {
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) break;
    if (body[cursor] === 0x0d) cursor += 2;
    const headerEnd = body.indexOf('\r\n\r\n', cursor);
    if (headerEnd === -1) return null;
    const rawHeaders = body.subarray(cursor, headerEnd).toString('utf8');
    const contentStart = headerEnd + 4;
    const nextBoundary = body.indexOf(boundary, contentStart);
    if (nextBoundary === -1) return null;
    let contentEnd = nextBoundary;
    if (body[contentEnd - 1] === 0x0a && body[contentEnd - 2] === 0x0d) contentEnd -= 2;
    const disposition = /content-disposition:([^\r\n]*)/i.exec(rawHeaders)?.[1] ?? '';
    const fieldName = /name="([^"]*)"/i.exec(disposition)?.[1] ?? '';
    const fileName = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? '';
    if (fieldName === 'file') {
      const bytes = body.subarray(contentStart, contentEnd);
      if (bytes.length > partLimit) throw errors.fileTooLarge();
      return { fieldName, fileName, bytes: Buffer.from(bytes) };
    }
    cursor = nextBoundary + boundary.length;
  }
  return null;
}
