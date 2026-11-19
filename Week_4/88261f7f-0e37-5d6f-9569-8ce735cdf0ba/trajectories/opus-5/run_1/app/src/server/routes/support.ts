import { pool } from '../db';
import { isPlainDate, PlainDate } from '../../shared/dates';
import { Hotel, loadHotel } from '../repo/hotels';
import { notFoundError } from '../http/errors';
import { RequestContext } from '../http/router';
import { SessionUser } from '../http/session';

export function signedInUser(ctx: RequestContext): SessionUser {
  if (!ctx.user) throw notFoundError();
  return ctx.user;
}

export async function hotelOf(ctx: RequestContext): Promise<Hotel> {
  const hotel = await loadHotel(pool, signedInUser(ctx).hotelId);
  if (!hotel) throw notFoundError();
  return hotel;
}

export function textField(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  return typeof value === 'string' ? value : '';
}

export function optionalText(body: Record<string, unknown>, name: string): string | null {
  const value = body[name];
  return typeof value === 'string' ? value : null;
}

export function integerField(body: Record<string, unknown>, name: string): number | null {
  const value = body[name];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function dateField(body: Record<string, unknown>, name: string): PlainDate | null {
  const value = body[name];
  return isPlainDate(value) ? value : null;
}

export function queryDate(ctx: RequestContext, name: string): PlainDate | null {
  const value = ctx.url.searchParams.get(name);
  return value !== null && isPlainDate(value) ? value : null;
}

export { isEmailAddress as isEmail } from '../../shared/email';
