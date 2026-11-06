import { query } from './db.js';
import { notFound } from './errors.js';
import { personObject } from './people.js';
import type { DocumentSummary, Role, ShareStatus } from '../shared/types.js';

export interface Access {
  role: Role;
  accessEndsAt: string | null;
  shareId: string | null;
}

export interface ShareRow {
  id: string;
  documentId: string;
  personId: string;
  email: string;
  role: Role;
  endsAt: string | null;
  status: ShareStatus;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${date.toISOString().slice(0, 19)}Z`;
}

/** The one place visibility is decided: Owner, or a share that is active on the server's clock. */
export async function accessFor(personId: string, documentId: string): Promise<Access | null> {
  const owned = await query<{ owner_id: string }>('select owner_id from documents where id = $1', [documentId]);
  const document = owned.rows[0];
  if (!document) return null;
  if (document.owner_id === personId) return { role: 'owner', accessEndsAt: null, shareId: null };
  const shares = await query<{ id: string; role: Role; ends_at: Date | null }>(
    `select id, role, ends_at from shares
     where document_id = $1 and person_id = $2 and status = 'active' and (ends_at is null or ends_at > now())
     order by created_at desc limit 1`,
    [documentId, personId],
  );
  const share = shares.rows[0];
  if (!share) return null;
  return { role: share.role, accessEndsAt: iso(share.ends_at), shareId: share.id };
}

export async function requireAccess(personId: string, documentId: string): Promise<Access> {
  const access = await accessFor(personId, documentId);
  if (!access) throw notFound();
  return access;
}

export async function peopleWithAccess(documentId: string): Promise<{ personId: string; role: Role }[]> {
  const result = await query<{ owner_id: string }>('select owner_id from documents where id = $1', [documentId]);
  const owner = result.rows[0];
  if (!owner) return [];
  const shares = await query<{ person_id: string; role: Role }>(
    `select person_id, role from shares
     where document_id = $1 and status = 'active' and (ends_at is null or ends_at > now())
     order by created_at`,
    [documentId],
  );
  const out: { personId: string; role: Role }[] = [{ personId: owner.owner_id, role: 'owner' }];
  for (const row of shares.rows) {
    if (row.person_id !== owner.owner_id) out.push({ personId: row.person_id, role: row.role });
  }
  return out;
}

export async function shareRowsFor(documentId: string): Promise<ShareRow[]> {
  const result = await query<{
    id: string;
    document_id: string;
    person_id: string;
    email: string;
    role: Role;
    ends_at: Date | null;
    status: ShareStatus;
  }>('select id, document_id, person_id, email, role, ends_at, status from shares where document_id = $1 order by created_at', [
    documentId,
  ]);
  return result.rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    personId: row.person_id,
    email: row.email,
    role: row.role,
    endsAt: iso(row.ends_at),
    status: row.status === 'active' && row.ends_at !== null && row.ends_at.getTime() <= Date.now() ? 'expired' : row.status,
  }));
}

export async function shareById(documentId: string, shareId: string): Promise<ShareRow | null> {
  const rows = await shareRowsFor(documentId);
  return rows.find((row) => row.id === shareId) ?? null;
}

export type ListView = 'recent' | 'mine' | 'shared' | 'all';

export async function listDocuments(personId: string, view: ListView, search: string): Promise<DocumentSummary[]> {
  const base = `
    select distinct on (d.id) d.id, d.title, d.client, d.owner_id, d.updated_at,
      case when d.owner_id = $1 then 'owner' else s.role end as role,
      coalesce(r.joined_at, to_timestamp(0)) as joined_at
    from documents d
    left join shares s
      on s.document_id = d.id and s.person_id = $1 and s.status = 'active'
      and (s.ends_at is null or s.ends_at > now())
    left join recents r on r.document_id = d.id and r.person_id = $1
    where (d.owner_id = $1 or s.id is not null)
  `;
  const conditions: string[] = [];
  if (view === 'mine') conditions.push('d.owner_id = $1');
  if (view === 'shared') conditions.push('d.owner_id <> $1');
  if (view === 'recent') conditions.push('r.joined_at is not null');
  const sql = `select * from (${base}${conditions.length ? ` and ${conditions.join(' and ')}` : ''}) as rows`;
  const result = await query<{
    id: string;
    title: string;
    client: string;
    owner_id: string;
    updated_at: Date;
    role: Role;
    joined_at: Date;
  }>(sql, [personId]);
  const needle = search.trim().toLowerCase();
  let rows = result.rows;
  if (needle.length > 0) {
    rows = rows.filter(
      (row) => row.title.toLowerCase().includes(needle) || row.client.toLowerCase().includes(needle),
    );
  }
  if (view === 'recent') {
    rows.sort((a, b) => b.joined_at.getTime() - a.joined_at.getTime());
    rows = rows.slice(0, 10);
  } else {
    rows.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
  }
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    client: row.client,
    role: row.role,
    updatedAt: iso(row.updated_at) as string,
    owner: personObject(row.owner_id, 'owner'),
  }));
}

export async function touchRecent(personId: string, documentId: string): Promise<void> {
  await query(
    `insert into recents (document_id, person_id, joined_at) values ($1, $2, now())
     on conflict (document_id, person_id) do update set joined_at = now()`,
    [documentId, personId],
  );
}
