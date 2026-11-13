import type { IncomingMessage, ServerResponse } from "node:http";

export type FieldErrors = { path: string; message: string }[];

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public message: string,
    public extra?: Record<string, unknown>,
    public errors?: FieldErrors,
  ) {
    super(message);
  }
}

export function unauthenticated(): ApiError {
  return new ApiError(401, "unauthenticated", "Sign in to continue.");
}

export function notFound(): ApiError {
  return new ApiError(404, "not_found", "Notebook not found.");
}

export function forbidden(): ApiError {
  return new ApiError(403, "forbidden", "Your role does not allow this.");
}

export function validationFailed(errors: { path: string; message: string }[]): ApiError {
  return new ApiError(422, "validation_failed", "Some fields are not valid.", { errors });
}

export function storageUnavailable(): ApiError {
  return new ApiError(503, "storage_unavailable", "Storage is unavailable right now.");
}

export function searchUnavailable(): ApiError {
  return new ApiError(503, "search_unavailable", "Search is unavailable right now.");
}

export function mailUnavailable(): ApiError {
  return new ApiError(503, "mail_unavailable", "Email could not be sent right now.");
}

export function crossOrigin(): ApiError {
  return new ApiError(403, "cross_origin", "Cross-origin requests are refused.");
}

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  user: { id: string; email: string; display_name: string; verified: boolean } | null;
};

export type Handler = (ctx: Ctx) => Promise<void>;

type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

export function routeParam(pattern: RegExp, keys: string[]): { pattern: RegExp; keys: string[] } {
  return { pattern, keys };
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler): this {
    const keys: string[] = [];
    const source = path.replace(/:[A-Za-z0-9_]+/g, (match) => {
      keys.push(match.slice(1));
      return "([^/]+)";
    });
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
    return this;
  }

  async dispatch(ctx: Ctx): Promise<boolean> {
    for (const r of this.routes) {
      if (r.method !== ctx.method) continue;
      const match = ctx.path.match(r.pattern);
      if (match === null) continue;
      ctx.params = {};
      r.keys.forEach((key, i) => {
        ctx.params[key] = decodeURIComponent(match[i + 1]);
      });
      await r.handler(ctx);
      return true;
    }
    return false;
  }
}
