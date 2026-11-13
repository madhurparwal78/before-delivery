export const APP_ROUTES = [
  '/',
  '/plans',
  '/markers',
  '/join',
  '/signin',
  '/me',
  '/me/membership',
  '/me/draws',
  '/me/draws/:drawId',
  '/me/results',
  '/me/plan',
  '/me/messages',
  '/me/records',
  '/me/account',
  '/receipts/:receiptId',
  '/staff/members',
  '/staff/members/:memberId',
  '/staff/members/:memberId/results',
  '/staff/members/:memberId/plan',
  '/staff/members/:memberId/plans/:planId',
  '/staff/members/:memberId/blend',
  '/staff/members/:memberId/blends/:blendId',
  '/staff/members/:memberId/messages',
  '/staff/messages',
  '/staff/calendar',
  '/staff/draws/:drawId',
  '/staff/results',
  '/staff/ranges',
  '/staff/receipts',
  '/staff/team',
  '/visit/:token',
] as const;

export type AppRoutePattern = (typeof APP_ROUTES)[number];

export interface RouteMatch {
  pattern: AppRoutePattern;
  params: Record<string, string>;
}

export function matchAppRoute(path: string): RouteMatch | null {
  const segments = path.split('/').filter((segment) => segment !== '');
  for (const pattern of APP_ROUTES) {
    const expected = pattern.split('/').filter((segment) => segment !== '');
    if (expected.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < expected.length; index += 1) {
      const part = expected[index] as string;
      const actual = segments[index] as string;
      if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(actual);
      else if (part !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { pattern, params };
  }
  return null;
}
