/** The page routes of each role, and the one return-path check. */

export type Role = 'grower' | 'operator' | 'dispatcher' | 'clerk' | 'reviewer';

export type RouteName =
  | 'sign-in'
  | 'grower-home'
  | 'order-new'
  | 'order'
  | 'field'
  | 'board'
  | 'capacity'
  | 'restriction'
  | 'contractors'
  | 'packs'
  | 'pack-new'
  | 'pack'
  | 'review';

export interface RouteMatch {
  name: RouteName;
  params: Record<string, string>;
}

const PATTERNS: ReadonlyArray<{ name: RouteName; pattern: RegExp; keys: readonly string[] }> = [
  { name: 'sign-in', pattern: /^\/sign-in$/, keys: [] },
  { name: 'grower-home', pattern: /^\/grower$/, keys: [] },
  { name: 'order-new', pattern: /^\/grower\/orders\/new$/, keys: [] },
  { name: 'order', pattern: /^\/orders\/([A-Za-z0-9-]+)$/, keys: ['orderNumber'] },
  { name: 'field', pattern: /^\/field$/, keys: [] },
  { name: 'board', pattern: /^\/board$/, keys: [] },
  { name: 'capacity', pattern: /^\/channels\/([A-Za-z0-9-]+)\/capacity$/, keys: ['channelId'] },
  { name: 'restriction', pattern: /^\/restrictions\/([A-Za-z0-9-]+)$/, keys: ['restrictionId'] },
  { name: 'contractors', pattern: /^\/contractors$/, keys: [] },
  { name: 'pack-new', pattern: /^\/packs\/new$/, keys: [] },
  { name: 'packs', pattern: /^\/packs$/, keys: [] },
  { name: 'pack', pattern: /^\/packs\/([A-Za-z0-9-]+)$/, keys: ['packId'] },
  { name: 'review', pattern: /^\/review$/, keys: [] },
];

export const ROLE_HOME: Record<Role, string> = {
  grower: '/grower',
  operator: '/field',
  dispatcher: '/board',
  clerk: '/packs',
  reviewer: '/review',
};

export const ROLE_ROUTES: Record<Role, readonly RouteName[]> = {
  grower: ['grower-home', 'order-new', 'order'],
  operator: ['field'],
  dispatcher: ['board', 'capacity', 'restriction', 'order', 'contractors'],
  clerk: ['packs', 'pack-new', 'pack', 'capacity', 'restriction', 'order', 'contractors'],
  reviewer: ['review', 'pack', 'capacity', 'restriction'],
};

export function matchRoute(pathname: string): RouteMatch | null {
  for (const entry of PATTERNS) {
    const found = entry.pattern.exec(pathname);
    if (!found) continue;
    const params: Record<string, string> = {};
    entry.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(found[index + 1] as string);
    });
    return { name: entry.name, params };
  }
  return null;
}

function isPageRouteOfRole(pathname: string, role: Role): boolean {
  const match = matchRoute(pathname);
  if (!match) return false;
  return (ROLE_ROUTES[role] as readonly RouteName[]).includes(match.name);
}

/**
 * A return path is followed only when it starts with exactly one slash and its
 * pathname is a page route of the signed-in role.
 */
export function isReturnPathAllowed(returnPath: string, role: Role): boolean {
  if (!returnPath.startsWith('/')) return false;
  if (returnPath.startsWith('//') || returnPath.startsWith('/\\')) return false;
  const queryStart = returnPath.search(/[?#]/);
  const pathname = queryStart === -1 ? returnPath : returnPath.slice(0, queryStart);
  return isPageRouteOfRole(pathname, role);
}
