import type { IncomingMessage, ServerResponse } from 'node:http';

import { ERROR_MESSAGES } from '../shared/copy';
import { JSON_BODY_MAX_BYTES, config } from './config';
import { AppError, forbidden } from './errors';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
  userId: string | null;
  username: string | null;
  sessionId: string | null;
}

export const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
};

export const sendEmpty = (res: ServerResponse, status: number): void => {
  res.writeHead(status, { 'cache-control': 'no-store' });
  res.end();
};

const readBody = async (req: IncomingMessage, limit: number, tooLarge: AppError): Promise<Buffer> => {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw tooLarge;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) {
      req.resume();
      throw tooLarge;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

export const readJsonBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const body = await readBody(
    req,
    JSON_BODY_MAX_BYTES,
    new AppError('too_large', ERROR_MESSAGES.bodyTooLarge(JSON_BODY_MAX_BYTES)),
  );
  if (body.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

export interface UploadedFile {
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

const MULTIPART_OVERHEAD = 65536;

export const readFilePart = async (req: IncomingMessage, maxBytes: number): Promise<UploadedFile> => {
  const tooLarge = new AppError('too_large', ERROR_MESSAGES.fileTooLarge(maxBytes));
  const contentType = String(req.headers['content-type'] ?? '');
  const boundaryMatch = /boundary="?([^";]+)"?/i.exec(contentType);
  if (!boundaryMatch?.[1]) {
    await readBody(req, maxBytes + MULTIPART_OVERHEAD, tooLarge);
    throw new AppError('validation', ERROR_MESSAGES.validationFields, { fields: { file: 'Choose a file.' } });
  }
  const body = await readBody(req, maxBytes + MULTIPART_OVERHEAD, tooLarge);
  const boundary = Buffer.from(`--${boundaryMatch[1]}`);
  let fileName = '';
  let partType = 'application/octet-stream';
  let bytes: Buffer | null = null;

  let cursor = body.indexOf(boundary);
  while (cursor !== -1) {
    const partStart = cursor + boundary.length;
    if (body.slice(partStart, partStart + 2).toString() === '--') break;
    const headerEnd = body.indexOf('\r\n\r\n', partStart);
    if (headerEnd === -1) break;
    const headerText = body.slice(partStart, headerEnd).toString('utf8');
    const next = body.indexOf(boundary, headerEnd);
    const contentEnd = next === -1 ? body.length : next - 2;
    const content = body.slice(headerEnd + 4, contentEnd);
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    if (nameMatch?.[1] === 'file') {
      fileName = /filename="([^"]*)"/i.exec(headerText)?.[1] ?? '';
      partType = /content-type:\s*([^\r\n;]+)/i.exec(headerText)?.[1]?.trim() ?? partType;
      bytes = content;
    }
    cursor = next;
  }

  if (bytes === null) {
    throw new AppError('validation', ERROR_MESSAGES.validationFields, { fields: { file: 'Choose a file.' } });
  }
  if (bytes.length > maxBytes) throw tooLarge;
  return { fileName, contentType: partType, bytes };
};

export const parseCookies = (req: IncomingMessage): Record<string, string> => {
  const header = req.headers.cookie;
  const jar: Record<string, string> = {};
  if (!header) return jar;
  for (const piece of header.split(';')) {
    const index = piece.indexOf('=');
    if (index === -1) continue;
    jar[piece.slice(0, index).trim()] = decodeURIComponent(piece.slice(index + 1).trim());
  }
  return jar;
};

const allowedHosts = (req: IncomingMessage): string[] => {
  const hosts = [String(req.headers.host ?? '')];
  try {
    hosts.push(new URL(config.publicUrl).host);
  } catch {
    /* an unparseable public url simply adds no host */
  }
  return hosts.filter((host) => host !== '');
};

/** Same origin only: a state-changing request from another origin is refused. */
export const checkOrigin = (req: IncomingMessage): void => {
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw forbidden(ERROR_MESSAGES.forbiddenCrossSite);
  }
  if (!allowedHosts(req).includes(host)) throw forbidden(ERROR_MESSAGES.forbiddenCrossSite);
};
