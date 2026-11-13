// The API: one precedence chain for every error, from origin to provider calls (DP-52).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { problems, problemJson, type Json, type Problem } from '../shared/problems.js';

export type { Problem, Json };

export interface ApiRequest {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
}

export type ApiHandler = (request: ApiRequest) => Promise<{ status: number; body?: Json; headers?: Record<string, string> } | void>;

export interface ApiRoute {
  method: string;
  path: string;
  handler: ApiHandler;
  options: {
    stateChanging: boolean;
    keyed: boolean;
    conditional: boolean;
    rawBody: boolean;
  };
}

export function apiRoute(
  method: string,
  path: string,
  handler: ApiHandler,
  options: Partial<ApiRoute['options']> = {},
): ApiRoute {
  return {
    method,
    path,
    handler,
    options: {
      stateChanging: options.stateChanging ?? (method !== 'GET' && method !== 'HEAD'),
      keyed: options.keyed ?? false,
      conditional: options.conditional ?? false,
      rawBody: options.rawBody ?? false,
    },
  };
}

export function matchPath(pattern: string, pathname: string): { [name: string]: string } | null {
  const patternParts = pattern.split('/').filter((p) => p !== '');
  const pathParts = pathname.split('/').filter((p) => p !== '');
  if (patternParts.length !== pathParts.length) return null;
  const params: { [name: string]: string } = {};
  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i]!;
    const actual = pathParts[i]!;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

export function writeProblem(res: ServerResponse, problem: Problem): void {
  const payload = Buffer.from(problemJson(problem));
  res.writeHead(problem.status, {
    'Content-Type': 'application/problem+json; charset=utf-8',
    'Content-Length': String(payload.length),
    'Cache-Control': 'no-store',
    ...problem.headers,
  });
  res.end(payload);
}

export function writeJson(res: ServerResponse, status: number, body: Json, headers: Record<string, string> = {}): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.length),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export { problems };
