import type { IncomingHttpHeaders } from 'node:http';
import type { Role } from '../../shared/types.js';
import type { Actor } from './session.js';
import { forbidden, invalidJson, unauthenticated } from './errors.js';

export interface Reply {
  status: number;
  body?: unknown;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
  setCookie?: string;
}

export const json = (status: number, body: unknown): Reply => ({ status, body });
export const noContent = (): Reply => ({ status: 204 });

export class Ctx {
  constructor(
    readonly method: string,
    readonly url: URL,
    readonly params: Readonly<Record<string, string>>,
    readonly headers: IncomingHttpHeaders,
    readonly rawBody: Buffer,
    readonly actor: Actor | null,
  ) {}

  requireActor(): Actor {
    if (this.actor === null) throw unauthenticated();
    return this.actor;
  }

  requireRole(...roles: readonly Role[]): Actor {
    const actor = this.requireActor();
    if (!roles.includes(actor.role)) throw forbidden();
    return actor;
  }

  body(): Record<string, unknown> {
    if (this.rawBody.length === 0) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.rawBody.toString('utf8'));
    } catch {
      throw invalidJson();
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidJson();
    return parsed as Record<string, unknown>;
  }

  header(name: string): string | null {
    const value = this.headers[name];
    if (typeof value === 'string') return value;
    return null;
  }

  queryValue(name: string): string | null {
    return this.url.searchParams.get(name);
  }
}
