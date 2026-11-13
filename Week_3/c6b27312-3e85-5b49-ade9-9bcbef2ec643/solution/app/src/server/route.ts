// Route definitions: a method, a path with :names, a handler and how a storage failure in it is answered.
import type { Ctx } from "./http";
import type { Reply } from "./reply";

export const HANDLED = Symbol("handled");
export type Handler = (ctx: Ctx) => Promise<Reply | typeof HANDLED>;

export interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  handler: Handler;
  /** Which outage copy a storage failure in this route answers with. */
  outage: "download" | "save" | null;
  needsDatabase: boolean;
}

type RouteOptions = Partial<Pick<Route, "outage" | "needsDatabase">>;

function route(method: string, path: string, handler: Handler, options: RouteOptions): Route {
  const names: string[] = [];
  const source = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:(\w+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return { method, pattern: new RegExp(`^${source}$`), names, handler, outage: options.outage ?? null, needsDatabase: options.needsDatabase ?? true };
}

export const get = (path: string, handler: Handler, options: RouteOptions = {}) => route("GET", path, handler, options);
export const post = (path: string, handler: Handler, options: RouteOptions = {}) => route("POST", path, handler, options);
export const put = (path: string, handler: Handler) => route("PUT", path, handler, {});
export const del = (path: string, handler: Handler) => route("DELETE", path, handler, {});
