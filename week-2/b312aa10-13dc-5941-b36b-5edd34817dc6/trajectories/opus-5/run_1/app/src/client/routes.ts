/** Which screens each role reaches, and which return addresses are honoured. */

export type Role = 'operator' | 'shift_lead' | 'member';

export const screenPaths = [
  '/board',
  '/bookings',
  '/documents',
  '/invoices',
  '/reports',
  '/sanitation',
  '/settings',
] as const;

export type ScreenPath = (typeof screenPaths)[number];

const navigationByRole: Record<Role, ScreenPath[]> = {
  member: ['/board', '/bookings', '/documents', '/invoices'],
  shift_lead: ['/board', '/documents', '/sanitation'],
  operator: [
    '/board',
    '/bookings',
    '/documents',
    '/invoices',
    '/reports',
    '/sanitation',
    '/settings',
  ],
};

export const screenTitles: Record<ScreenPath, string> = {
  '/board': 'Line board',
  '/bookings': 'Bookings',
  '/documents': 'Documents',
  '/invoices': 'Invoices',
  '/reports': 'Reports',
  '/sanitation': 'Sanitation',
  '/settings': 'Settings',
};

export function navigationFor(role: Role): ScreenPath[] {
  return navigationByRole[role];
}

export function roleReaches(role: Role, path: string): boolean {
  return navigationByRole[role].includes(path as ScreenPath);
}

export function isScreenPath(path: string): path is ScreenPath {
  return (screenPaths as readonly string[]).includes(path);
}

/** A `next` address is honoured only for the published signed-in screens. */
export function validNext(raw: string | null): string | null {
  if (raw === null) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded)) return null;
  if (decoded.startsWith('//')) return null;
  if (decoded.includes('#')) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded)) return null;
  const queryAt = decoded.indexOf('?');
  const path = queryAt < 0 ? decoded : decoded.slice(0, queryAt);
  if (!isScreenPath(path)) return null;
  return decoded;
}

export function signInAddressFor(path: string, search: string): string {
  return `/?next=${encodeURIComponent(`${path}${search}`)}`;
}
