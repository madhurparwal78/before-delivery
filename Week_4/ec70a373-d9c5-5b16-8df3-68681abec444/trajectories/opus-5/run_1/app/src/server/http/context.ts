import type { IncomingHttpHeaders } from 'node:http';
import type { Role } from '../../shared/types';
import type { LiveSession, SignedInUser } from '../domain/sessions';
import type { MultipartBody } from './request';
import type { AuditTargetType } from '../domain/audit';

export interface HandlerResult {
  status: number;
  body?: unknown;
  raw?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
  setCookies?: string[];
}

export interface AuditIntent {
  targetType: AuditTargetType | null;
  targetId: string | null;
  tokenTenantId: string | null;
  tokenSiteId: string | null;
  subjectUserId: string | null;
}

export interface RequestContext {
  method: string;
  path: string;
  pattern: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  rawBody: Buffer;
  json(): Record<string, unknown>;
  multipart(): MultipartBody;
  user: SignedInUser | null;
  session: LiveSession | null;
  requireUser(): SignedInUser;
  origin: string;
  clientAddress: string | null;
  addressPrefix: string | null;
  presentedSessionValue: string | null;
  secure: boolean;
  nowMs: number;
  audit: AuditIntent;
  cookies: Record<string, string>;
}

export type Handler = (ctx: RequestContext) => Promise<HandlerResult>;

export type RouteRoles = 'public' | readonly Role[];

export interface RouteMethod {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  roles: RouteRoles;
  handler: Handler;
}

export interface RouteDef {
  pattern: string;
  methods: RouteMethod[];
}
