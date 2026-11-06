import type { Pool } from 'pg';
import { newId } from './config.js';
import { saveStateOf, type LiveDoc } from './store.js';
import { modelBlocks, type ModelComment, type ModelSuggestion } from '../domain/model.js';
import { wordCount } from '../domain/suggest.js';
import { initialMode, type DomainRole, type Mode } from '../domain/types.js';
import { conflict, invalid, notFound } from './errors.js';

export type PersonRow = { person_id: string; display_name: string; email: string; colour: string; is_consultant: boolean };
export type PersonObject = { personId: string; displayName: string; colour: string; role?: DomainRole };

export type DocAccess = { role: DomainRole; endsAt: string | null; shareId: string | null };

export async function personById(pool: Pool, personId: string): Promise<PersonRow | null> {
  const row = await pool.query(`SELECT person_id, display_name, email, colour, is_consultant FROM people WHERE person_id = $1`, [personId]);
  return (row.rows[0] as PersonRow | undefined) ?? null;
}

export async function personByEmail(pool: Pool, email: string): Promise<PersonRow | null> {
  const row = await pool.query(`SELECT person_id, display_name, email, colour, is_consultant FROM people WHERE lower(email) = lower($1)`, [email]);
  return (row.rows[0] as PersonRow | undefined) ?? null;
}

/** The single visibility rule: a person can open a proposal only while they own or hold an active share (DP-09). */
export async function accessFor(pool: Pool, documentId: string, personId: string): Promise<DocAccess | null> {
  const row = await pool.query(
    `SELECT d.owner_id, s.id AS share_id, s.role, s.ends_at
     FROM documents d
     LEFT JOIN shares s ON s.document_id = d.id AND s.person_id = $2 AND s.status = 'active'
     WHERE d.id = $1 AND d.deleted = false`,
    [documentId, personId],
  );
  if (!row.rowCount) return null;
  const r = row.rows[0] as { owner_id: string; share_id: string | null; role: DomainRole | null; ends_at: Date | null };
  if (r.owner_id === personId) return { role: 'owner', endsAt: null, shareId: null };
  if (!r.share_id || !r.role) return null;
  // access ends at the end time on the server's clock (DP-35)
  if (r.ends_at && r.ends_at.getTime() <= Date.now()) {
    await pool.query(`UPDATE shares SET status = 'expired' WHERE id = $1`, [r.share_id]);
    return null;
  }
  return { role: r.role, endsAt: r.ends_at ? r.ends_at.toISOString() : null, shareId: r.share_id };
}

export async function requireAccess(pool: Pool, documentId: string, personId: string): Promise<DocAccess> {
  const access = await accessFor(pool, documentId, personId);
  if (!access) throw notFound();
  return access;
}

/** Role map for the people of a proposal: the Owner plus every active share. */
export async function docRoles(pool: Pool, documentId: string): Promise<Map<string, DomainRole>> {
  const rows = await pool.query(
    `SELECT d.owner_id, s.person_id, s.role FROM documents d
     LEFT JOIN shares s ON s.document_id = d.id AND s.status = 'active' AND (s.ends_at IS NULL OR s.ends_at > now())
     WHERE d.id = $1 AND d.deleted = false`,
    [documentId],
  );
  const map = new Map<string, DomainRole>();
  for (const r of rows.rows as { owner_id: string; person_id: string | null; role: DomainRole | null }[]) {
    map.set(r.owner_id, 'owner');
    if (r.person_id && r.role) map.set(r.person_id, r.role);
  }
  return map;
}

export function personObject(person: PersonRow, role: DomainRole | undefined): PersonObject {
  return { personId: person.person_id, displayName: person.display_name, colour: person.colour, ...(role ? { role } : {}) };
}

function unknownPerson(personId: string): PersonObject {
  return { personId, displayName: 'Unknown', colour: '#666666' };
}

/** People projection by role (DP-08): display names, colours and roles only, never emails. */
export function suggestionObject(sug: ModelSuggestion, people: Map<string, PersonRow>, roles: Map<string, DomainRole>): Record<string, unknown> {
  const author = people.get(sug.authorId);
  const role = roles.get(sug.authorId) ?? sug.authorRole;
  return {
    id: sug.id,
    kind: sug.kind,
    author: author ? personObject(author, role) : unknownPerson(sug.authorId),
    inserted: sug.inserted,
    deleted: sug.deleted,
    contentDeleted: sug.contentDeleted,
    status: sug.status,
    createdAt: sug.createdAt,
  };
}

export function commentObject(c: ModelComment, people: Map<string, PersonRow>, roles: Map<string, DomainRole>): Record<string, unknown> {
  const author = people.get(c.authorId);
  return {
    id: c.id,
    author: author ? personObject(author, roles.get(c.authorId)) : unknownPerson(c.authorId),
    body: c.body,
    mentions: c.mentions.map((pid) => (people.get(pid) ? personObject(people.get(pid)!, roles.get(pid)) : unknownPerson(pid))),
    anchor: c.anchor,
    contentDeleted: c.contentDeleted,
    status: c.status,
    replies: c.replies.map((r) => ({
      id: r.id,
      author: people.get(r.authorId) ? personObject(people.get(r.authorId)!, roles.get(r.authorId)) : unknownPerson(r.authorId),
      body: r.body,
      createdAt: r.createdAt,
    })),
    createdAt: c.createdAt,
  };
}

async function loadPeople(pool: Pool, ids: Iterable<string>): Promise<Map<string, PersonRow>> {
  const people = new Map<string, PersonRow>();
  for (const pid of ids) {
    const p = await personById(pool, pid);
    if (p) people.set(pid, p);
  }
  return people;
}

export async function buildSnapshot(pool: Pool, doc: LiveDoc, access: DocAccess): Promise<Record<string, unknown>> {
  const roles = await docRoles(pool, doc.id);
  const people = await loadPeople(pool, [doc.ownerId, ...roles.keys()]);
  return {
    id: doc.id,
    title: doc.title,
    client: doc.client,
    revision: doc.model.revision,
    savedRevision: doc.savedRevision,
    saveState: saveStateOf(doc),
    myAccess: { role: access.role, mode: undefined, accessEndsAt: access.endsAt },
    text: doc.model.text,
    blocks: modelBlocks(doc.model),
    marks: doc.model.marks,
    suggestions: doc.model.suggestions.filter((s) => s.status === 'open').map((s) => suggestionObject(s, people, roles)),
    comments: doc.model.comments.map((c) => commentObject(c, people, roles)),
    people: [...roles.entries()].map(([pid, role]) => (people.get(pid) ? personObject(people.get(pid)!, role) : unknownPerson(pid))),
    wordCount: wordCount(doc.model),
  };
}

/** Each person's last mode per proposal, restored within what the role allows (DP-33). */
export async function storedMode(pool: Pool, documentId: string, personId: string, role: DomainRole): Promise<Mode> {
  const row = await pool.query(`SELECT mode FROM modes WHERE document_id = $1 AND person_id = $2`, [documentId, personId]);
  const allowed: Mode[] = role === 'viewer' ? ['viewing'] : role === 'commenter' ? ['suggesting', 'viewing'] : ['editing', 'suggesting', 'viewing'];
  if (row.rowCount) {
    const mode = (row.rows[0] as { mode: Mode }).mode;
    if (allowed.includes(mode)) return mode;
  }
  return initialMode(role);
}

export async function saveMode(pool: Pool, documentId: string, personId: string, mode: Mode): Promise<void> {
  await pool.query(
    `INSERT INTO modes (document_id, person_id, mode) VALUES ($1,$2,$3)
     ON CONFLICT (document_id, person_id) DO UPDATE SET mode = $3`,
    [documentId, personId, mode],
  );
}

export function roleLabel(role: DomainRole): string {
  return role === 'owner' ? 'Owner' : role === 'editor' ? 'Editor' : role === 'commenter' ? 'Commenter' : 'Viewer';
}

export type ShareView = Record<string, unknown>;

/** The Owner's share list carries the email each share was granted to; others see people only (DP-08). */
export async function listShares(pool: Pool, doc: LiveDoc, viewerRole: DomainRole): Promise<{ shares: ShareView[] }> {
  const owner = await personById(pool, doc.ownerId);
  const shares = await pool.query(
    `SELECT s.id, s.person_id, s.role, s.ends_at, s.status, s.created_at FROM shares s WHERE s.document_id = $1 ORDER BY s.created_at, s.id`,
    [doc.id],
  );
  const granteeIds = (shares.rows as { person_id: string }[]).map((s) => s.person_id);
  const people = await loadPeople(pool, granteeIds);
  const roles = await docRoles(pool, doc.id);
  const rows = shares.rows as { id: string; person_id: string; role: DomainRole; ends_at: Date | null; status: string }[];
  if (viewerRole !== 'owner') {
    return {
      shares: [
        ...(owner ? [{ person: personObject(owner, 'owner') }] : []),
        ...rows.filter((s) => s.status === 'active' && people.has(s.person_id)).map((s) => ({ person: personObject(people.get(s.person_id)!, roles.get(s.person_id) ?? s.role) })),
      ],
    };
  }
  return {
    shares: [
      ...(owner ? [{ person: personObject(owner, 'owner') }] : []),
      ...rows
        .filter((s) => people.has(s.person_id))
        .map((s) => ({
          person: personObject(people.get(s.person_id)!, roles.get(s.person_id) ?? s.role),
          shareId: s.id,
          email: people.get(s.person_id)!.email,
          role: s.role,
          endsAt: s.ends_at ? s.ends_at.toISOString() : null,
          status: s.status,
        })),
    ],
  };
}

export async function createShare(pool: Pool, doc: LiveDoc, owner: PersonRow, email: string, role: DomainRole, endsAt: string | null): Promise<ShareView & { granteeId: string }> {
  if (email === owner.email) throw invalid({ email: 'You already own this proposal.' });
  const grantee = await personByEmail(pool, email);
  if (!grantee) throw invalid({ email: 'No Quillmere account uses this email.' });
  const existing = await pool.query(`SELECT id, status FROM shares WHERE document_id = $1 AND person_id = $2`, [doc.id, grantee.person_id]);
  if (existing.rowCount) {
    const ex = existing.rows[0] as { id: string; status: string };
    if (ex.status === 'active') throw conflict('already_shared');
    await pool.query(`DELETE FROM shares WHERE id = $1`, [ex.id]);
  }
  const shareId = newId();
  await pool.query(
    `INSERT INTO shares (id, document_id, person_id, role, ends_at, status) VALUES ($1,$2,$3,$4,$5,'active')`,
    [shareId, doc.id, grantee.person_id, role, endsAt],
  );
  return { shareId, person: personObject(grantee, role), email: grantee.email, role, endsAt, status: 'active', granteeId: grantee.person_id };
}

export async function updateShare(
  pool: Pool,
  doc: LiveDoc,
  shareId: string,
  role: DomainRole | undefined,
  endsAt: string | null | undefined,
): Promise<ShareView & { granteeId: string | null; roleChanged: boolean }> {
  const row = await pool.query(`SELECT id, person_id, role, ends_at, status FROM shares WHERE id = $1 AND document_id = $2`, [shareId, doc.id]);
  if (!row.rowCount) throw notFound();
  const share = row.rows[0] as { id: string; person_id: string; role: DomainRole; ends_at: Date | null; status: string };
  if (share.status === 'expired') throw conflict('share_ended');
  const newRole = role ?? share.role;
  const newEnds = endsAt === undefined ? share.ends_at : endsAt === null ? null : new Date(endsAt);
  await pool.query(`UPDATE shares SET role = $2, ends_at = $3 WHERE id = $1`, [shareId, newRole, newEnds]);
  const grantee = await personById(pool, share.person_id);
  return {
    shareId,
    person: grantee ? personObject(grantee, newRole) : unknownPerson(share.person_id),
    email: grantee?.email ?? '',
    role: newRole,
    endsAt: newEnds ? newEnds.toISOString() : null,
    status: 'active',
    granteeId: grantee ? grantee.person_id : null,
    roleChanged: role !== undefined && role !== share.role,
  };
}

export async function removeShare(pool: Pool, doc: LiveDoc, shareId: string): Promise<string | null> {
  const row = await pool.query(`SELECT id, person_id FROM shares WHERE id = $1 AND document_id = $2`, [shareId, doc.id]);
  if (!row.rowCount) throw notFound();
  const share = row.rows[0] as { id: string; person_id: string };
  await pool.query(`DELETE FROM shares WHERE id = $1`, [shareId]);
  return share.person_id;
}

export type NoticeRecord = Record<string, unknown> & { documentId: string; read: boolean };

export async function addNotice(
  pool: Pool,
  personId: string,
  kind: 'mention' | 'shared' | 'role_changed',
  doc: { id: string; title: string },
  actor: PersonRow | null,
  role: DomainRole | null,
  text: string,
  commentId?: string,
): Promise<NoticeRecord> {
  const noticeId = newId();
  await pool.query(
    `INSERT INTO notices (id, person_id, kind, document_id, document_title, actor_id, role, comment_id, text, read, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,now())`,
    [noticeId, personId, kind, doc.id, doc.title, actor?.person_id ?? '', role, commentId ?? null, text],
  );
  return {
    id: noticeId,
    kind,
    documentId: doc.id,
    documentTitle: doc.title,
    actor: actor ? personObject(actor, undefined) : unknownPerson(''),
    ...(role ? { role } : {}),
    ...(commentId ? { commentId } : {}),
    text,
    read: false,
    createdAt: new Date().toISOString(),
  };
}

/** Notices are listed only while the person can still open the proposal (DP-38). */
export async function listNotices(pool: Pool, personId: string): Promise<{ unread: number; notices: NoticeRecord[] }> {
  const unreadRow = await pool.query(`SELECT count(*)::int AS n FROM notices WHERE person_id = $1 AND read = false`, [personId]);
  const unread = (unreadRow.rows[0] as { n: number }).n;
  const rows = await pool.query(
    `SELECT n.id, n.kind, n.document_id, n.document_title, n.actor_id, n.role, n.comment_id, n.text, n.read, n.created_at
     FROM notices n WHERE n.person_id = $1 ORDER BY n.created_at DESC LIMIT 50`,
    [personId],
  );
  const out: NoticeRecord[] = [];
  for (const r of rows.rows as { id: string; kind: string; document_id: string; document_title: string; actor_id: string; role: DomainRole | null; comment_id: string | null; text: string; read: boolean; created_at: Date }[]) {
    const access = await accessFor(pool, r.document_id, personId);
    if (!access) continue;
    const actor = await personById(pool, r.actor_id);
    out.push({
      id: r.id,
      kind: r.kind,
      documentId: r.document_id,
      documentTitle: r.document_title,
      actor: actor ? personObject(actor, undefined) : unknownPerson(r.actor_id),
      ...(r.role ? { role: r.role } : {}),
      ...(r.comment_id ? { commentId: r.comment_id } : {}),
      text: r.text,
      read: r.read,
      createdAt: r.created_at.toISOString(),
    });
  }
  return { unread, notices: out };
}

/** Documents lists (DP-03, DP-04): only proposals the caller can open now. */
export async function listDocuments(pool: Pool, personId: string, view: 'recent' | 'mine' | 'shared' | undefined, q: string | undefined): Promise<Record<string, unknown>[]> {
  const params: unknown[] = [personId];
  let where = `d.deleted = false AND (d.owner_id = $1 OR EXISTS (
      SELECT 1 FROM shares s WHERE s.document_id = d.id AND s.person_id = $1 AND s.status = 'active'
        AND (s.ends_at IS NULL OR s.ends_at > now())))`;
  if (q !== undefined && q !== '') {
    params.push(`%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where += ` AND (d.title ILIKE $2 OR d.client ILIKE $2)`;
  }
  if (view === 'mine') where += ` AND d.owner_id = $1`;
  if (view === 'shared') where += ` AND d.owner_id <> $1`;
  const rows = await pool.query(
    `SELECT DISTINCT d.id, d.title, d.client, d.updated_at,
       CASE WHEN d.owner_id = $1 THEN 'owner' ELSE s.role END AS role,
       d.owner_id AS owner_id
     FROM documents d
     LEFT JOIN shares s ON s.document_id = d.id AND s.person_id = $1 AND s.status = 'active'
       AND (s.ends_at IS NULL OR s.ends_at > now())
     WHERE ${where}
     ORDER BY d.updated_at DESC`,
    params,
  );
  const owners = new Map<string, PersonRow | null>();
  const summaries = (rows.rows as { id: string; title: string; client: string; updated_at: Date; role: DomainRole; owner_id: string }[]).map((r) => {
    if (!owners.has(r.owner_id)) {
      owners.set(r.owner_id, null);
      void personById(pool, r.owner_id).then((p) => owners.set(r.owner_id, p));
    }
    return {
      id: r.id,
      title: r.title,
      client: r.client,
      role: r.role,
      updatedAt: r.updated_at.toISOString(),
      ownerId: r.owner_id,
    };
  });
  for (const s of summaries) {
    const owner = owners.get(s.ownerId as string) ?? (await personById(pool, s.ownerId as string));
    owners.set(s.ownerId as string, owner);
    (s as Record<string, unknown>).owner = owner ? personObject(owner, 'owner') : unknownPerson(s.ownerId as string);
    delete (s as Record<string, unknown>).ownerId;
  }
  return summaries;
}

export async function touchRecent(pool: Pool, personId: string, documentId: string): Promise<void> {
  await pool.query(
    `INSERT INTO recent (person_id, document_id, opened_at) VALUES ($1,$2,now())
     ON CONFLICT (person_id, document_id) DO UPDATE SET opened_at = now()`,
    [personId, documentId],
  );
}
