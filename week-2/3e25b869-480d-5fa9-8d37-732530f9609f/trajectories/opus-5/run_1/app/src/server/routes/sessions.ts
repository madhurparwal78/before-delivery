import { isLocale, type Locale, type StaffRole } from '../../shared/types.js';
import { db } from '../db/pool.js';
import { COOKIE, type Customer, type RequestContext, type StaffMember } from '../http/context.js';
import { openSession } from '../http/cookies.js';
import { errors } from '../http/errors.js';

export async function loadCustomer(ctx: RequestContext): Promise<Customer | null> {
  const session = openSession(ctx.cookies.get(COOKIE.session));
  const email = session?.['email'];
  if (!email) return null;
  const result = await db.query<{ id: string; email: string; locale: string }>(
    'SELECT id, email, locale FROM customers WHERE email = $1',
    [email],
  );
  const row = result.rows[0];
  if (!row) return null;
  const locale: Locale = isLocale(row.locale) ? row.locale : 'en-CA';
  return { id: row.id, email: row.email, locale };
}

export async function loadStaff(ctx: RequestContext): Promise<StaffMember | null> {
  const session = openSession(ctx.cookies.get(COOKIE.staff));
  const email = session?.['email'];
  if (!email) return null;
  const result = await db.query<{ email: string; name: string; role: StaffRole }>(
    'SELECT email, name, role FROM staff WHERE email = $1',
    [email],
  );
  return result.rows[0] ?? null;
}

export function requireStaff(ctx: RequestContext): StaffMember {
  if (!ctx.staff) throw errors.unauthenticated();
  return ctx.staff;
}

export function requireRole(ctx: RequestContext, roles: readonly StaffRole[]): StaffMember {
  const staff = requireStaff(ctx);
  if (!roles.includes(staff.role)) throw errors.forbidden();
  return staff;
}

export function requireCustomer(ctx: RequestContext): Customer {
  if (!ctx.customer) throw errors.unauthenticated();
  return ctx.customer;
}
