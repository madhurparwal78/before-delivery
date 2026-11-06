import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, type FieldErrors } from '../errors.js';

export interface RequestBody {
  json?: unknown;
  files?: Map<string, { filename: string; data: Buffer; contentType: string }>;
  fields: Map<string, string>;
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  cookies: Record<string, string>;
  body?: RequestBody;
  idempotencyKey?: string;
}

export type Handler = (ctx: RequestContext) => Promise<void> | void;

export interface RouteDef {
  method: string;
  pattern: string;
  handler: Handler;
  /** Query parameters this route accepts; unknown others answer unknown_parameter. null = accept anything. */
  allowedParams: string[] | null;
  /** Route reads a JSON body (application/json required). */
  json?: boolean;
  /** Route reads a multipart body (multipart/form-data required). */
  multipart?: boolean;
}

export class Router {
  private routes: { method: string; segments: string[]; def: RouteDef }[] = [];

  add(def: RouteDef): void {
    this.routes.push({ method: def.method, segments: def.pattern.split('/').filter(Boolean), def });
  }

  match(
    method: string,
    path: string,
  ): { def: RouteDef; params: Record<string, string> } | { allowedMethods: string[] } | null {
    const parts = path.split('/').filter(Boolean);
    const allowed: string[] = [];
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const seg = route.segments[i];
        if (seg === undefined) {
          ok = false;
          break;
        }
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(parts[i] ?? '');
        } else if (seg !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (route.method === method) return { def: route.def, params };
      allowed.push(route.method);
    }
    if (allowed.length > 0) return { allowedMethods: [...new Set(allowed)].sort() };
    return null;
  }
}

export function validationError(fields: FieldErrors): ApiError {
  return new ApiError(422, 'validation_failed', undefined, fields);
}
