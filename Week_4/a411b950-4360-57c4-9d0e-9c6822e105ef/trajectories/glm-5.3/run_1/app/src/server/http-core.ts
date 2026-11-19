import { IncomingMessage, ServerResponse } from "node:http";
import { AppError } from "./errors.js";

/**
 * Minimal request/response plumbing with the API's single error shape and the
 * error precedence from the brief: method, origin, size, JSON, session,
 * resource, expiry, version, conflicts, media, validation, dependency.
 */

export interface RouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Buffer;
  cookies: Record<string, string>;
  ip: string;
}

export type Handler = (context: RouteContext) => Promise<unknown>;

export interface RouteMatch {
  params: Record<string, string>;
  handler: Handler;
  allowedMethods: string[];
}

export class Router {
  private readonly routes: { method: string; pattern: string; segments: string[]; handler: Handler }[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      segments: pattern.split("/").filter((segment) => segment.length > 0),
      handler,
    });
  }

  /** Returns the match, or the 405/404 the precedence rules demand. */
  match(method: string, path: string): RouteMatch | "method_not_allowed" | "not_found" {
    const wanted = path.split("/").filter((segment) => segment.length > 0);
    const allowed = new Set<string>();
    let matchedOtherMethod = false;
    for (const route of this.routes) {
      const params = matchSegments(route.segments, wanted);
      if (!params) continue;
      if (route.method !== method) {
        allowed.add(route.method);
        matchedOtherMethod = true;
        continue;
      }
      return { params, handler: route.handler, allowedMethods: [...allowed] };
    }
    return matchedOtherMethod ? "method_not_allowed" : "not_found";
  }
}

function matchSegments(pattern: string[], wanted: string[]): Record<string, string> | null {
  if (pattern.length !== wanted.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const segment = pattern[index];
    if (segment.startsWith(":")) {
      params[segment.slice(1)] = decodeURIComponent(wanted[index]);
    } else if (segment !== wanted[index]) {
      return null;
    }
  }
  return params;
}

export function readCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const pair of header.split(";")) {
    const equals = pair.indexOf("=");
    if (equals < 0) continue;
    const name = pair.slice(0, equals).trim();
    const value = pair.slice(equals + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}
