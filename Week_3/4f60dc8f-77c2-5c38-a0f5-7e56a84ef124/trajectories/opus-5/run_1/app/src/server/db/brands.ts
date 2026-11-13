import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { CurrencyCode } from '../../shared/money.js';
import { SIGNIN_CODE_MAX_TRIES } from '../domain/signin.js';
import { query, transaction, type Queryable } from './pool.js';

export type ContactRole = 'owner' | 'finance' | 'reviewer';

export type BrandRow = {
  id: string;
  name: string;
  currency: CurrencyCode;
  killbill_account_id: string | null;
  overdue_blocked: boolean;
};

export type ContactRow = {
  id: string;
  brand_id: string;
  role: ContactRole;
  name: string;
  email: string;
};

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const findBrand = async (id: string): Promise<BrandRow | null> =>
  (await query<BrandRow>('SELECT id, name, currency, killbill_account_id, overdue_blocked FROM brands WHERE id = $1', [id]))
    .rows[0] ?? null;

/** One address may belong to both the owner and the finance contact of a brand. */
export const findContactByEmail = async (email: string): Promise<ContactRow | null> =>
  (
    await query<ContactRow>(
      `SELECT id, brand_id, role, name, email FROM contacts WHERE email_lc = $1
       ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'finance' THEN 1 ELSE 2 END, created_at
       LIMIT 1`,
      [email.trim().toLowerCase()],
    )
  ).rows[0] ?? null;

export const contactOfRole = async (
  brandId: string,
  role: ContactRole,
): Promise<ContactRow | null> =>
  (
    await query<ContactRow>(
      'SELECT id, brand_id, role, name, email FROM contacts WHERE brand_id = $1 AND role = $2 LIMIT 1',
      [brandId, role],
    )
  ).rows[0] ?? null;

export type NewBrand = {
  name: string;
  currency: CurrencyCode;
  owner: { name: string; email: string };
  financeEmail: string;
  reviewerEmail: string;
  engagementTitle: string;
};

export type CreatedBrand = { brand: BrandRow; owner: ContactRow; engagementId: string };

export const createBrandWithEngagement = async (input: NewBrand): Promise<CreatedBrand> =>
  transaction(async (client) => {
    const brandId = randomUUID();
    await client.query(
      'INSERT INTO brands (id, name, currency) VALUES ($1, $2, $3)',
      [brandId, input.name, input.currency],
    );
    const owner = await insertContact(client, brandId, 'owner', input.owner.name, input.owner.email);
    await insertContact(client, brandId, 'finance', input.owner.name, input.financeEmail);
    await insertContact(client, brandId, 'reviewer', input.owner.name, input.reviewerEmail);
    const engagementId = await insertEngagement(client, brandId, input.engagementTitle);
    const brand = (
      await client.query<BrandRow>(
        'SELECT id, name, currency, killbill_account_id, overdue_blocked FROM brands WHERE id = $1',
        [brandId],
      )
    ).rows[0];
    return { brand, owner, engagementId };
  });

const insertContact = async (
  client: Queryable,
  brandId: string,
  role: ContactRole,
  name: string,
  email: string,
): Promise<ContactRow> =>
  (
    await client.query<ContactRow>(
      `INSERT INTO contacts (id, brand_id, role, name, email, email_lc)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, brand_id, role, name, email`,
      [randomUUID(), brandId, role, name, email, email.trim().toLowerCase()],
    )
  ).rows[0];

export const insertEngagement = async (
  client: Queryable,
  brandId: string,
  title: string,
): Promise<string> => {
  const id = randomUUID();
  await client.query(
    `INSERT INTO engagements (id, brand_id, reference, title, state)
     VALUES ($1, $2, 'GW-' || nextval('engagement_reference_seq')::text, $3, 'quoted')`,
    [id, brandId, title],
  );
  return id;
};

export const emailTaken = async (emails: readonly string[]): Promise<boolean> =>
  (
    await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM contacts WHERE email_lc = ANY($1::text[])',
      [emails.map((email) => email.trim().toLowerCase())],
    )
  ).rows[0].count !== '0';

export type SessionRow = { id: string; kind: string; contact_id: string | null; brand_id: string | null };

export const createSession = async (
  kind: 'client' | 'studio',
  contactId: string | null,
  brandId: string | null,
): Promise<string> => {
  const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
  await query(
    'INSERT INTO sessions (id, token_hash, kind, contact_id, brand_id) VALUES ($1, $2, $3, $4, $5)',
    [randomUUID(), hashToken(token), kind, contactId, brandId],
  );
  return token;
};

export const findSession = async (token: string): Promise<SessionRow | null> =>
  (
    await query<SessionRow>(
      'SELECT id, kind, contact_id, brand_id FROM sessions WHERE token_hash = $1',
      [hashToken(token)],
    )
  ).rows[0] ?? null;

export const deleteSession = async (token: string): Promise<void> => {
  await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
};

export const countCodeRequestAges = async (
  email: string,
  windowSeconds: number,
): Promise<number[]> =>
  (
    await query<{ age: string }>(
      `SELECT extract(epoch FROM (now() - created_at))::text AS age
       FROM signin_code_requests
       WHERE email_lc = $1 AND created_at > now() - ($2::text || ' seconds')::interval`,
      [email.trim().toLowerCase(), String(windowSeconds)],
    )
  ).rows.map((row) => Number(row.age));

export const recordCodeRequest = async (email: string): Promise<void> => {
  await query('INSERT INTO signin_code_requests (id, email_lc) VALUES ($1, $2)', [
    randomUUID(),
    email.trim().toLowerCase(),
  ]);
};

export const issueSigninCode = async (contactId: string): Promise<string> => {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  await transaction(async (client) => {
    await client.query('UPDATE signin_codes SET dead = true WHERE contact_id = $1 AND dead = false', [
      contactId,
    ]);
    await client.query('INSERT INTO signin_codes (id, contact_id, code) VALUES ($1, $2, $3)', [
      randomUUID(),
      contactId,
      code,
    ]);
  });
  return code;
};

export type CodeRow = { id: string; code: string; tries: number; used: boolean; age: number };

export const liveSigninCode = async (contactId: string): Promise<CodeRow | null> => {
  const row = (
    await query<{ id: string; code: string; tries: number; used: boolean; age: string }>(
      `SELECT id, code, tries, used, extract(epoch FROM (now() - created_at))::text AS age
       FROM signin_codes WHERE contact_id = $1 AND dead = false ORDER BY created_at DESC LIMIT 1`,
      [contactId],
    )
  ).rows[0];
  return row === undefined ? null : { ...row, age: Number(row.age) };
};

export const recordCodeFailure = async (id: string): Promise<void> => {
  await query(
    'UPDATE signin_codes SET tries = tries + 1, dead = (tries + 1 >= $2) WHERE id = $1',
    [id, SIGNIN_CODE_MAX_TRIES],
  );
};

export const consumeCode = async (id: string): Promise<void> => {
  await query('UPDATE signin_codes SET used = true, dead = true WHERE id = $1', [id]);
};

export const setKillbillAccount = async (brandId: string, accountId: string): Promise<void> => {
  await query('UPDATE brands SET killbill_account_id = $2 WHERE id = $1', [brandId, accountId]);
};

export const setOverdueBlocked = async (brandId: string, blocked: boolean): Promise<void> => {
  await query('UPDATE brands SET overdue_blocked = $2 WHERE id = $1', [brandId, blocked]);
};
