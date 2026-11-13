// Reads shared by the policy, service and maintenance screens.
import { api } from '../../lib/api.js';

// listAll fetches every item of a list endpoint, following cursors when the server pages it. Null when a request fails.
export async function listAll(path) {
  const items = [];
  let after = null;
  for (;;) {
    const res = await api.get(after ? `${path}?after=${encodeURIComponent(after)}` : path);
    if (!res.ok) return null;
    if (Array.isArray(res.data)) return res.data;
    items.push(...(res.data.items ?? []));
    if (!res.data.next_cursor) return items;
    after = res.data.next_cursor;
  }
}

export function byName(a, b) {
  if (a.name < b.name) return -1;
  return a.name > b.name ? 1 : 0;
}

// The firm's zone: maintenance banners read the same for everyone.
export const FIRM_ZONE = 'America/Chicago';

// Window states arrive as words in any case; compare lowercase.
export function windowState(window) {
  return String(window.state).toLowerCase();
}

export function canEditPolicies(user) {
  return user?.role === 'lead' || user?.role === 'admin';
}

export function canEditServices(user) {
  return user?.role === 'admin';
}
