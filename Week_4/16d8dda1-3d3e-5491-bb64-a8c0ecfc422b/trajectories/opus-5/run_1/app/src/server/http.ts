import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly text: string
  ) {
    super(text);
  }
}

export const errors = {
  signIn: () => new ApiError(401, 'Sign in first.'),
  notFound: () => new ApiError(404, 'Not found.'),
  onlyTeacher: () => new ApiError(403, 'Only the teacher can do that.'),
  crossSite: () => new ApiError(403, 'Cross-site requests are refused.'),
  tooLarge: () => new ApiError(413, 'That request is too large.'),
  sendJson: () => new ApiError(415, 'Send JSON.'),
  livePaused: () => new ApiError(503, 'Live updates are paused. Try again in a moment.'),
  filesUnsaved: () => new ApiError(503, "Files can't be saved right now. Try again in a minute."),
  filesUnreadable: () => new ApiError(503, "Files can't be loaded right now. Try again in a minute.")
};

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.byteLength,
    'cache-control': 'no-store',
    'x-slatehall-instance': config.instanceName
  });
  res.end(payload);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204, { 'x-slatehall-instance': config.instanceName });
  res.end();
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(res, error.status, { error: error.text });
    return;
  }
  process.stderr.write(`${String(error instanceof Error ? error.stack : error)}\n`);
  sendJson(res, 500, { error: 'Something went wrong.' });
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    jar.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return jar;
}

export function sessionCookie(value: string): string {
  return `slatehall_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`;
}

const stateChanging = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** DP-40: a state-changing request or upgrade from another origin is refused outright. */
export function isCrossSite(req: IncomingMessage, forUpgrade: boolean): boolean {
  if (!forUpgrade && !stateChanging.has(req.method ?? 'GET')) return false;
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return false;
  const host = req.headers.host;
  if (!host) return true;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) throw errors.tooLarge();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > limit) throw errors.tooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function hasBody(req: IncomingMessage): boolean {
  const length = req.headers['content-length'];
  if (length !== undefined && length !== '0') return true;
  return req.headers['transfer-encoding'] !== undefined;
}

export type JsonBody = Record<string, unknown>;

export async function readJsonBody(req: IncomingMessage): Promise<JsonBody> {
  if (!hasBody(req)) return {};
  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') throw errors.sendJson();
  const raw = await readBody(req, config.maxJsonBytes);
  if (raw.byteLength === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as JsonBody;
  } catch {
    return {};
  }
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}
