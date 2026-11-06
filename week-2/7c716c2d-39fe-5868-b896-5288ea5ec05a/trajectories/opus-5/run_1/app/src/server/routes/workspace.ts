import { now, nowDate } from '../clock.js';
import { db, tx } from '../db.js';
import { ApiError } from '../errors.js';
import { requireOwner, requireWorkspace, visibleProjectIds } from '../access.js';
import { loadHistory } from '../calendarstore.js';
import { cycleBodyFor } from '../cycleview.js';
import { cycleNumberAt, MAX_CYCLE_NUMBER } from '../domain/cycles.js';
import { appendEvent } from '../events.js';
import { emitUnread } from '../chatview.js';
import { publicRoute, sessionRoute, type Route } from '../router.js';
import { serviceStatusFor } from '../services/status.js';
import { noticeOwner } from '../services/status.js';
import { integerOrNotFound, isUuid, uuidOrNotFound } from '../validate.js';
import { saveCalendar, workspaceBody } from '../workspaces.js';

async function requireProject(workspaceId: string, projectId: string): Promise<void> {
  const row = await db.one<{ id: string }>('select id from projects where id = $1 and workspace_id = $2', [
    projectId,
    workspaceId,
  ]);
  if (row === undefined) throw new ApiError('not_found');
}

async function guestInWorkspace(workspaceId: string, personId: string): Promise<void> {
  const row = await db.one<{ id: string }>(
    "select id from people where id = $1 and workspace_id = $2 and removed = false and role = 'guest'",
    [personId, workspaceId],
  );
  if (row === undefined) {
    throw new ApiError('validation', {
      fields: { person_id: 'Name a guest of this workspace.' },
      message: 'Name a guest of this workspace.',
    });
  }
}

export const workspaceRoutes: Route[] = [
  publicRoute('GET', '/api/health', 'none', async () => ({ status: 200, body: { status: 'ok' } })),

  publicRoute('GET', '/api/status', 'none', async (ctx) => {
    const actor = await ctx.resolveActor();
    return {
      status: 200,
      body: await serviceStatusFor(actor?.workspaceId ?? null, actor?.role === 'owner'),
    };
  }),

  sessionRoute('GET', '/api/workspace', 'none', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    return { status: 200, body: await workspaceBody(ctx.actor, workspaceId) };
  }),

  sessionRoute('PUT', '/api/workspace/calendar', 'json', async (ctx) => {
    const workspaceId = requireOwner(ctx.actor);
    await saveCalendar(workspaceId, ctx.body);
    return { status: 200, body: await workspaceBody(ctx.actor, workspaceId) };
  }),

  sessionRoute('GET', '/api/cycles/current', 'none', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const history = await loadHistory(workspaceId);
    const number = cycleNumberAt(history, now());
    return { status: 200, body: await cycleBodyFor(ctx.actor, number, history) };
  }),

  sessionRoute('GET', '/api/cycles/:number', 'none', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const number = integerOrNotFound(ctx.params.number, 1, MAX_CYCLE_NUMBER);
    const history = await loadHistory(workspaceId);
    return { status: 200, body: await cycleBodyFor(ctx.actor, number, history) };
  }),

  sessionRoute('GET', '/api/projects', 'none', async (ctx) => {
    requireWorkspace(ctx.actor);
    const ids = await visibleProjectIds(ctx.actor);
    const rows = await db.query<{ id: string; key: string; name: string }>(
      'select id, key, name from projects where id = any($1::uuid[]) order by name asc',
      [ids],
    );
    return { status: 200, body: { projects: rows } };
  }),

  sessionRoute('POST', '/api/projects/:id/members', 'json', async (ctx) => {
    const workspaceId = requireOwner(ctx.actor);
    const projectId = uuidOrNotFound(ctx.params.id);
    await requireProject(workspaceId, projectId);
    const personId = ctx.body.person_id;
    if (!isUuid(personId)) {
      throw new ApiError('validation', {
        fields: { person_id: 'Name a guest of this workspace.' },
        message: 'Name a guest of this workspace.',
      });
    }
    await guestInWorkspace(workspaceId, personId);
    await db.query(
      'insert into project_guests (project_id, person_id) values ($1, $2) on conflict do nothing',
      [projectId, personId],
    );
    return { status: 204 };
  }),

  sessionRoute('DELETE', '/api/projects/:id/members/:personId', 'none', async (ctx) => {
    const workspaceId = requireOwner(ctx.actor);
    const projectId = uuidOrNotFound(ctx.params.id);
    const personId = uuidOrNotFound(ctx.params.personId);
    await requireProject(workspaceId, projectId);
    await tx(async (client) => {
      const removed = await client.one<{ person_id: string }>(
        'delete from project_guests where project_id = $1 and person_id = $2 returning person_id',
        [projectId, personId],
      );
      if (removed !== undefined) {
        await appendEvent(
          client,
          workspaceId,
          'revoked',
          { scope: 'project', id: projectId },
          { type: 'person', id: personId },
          nowDate().toISOString(),
        );
      }
    });
    return { status: 204 };
  }),

  sessionRoute('POST', '/api/channels/:id/members', 'json', async (ctx) => {
    const workspaceId = requireOwner(ctx.actor);
    const channelId = uuidOrNotFound(ctx.params.id);
    const channel = await db.one<{ id: string }>(
      'select id from channels where id = $1 and workspace_id = $2',
      [channelId, workspaceId],
    );
    if (channel === undefined) throw new ApiError('not_found');
    const personId = ctx.body.person_id;
    if (!isUuid(personId)) {
      throw new ApiError('validation', {
        fields: { person_id: 'Name a person of this workspace.' },
        message: 'Name a person of this workspace.',
      });
    }
    const person = await db.one<{ id: string }>(
      'select id from people where id = $1 and workspace_id = $2 and removed = false',
      [personId, workspaceId],
    );
    if (person === undefined) {
      throw new ApiError('validation', {
        fields: { person_id: 'Name a person of this workspace.' },
        message: 'Name a person of this workspace.',
      });
    }
    const at = nowDate().toISOString();
    await tx(async (client) => {
      const added = await client.one<{ person_id: string }>(
        `insert into channel_members (channel_id, person_id, joined_at) values ($1, $2, $3)
         on conflict do nothing returning person_id`,
        [channelId, personId, at],
      );
      if (added === undefined) return;
      await client.query(
        `insert into read_markers (person_id, channel_id, thread_root_id, up_to)
         select $2, $1, 0, coalesce(max(id), 0) from messages where channel_id = $1 and thread_root_id is null
         on conflict (person_id, channel_id, thread_root_id) do update set up_to = excluded.up_to`,
        [channelId, personId],
      );
      await emitUnread(client, workspaceId, [personId], at);
    });
    return { status: 204 };
  }),

  sessionRoute('DELETE', '/api/channels/:id/members/:personId', 'none', async (ctx) => {
    const workspaceId = requireOwner(ctx.actor);
    const channelId = uuidOrNotFound(ctx.params.id);
    const personId = uuidOrNotFound(ctx.params.personId);
    const channel = await db.one<{ id: string }>(
      'select id from channels where id = $1 and workspace_id = $2',
      [channelId, workspaceId],
    );
    if (channel === undefined) throw new ApiError('not_found');
    const at = nowDate().toISOString();
    await tx(async (client) => {
      const removed = await client.one<{ person_id: string }>(
        'delete from channel_members where channel_id = $1 and person_id = $2 returning person_id',
        [channelId, personId],
      );
      if (removed === undefined) return;
      await client.query('delete from read_markers where channel_id = $1 and person_id = $2', [
        channelId,
        personId,
      ]);
      await client.query('delete from typing where channel_id = $1 and person_id = $2', [channelId, personId]);
      const held = await client.query<{ id: number }>(
        `delete from outbox where sent_at is null and kind = 'mention' and channel_id = $1 and person_id = $2
         returning id`,
        [channelId, personId],
      );
      await appendEvent(
        client,
        workspaceId,
        'revoked',
        { scope: 'channel', id: channelId },
        { type: 'person', id: personId },
        at,
      );
      await emitUnread(client, workspaceId, [personId], at);
      if (held.length > 0) await noticeOwner(client, workspaceId, at);
    });
    return { status: 204 };
  }),
];
