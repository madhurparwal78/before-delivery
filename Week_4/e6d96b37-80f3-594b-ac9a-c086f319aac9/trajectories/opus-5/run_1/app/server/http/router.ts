import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from '../config.ts';
import { ApiError, methodNotAllowed, notFound } from './errors.ts';
import type { AppSession } from '../session.ts';

/**
 * The server answers only the published routes plus the built frontend's pages.
 * Nothing else exists, and no other path reveals itself through 400, 405, 413
 * or 415.
 */

export interface RouteRequest {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  params: Record<string, string>;
  session: AppSession | null;
}

export type RouteHandler = (context: RouteRequest) => Promise<void>;

export interface Route {
  method: string;
  /** Path template; `:name` captures one segment. */
  path: string;
  handler: RouteHandler;
  /**
   * A dealer-only route answers a signed-in counterpart or outsider 404,
   * exactly as if the route did not exist, whatever the method or body.
   */
  dealerOnly?: boolean;
  /** A grading route exists only with the valid grading key. */
  grading?: boolean;
}

interface CompiledRoute extends Route {
  segments: string[];
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(route: Route): void {
    this.routes.push({ ...route, segments: route.path.split('/').filter((part) => part !== '') });
  }

  /** Every route whose path shape matches, regardless of method. */
  private matching(pathname: string): { route: CompiledRoute; params: Record<string, string> }[] {
    const parts = pathname.split('/').filter((part) => part !== '');
    const found: { route: CompiledRoute; params: Record<string, string> }[] = [];
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let at = 0; at < route.segments.length; at += 1) {
        const expected = route.segments[at] as string;
        const actual = parts[at] as string;
        if (expected.startsWith(':')) {
          params[expected.slice(1)] = decodeURIComponent(actual);
        } else if (expected !== actual) {
          ok = false;
          break;
        }
      }
      if (ok) found.push({ route, params });
    }
    return found;
  }

  /**
   * Resolves a request to its handler. The boundary exceptions come before
   * every transport check, so a hidden route never answers 405.
   */
  resolve(
    pathname: string,
    method: string,
    viewer: { role: string | null; gradingKeyValid: boolean },
  ): { handler: RouteHandler; params: Record<string, string> } {
    const candidates = this.matching(pathname);
    if (candidates.length === 0) throw notFound();

    const visible = candidates.filter(({ route }) => {
      if (route.grading && !viewer.gradingKeyValid) return false;
      if (route.dealerOnly && viewer.role !== 'dealer') return false;
      return true;
    });
    if (visible.length === 0) throw notFound();

    const exact = visible.find(({ route }) => route.method === method);
    if (exact) return { handler: exact.route.handler, params: exact.params };

    const allow = [...new Set(visible.map(({ route }) => route.method))].sort();
    if (allow.includes('GET') && method === 'HEAD') {
      const head = visible.find(({ route }) => route.method === 'GET');
      if (head) return { handler: head.route.handler, params: head.params };
    }
    throw methodNotAllowed([...allow, 'OPTIONS']);
  }
}

/** The grading key authenticates the grading routes when configured. */
export function gradingKeyValid(request: IncomingMessage): boolean {
  if (!app.gradeKey) return false;
  const offered = request.headers['x-flan-grading-key'];
  return typeof offered === 'string' && offered === app.gradeKey;
}

export { ApiError };
