/** The one place that chooses a landing route. */

import type { Role } from '../types.js';

const DESK_ROUTES: Record<string, readonly Role[]> = {
  '/desk': ['office_manager', 'managing_partner', 'staff_accountant', 'outside_bookkeeper'],
  '/rotations': ['office_manager', 'managing_partner'],
  '/reviews': ['office_manager', 'managing_partner'],
  '/people': ['office_manager', 'managing_partner'],
  '/travel': ['staff_accountant', 'outside_bookkeeper'],
  '/billing': ['office_manager', 'managing_partner'],
  '/health': ['office_manager', 'managing_partner'],
  '/import': ['office_manager'],
  '/audit': ['office_manager', 'managing_partner'],
};

export function roleMayOpen(role: Role, path: string): boolean {
  const vaultMatch = /^\/desk\/vaults\/[^/]+$/.exec(path);
  if (vaultMatch !== null) return true;
  return (DESK_ROUTES[path] ?? []).includes(role);
}

function pathPartOf(next: string): string | null {
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  const cut = next.search(/[?#]/);
  const path = cut === -1 ? next : next.slice(0, cut);
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export function safeNext(next: string | null, role: Role, visibleVaultIds: readonly string[]): string | null {
  if (next === null || next === '') return null;
  const path = pathPartOf(next);
  if (path === null) return null;
  const vaultMatch = /^\/desk\/vaults\/([^/]+)$/.exec(path);
  if (vaultMatch !== null) {
    const vaultId = vaultMatch[1] as string;
    return visibleVaultIds.includes(vaultId) ? next : null;
  }
  return roleMayOpen(role, path) ? next : null;
}

export function landingRoute(options: {
  next: string | null;
  role: Role;
  visibleVaultIds: readonly string[];
}): string {
  const safe = safeNext(options.next, options.role, options.visibleVaultIds);
  if (safe !== null) return safe;
  const first = options.visibleVaultIds[0];
  return first === undefined ? '/desk' : `/desk/vaults/${first}`;
}
