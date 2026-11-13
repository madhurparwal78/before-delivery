import { MAX_JSON_BYTES, MAX_PHOTO_BYTES } from '../../shared/constants';
import { boardRoutes } from './boards';
import { holdRoutes } from './holds';
import { invoiceRoutes } from './invoices';
import { layoutRoutes } from './layouts';
import { metaRoutes } from './meta';
import { photoRoutes } from './photos';
import { ticketRoutes } from './tickets';
import { Route } from './types';
import { yardRoutes } from './yard';

export const routes: Route[] = [
  ...metaRoutes,
  ...boardRoutes,
  ...photoRoutes,
  ...yardRoutes,
  ...layoutRoutes,
  ...holdRoutes,
  ...ticketRoutes,
  ...invoiceRoutes
];

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
  methodMatches: boolean;
}

function matchPattern(pattern: string, segments: string[]): Record<string, string> | null {
  const parts = pattern.split('/').filter((part) => part !== '');
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let at = 0; at < parts.length; at += 1) {
    const part = parts[at] ?? '';
    const segment = segments[at] ?? '';
    if (part.startsWith(':')) {
      if (segment === '') return null;
      params[part.slice(1)] = segment;
    } else if (part !== segment) {
      return null;
    }
  }
  return params;
}

export function matchRoute(method: string, pathname: string): RouteMatch | null {
  const segments = pathname
    .split('/')
    .filter((part) => part !== '')
    .map((part) => decodeURIComponent(part));
  let fallback: RouteMatch | null = null;
  for (const candidate of routes) {
    const params = matchPattern(candidate.pattern, segments);
    if (params === null) continue;
    if (candidate.method === method) return { route: candidate, params, methodMatches: true };
    fallback = fallback ?? { route: candidate, params, methodMatches: false };
  }
  return fallback;
}

/** The body limit that applies before a route is known. */
export function bodyLimitFor(match: RouteMatch | null): number {
  return match !== null && match.route.bodyKind === 'photo' ? MAX_PHOTO_BYTES : MAX_JSON_BYTES;
}
