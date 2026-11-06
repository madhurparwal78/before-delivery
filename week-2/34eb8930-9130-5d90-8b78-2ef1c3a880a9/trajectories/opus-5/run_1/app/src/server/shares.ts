import { type ShareRow, shareById, shareRowsFor } from './access.js';
import { query } from './db.js';
import { conflict, invalid, notFound } from './errors.js';
import { type LiveDocument, broadcast } from './livedoc.js';
import { modeFor, setStoredMode } from './modes.js';
import { createNotice, newId } from './notices.js';
import { personByEmail, personObject } from './people.js';
import { modeForRole } from './permissions.js';
import type { Role, ShareEntry } from '../shared/types.js';

const GRANTABLE: Role[] = ['editor', 'commenter', 'viewer'];
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function shareEntry(row: ShareRow, forOwner: boolean): ShareEntry {
  if (!forOwner) return { person: personObject(row.personId, row.role) };
  return {
    shareId: row.id,
    person: personObject(row.personId, row.role),
    email: row.email,
    role: row.role,
    endsAt: row.endsAt,
    status: row.status,
  };
}

/** The share list: the Owner sees emails, end times and ended shares; nobody else does. */
export async function listShares(document: LiveDocument, viewerId: string): Promise<ShareEntry[]> {
  const forOwner = document.meta.ownerId === viewerId;
  const rows = await shareRowsFor(document.meta.id);
  const entries: ShareEntry[] = [{ person: personObject(document.meta.ownerId, 'owner') }];
  for (const row of rows) {
    if (row.personId === document.meta.ownerId) continue;
    if (!forOwner && row.status !== 'active') continue;
    entries.push(shareEntry(row, forOwner));
  }
  return entries;
}

function validateRole(role: unknown): Role {
  if (typeof role !== 'string' || !GRANTABLE.includes(role as Role)) {
    throw invalid({ role: 'Choose Editor, Commenter or Viewer.' });
  }
  return role as Role;
}

function validateEndsAt(endsAt: unknown): string | null {
  if (endsAt === null || endsAt === undefined) return null;
  if (typeof endsAt !== 'string') throw invalid({ endsAt: 'Pick an end time in the future.' });
  const when = new Date(endsAt);
  if (Number.isNaN(when.getTime())) throw invalid({ endsAt: 'Pick an end time in the future.' });
  const now = Date.now();
  if (when.getTime() <= now) throw invalid({ endsAt: 'Pick an end time in the future.' });
  if (when.getTime() > now + YEAR_MS) throw invalid({ endsAt: 'Pick an end time within a year.' });
  return when.toISOString();
}

export async function createShare(
  document: LiveDocument,
  input: { email: unknown; role: unknown; endsAt: unknown },
): Promise<ShareEntry> {
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const person = email.length === 0 ? null : personByEmail(email);
  if (!person) throw invalid({ email: 'No Quillmere account uses this email.' });
  if (person.id === document.meta.ownerId) throw invalid({ email: 'You already own this proposal.' });
  const role = validateRole(input.role);
  const endsAt = validateEndsAt(input.endsAt);

  const rows = await shareRowsFor(document.meta.id);
  const existing = rows.find((row) => row.personId === person.id);
  if (existing && existing.status === 'active') throw conflict('already_shared');
  if (existing) await query('delete from shares where id = $1', [existing.id]);

  const id = newId();
  await query(
    `insert into shares (id, document_id, person_id, email, role, ends_at, status)
     values ($1, $2, $3, $4, $5, $6, 'active')`,
    [id, document.meta.id, person.id, person.email, role, endsAt],
  );
  await setStoredMode(document.meta.id, person.id, modeForRole(role, 'editing'));
  await createNotice({
    personId: person.id,
    kind: 'shared',
    documentId: document.meta.id,
    documentTitle: document.meta.title,
    actorId: document.meta.ownerId,
    role,
  });
  broadcast().toPerson(person.id, { type: 'lists_changed' });
  const row = await shareById(document.meta.id, id);
  if (!row) throw notFound();
  return shareEntry(row, true);
}

export async function patchShare(
  document: LiveDocument,
  shareId: string,
  input: { role?: unknown; endsAt?: unknown },
): Promise<ShareEntry> {
  const row = await shareById(document.meta.id, shareId);
  if (!row) throw notFound();
  if (row.status === 'expired') throw conflict('share_ended');
  let role = row.role;
  let endsAt = row.endsAt;
  const roleGiven = input.role !== undefined;
  const endsAtGiven = input.endsAt !== undefined;
  if (roleGiven) role = validateRole(input.role);
  if (endsAtGiven) endsAt = validateEndsAt(input.endsAt);
  await query('update shares set role = $2, ends_at = $3 where id = $1', [shareId, role, endsAt]);

  if (roleGiven && role !== row.role) {
    const mode = await modeFor(document.meta.id, row.personId, role);
    await setStoredMode(document.meta.id, row.personId, mode);
    await createNotice({
      personId: row.personId,
      kind: 'role_changed',
      documentId: document.meta.id,
      documentTitle: document.meta.title,
      actorId: document.meta.ownerId,
      role,
    });
    broadcast().toPersonInDocument(document.meta.id, row.personId, { type: 'role_changed', role, mode });
    broadcast().toPerson(row.personId, { type: 'lists_changed' });
  }
  const updated = await shareById(document.meta.id, shareId);
  if (!updated) throw notFound();
  return shareEntry(updated, true);
}

export async function removeShare(document: LiveDocument, shareId: string): Promise<void> {
  const row = await shareById(document.meta.id, shareId);
  if (!row) throw notFound();
  await query('delete from shares where id = $1', [shareId]);
  broadcast().endAccess(document.meta.id, row.personId, 'removed');
  broadcast().toPerson(row.personId, { type: 'lists_changed' });
}

/** Ends access at the end time on the server's clock. */
export async function expireDueShares(): Promise<void> {
  const result = await query<{ id: string; document_id: string; person_id: string }>(
    `update shares set status = 'expired'
     where status = 'active' and ends_at is not null and ends_at <= now()
     returning id, document_id, person_id`,
  );
  for (const row of result.rows) {
    broadcast().endAccess(row.document_id, row.person_id, 'expired');
    broadcast().toPerson(row.person_id, { type: 'lists_changed' });
  }
}
