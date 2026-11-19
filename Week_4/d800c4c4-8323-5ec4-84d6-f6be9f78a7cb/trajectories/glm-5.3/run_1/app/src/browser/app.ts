// App state: the signed-in user, service status, announcements, refresh loops.

import { apiJson, ApiFailure } from './apiClient';
import type { Board, Me, ServiceStatus, User } from './types';

export interface AppSnapshot {
  me: Me | null;
  status: ServiceStatus;
  board: Board | null;
}

type Listener = () => void;

export class App {
  me: Me | null = null;
  status: ServiceStatus = { storage: 'up', billing: 'up' };
  board: Board | null = null;
  authError: 'none' | 'session-ended' = 'none';
  private listeners: Set<Listener> = new Set();
  private statusTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.statusTimer = setInterval(() => void this.refreshStatus(), 10000);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  async loadMe(): Promise<void> {
    try {
      this.me = await apiJson<Me>('GET', '/api/me');
      this.authError = 'none';
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) {
        this.me = null;
        this.sessionEndedFromBackground(err.error);
      }
    }
    this.emit();
  }

  async refreshStatus(): Promise<void> {
    try {
      this.status = await apiJson<ServiceStatus>('GET', '/api/status');
    } catch {
      // leave the last known state
    }
    this.emit();
  }

  async refreshBoard(): Promise<void> {
    try {
      this.board = await apiJson<Board>('GET', '/api/board');
      this.emit();
    } catch {
      // leave the last board
    }
  }

  user(): User | null {
    return this.me === null ? null : this.me.user;
  }

  role(): 'coordinator' | 'volunteer' | 'member' | null {
    const user = this.user();
    return user === null ? null : user.role;
  }

  /** A background read answered 401: nothing on screen changes; the session has ended. */
  private sessionEndedFromBackground(message: string): void {
    if (message.includes('session has ended')) {
      this.authError = 'session-ended';
    }
  }

  clearSession(): void {
    this.me = null;
    this.emit();
  }

  stop(): void {
    if (this.statusTimer !== null) clearInterval(this.statusTimer);
  }
}
