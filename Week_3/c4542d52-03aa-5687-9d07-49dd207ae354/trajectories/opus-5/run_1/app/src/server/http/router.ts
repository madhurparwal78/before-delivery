import type { Handler, RequestContext } from "./context.js";

export interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  anonymous: boolean;
}

export function route(method: string, path: string, handler: Handler, anonymous = false): Route {
  return { method, segments: path.split("/").filter((part) => part !== ""), handler, anonymous };
}

export interface Match {
  route: Route;
  params: Record<string, string>;
}

export function matchRoute(routes: readonly Route[], method: string, path: string): Match | "method_mismatch" | null {
  const segments = path.split("/").filter((part) => part !== "");
  let pathMatched = false;
  for (const candidate of routes) {
    if (candidate.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matches = true;
    for (let index = 0; index < segments.length; index += 1) {
      const expected = candidate.segments[index] ?? "";
      const actual = segments[index] ?? "";
      if (expected.startsWith(":")) params[expected.slice(1)] = decodeURIComponent(actual);
      else if (expected !== actual) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    pathMatched = true;
    if (candidate.method === method) return { route: candidate, params };
  }
  return pathMatched ? "method_mismatch" : null;
}

export type { Handler, RequestContext };
