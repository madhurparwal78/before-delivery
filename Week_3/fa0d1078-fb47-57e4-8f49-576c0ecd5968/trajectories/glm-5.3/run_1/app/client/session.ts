// The session state shared by every page, with the sign-in redirect for
// signed-out visitors: every page except the public ones sends a signed-out
// visitor to /signin, and after signing in they return to the page they
// asked for.

import { api } from './api.js';
import type { Player } from '../shared/api.js';

export interface SessionState {
  player: Player | null;
  ready: boolean;
}

const PUBLIC_PATHS = ['/', '/signin', '/signup', '/reset'];

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.includes(path)) return true;
  if (path.startsWith('/verify/')) return true;
  if (path.startsWith('/reset/')) return true;
  return false;
}

export class Session {
  player: Player | null = null;
  ready = false;
  private listeners: Array<() => void> = [];

  async load(): Promise<void> {
    try {
      const me = await api.get<{ player: Player }>('/api/me');
      this.player = me.player;
    } catch {
      this.player = null;
    }
    this.ready = true;
    this.notify();
  }

  setPlayer(player: Player | null): void {
    this.player = player;
    this.ready = true;
    this.notify();
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  async signOut(): Promise<void> {
    await api.post('/api/auth/signout');
    this.player = null;
    this.notify();
  }

  // A signed-out visitor on a private page is sent to /signin with a return
  // path; the sign-in page returns them to the page they asked for.
  needsRedirect(pathname: string): boolean {
    return this.ready && this.player === null && !isPublicPath(pathname);
  }
}

export const session = new Session();
