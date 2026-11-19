import { request } from './api.js';
import type { Org, Role, User } from '../shared/types.js';

export interface Identity {
  readonly user: User;
  readonly org: Org;
  readonly project_ids: string[];
}

let identity: Identity | null = null;

export const currentIdentity = (): Identity | null => identity;

export const loadIdentity = async (): Promise<Identity | null> => {
  try {
    identity = await request<Identity>('/api/me');
    return identity;
  } catch {
    identity = null;
    return null;
  }
};

export const landingRoute = (role: Role): string => (role === 'billing' ? '/console/usage' : '/console/projects');

type Listener = () => void;

/**
 * The console's view of its dependencies. The storage banner is sticky until the
 * next request that touches storage succeeds; billing follows the server's probe.
 */
class ServiceStatus {
  private storage = false;
  private billing = true;
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  get storageDown(): boolean {
    return this.storage;
  }

  get billingDown(): boolean {
    return !this.billing;
  }

  noteStorageFailure(): void {
    if (this.storage) return;
    this.storage = true;
    this.notify();
  }

  noteStorageSuccess(): void {
    if (!this.storage) return;
    this.storage = false;
    this.notify();
  }

  setBillingReachable(reachable: boolean): void {
    if (this.billing === reachable) return;
    this.billing = reachable;
    this.notify();
  }
}

export const serviceStatus = new ServiceStatus();

export const permissions: Record<string, readonly Role[]> = {
  projects: ['admin', 'developer', 'reviewer', 'approver', 'billing'],
  usage: ['admin', 'billing'],
  members: ['admin'],
  plan: ['admin'],
  keys: ['admin', 'developer'],
  sessions: ['admin', 'developer', 'reviewer', 'approver'],
  review: ['admin', 'developer', 'reviewer', 'approver'],
  synthesis: ['admin', 'developer'],
  settings: ['admin'],
  search: ['admin', 'developer', 'reviewer', 'approver'],
  stop: ['admin', 'developer'],
  decide: ['approver'],
  write_corrections: ['reviewer', 'approver'],
};

export const may = (role: Role, action: keyof typeof permissions | string): boolean =>
  (permissions[action] ?? []).includes(role);
