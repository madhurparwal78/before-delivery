import type { Role, SessionUser } from '../../shared/api.js';
import { apiError } from './errors.js';

export function requireRole(user: SessionUser, ...allowed: Role[]): SessionUser {
  if (!allowed.includes(user.role)) throw apiError('forbidden');
  return user;
}
