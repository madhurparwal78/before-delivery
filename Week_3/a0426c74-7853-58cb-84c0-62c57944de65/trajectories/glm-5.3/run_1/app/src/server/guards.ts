import { ApiError, ERROR_TEXT } from '../shared/errors.js';
import type { Role } from './auth.js';
import { roleAtLeast, ROLES } from './auth.js';
import type { RequestContext } from './http.js';

// Guards shared by every route: one place decides what a role may do.
export async function requireUser(context: RequestContext): Promise<string> {
  const username = context.username;
  if (!username) throw new ApiError('unauthenticated', 'Sign in first.');
  return username;
}

export async function drawingRole(context: RequestContext, drawingId: string): Promise<{ username: string; role: Role }> {
  const username = await requireUser(context);
  const { roleForDrawing } = await import('./auth.js');
  const role = await roleForDrawing(drawingId, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that drawing.');
  return { username, role };
}

export function requireRole(role: Role, needed: Role): void {
  if (!roleAtLeast(role, needed)) {
    if (needed === 'manage') throw new ApiError('forbidden', 'You need the manage role for that.');
    if (needed === 'edit') throw new ApiError('read_only', 'You can view this drawing but not edit it.');
    throw new ApiError('forbidden', 'Your role is too low for that.');
  }
}

export function validRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export { ERROR_TEXT };
