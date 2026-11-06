export type Role = 'author' | 'editor' | 'contributor' | 'staff';

const LANDING: Readonly<Record<Role, string>> = {
  author: '/studio',
  editor: '/studio/review',
  contributor: '/contribute',
  staff: '/staff',
};

export function landingRoute(role: Role): string {
  return LANDING[role];
}

/** The author area; the editor may open only part of it. */
const AUTHOR_ONLY_PAGES: readonly string[] = [
  '/studio/upload',
  '/studio/plan',
  '/studio/api-keys',
  '/studio/export',
];

/** Whether a signed-in role may open a page. Other roles get the page with 403. */
export function mayOpenPage(role: Role, path: string): boolean {
  if (path.startsWith('/staff')) return role === 'staff';
  if (path.startsWith('/contribute')) return role === 'contributor';
  if (path.startsWith('/studio')) {
    if (role === 'author') return true;
    if (role !== 'editor') return false;
    return !AUTHOR_ONLY_PAGES.includes(path);
  }
  return true;
}

/** Page areas a signed-out visitor is redirected away from. */
export function requiresSignIn(path: string): boolean {
  return (
    path === '/studio' ||
    path.startsWith('/studio/') ||
    path === '/contribute' ||
    path.startsWith('/contribute/') ||
    path === '/staff' ||
    path.startsWith('/staff/')
  );
}

/**
 * After sign-in the browser goes to `next` when it is a same-origin path the
 * role may open, and otherwise to the landing route.
 */
export function destinationAfterSignIn(role: Role, next: string | null): string {
  if (next === null || next === '') return landingRoute(role);
  if (!next.startsWith('/') || next.startsWith('//')) return landingRoute(role);
  const path = next.split('?', 1)[0] ?? next;
  return mayOpenPage(role, path) ? next : landingRoute(role);
}
