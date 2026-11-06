import type { ServerResponse, IncomingMessage } from 'node:http';
import { AppError } from './errors.js';
import { Caller, Role } from './context.js';

/** Role checks before any lookup (API error precedence step 6). */
export function requireRole(caller: Caller | null, roles: Array<Role | 'token'>): void {
  if (!caller) throw new AppError(401, 'unauthenticated');
  if (caller.type === 'token') {
    if (roles.includes('token')) return;
    // A token acts as the farrier wherever its scope covers the route (DP-82);
    // the dispatcher refuses the uncovered routes before this check.
    if (roles.includes('farrier')) return;
    throw new AppError(403, 'insufficient_scope');
  }
  if (roles.includes(caller.role as Role)) return;
  throw new AppError(403, 'forbidden');
}

export function requireTokenScope(caller: Caller | null, need: 'read_only' | 'billing'): void {
  if (!caller) throw new AppError(401, 'unauthenticated');
  if (caller.type === 'token') {
    if (caller.scope === 'billing' || (caller.scope === 'read_only' && need === 'read_only')) return;
    throw new AppError(403, 'insufficient_scope');
  }
}

/** Tokens act as the farrier on every route their scope covers (DP-82). */
export function tokenAllowsFarrierGet(caller: Caller | null, path: string): boolean {
  if (!caller || caller.type !== 'token') return true;
  if (path.startsWith('/api/tokens') || path.startsWith('/api/audit') || path.startsWith('/api/jobs')) return false;
  if (path.includes('/events')) return false;
  if (caller.scope === 'read_only' && (path.startsWith('/api/invoices') || path.startsWith('/api/payments'))) return false;
  return true;
}

export function requireSession(caller: Caller | null): Caller {
  if (!caller) throw new AppError(401, 'unauthenticated');
  if (caller.type === 'token') throw new AppError(403, 'forbidden');
  return caller;
}

export function isFarrierRole(caller: Caller | null): boolean {
  if (!caller) return false;
  if (caller.type === 'token') return true;
  return caller.role === 'farrier';
}

export function isStaffRole(caller: Caller | null): boolean {
  if (!caller) return false;
  if (caller.type === 'token') return true;
  return caller.role === 'farrier' || caller.role === 'apprentice';
}
