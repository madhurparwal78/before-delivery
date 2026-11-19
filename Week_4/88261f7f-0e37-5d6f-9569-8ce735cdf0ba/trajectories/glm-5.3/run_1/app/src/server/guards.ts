import type { Request, Response, NextFunction } from 'express';
import { pool } from './db.js';
import { err } from './errors.js';
import type { SessionUser } from './auth.js';

export interface HotelContext {
  hotelId: string;
  name: string;
  timeZone: string;
  businessDate: string;
}

export async function hotelNow(hotelId: string): Promise<{ now: Date; timeZone: string; businessDate: string; name: string }> {
  const res = await pool.query(
    'SELECT name, time_zone, business_date, clock_fixed_at FROM hotels WHERE id = $1', [hotelId]);
  const row = res.rows[0];
  if (!row) throw err.notFound();
  const fixed = row.clock_fixed_at ? new Date(row.clock_fixed_at) : null;
  const now = fixed ?? new Date();
  return { now, timeZone: row.time_zone, businessDate: row.business_date, name: row.name };
}

export function requireSignIn() {
  return async (req: Request & { user?: SessionUser }, res: Response, next: NextFunction) => {
    const token = req.sessionToken;
    if (!token) return next(err.unauthorized());
    const sess = await pool.query(
      'SELECT u.id, u.hotel_id, u.email, u.name, u.role, s.user_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1',
      [token]);
    const row = sess.rows[0];
    if (!row) return next(err.unauthorized());
    req.user = { id: row.id, hotelId: row.hotel_id, email: row.email, name: row.name, role: row.role };
    next();
  };
}

export function requireRole(...roles: Array<'owner' | 'front_desk' | 'housekeeper'>) {
  return (req: Request & { user?: SessionUser }, _res: Response, next: NextFunction) => {
    if (!req.user) return next(err.unauthorized());
    if (!roles.includes(req.user.role)) return next(err.notFound());
    next();
  };
}
