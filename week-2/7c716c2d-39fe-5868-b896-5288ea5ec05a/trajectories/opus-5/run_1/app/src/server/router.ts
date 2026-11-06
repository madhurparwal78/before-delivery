import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Actor } from './access.js';
import type { Handled, Reply } from './http.js';

export type BodyKind = 'json' | 'none' | 'multipart';

export type Ctx = {
  method: string;
  url: URL;
  params: Record<string, string>;
  body: Record<string, unknown>;
  rawBody: Buffer;
  request: IncomingMessage;
  response: ServerResponse;
  idempotencyKey: string | undefined;
  lastEventId: string | undefined;
  sessionToken: string | undefined;
  /** The signed-in person, when there is one and the database can be reached. */
  resolveActor: () => Promise<Actor | null>;
};

export type AuthCtx = Ctx & { actor: Actor };

export type Route =
  | {
      kind: 'public';
      method: string;
      segments: string[];
      body: BodyKind;
      handler: (ctx: Ctx) => Promise<Reply | Handled>;
    }
  | {
      kind: 'session';
      method: string;
      segments: string[];
      body: BodyKind;
      handler: (ctx: AuthCtx) => Promise<Reply | Handled>;
    };

function split(pattern: string): string[] {
  return pattern.split('/').filter((part) => part !== '');
}

export function publicRoute(
  method: string,
  pattern: string,
  body: BodyKind,
  handler: (ctx: Ctx) => Promise<Reply | Handled>,
): Route {
  return { kind: 'public', method, segments: split(pattern), body, handler };
}

export function sessionRoute(
  method: string,
  pattern: string,
  body: BodyKind,
  handler: (ctx: AuthCtx) => Promise<Reply | Handled>,
): Route {
  return { kind: 'session', method, segments: split(pattern), body, handler };
}

export type Match = { route: Route; params: Record<string, string> };

export function matchRoute(routes: readonly Route[], method: string, pathname: string): Match | undefined {
  const parts = split(pathname);
  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < route.segments.length; index += 1) {
      const segment = route.segments[index];
      const part = parts[index];
      if (segment === undefined || part === undefined) {
        matched = false;
        break;
      }
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(part);
      } else if (segment !== part) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return undefined;
}
