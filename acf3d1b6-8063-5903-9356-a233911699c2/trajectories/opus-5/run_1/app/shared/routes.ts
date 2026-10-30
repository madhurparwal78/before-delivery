export const PUBLIC_ROUTES = [
  '/',
  '/product',
  '/pricing',
  '/team-plan',
  '/enterprise',
  '/enterprise-contact',
  '/model-licensing',
  '/examples',
  '/use-cases',
  '/workflows',
  '/research',
  '/resources',
  '/privacy',
  '/signup',
  '/login',
  '/invite/:token'
];

export const STUDIO_ROUTES = [
  '/studio',
  '/studio/projects',
  '/studio/projects/:id',
  '/studio/generations/:id',
  '/studio/credits',
  '/studio/team'
];

function matches(pattern: string, path: string): boolean {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, index) => part.startsWith(':') || part === pathParts[index]);
}

export type RouteKind = 'public' | 'studio' | 'none';

export function routeKind(path: string): RouteKind {
  const clean = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  if (PUBLIC_ROUTES.some((route) => matches(route, clean))) return 'public';
  if (STUDIO_ROUTES.some((route) => matches(route, clean))) return 'studio';
  return 'none';
}
