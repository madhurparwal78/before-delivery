import type { IncomingMessage, ServerResponse } from 'node:http';
import { JSON_BODY_CAP_BYTES, UPLOAD_REQUEST_CAP_BYTES } from '../domain/constants.js';
import type { UserRole } from '../domain/constants.js';
import { errors } from './errors.js';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
}

export type BodyKind = 'none' | 'json' | 'multipart';

export interface JsonResponse {
  status: number;
  json: unknown;
  headers?: Record<string, string>;
}

export interface BinaryResponse {
  status: number;
  buffer: Buffer;
  contentType: string;
  headers?: Record<string, string>;
}

export type ApiResponse = JsonResponse | BinaryResponse;

export function isJsonResponse(response: ApiResponse): response is JsonResponse {
  return 'json' in response;
}

export class RequestContext {
  user: SessionUser | null = null;

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
    readonly method: string,
    readonly path: string,
    readonly query: URLSearchParams,
    readonly params: Record<string, string>,
    private readonly rawBody: Buffer,
    private readonly overLimit: boolean,
    readonly idempotencyKey: string | null,
  ) {}

  get actor(): SessionUser {
    if (!this.user) throw errors.unauthenticated();
    return this.user;
  }

  requireRole(...roles: readonly UserRole[]): SessionUser {
    const user = this.actor;
    if (!roles.includes(user.role)) throw errors.forbidden();
    return user;
  }

  /** The tenant a tenant user is scoped to; operators are unscoped. */
  get scopeTenantId(): string | null {
    return this.actor.role === 'operator' ? null : this.actor.tenantId;
  }

  private contentType(): string {
    return (this.req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  }

  jsonBody(): Record<string, unknown> {
    if (this.overLimit || this.rawBody.length > JSON_BODY_CAP_BYTES) throw errors.bodyTooLarge();
    if (this.contentType() !== 'application/json') throw errors.unsupportedMediaType();
    if (this.rawBody.length === 0) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.rawBody.toString('utf8'));
    } catch {
      throw errors.validation({ body: 'Send a JSON object.' });
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw errors.validation({ body: 'Send a JSON object.' });
    }
    return parsed as Record<string, unknown>;
  }

  multipartBody(): Buffer {
    if (this.overLimit || this.rawBody.length > UPLOAD_REQUEST_CAP_BYTES) throw errors.fileTooLarge();
    if (this.contentType() !== 'multipart/form-data') throw errors.unsupportedMediaType();
    return this.rawBody;
  }

  boundary(): string {
    const header = this.req.headers['content-type'] ?? '';
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(header);
    const value = match ? (match[1] ?? match[2]) : null;
    if (!value) throw errors.unsupportedMediaType();
    return value.trim();
  }

  bodyFingerprint(): string {
    return this.rawBody.toString('base64');
  }
}
