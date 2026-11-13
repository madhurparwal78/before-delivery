import type { Ctx } from './context';

export type Handler = (ctx: Ctx) => Promise<void>;

export interface Route {
  readonly segments: readonly string[];
  readonly methods: Readonly<Record<string, Handler>>;
  readonly upload: boolean;
  readonly open: boolean;
}

export interface RouteOptions {
  upload?: boolean;
  open?: boolean;
}

export function route(pattern: string, methods: Record<string, Handler>, options: RouteOptions = {}): Route {
  return {
    segments: pattern.split('/').filter((segment) => segment.length > 0),
    methods,
    upload: options.upload === true,
    open: options.open === true,
  };
}

export interface Match {
  route: Route;
  params: Record<string, string>;
}

export function matchRoute(routes: readonly Route[], path: string): Match | null {
  const parts = path.split('/').filter((segment) => segment.length > 0);
  for (const candidate of routes) {
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < parts.length; index += 1) {
      const expected = candidate.segments[index] as string;
      const actual = parts[index] as string;
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = safeDecode(actual);
        continue;
      }
      if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
