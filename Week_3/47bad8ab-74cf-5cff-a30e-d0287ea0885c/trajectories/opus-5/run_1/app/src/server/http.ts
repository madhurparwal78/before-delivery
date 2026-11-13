import type { IncomingMessage, ServerResponse } from 'node:http';
import { JSON_BODY_LIMIT } from './config';
import { query } from './db';
import { ApiError, errors } from './errors';

export const JSON_TYPE = 'application/json; charset=utf-8';

export interface PlayerRecord {
  id: string;
  display_name: string;
  skip_filled: boolean;
  jump_next_clue: boolean;
  autocheck: boolean;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, { 'content-type': JSON_TYPE, 'content-length': payload.length });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(res, error.status, error.body());
    return;
  }
  process.stderr.write(`unhandled error: ${String(error)}\n`);
  sendJson(res, 500, { error: 'invalid', message: 'Something went wrong.' });
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        req.resume();
        reject(limit === JSON_BODY_LIMIT ? errors.tooLargeJson() : errors.tooLargeUpload());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req, JSON_BODY_LIMIT);
  if (body.length === 0) return {};
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw errors.invalid({ body: 'Send a JSON object.' });
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw errors.invalid({ body: 'Send a JSON object.' });
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function setPlayerCookie(res: ServerResponse, playerId: string): void {
  res.setHeader(
    'set-cookie',
    `overlap_player=${playerId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`,
  );
}

export async function currentPlayer(req: IncomingMessage): Promise<PlayerRecord | null> {
  const id = parseCookies(req.headers.cookie).overlap_player;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const result = await query<PlayerRecord>(
    'select id, display_name, skip_filled, jump_next_clue, autocheck from players where id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}

export async function requirePlayer(req: IncomingMessage): Promise<PlayerRecord> {
  const player = await currentPlayer(req);
  if (!player) throw errors.noPlayer();
  return player;
}
