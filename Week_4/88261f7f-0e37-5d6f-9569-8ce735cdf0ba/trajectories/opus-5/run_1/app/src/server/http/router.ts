import { IncomingMessage, ServerResponse } from 'node:http';
import { Role } from '../domain/roles';
import { ApiError, errorTexts, failure } from './errors';
import { SessionUser } from './session';

export const MAX_JSON_BYTES = 1000000;

export type BodyMode = 'json' | 'none' | 'multipart';

export type Access = 'public' | 'signedIn' | Role[];

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  user: SessionUser | null;
  body: Record<string, unknown>;
  rawBody: Buffer;
}

export interface Reply {
  status: number;
  json?: unknown;
  body?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

export type Handler = (ctx: RequestContext) => Promise<Reply>;

export interface Route {
  method: string;
  pattern: string;
  access: Access;
  bodyMode: BodyMode;
  handler: Handler;
}

interface CompiledRoute extends Route {
  segments: string[];
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(route: Route): void {
    this.routes.push({ ...route, segments: route.pattern.split('/').filter((part) => part !== '') });
  }

  match(method: string, pathname: string): { route: CompiledRoute; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter((part) => part !== '');
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const segment = route.segments[index];
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(parts[index]);
        } else if (segment !== parts[index]) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }
}

export function readJsonBody(raw: Buffer, contentType: string | undefined): Record<string, unknown> {
  const base = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (base !== '' && base !== 'application/json') {
    throw failure(415, errorTexts.sendJson);
  }
  if (raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw failure(415, errorTexts.sendJson);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw failure(415, errorTexts.sendJson);
  }
}

/** Collects the body, holding nothing beyond the limit and draining the rest. */
export function collectBody(req: IncomingMessage, limit: number, tooLarge: ApiError): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let refused = false;
    req.on('data', (chunk: Buffer) => {
      if (refused) return;
      total += chunk.length;
      if (total > limit) {
        refused = true;
        chunks.length = 0;
        reject(tooLarge);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!refused) resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => {
      if (!refused) reject(error);
    });
  });
}
