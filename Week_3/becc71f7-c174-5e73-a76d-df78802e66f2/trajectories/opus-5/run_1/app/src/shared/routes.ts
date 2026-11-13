/** Every published screen route. Reloading a route, or opening it fresh, shows its screen. */
export const SCREEN_ROUTES = [
  '/',
  '/pieces/:pieceId',
  '/h/:token',
  '/c/:token',
  '/appointments',
  '/appointments/cancel/:token',
  '/sign-in',
  '/staff/pieces',
  '/staff/pieces/:pieceId',
  '/staff/till',
  '/staff/sales/:saleId',
  '/staff/holds',
  '/staff/holds/:holdId',
  '/staff/appointments',
  '/staff/consignors',
  '/staff/consignors/:consignorId',
  '/staff/ladder',
  '/staff/payouts',
  '/staff/payouts/:month',
  '/staff/import',
  '/staff/sales-book',
  '/staff/members',
] as const;

export type ScreenRoute = (typeof SCREEN_ROUTES)[number];

export interface RouteMatch {
  pattern: ScreenRoute;
  params: Record<string, string>;
}

export function matchScreenRoute(pathname: string): RouteMatch | null {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  for (const pattern of SCREEN_ROUTES) {
    const expected = pattern.split('/').filter((segment) => segment !== '');
    if (expected.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let fits = true;
    for (let index = 0; index < expected.length; index += 1) {
      const slot = expected[index] as string;
      const actual = segments[index] as string;
      if (slot.startsWith(':')) {
        params[slot.slice(1)] = actual;
      } else if (slot !== actual) {
        fits = false;
        break;
      }
    }
    if (fits) return { pattern, params };
  }
  return null;
}

export const HOME_ROUTES = {
  owner: '/staff/consignors',
  assistant: '/staff/pieces',
  bookkeeper: '/staff/sales-book',
} as const;
