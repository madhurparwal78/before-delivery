import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";
import { clientIp, fail, parseJson, readBody } from "./http.js";
import { sessionOperator } from "./routes/session.js";

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  ip: string;
  /** The parsed JSON body (`{}` when empty); only for JSON endpoints. */
  json: unknown;
  /** The raw body; only for multipart endpoints. */
  raw: Buffer;
}

type Handler = (context: Context) => Promise<void>;

/** How an endpoint's body is read: JSON up to 65,536 bytes, or multipart up to the enquiry or stem limit. */
type BodyKind = "json" | "enquiry" | "stem";

const LIMITS: Record<BodyKind, number> = { json: 65_536, enquiry: 10_500_000, stem: 20_500_000 };
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface Endpoint {
  handler: Handler;
  body?: BodyKind;
}

export interface Route {
  pattern: string;
  methods: Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", Endpoint>>;
  /** Read-only capability paths answer other methods with 405 read_only and never cache. */
  readOnly?: boolean;
}

interface Compiled extends Route {
  regex: RegExp;
  names: string[];
}

export function compile(routes: Route[]): Compiled[] {
  return routes.map((route) => {
    const names: string[] = [];
    const source = route.pattern.replace(/:([a-z_]+)/g, (_, name: string) => {
      names.push(name);
      return "([^/]+)";
    });
    return { ...route, regex: new RegExp(`^${source}$`), names };
  });
}

export function match(routes: Compiled[], path: string): { route: Compiled; params: Record<string, string> } | null {
  for (const route of routes) {
    const found = route.regex.exec(path);
    if (found) {
      const params: Record<string, string> = {};
      route.names.forEach((name, index) => {
        params[name] = decodeURIComponent(found[index + 1] ?? "");
      });
      // A NUL byte can never name anything, and Postgres refuses it in text: unknown, before any lookup.
      if (Object.values(params).some((value) => value.includes("\u0000"))) return null;
      return { route, params };
    }
  }
  return null;
}

/** Runs the brief's error precedence up to the handler: 405, 403, 413, 400, 401, then the handler. */
export async function dispatch(
  route: Compiled,
  params: Record<string, string>,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  if (route.readOnly) res.setHeader("Cache-Control", "no-store");
  const method = (req.method ?? "GET").toUpperCase();
  const endpoint = route.methods[method as keyof Route["methods"]];
  if (!endpoint) {
    if (route.readOnly) fail(405, "read_only", "Listening links are read-only.", {}, { Allow: "GET" });
    fail(405, "method_not_allowed", "That method is not allowed here.", {}, { Allow: Object.keys(route.methods).join(", ") });
  }
  if (STATE_CHANGING.has(method)) {
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== config.publicOrigin) {
      fail(403, "cross_origin", "Requests from another origin cannot change anything.");
    }
  }
  const kind = endpoint.body ?? "json";
  const raw = await readBody(req, LIMITS[kind]);
  const json = kind === "json" && STATE_CHANGING.has(method) ? parseJson(raw) : {};
  const consoleOnly = url.pathname.startsWith("/api/console/") && !(url.pathname === "/api/console/session" && method === "POST");
  if (consoleOnly && !(await sessionOperator(req))) {
    fail(401, "unauthenticated", "Sign in to the console first.");
  }
  await endpoint.handler({ req, res, url, params, ip: clientIp(req), json, raw });
}

