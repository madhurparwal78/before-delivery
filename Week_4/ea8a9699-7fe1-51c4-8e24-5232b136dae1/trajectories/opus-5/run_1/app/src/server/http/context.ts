import type { IncomingMessage } from 'node:http';
import type { MediaType } from '../domain/media.js';
import type { MultipartBody } from './multipart.js';

export type BodyKind = 'none' | 'json' | 'multipart';

export interface HttpResponse {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
  body?: Buffer | string;
  contentType?: string;
}

export interface RequestContext {
  readonly method: string;
  readonly url: URL;
  readonly params: Record<string, string>;
  readonly headers: IncomingMessage['headers'];
  readonly cookies: Record<string, string>;
  readonly body: unknown;
  readonly multipart: MultipartBody | null;
  /** The sniffed type of the upload part, already checked against the boundary limits. */
  readonly uploadType: MediaType | null;
}

export function jsonResponse(status: number, data: unknown, headers: Record<string, string> = {}): HttpResponse {
  return { status, json: data, headers };
}

export function noContent(headers: Record<string, string> = {}): HttpResponse {
  return { status: 204, headers };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) {
    return cookies;
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return cookies;
}
