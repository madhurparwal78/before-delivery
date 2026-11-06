import { randomUUID } from 'node:crypto';
import { pool, query, queryOne, transaction } from '../db/pool.js';
import { siteInScope } from '../domain/records.js';
import { json, type Ctx, type Reply } from '../http/context.js';
import { ApiError, validation } from '../http/errors.js';
import type { Route } from '../http/router.js';
import { hashPassword } from '../http/session.js';

interface RenterRecord {
  id: string;
  name: string;
  business: string;
  email: string;
  home_site_id: string;
  phone: string;
}

async function searchRenters(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireRole('front_desk', 'manager');
  const term = (ctx.queryValue('q') ?? '').trim();
  const rows = await query<RenterRecord>(
    pool,
    `SELECT id, name, business, email, home_site_id, phone FROM renters
      WHERE operator_id = $1
        AND ($2 = '' OR name ILIKE '%' || $2 || '%' OR business ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%')
      ORDER BY business`,
    [actor.operator_id, term],
  );
  return json(200, {
    renters: rows.map((row) => ({
      id: row.id,
      name: row.name,
      business: row.business,
      email: row.email,
      home_site_id: row.home_site_id,
    })),
  });
}

async function createRenter(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireRole('manager');
  const body = ctx.body();
  const text = (key: string): string => (typeof body[key] === 'string' ? (body[key] as string).trim() : '');
  const name = text('name');
  const business = text('business');
  const email = text('email');
  const phone = text('phone');
  const password = typeof body.password === 'string' ? body.password : '';
  const homeSiteId = text('home_site_id');
  if (homeSiteId !== '') await siteInScope(actor, homeSiteId);

  const fields: Record<string, string> = {};
  if (name === '') fields.name = 'Give the renter’s name.';
  if (business === '') fields.business = 'Give the business name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Give a valid email address.';
  if (phone === '') fields.phone = 'Give a phone number.';
  if (password.length < 10) fields.password = 'Use at least 10 characters.';
  if (homeSiteId === '') fields.home_site_id = 'Choose a home site.';
  if (Object.keys(fields).length > 0) throw validation(fields);

  const taken = await queryOne<{ id: string }>(pool, 'SELECT id FROM users WHERE lower(email) = $1', [
    email.toLowerCase(),
  ]);
  if (taken) throw new ApiError(409, 'email_taken', 'That email already has an account.', {});

  const renterId = `rn-${randomUUID()}`;
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO renters (id, operator_id, name, business, email, phone, home_site_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [renterId, actor.operator_id, name, business, email, phone, homeSiteId],
    );
    await client.query(
      `INSERT INTO users (id, operator_id, site_id, renter_id, email, name, role, password_hash)
       VALUES ($1, $2, NULL, $3, $4, $5, 'renter', $6)`,
      [`us-${renterId}`, actor.operator_id, renterId, email, name, hashPassword(password)],
    );
  });
  return json(201, {
    renter: { id: renterId, name, business, email, home_site_id: homeSiteId, phone },
  });
}

export const renterRoutes: Route[] = [
  { method: 'GET', pattern: '/api/renters', handle: searchRenters },
  { method: 'POST', pattern: '/api/renters', handle: createRenter },
];
