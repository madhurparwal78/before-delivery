// The API dispatcher: route matching, the boundary checks, the single error
// shape, and the locale, for every route under /api.
import {
  ApiError, type Ctx, errorBody, readCookies, resolveLocale, checkOrigin, readJsonBody
} from "../core/http.js";
import { buildRoutes, type Services } from "./routes.js";

export class ApiRouter {
  private routes = buildRoutes();
  constructor(public services: Services) {}

  async handle(req: Request, url: URL): Promise<{ status: number; body: string | null; headers: Record<string, string> }> {
    const cookies = readCookies(req.headers.get("cookie"));
    const locale = resolveLocale(cookies, req.headers.get("accept-language"));
    const ctx: Ctx = {
      req, url, method: req.method.toUpperCase(),
      env: this.services.env, pool: this.services.pool,
      locale, cookies, body: undefined, setCookies: [],
      responseHeaders: {}
    };
    const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
    try {
      checkOrigin(req);
      ctx.body = await readJsonBody(req);
      const path = url.pathname;
      if (!path.startsWith("/api/") && path !== "/api") {
        throw new ApiError(404, "not_found");
      }
      const apiPath = path.slice("/api".length) || "/";
      const method = ctx.method;
      let pathMatched = false;
      for (const routeItem of this.routes) {
        const match = routeItem.pattern.exec(apiPath);
        if (!match) continue;
        pathMatched = true;
        if (routeItem.method !== method && !(routeItem.method === "GET" && method === "HEAD")) continue;
        const params: Record<string, string> = {};
        routeItem.paramNames.forEach((name, index) => {
          params[name] = decodeURIComponent(match[index + 1]);
        });
        const result = await routeItem.handler(ctx, this.services, params);
        for (const [key, value] of Object.entries(result.headers ?? {})) {
          headers[key] = value;
        }
        for (const cookie of ctx.setCookies) {
          headers["Set-Cookie"] = headers["Set-Cookie"]
            ? `${headers["Set-Cookie"]}, ${cookie}`
            : cookie;
        }
        if (result.status === 204) {
          return { status: 204, body: null, headers };
        }
        return { status: result.status, body: JSON.stringify(result.body ?? null), headers };
      }
      if (pathMatched) {
        throw new ApiError(405, "method_not_allowed");
      }
      throw new ApiError(404, "not_found");
    } catch (err) {
      if (!(err instanceof ApiError)) {
        console.error("api error:", err);
      }
      const apiError = err instanceof ApiError ? err : new ApiError(500, "internal_error");
      const { status, body } = errorBody(apiError, locale);
      for (const [key, value] of Object.entries(apiError.headers)) {
        headers[key] = value;
      }
      for (const cookie of ctx.setCookies) {
        headers["Set-Cookie"] = headers["Set-Cookie"]
          ? `${headers["Set-Cookie"]}, ${cookie}`
          : cookie;
      }
      return { status, body, headers };
    }
  }
}
