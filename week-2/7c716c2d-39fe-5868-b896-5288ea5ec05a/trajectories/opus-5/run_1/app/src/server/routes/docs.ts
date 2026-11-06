import { randomUUID } from 'node:crypto';
import { nowDate } from '../clock.js';
import { db, tx, type Queryable } from '../db.js';
import { ApiError } from '../errors.js';
import { requireWorkspace, visibleProjectIds, type Actor } from '../access.js';
import { appendEvent } from '../events.js';
import { attachmentsFor } from '../issueview.js';
import { codePointLength, isBlank, isStorableText } from '../domain/text.js';
import { sessionRoute, type Route } from '../router.js';
import { isUuid, uuidOrNotFound } from '../validate.js';
import { zoneOf } from '../calendarstore.js';
import { storedInstant } from '../domain/zone.js';
import type { Doc, DocSummary } from '../../shared/types.js';

export const DOC_TITLE_LIMIT = 200;
export const DOC_BODY_LIMIT = 200000;

type DocRow = {
  id: string;
  project_id: string;
  title: string;
  body: string;
  version: number;
  updated_by: string | null;
  updated_at: string;
};

function titleOf(body: Record<string, unknown>): string {
  const value = body.title;
  if (typeof value !== 'string' || !isStorableText(value) || isBlank(value)) {
    throw new ApiError('validation', {
      fields: { title: 'Give the doc a title.' },
      message: 'Give the doc a title.',
    });
  }
  if (codePointLength(value) > DOC_TITLE_LIMIT) {
    throw new ApiError('validation', {
      fields: { title: `Doc titles can be up to ${DOC_TITLE_LIMIT} characters.` },
      message: `Doc titles can be up to ${DOC_TITLE_LIMIT} characters.`,
    });
  }
  return value;
}

function bodyOf(body: Record<string, unknown>): string {
  const value = body.body;
  if (typeof value !== 'string' || !isStorableText(value)) {
    throw new ApiError('validation', {
      fields: { body: 'A doc can be up to 200,000 characters.' },
      message: 'A doc can be up to 200,000 characters.',
    });
  }
  if (codePointLength(value) > DOC_BODY_LIMIT) {
    throw new ApiError('validation', {
      fields: { body: 'A doc can be up to 200,000 characters.' },
      message: 'A doc can be up to 200,000 characters.',
    });
  }
  return value;
}

function baseVersionOf(body: Record<string, unknown>): number {
  const value = body.base_version;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError('validation', {
      fields: { base_version: 'Send the version you loaded.' },
      message: 'Send the version you loaded.',
    });
  }
  return value;
}

async function docBody(row: DocRow, zone: string, client: Queryable = db): Promise<Doc> {
  const attachments = await attachmentsFor('doc', [row.id], client);
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    body: row.body,
    version: Number(row.version),
    updated_by: row.updated_by,
    updated_at: storedInstant(zone, row.updated_at) ?? row.updated_at,
    attachments: attachments.get(row.id) ?? [],
  };
}

async function loadDoc(actor: Actor, docId: string, client: Queryable = db): Promise<DocRow> {
  const projectIds = await visibleProjectIds(actor, client);
  const row = await client.one<DocRow>(
    `select id, project_id, title, body, version, updated_by, updated_at from docs
      where id = $1 and workspace_id = $2 and project_id = any($3::uuid[])`,
    [docId, actor.workspaceId, projectIds],
  );
  if (row === undefined) throw new ApiError('not_found');
  return row;
}

function requireDocEditor(actor: Actor): void {
  if (actor.role !== 'owner' && actor.role !== 'member') throw new ApiError('forbidden');
}

async function emitDoc(client: Queryable, workspaceId: string, row: DocRow, at: string): Promise<void> {
  await appendEvent(
    client,
    workspaceId,
    'doc',
    {
      id: row.id,
      project_id: row.project_id,
      version: Number(row.version),
      updated_by: row.updated_by,
    },
    { type: 'project', id: row.project_id },
    at,
  );
}

export const docRoutes: Route[] = [
  sessionRoute('GET', '/api/docs', 'none', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const projectIds = await visibleProjectIds(ctx.actor);
    const rows = await db.query<DocRow>(
      `select id, project_id, title, '' as body, version, updated_by, updated_at from docs
        where project_id = any($1::uuid[]) order by title asc`,
      [projectIds],
    );
    const attachments = await attachmentsFor(
      'doc',
      rows.map((row) => row.id),
    );
    const zone = await zoneOf(workspaceId);
    const docs: DocSummary[] = rows.map((row) => ({
      id: row.id,
      project_id: row.project_id,
      title: row.title,
      version: Number(row.version),
      updated_by: row.updated_by,
      updated_at: storedInstant(zone, row.updated_at) ?? row.updated_at,
      attachments: attachments.get(row.id) ?? [],
    }));
    return { status: 200, body: { docs } };
  }),

  sessionRoute('POST', '/api/docs', 'json', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const projectId = ctx.body.project_id;
    if (!isUuid(projectId)) throw new ApiError('not_found');
    if (!(await visibleProjectIds(ctx.actor)).includes(projectId)) throw new ApiError('not_found');
    requireDocEditor(ctx.actor);
    const title = titleOf(ctx.body);
    const body = bodyOf(ctx.body);
    const at = nowDate().toISOString();
    const id = randomUUID();
    const zone = await zoneOf(workspaceId);
    const doc = await tx(async (client) => {
      await client.query(
        `insert into docs (id, workspace_id, project_id, title, body, version, updated_by, updated_at, created_at)
         values ($1, $2, $3, $4, $5, 1, $6, $7, $7)`,
        [id, workspaceId, projectId, title, body, ctx.actor.id, at],
      );
      await client.query(
        'insert into doc_versions (doc_id, version, title, body, saved_by, saved_at) values ($1, 1, $2, $3, $4, $5)',
        [id, title, body, ctx.actor.id, at],
      );
      const row = await loadDoc(ctx.actor, id, client);
      await emitDoc(client, workspaceId, row, at);
      return docBody(row, zone, client);
    });
    return { status: 201, body: doc };
  }),

  sessionRoute('GET', '/api/docs/:id', 'none', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const row = await loadDoc(ctx.actor, uuidOrNotFound(ctx.params.id));
    return { status: 200, body: await docBody(row, await zoneOf(workspaceId)) };
  }),

  sessionRoute('PUT', '/api/docs/:id', 'json', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const docId = uuidOrNotFound(ctx.params.id);
    await loadDoc(ctx.actor, docId);
    requireDocEditor(ctx.actor);
    const title = titleOf(ctx.body);
    const body = bodyOf(ctx.body);
    const baseVersion = baseVersionOf(ctx.body);
    const at = nowDate().toISOString();
    const zone = await zoneOf(workspaceId);
    const saved = await tx(async (client) => {
      const current = await client.one<{ version: number }>(
        'select version from docs where id = $1 for update',
        [docId],
      );
      if (current === undefined) throw new ApiError('not_found');
      if (Number(current.version) !== baseVersion) {
        const row = await loadDoc(ctx.actor, docId, client);
        throw new ApiError('version_conflict', { extra: { current: await docBody(row, zone, client) } });
      }
      const next = baseVersion + 1;
      await client.query(
        'update docs set title = $2, body = $3, version = $4, updated_by = $5, updated_at = $6 where id = $1',
        [docId, title, body, next, ctx.actor.id, at],
      );
      await client.query(
        'insert into doc_versions (doc_id, version, title, body, saved_by, saved_at) values ($1, $2, $3, $4, $5, $6)',
        [docId, next, title, body, ctx.actor.id, at],
      );
      const row = await loadDoc(ctx.actor, docId, client);
      await emitDoc(client, workspaceId, row, at);
      return docBody(row, zone, client);
    });
    return { status: 200, body: saved };
  }),

  sessionRoute('GET', '/api/docs/:id/versions', 'none', async (ctx) => {
    requireWorkspace(ctx.actor);
    const docId = uuidOrNotFound(ctx.params.id);
    await loadDoc(ctx.actor, docId);
    requireDocEditor(ctx.actor);
    const rows = await db.query<{
      version: number;
      saved_at: string;
      saved_by: string | null;
      title: string;
      body: string;
    }>(
      `select version, saved_at, saved_by, title, body from doc_versions
        where doc_id = $1 order by version desc`,
      [docId],
    );
    const zone = await zoneOf(requireWorkspace(ctx.actor));
    return {
      status: 200,
      body: {
        versions: rows.map((row) => ({
          ...row,
          version: Number(row.version),
          saved_at: storedInstant(zone, row.saved_at) ?? row.saved_at,
        })),
      },
    };
  }),

  sessionRoute('POST', '/api/docs/:id/restore', 'json', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const docId = uuidOrNotFound(ctx.params.id);
    const existing = await loadDoc(ctx.actor, docId);
    requireDocEditor(ctx.actor);
    const baseVersion = baseVersionOf(ctx.body);
    const version = ctx.body.version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      throw new ApiError('validation', {
        fields: { version: 'Choose an older version.' },
        message: 'Choose an older version.',
      });
    }
    if (version === Number(existing.version)) {
      throw new ApiError('validation', {
        fields: { version: 'Choose an older version.' },
        message: 'Choose an older version.',
      });
    }
    const at = nowDate().toISOString();
    const zone = await zoneOf(workspaceId);
    const restored = await tx(async (client) => {
      const current = await client.one<{ version: number }>(
        'select version from docs where id = $1 for update',
        [docId],
      );
      if (current === undefined) throw new ApiError('not_found');
      const source = await client.one<{ title: string; body: string }>(
        'select title, body from doc_versions where doc_id = $1 and version = $2',
        [docId, version],
      );
      if (source === undefined) {
        throw new ApiError('validation', {
          fields: { version: 'Choose an older version.' },
          message: 'Choose an older version.',
        });
      }
      if (Number(current.version) !== baseVersion) {
        const row = await loadDoc(ctx.actor, docId, client);
        throw new ApiError('version_conflict', { extra: { current: await docBody(row, zone, client) } });
      }
      const next = baseVersion + 1;
      await client.query(
        'update docs set title = $2, body = $3, version = $4, updated_by = $5, updated_at = $6 where id = $1',
        [docId, source.title, source.body, next, ctx.actor.id, at],
      );
      await client.query(
        'insert into doc_versions (doc_id, version, title, body, saved_by, saved_at) values ($1, $2, $3, $4, $5, $6)',
        [docId, next, source.title, source.body, ctx.actor.id, at],
      );
      const row = await loadDoc(ctx.actor, docId, client);
      await emitDoc(client, workspaceId, row, at);
      return docBody(row, zone, client);
    });
    return { status: 200, body: restored };
  }),
];
