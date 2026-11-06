import { type Ctx } from "./http.js";

export type Handler = (ctx: Ctx) => Promise<void>;

export interface OutageCopy {
  billing?: string;
  storage?: string;
}

export interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  outage: OutageCopy;
}

export function route(method: string, pattern: string, handler: Handler, outage: OutageCopy = {}): Route {
  return { method, segments: pattern.split("/").filter((part) => part.length > 0), handler, outage };
}

export function pathSegments(pathname: string): string[] {
  return pathname.split("/").filter((part) => part.length > 0);
}

export function matchRoute(
  routes: Route[],
  method: string,
  segments: string[],
): { handler: Handler; params: Record<string, string>; outage: OutageCopy } | null {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < candidate.segments.length; index += 1) {
      const expected = candidate.segments[index] ?? "";
      const actual = segments[index] ?? "";
      if (expected.startsWith(":")) {
        params[expected.slice(1)] = decodeURIComponent(actual);
        continue;
      }
      if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { handler: candidate.handler, params, outage: candidate.outage };
  }
  return null;
}
