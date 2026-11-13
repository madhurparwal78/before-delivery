import type { IncomingHttpHeaders } from 'node:http';
import type { Config } from '../config.js';
import type { Database } from '../db.js';
import type { Storage } from '../services/storage.js';
import type { Mailer } from '../services/mail.js';
import type { Role } from '../../shared/options.js';
import { malformedJson } from './errors.js';

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: number;
}

export interface AppContext {
  config: Config;
  db: Database;
  storage: Storage;
  mailer: Mailer;
  /** The server's clock: every price, station state, end time and countdown comes from here. */
  now: () => number;
}

export type ApiResponse =
  | { kind: 'json'; status: number; body: unknown; headers?: Record<string, string> }
  | { kind: 'empty'; status: number; headers?: Record<string, string> }
  | {
      kind: 'bytes';
      status: number;
      body: Buffer;
      contentType: string;
      headers?: Record<string, string>;
    };

export const jsonResponse = (status: number, body: unknown, headers?: Record<string, string>): ApiResponse => ({
  kind: 'json',
  status,
  body,
  ...(headers === undefined ? {} : { headers }),
});

export class RequestContext {
  readonly params: Record<string, string> = {};
  member: Member | null = null;

  constructor(
    readonly app: AppContext,
    readonly method: string,
    readonly url: URL,
    readonly headers: IncomingHttpHeaders,
    readonly body: Buffer,
    readonly cookies: Record<string, string>,
    readonly now: number,
  ) {}

  param(name: string): string {
    return this.params[name] ?? '';
  }

  query(name: string): string | null {
    const value = this.url.searchParams.get(name);
    return value === null || value === '' ? null : value;
  }

  header(name: string): string | null {
    const value = this.headers[name.toLowerCase()];
    return typeof value === 'string' ? value : null;
  }

  /** The parsed JSON body, or 400 `malformed_json`. */
  json(): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.body.toString('utf8') || 'null');
    } catch {
      throw malformedJson();
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw malformedJson();
    }
    return parsed as Record<string, unknown>;
  }

  /** The body read as JSON without judging it, used where a rate-limit key lives in the body. */
  peekJson(): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(this.body.toString('utf8') || 'null');
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  signedInMember(): Member {
    if (this.member === null) throw new Error('This route authenticates before it is handled');
    return this.member;
  }
}
