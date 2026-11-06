import { query, queryOne } from '../db.js';
import { newId, slugify } from '../ids.js';
import type { ClientRecord } from '../../shared/types.js';

export type ClientRow = {
  id: string;
  slug: string;
  company: string;
  contact_name: string;
  contact_email: string;
  time_zone: string;
  killbill_account_id: string | null;
};

export function clientView(row: ClientRow): ClientRecord {
  return {
    id: row.id,
    slug: row.slug,
    company: row.company,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    timeZone: row.time_zone,
  };
}

export async function listClients(): Promise<ClientRow[]> {
  return query<ClientRow>('SELECT * FROM clients ORDER BY company');
}

export async function findClient(id: string): Promise<ClientRow | null> {
  return queryOne<ClientRow>('SELECT * FROM clients WHERE id = $1', [id]);
}

export async function insertClient(input: {
  company: string;
  contactName: string;
  contactEmail: string;
  timeZone: string;
}): Promise<ClientRow> {
  const base = slugify(input.company) || 'client';
  const taken = await query<{ slug: string }>('SELECT slug FROM clients WHERE slug = $1 OR slug LIKE $2', [
    base,
    `${base}-%`,
  ]);
  const existing = new Set(taken.map((row) => row.slug));
  let slug = base;
  for (let suffix = 2; existing.has(slug); suffix += 1) slug = `${base}-${suffix}`;
  const rows = await query<ClientRow>(
    `INSERT INTO clients (id, slug, company, contact_name, contact_email, time_zone)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [newId('cli'), slug, input.company, input.contactName, input.contactEmail, input.timeZone],
  );
  return rows[0];
}
