import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, errors } from './errors';
import { readKeys, type Body, type KeySpec } from '../domain/body';
import { isWellFormedId } from '../domain/ids';
import type { FilePart } from './multipart';
import type { UserRow } from '../db/repo';

export interface SessionRef {
  tokenHash: string;
  userId: string;
}

export class Ctx {
  params: Record<string, string> = {};
  session: SessionRef | null = null;
  file: FilePart | null = null;
  private user: UserRow | null = null;
  private parsed: Body | null = null;

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
    readonly method: string,
    readonly url: URL,
    readonly rawBody: Buffer,
  ) {}

  setUser(user: UserRow, session: SessionRef): void {
    this.user = user;
    this.session = session;
  }

  requireUser(): UserRow {
    if (this.user === null) throw errors.signedOut();
    return this.user;
  }

  requireSession(): SessionRef {
    if (this.session === null) throw errors.signedOut();
    return this.session;
  }

  /** A param that cannot be one of our ids matches nothing. */
  id(name: string): string {
    const value = this.params[name];
    if (value === undefined || !isWellFormedId(value)) throw errors.notFound();
    return value;
  }

  query(name: string): string | null {
    return this.url.searchParams.get(name);
  }

  header(name: string): string | null {
    const value = this.req.headers[name.toLowerCase()];
    if (typeof value === 'string') return value;
    return Array.isArray(value) ? (value[0] ?? null) : null;
  }

  body(spec: KeySpec): Body {
    if (this.parsed === null) {
      let raw: unknown;
      try {
        raw = JSON.parse(this.rawBody.length === 0 ? 'null' : this.rawBody.toString('utf8'));
      } catch {
        throw errors.validation({ body: 'Send a JSON object.' });
      }
      this.parsed = readKeys(raw, spec);
    }
    return this.parsed;
  }

  json(status: number, payload: unknown, headers: Record<string, string> = {}): void {
    const text = JSON.stringify(payload);
    this.res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      ...headers,
    });
    this.res.end(text);
  }

  noContent(): void {
    this.res.writeHead(204).end();
  }

  fail(error: ApiError): never {
    throw error;
  }
}
