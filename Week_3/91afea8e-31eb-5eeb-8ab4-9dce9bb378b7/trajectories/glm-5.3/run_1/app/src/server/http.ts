import type { IncomingMessage, ServerResponse } from "node:http";

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: unknown;
  rawBody: Buffer;
  cookies: Record<string, string>;
  ip: string;
  origin: string | null;
  host: string | null;
  account: { id: string; role: string; name: string; firstName: string } | null;
  sessionId: string | null;
  setCookies: string[];
  idempotencyReplay: boolean;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  template: string;
}

export class Router {
  private routeTable: Route[] = [];

  add(method: string, template: string, handler: Handler): void {
    const keys: string[] = [];
    const source = template.split("/").map((part) => {
      if (part.startsWith(":")) {
        keys.push(part.slice(1));
        return "([^/]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("/");
    this.routeTable.push({ method, pattern: new RegExp(`^${source}/?$`), keys, handler, template });
  }

  merge(other: Router): void {
    for (const route of other.routes()) {
      this.add(route.method, route.template, route.handler);
    }
  }

  routes(): Array<{ method: string; template: string; handler: Handler }> {
    return this.routeTable.map((r) => ({ method: r.method, template: r.template, handler: r.handler }));
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routeTable) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(path);
      if (m) {
        const params: Record<string, string> = {};
        route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { route, params };
      }
    }
    return null;
  }

  allowedMethods(path: string): string[] {
    return this.routeTable.filter((r) => r.pattern.test(path)).map((r) => r.method);
  }
}
