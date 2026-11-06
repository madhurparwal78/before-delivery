import type { Db, Tx } from "./db.js";
import type { User } from "./users.js";
import { ApiError } from "./errors.js";
import type { Request } from "./http.js";
import { one, rows } from "./db.js";

export type RouteContext = {
  req: Request;
  url: URL;
  user: User | null;
  db: Tx;
  now: Date;
};

export type RouteHandler = (ctx: RouteContext) => Promise<Response | null>;

export type Route = {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
  requireAuth: "none" | "any" | "renter" | "staff" | "operator";
};

const compiled: Route[] = [];

export const route = (
  method: string,
  path: string,
  requireAuth: Route["requireAuth"],
  handler: RouteHandler,
): void => {
  const paramNames: string[] = [];
  const regexSource = path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  compiled.push({ method, pattern: new RegExp(`^${regexSource}$`), paramNames, handler, requireAuth });
};

export const matchRoute = (
  method: string,
  path: string,
): { route: Route; params: Record<string, string> } | null => {
  for (const entry of compiled) {
    const match = entry.pattern.exec(path);
    if (!match) continue;
    if (entry.method !== method) {
      // Method mismatch on a known path is reported by the router caller.
      continue;
    }
    const params: Record<string, string> = {};
    entry.paramNames.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1]!);
    });
    return { route: entry, params };
  }
  return null;
};

export const pathMatches = (path: string): boolean =>
  compiled.some((entry) => entry.pattern.test(path));

export const requireUser = (ctx: RouteContext): User => {
  if (!ctx.user) throw ApiError.unauthenticated();
  return ctx.user;
};

export const requireRenter = (ctx: RouteContext): { user: User; renterId: string } => {
  const user = requireUser(ctx);
  if (user.role !== "renter" || !user.renter_id) throw ApiError.forbidden();
  return { user, renterId: user.renter_id };
};

export const requireStaff = (ctx: RouteContext): User => {
  const user = requireUser(ctx);
  if (user.role !== "operator" && user.role !== "shift_lead") throw ApiError.forbidden();
  return user;
};

export const requireOperator = (ctx: RouteContext): User => {
  const user = requireUser(ctx);
  if (user.role !== "operator") throw ApiError.forbidden();
  return user;
};

// A renter may only read their own records. Any other renter's identifier
// answers 404, exactly like an unknown identifier (DP-05).
export const renterScoped = (ctx: RouteContext, renterId: string): void => {
  if (ctx.user?.role === "operator" || ctx.user?.role === "shift_lead") return;
  if (ctx.user?.role === "renter" && ctx.user.renter_id === renterId) return;
  if (ctx.user?.role === "renter") throw ApiError.notFound();
  throw ApiError.forbidden();
};

export const findRenter = async (db: Db, renterId: string): Promise<{
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone: string;
  status: string;
  created_at: Date;
}> => {
  const found = await one<{
    id: string;
    business_name: string;
    contact_name: string;
    email: string;
    phone: string;
    status: string;
    created_at: Date;
  }>(
    db,
    "select id, business_name, contact_name, email, phone, status, created_at from renters where id = $1",
    [renterId],
  );
  if (!found) throw ApiError.notFound();
  return found;
};

export const loadRenterOr404 = findRenter;

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

export const noContent = (): Response => new Response(null, { status: 204 });

export const redirect = (location: string, status = 302): Response =>
  new Response(null, { status, headers: { Location: location } });

export const parseJsonBody = <T>(ctx: RouteContext): T => {
  if (!ctx.req.body) throw ApiError.validationError({ body: "A JSON body is required." });
  try {
    return JSON.parse(ctx.req.body.toString("utf8")) as T;
  } catch {
    throw ApiError.validationError({ body: "The body is not valid JSON." });
  }
};

export const queryEntries = (rowsData: unknown): unknown[] => (Array.isArray(rowsData) ? rowsData : []);

export { rows };
