/** The signed-in user and the published landing route for each role and status. */

import { api, ApiError } from './api.js';
import { replace } from './router.js';
import type { SessionUser } from '../shared/types.js';

let current: SessionUser | null = null;
let loaded = false;
let focusEmailOnSignIn = false;

export function currentUser(): SessionUser | null {
  return current;
}

export function setCurrentUser(user: SessionUser | null): void {
  current = user;
  loaded = true;
}

export async function ensureUser(): Promise<SessionUser | null> {
  if (loaded) return current;
  try {
    const answer = await api.get<{ user: SessionUser }>('/api/me');
    current = answer.user;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    current = null;
  }
  loaded = true;
  return current;
}

/** Where each user lands after applying, signing in, or opening a screen they cannot use. */
export function landingFor(user: SessionUser): string {
  if (user.role === 'operator') return '/operator';
  if (user.role === 'shift_lead') return '/shift';
  if (user.renter_status === 'applied' || user.renter_status === 'documents_review') {
    return '/kitchen';
  }
  return '/board';
}

export async function signOut(): Promise<void> {
  await api.del('/api/session').catch(() => undefined);
  current = null;
  loaded = true;
  focusEmailOnSignIn = true;
  replace('/');
}

export function takeSignOutFocus(): boolean {
  const value = focusEmailOnSignIn;
  focusEmailOnSignIn = false;
  return value;
}
