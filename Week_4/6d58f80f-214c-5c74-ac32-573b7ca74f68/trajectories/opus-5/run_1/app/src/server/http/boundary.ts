import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_JSON_BODY, MAX_PART_BODY, SESSION_COOKIE } from '../config.js';
import { crossOrigin, tooLarge, unsupportedMediaType } from './errors.js';

export const readCookie = (req: IncomingMessage, name: string): string | null => {
  const header = req.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
};

export const setSessionCookie = (res: ServerResponse, value: string): void => {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`,
  );
};

export const clearSessionCookie = (res: ServerResponse): void => {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
};

const mediaType = (header: string | undefined): string | null => {
  if (header === undefined) return null;
  const value = header.split(';')[0]?.trim().toLowerCase();
  return value === undefined || value === '' ? null : value;
};

export interface RawBody {
  bytes: Buffer;
  hadBody: boolean;
}

export const readBody = async (req: IncomingMessage, limit: number): Promise<RawBody> => {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) throw tooLarge();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) throw tooLarge();
    chunks.push(buffer);
  }
  return { bytes: Buffer.concat(chunks), hadBody: total > 0 };
};

/** Body limits and content types, which are the first checks of every request. */
export const checkBody = async (
  req: IncomingMessage,
  kind: 'json' | 'part',
): Promise<RawBody> => {
  const body = await readBody(req, kind === 'part' ? MAX_PART_BODY : MAX_JSON_BODY);
  if (body.hadBody) {
    const type = mediaType(req.headers['content-type']);
    const wanted = kind === 'part' ? 'application/octet-stream' : 'application/json';
    if (type !== wanted) throw unsupportedMediaType();
  }
  return body;
};

export const checkOrigin = (req: IncomingMessage): void => {
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') return;
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return;
  const host = req.headers.host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw crossOrigin();
  }
  if (host === undefined || originHost !== host) throw crossOrigin();
};

export const parseJson = (body: RawBody): Record<string, unknown> => {
  if (!body.hadBody) return {};
  const parsed: unknown = JSON.parse(body.bytes.toString('utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
};
