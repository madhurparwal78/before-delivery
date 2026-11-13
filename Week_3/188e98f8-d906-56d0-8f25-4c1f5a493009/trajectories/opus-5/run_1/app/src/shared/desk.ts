/** Roles, desk paths and the sign-in landing rule, decided here only. */

export const ROLES = ['quizmaster', 'marker', 'captain'] as const;
export type Role = (typeof ROLES)[number];

export const DESK_PATHS = {
  quizmaster: '/quizmaster',
  marker: '/marker',
  captain: '/captain',
} as const;

export const PAGE_PATHS = ['/', '/sign-in', '/captain', '/marker', '/quizmaster', '/archive'] as const;
export type PagePath = (typeof PAGE_PATHS)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** The desk a role lands on after sign-in or a redirect. */
export function deskPath(role: Role): string {
  return DESK_PATHS[role];
}

/** Whether a role may open a page path, the archive included. */
export function mayOpenPath(role: Role, path: string): boolean {
  if (path === '/archive') return role === 'marker' || role === 'quizmaster';
  return path === deskPath(role);
}

export const DESK_ONLY_PATHS = ['/captain', '/marker', '/quizmaster', '/archive'] as const;

export function isDeskOnlyPath(path: string): boolean {
  return (DESK_ONLY_PATHS as readonly string[]).includes(path);
}

export function isPagePath(path: string): path is PagePath {
  return (PAGE_PATHS as readonly string[]).includes(path);
}
