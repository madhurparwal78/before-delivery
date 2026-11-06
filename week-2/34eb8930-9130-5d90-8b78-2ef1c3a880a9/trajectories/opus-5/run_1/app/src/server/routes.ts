import { listDocuments, requireAccess, shareById, touchRecent, type ListView } from './access.js';
import { query } from './db.js';
import { addComment, decideAll, decideSuggestion, renameDocument, setCommentStatus } from './edits.js';
import { AppError, forbidden, invalid, notFound, storageUnavailable, unauthenticated } from './errors.js';
import { broadcast, forget, loadDocument, release, retain } from './livedoc.js';
import { markNoticeRead, noticeById, noticesFor, newId } from './notices.js';
import { type PersonRecord, personById, personObject } from './people.js';
import { can } from './permissions.js';
import { createShare, listShares, patchShare, removeShare } from './shares.js';
import { roleMapFor, snapshotOf, withRole } from './snapshot.js';
import { StorageError, deleteObject } from './storage.js';
import { clearedCookie, passwordMatches, personForSession, sessionCookie, startSession } from './sessions.js';
import type { Decision, DocumentSummary, Role } from '../shared/types.js';

export interface RequestContext {
  method: string;
  path: string;
  searchParams: URLSearchParams;
  body: Record<string, unknown>;
  sessionId: string | null;
}

export interface Reply {
  status: number;
  body?: unknown;
  cookie?: string;
}

const json = (status: number, body?: unknown): Reply => ({ status, body });

function sessionPersonBody(person: PersonRecord): Reply {
  return json(200, {
    person: {
      personId: person.id,
      displayName: person.displayName,
      email: person.email,
      colour: person.colour,
      isConsultant: person.isConsultant,
    },
  });
}

function summaryOf(row: {
  id: string;
  title: string;
  client: string;
  role: Role;
  updatedAt: string;
  ownerId: string;
}): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    client: row.client,
    role: row.role,
    updatedAt: row.updatedAt,
    owner: personObject(row.ownerId, 'owner'),
  };
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validateTitleAndClient(title: string, client: string): void {
  const fields: Record<string, string> = {};
  if (title.length < 1 || title.length > 120) fields.title = 'Enter a title of 1 to 120 characters.';
  if (client.length < 1 || client.length > 80) fields.client = 'Enter a client name of 1 to 80 characters.';
  if (Object.keys(fields).length > 0) throw invalid(fields);
}

type Document = Awaited<ReturnType<typeof loadDocument>>;

async function withDocument<T>(documentId: string, task: (document: Document) => Promise<T>): Promise<T> {
  const document = await loadDocument(documentId);
  retain(documentId);
  try {
    return await task(document);
  } finally {
    release(documentId);
  }
}

export async function handleRoute(context: RequestContext): Promise<Reply> {
  const segments = context.path.split('/').filter((part) => part.length > 0);
  if (segments[0] !== 'api') throw notFound();
  const route = segments.slice(1);

  if (route[0] === 'health' && route.length === 1 && context.method === 'GET') {
    try {
      await query('select 1');
    } catch {
      return json(503, { status: 'starting' });
    }
    return json(200, { status: 'ok' });
  }

  if (route[0] === 'session' && route.length === 1) {
    if (context.method === 'POST') {
      const email = trimmedString(context.body.email);
      const password = typeof context.body.password === 'string' ? context.body.password : '';
      const fields: Record<string, string> = {};
      if (email.length === 0) fields.email = 'Enter your email.';
      if (password.length === 0) fields.password = 'Enter your password.';
      if (Object.keys(fields).length > 0) throw invalid(fields);
      const result = await query<{ id: string; password_hash: string }>(
        'select id, password_hash from people where lower(email) = lower($1)',
        [email],
      );
      const row = result.rows[0];
      if (!row || !passwordMatches(password, row.password_hash)) throw new AppError(401, 'invalid_credentials');
      const sessionId = await startSession(row.id);
      return { ...sessionPersonBody(personById(row.id)), cookie: sessionCookie(sessionId) };
    }
    if (context.method === 'GET') {
      const person = await personForSession(context.sessionId);
      if (!person) throw unauthenticated();
      return sessionPersonBody(person);
    }
    if (context.method === 'DELETE') {
      if (context.sessionId) await query('delete from sessions where id = $1', [context.sessionId]);
      return { status: 204, cookie: clearedCookie() };
    }
    throw notFound();
  }

  const person = await personForSession(context.sessionId);
  if (!person) throw unauthenticated();

  if (route[0] === 'notices') {
    if (route.length === 1 && context.method === 'GET') return json(200, await noticesFor(person.id));
    if (route.length === 3 && route[2] === 'read' && context.method === 'POST') {
      const notice = await noticeById(person.id, route[1] as string);
      if (!notice) throw notFound();
      await markNoticeRead(notice.id);
      return json(200, { ...notice, read: true });
    }
    throw notFound();
  }

  if (route[0] !== 'documents') throw notFound();

  if (route.length === 1) {
    if (context.method === 'GET') {
      const view = context.searchParams.get('view');
      const allowed: ListView[] = ['recent', 'mine', 'shared'];
      if (view !== null && !allowed.includes(view as ListView)) throw invalid({ view: 'Choose recent, mine or shared.' });
      const documents = await listDocuments(person.id, (view ?? 'all') as ListView, context.searchParams.get('q') ?? '');
      return json(200, { documents });
    }
    if (context.method === 'POST') {
      if (!person.isConsultant) throw forbidden();
      const title = trimmedString(context.body.title);
      const client = trimmedString(context.body.client);
      validateTitleAndClient(title, client);
      const id = newId();
      await query(
        `insert into documents (id, title, client, owner_id, revision, origin_revision, saved_revision)
         values ($1, $2, $3, $4, 0, 0, 0)`,
        [id, title, client, person.id],
      );
      const document = await loadDocument(id);
      broadcast().toPerson(person.id, { type: 'lists_changed' });
      return json(
        201,
        summaryOf({
          id,
          title: document.meta.title,
          client: document.meta.client,
          role: 'owner',
          updatedAt: new Date().toISOString().slice(0, 19) + 'Z',
          ownerId: person.id,
        }),
      );
    }
    throw notFound();
  }

  const documentId = route[1] as string;
  const access = await requireAccess(person.id, documentId);

  if (route.length === 2) {
    if (context.method === 'GET') {
      const document = await loadDocument(documentId);
      retain(documentId);
      try {
        await touchRecent(person.id, documentId);
        return json(200, await snapshotOf(document, person.id, access));
      } finally {
        release(documentId);
      }
    }
    if (context.method === 'PATCH') {
      if (!can(access.role, 'own')) throw forbidden();
      const document = await loadDocument(documentId);
      const title = context.body.title === undefined ? document.meta.title : trimmedString(context.body.title);
      const client = context.body.client === undefined ? document.meta.client : trimmedString(context.body.client);
      validateTitleAndClient(title, client);
      await renameDocument(document, title, client);
      return json(
        200,
        summaryOf({
          id: documentId,
          title,
          client,
          role: 'owner',
          updatedAt: new Date().toISOString().slice(0, 19) + 'Z',
          ownerId: document.meta.ownerId,
        }),
      );
    }
    if (context.method === 'DELETE') {
      if (!can(access.role, 'own')) throw forbidden();
      const roles = await roleMapFor(documentId);
      try {
        await deleteObject(documentId);
      } catch (error) {
        if (error instanceof StorageError) throw storageUnavailable();
        throw error;
      }
      broadcast().endAccess(documentId, null, 'deleted');
      await query('delete from documents where id = $1', [documentId]);
      forget(documentId);
      for (const personId of roles.keys()) broadcast().toPerson(personId, { type: 'lists_changed' });
      return { status: 204 };
    }
    throw notFound();
  }

  if (route[2] === 'shares') {
    return withDocument(documentId, async (document) => {
      if (route.length === 3) {
        if (context.method === 'GET') return json(200, { shares: await listShares(document, person.id) });
        if (context.method === 'POST') {
          if (!can(access.role, 'own')) throw forbidden();
          return json(
            201,
            await createShare(document, { email: context.body.email, role: context.body.role, endsAt: context.body.endsAt }),
          );
        }
        throw notFound();
      }
      if (route.length === 4 && (context.method === 'PATCH' || context.method === 'DELETE')) {
        const shareId = route[3] as string;
        if (!(await shareById(documentId, shareId))) throw notFound();
        if (!can(access.role, 'own')) throw forbidden();
        if (context.method === 'DELETE') {
          await removeShare(document, shareId);
          return { status: 204 };
        }
        const input: { role?: unknown; endsAt?: unknown } = {};
        if ('role' in context.body) input.role = context.body.role;
        if ('endsAt' in context.body) input.endsAt = context.body.endsAt;
        return json(200, await patchShare(document, shareId, input));
      }
      throw notFound();
    });
  }

  if (route[2] === 'people' && route.length === 3 && context.method === 'GET') {
    const roles = await roleMapFor(documentId);
    const needle = (context.searchParams.get('q') ?? '').trim().toLowerCase();
    const people = [...roles.keys()]
      .map((id) => withRole(id, roles))
      .filter((candidate) => candidate.displayName.toLowerCase().includes(needle));
    return json(200, { people });
  }

  if (route[2] === 'suggestions' && route.length === 5 && route[4] === 'decision' && context.method === 'POST') {
    return withDocument(documentId, async (document) => {
      const suggestionId = route[3] as string;
      const known = await query('select 1 from suggestions where id = $1 and document_id = $2', [suggestionId, documentId]);
      if (known.rowCount === 0) throw notFound();
      if (!can(access.role, 'decide')) throw forbidden();
      const decision = context.body.decision;
      if (decision !== 'accept' && decision !== 'reject') throw invalid({ decision: 'Choose accept or reject.' });
      const result = await document.serial(() => decideSuggestion(document, person.id, suggestionId, decision));
      const roles = await roleMapFor(documentId);
      return json(200, {
        suggestionId,
        status: result.status,
        applied: result.applied,
        decidedBy: withRole(person.id, roles),
        revision: result.revision,
      });
    });
  }

  if (route[2] === 'decisions' && route.length === 3 && context.method === 'POST') {
    if (!can(access.role, 'decide')) throw forbidden();
    const decision = context.body.decision;
    if (decision !== 'accept' && decision !== 'reject') throw invalid({ decision: 'Choose accept or reject.' });
    return withDocument(documentId, async (document) => {
      const result = await document.serial(() => decideAll(document, person.id, decision as Decision));
      return json(200, {
        decision,
        count: result.count,
        suggestionIds: result.suggestionIds,
        revision: result.revision,
      });
    });
  }

  if (route[2] === 'comments') {
    return withDocument(documentId, async (document) => {
      if (route.length === 3 && context.method === 'POST') {
        const parentId = context.body.parentId;
        if (typeof parentId === 'string' && !document.state.comments.some((comment) => comment.id === parentId)) {
          throw notFound();
        }
        if (!can(access.role, 'comment')) throw forbidden();
        const roles = await roleMapFor(documentId);
        const comment = await document.serial(() =>
          addComment(
            document,
            person.id,
            {
              anchor: context.body.anchor as { at: number; length: number } | null,
              body: context.body.body,
              mentions: context.body.mentions,
              parentId: context.body.parentId,
            },
            new Set(roles.keys()),
          ),
        );
        return json(201, comment);
      }
      if (route.length === 5 && context.method === 'POST' && (route[4] === 'resolve' || route[4] === 'reopen')) {
        const commentId = route[3] as string;
        if (!document.state.comments.some((comment) => comment.id === commentId)) throw notFound();
        if (!can(access.role, 'comment')) throw forbidden();
        const action = route[4] === 'resolve' ? 'resolve' : 'reopen';
        const comment = await document.serial(() => setCommentStatus(document, commentId, action));
        return json(200, comment);
      }
      throw notFound();
    });
  }

  throw notFound();
}
