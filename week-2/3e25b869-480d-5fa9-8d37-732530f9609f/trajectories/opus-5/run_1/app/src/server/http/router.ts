import type { Handler, RequestContext } from './context.js';
import { errors } from './errors.js';

export type AuthKind = 'none' | 'customer' | 'staff';

export type Route = {
  method: string;
  pattern: string;
  auth: AuthKind;
  handler: Handler;
};

type Compiled = Route & { segments: string[] };

export class Router {
  private readonly routes: Compiled[] = [];

  add(method: string, pattern: string, auth: AuthKind, handler: Handler): this {
    this.routes.push({ method, pattern, auth, handler, segments: pattern.split('/').filter(Boolean) });
    return this;
  }

  /** Matches on path first so a known path with a wrong method answers 405, not 404. */
  resolve(ctx: RequestContext): { route: Compiled; params: Record<string, string> } {
    const parts = ctx.path.split('/').filter(Boolean);
    let pathMatched = false;
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const segment = route.segments[index] as string;
        const value = parts[index] as string;
        if (segment.startsWith('{') && segment.endsWith('}')) {
          params[segment.slice(1, -1)] = decodeURIComponent(value);
        } else if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      pathMatched = true;
      if (route.method === ctx.method) return { route, params };
    }
    if (pathMatched) {
      throw ctx.path.startsWith('/api/staff/audit') ? errors.auditImmutable() : errors.methodNotAllowed();
    }
    throw errors.notFound();
  }
}
