/** The one request context every route handler is given. */

import type { IncomingMessage } from 'node:http';
import type { Role } from '../../shared/domain.js';
import {
  accessRemoved,
  ApiError,
  badRequest,
  bodyTooLarge,
  fileTooLarge,
  forbidden,
  sessionEnded,
} from './errors.js';
import { boundaryOf, parseMultipart, type Multipart, type UploadedFile } from './multipart.js';
import { readCookie, SESSION_COOKIE, memberOfSession, toMember, type Member } from './session.js';

export const JSON_BODY_LIMIT = 65_536;
export const MULTIPART_BODY_LIMIT = 10_100_000;
export const CSV_BODY_LIMIT = 1_000_000;

export interface Reply {
  status: number;
  json?: unknown;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

export class Context {
  readonly request: IncomingMessage;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly setCookies: string[] = [];

  private cachedMember: Member | null | undefined;
  private cachedBody: unknown;
  private bodyRead = false;
  private cachedRaw: Buffer | undefined;

  constructor(request: IncomingMessage, url: URL, params: Record<string, string>) {
    this.request = request;
    this.url = url;
    this.params = params;
  }

  get method(): string {
    return this.request.method ?? 'GET';
  }

  header(name: string): string | undefined {
    const value = this.request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  param(name: string): string {
    return this.params[name] ?? '';
  }

  queryParam(name: string): string | null {
    return this.url.searchParams.get(name);
  }

  get sessionToken(): string | null {
    return readCookie(this.header('cookie'), SESSION_COOKIE);
  }

  /** Precedence steps 2 and 3: no valid session, then removed access. */
  async member(): Promise<Member> {
    if (this.cachedMember === undefined) {
      const token = this.sessionToken;
      const row = token ? await memberOfSession(token) : null;
      this.cachedMember = row ? toMember(row) : null;
    }
    if (!this.cachedMember) throw sessionEnded();
    if (this.cachedMember.status !== 'active') throw accessRemoved();
    return this.cachedMember;
  }

  /** Precedence step 6 for a plain role check. */
  async memberWithRole(...allowed: readonly Role[]): Promise<Member> {
    const member = await this.member();
    if (!allowed.includes(member.role)) throw forbidden();
    return member;
  }

  async rawBody(limit: number, overLimit: ApiError): Promise<Buffer> {
    if (this.cachedRaw) return this.cachedRaw;
    const declared = Number(this.header('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > limit) throw overLimit;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of this.request) {
      const part = chunk as Buffer;
      total += part.byteLength;
      if (total > limit) {
        this.request.destroy();
        throw overLimit;
      }
      chunks.push(part);
    }
    this.cachedRaw = Buffer.concat(chunks);
    return this.cachedRaw;
  }

  async json(): Promise<Record<string, unknown>> {
    if (!this.bodyRead) {
      const raw = await this.rawBody(JSON_BODY_LIMIT, bodyTooLarge(JSON_BODY_LIMIT));
      if (raw.byteLength === 0) {
        this.cachedBody = {};
      } else {
        try {
          this.cachedBody = JSON.parse(raw.toString('utf8'));
        } catch {
          throw badRequest();
        }
      }
      this.bodyRead = true;
    }
    const body = this.cachedBody;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest();
    return body as Record<string, unknown>;
  }

  /** The raw JSON body, used to compare an idempotent replay. */
  async jsonForReplay(): Promise<unknown> {
    await this.json();
    return this.cachedBody;
  }

  async csvBody(): Promise<string> {
    const raw = await this.rawBody(CSV_BODY_LIMIT, fileTooLarge(CSV_BODY_LIMIT));
    return raw.toString('utf8');
  }

  async multipart(): Promise<Multipart> {
    const contentType = this.header('content-type') ?? '';
    const boundary = boundaryOf(contentType);
    if (!contentType.startsWith('multipart/form-data') || boundary === null) throw badRequest();
    const raw = await this.rawBody(MULTIPART_BODY_LIMIT, bodyTooLarge(MULTIPART_BODY_LIMIT));
    return parseMultipart(raw, boundary);
  }
}

export type { Multipart, UploadedFile };

export const jsonReply = (status: number, json: unknown): Reply => ({ status, json });
export const noContent = (): Reply => ({ status: 204 });
