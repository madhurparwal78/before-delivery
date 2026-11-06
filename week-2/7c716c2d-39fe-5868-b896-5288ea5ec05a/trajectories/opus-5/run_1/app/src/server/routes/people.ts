import { randomUUID } from 'node:crypto';
import { now, nowDate } from '../clock.js';
import { config } from '../config.js';
import { db, tx, type Queryable } from '../db.js';
import { ApiError } from '../errors.js';
import {
  activeMemberCount,
  personBody,
  requireOwner,
  requireWorkspace,
  visiblePeople,
  type PersonRow,
} from '../access.js';
import { emitUnread } from '../chatview.js';
import { appendEvent } from '../events.js';
import { withIdempotency } from '../idempotency.js';
import { emitKnock, emitRoom, expireKnocksOfEmptyRoom } from '../office.js';
import { sessionRoute, type Route } from '../router.js';
import { queueMail } from '../services/mail.js';
import { noticeOwner } from '../services/status.js';
import { confirmedSeats, pendingInviteCount, workspaceLockKey } from '../seats.js';
import { emailField, isUuid, uuidOrNotFound } from '../validate.js';
import { zoneOf } from '../calendarstore.js';
import { storedInstant } from '../domain/zone.js';
import { workspaceBody, workspaceRow } from '../workspaces.js';
import type { Invite, Role } from '../../shared/types.js';

type InviteRow = {
  id: string;
  workspace_id: string;
  email: string;
  role: Role;
  project_ids: string[];
  channel_ids: string[];
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  created_at: string;
  expires_at: string;
  workspace_name: string;
};

const inviteColumns = `i.id, i.workspace_id, i.email, i.role, i.project_ids, i.channel_ids, i.status,
  i.created_at, i.expires_at, w.name as workspace_name`;

/** An invite is pending until it is answered or its window passes. */
export function inviteBody(row: InviteRow, zone: string): Invite {
  const expired = row.status === 'pending' && now() >= Date.parse(row.expires_at);
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    project_ids: row.project_ids,
    channel_ids: row.channel_ids,
    status: expired ? 'expired' : row.status,
    created_at: storedInstant(zone, row.created_at) ?? row.created_at,
    expires_at: storedInstant(zone, row.expires_at) ?? row.expires_at,
    workspace_name: row.workspace_name,
  };
}

async function uniqueHandle(workspaceId: string, email: string, client: Queryable): Promise<string> {
  const base = (email.split('@')[0] ?? 'member').toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'member';
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}${suffix}`;
    const taken = await client.one<{ id: string }>(
      'select id from people where workspace_id = $1 and lower(handle) = $2',
      [workspaceId, candidate],
    );
    if (taken === undefined) return candidate;
  }
  return `${base}${randomUUID().slice(0, 4)}`;
}

/** The channels every owner and member of a workspace shares. */
async function defaultChannelIds(workspaceId: string, client: Queryable): Promise<string[]> {
  const rows = await client.query<{ id: string }>(
    `select c.id from channels c
      where c.workspace_id = $1
        and not exists (
          select 1 from people p
           where p.workspace_id = $1 and p.removed = false and p.role in ('owner','member')
             and not exists (select 1 from channel_members cm where cm.channel_id = c.id and cm.person_id = p.id))`,
    [workspaceId],
  );
  return rows.map((row) => row.id);
}

export const peopleRoutes: Route[] = [
  sessionRoute('GET', '/api/members', 'none', async (ctx) => {
    requireWorkspace(ctx.actor);
    const rows = await visiblePeople(ctx.actor);
    return { status: 200, body: { members: rows.map(personBody) } };
  }),

  sessionRoute('DELETE', '/api/members/:personId', 'none', async (ctx) => {
    const workspaceId = requireOwner(ctx.actor);
    const personId = uuidOrNotFound(ctx.params.personId);
    if (personId === ctx.actor.id) throw new ApiError('owner_required');
    const person = await db.one<PersonRow>(
      `select id, name, email, handle, role, workspace_id, removed, away from people
        where id = $1 and workspace_id = $2 and removed = false`,
      [personId, workspaceId],
    );
    if (person === undefined) throw new ApiError('not_found');
    const at = nowDate().toISOString();
    await tx(async (client) => {
      await client.query('update people set removed = true where id = $1', [personId]);
      await client.query(
        'update sessions set revoked_at = $2 where person_id = $1 and revoked_at is null',
        [personId, at],
      );
      await client.query('delete from channel_members where person_id = $1', [personId]);
      await client.query('delete from project_guests where person_id = $1', [personId]);
      await client.query('delete from typing where person_id = $1', [personId]);
      await client.query('delete from read_markers where person_id = $1', [personId]);
      const left = await client.one<{ room_id: string }>(
        'delete from room_occupants where person_id = $1 returning room_id',
        [personId],
      );
      if (left !== undefined) {
        await emitRoom(client, workspaceId, left.room_id, at);
        await expireKnocksOfEmptyRoom(client, workspaceId, left.room_id, at);
      }
      const knocks = await client.query<{ id: string }>(
        `update knocks set status = 'expired' where person_id = $1 and status = 'waiting' returning id`,
        [personId],
      );
      for (const knock of knocks) await emitKnock(client, workspaceId, knock.id, at);
      const held = await client.query<{ id: number }>(
        'delete from outbox where sent_at is null and person_id = $1 returning id',
        [personId],
      );
      await client.query(
        `update invites set status = 'revoked' where workspace_id = $1 and email_lower = $2 and status = 'pending'`,
        [workspaceId, person.email.toLowerCase()],
      );
      if (held.length > 0) await noticeOwner(client, workspaceId, at);
    });
    return { status: 204 };
  }),

  sessionRoute('GET', '/api/invites', 'none', async (ctx) => {
    const workspaceId = requireOwner(ctx.actor);
    const zone = await zoneOf(workspaceId);
    const rows = await db.query<InviteRow>(
      `select ${inviteColumns} from invites i join workspaces w on w.id = i.workspace_id
        where i.workspace_id = $1 order by i.created_at desc`,
      [workspaceId],
    );
    return { status: 200, body: { invites: rows.map((row) => inviteBody(row, zone)) } };
  }),

  sessionRoute('POST', '/api/invites', 'json', async (ctx) => {
    const workspaceId = requireOwner(ctx.actor);
    return withIdempotency(ctx.actor.id, 'post-invite', ctx.idempotencyKey, ctx.rawBody, async () => {
      const email = emailField(ctx.body);
      const role = ctx.body.role;
      if (role !== 'member' && role !== 'guest') {
        throw new ApiError('validation', {
          fields: { role: 'Choose member or guest.' },
          message: 'Choose member or guest.',
        });
      }
      const projectIds = idList(ctx.body.project_ids, 'project_ids');
      const channelIds = idList(ctx.body.channel_ids, 'channel_ids');
      if (role === 'guest' && projectIds.length + channelIds.length === 0) {
        throw new ApiError('validation', {
          fields: { project_ids: 'Share at least one project or channel.' },
          message: 'Share at least one project or channel.',
        });
      }
      if (role === 'member' && projectIds.length + channelIds.length > 0) {
        throw new ApiError('validation', {
          fields: { project_ids: 'Members see every project.' },
          message: 'Members see every project.',
        });
      }
      for (const projectId of projectIds) {
        const row = await db.one<{ id: string }>(
          'select id from projects where id = $1 and workspace_id = $2',
          [projectId, workspaceId],
        );
        if (row === undefined) {
          throw new ApiError('validation', {
            fields: { project_ids: 'Choose projects of this workspace.' },
            message: 'Choose projects of this workspace.',
          });
        }
      }
      for (const channelId of channelIds) {
        const row = await db.one<{ id: string }>(
          'select id from channels where id = $1 and workspace_id = $2',
          [channelId, workspaceId],
        );
        if (row === undefined) {
          throw new ApiError('validation', {
            fields: { channel_ids: 'Choose channels of this workspace.' },
            message: 'Choose channels of this workspace.',
          });
        }
      }

      const seats = await confirmedSeats(workspaceId, { force: true, strict: true });
      const existingPerson = await db.one<{ id: string }>(
        'select id from people where workspace_id = $1 and email_lower = $2 and removed = false',
        [workspaceId, email.toLowerCase()],
      );
      if (existingPerson !== undefined) throw new ApiError('already_member');
      const pending = await db.one<{ id: string }>(
        `select id from invites where workspace_id = $1 and email_lower = $2 and status = 'pending'
           and expires_at > $3`,
        [workspaceId, email.toLowerCase(), nowDate().toISOString()],
      );
      if (pending !== undefined) throw new ApiError('invite_pending');
      const active = await activeMemberCount(workspaceId);
      const pendingCount = await pendingInviteCount(workspaceId);
      if (active + pendingCount >= seats.limit) throw new ApiError('workspace_full');

      const workspace = await workspaceRow(workspaceId);
      const at = now();
      const id = randomUUID();
      const body = await tx(async (client) => {
        await client.query(
          `insert into invites (id, workspace_id, email, email_lower, role, project_ids, channel_ids, status,
                                created_at, expires_at, invited_by)
           values ($1, $2, $3, $4, $5, $6::uuid[], $7::uuid[], 'pending', $8, $9, $10)`,
          [
            id,
            workspaceId,
            email,
            email.toLowerCase(),
            role,
            projectIds,
            channelIds,
            new Date(at).toISOString(),
            new Date(at + config.inviteTtlSeconds * 1000).toISOString(),
            ctx.actor.id,
          ],
        );
        await queueMail(client, {
          workspaceId,
          to: email,
          subject: `You're invited to ${workspace.name} on Tallyroom`,
          body:
            `${ctx.actor.name} invited you to the ${workspace.name} workspace on Tallyroom.\n\n` +
            `Sign in or create an account at ${config.appPublicUrl} with this exact address: ${email}\n\n` +
            `Your invitation is waiting on Your invitations.\n`,
          kind: 'invite',
          inviteId: id,
        });
        await noticeOwner(client, workspaceId, new Date(at).toISOString());
        const row = await client.one<InviteRow>(
          `select ${inviteColumns} from invites i join workspaces w on w.id = i.workspace_id where i.id = $1`,
          [id],
        );
        if (row === undefined) throw new ApiError('not_found');
        return inviteBody(row, await zoneOf(workspaceId, client));
      });
      return { status: 201, body };
    });
  }),

  sessionRoute('DELETE', '/api/invites/:id', 'none', async (ctx) => {
    const workspaceId = requireOwner(ctx.actor);
    const inviteId = uuidOrNotFound(ctx.params.id);
    const existing = await db.one<InviteRow>(
      `select ${inviteColumns} from invites i join workspaces w on w.id = i.workspace_id
        where i.id = $1 and i.workspace_id = $2`,
      [inviteId, workspaceId],
    );
    if (existing === undefined) throw new ApiError('not_found');
    const zone = await zoneOf(workspaceId);
    if (inviteBody(existing, zone).status !== 'pending') throw new ApiError('invite_not_pending');
    const at = nowDate().toISOString();
    const body = await tx(async (client) => {
      await client.query(`update invites set status = 'revoked' where id = $1`, [inviteId]);
      const held = await client.query<{ id: number }>(
        'delete from outbox where sent_at is null and invite_id = $1 returning id',
        [inviteId],
      );
      if (held.length > 0) await noticeOwner(client, workspaceId, at);
      const row = await client.one<InviteRow>(
        `select ${inviteColumns} from invites i join workspaces w on w.id = i.workspace_id where i.id = $1`,
        [inviteId],
      );
      if (row === undefined) throw new ApiError('not_found');
      return inviteBody(row, zone);
    });
    return { status: 200, body };
  }),

  sessionRoute('GET', '/api/invites/mine', 'none', async (ctx) => {
    const rows = await db.query<InviteRow>(
      `select ${inviteColumns} from invites i join workspaces w on w.id = i.workspace_id
        where i.email_lower = $1 order by i.created_at desc`,
      [ctx.actor.email.toLowerCase()],
    );
    const invites = [];
    for (const row of rows) invites.push(inviteBody(row, await zoneOf(row.workspace_id)));
    return { status: 200, body: { invites } };
  }),

  sessionRoute('POST', '/api/invites/:id/accept', 'json', async (ctx) => {
    const inviteId = uuidOrNotFound(ctx.params.id);
    const invite = await db.one<InviteRow & { email_lower: string }>(
      `select ${inviteColumns}, i.email_lower from invites i join workspaces w on w.id = i.workspace_id
        where i.id = $1`,
      [inviteId],
    );
    if (invite === undefined || invite.email_lower !== ctx.actor.email.toLowerCase()) {
      throw new ApiError('not_found');
    }
    if (ctx.actor.workspaceId !== null) throw new ApiError('already_in_workspace');
    const state = inviteBody(invite, await zoneOf(invite.workspace_id)).status;
    if (state === 'expired') throw new ApiError('invite_expired');
    if (state === 'revoked') throw new ApiError('invite_revoked');
    if (state === 'accepted') throw new ApiError('invite_accepted');

    const seats = await confirmedSeats(invite.workspace_id, { force: true, strict: true });
    const at = nowDate().toISOString();
    await tx(async (client) => {
      await client.query('select pg_advisory_xact_lock($1)', [workspaceLockKey(invite.workspace_id)]);
      const current = await client.one<InviteRow>(
        `select ${inviteColumns} from invites i join workspaces w on w.id = i.workspace_id
          where i.id = $1 for no key update of i`,
        [inviteId],
      );
      if (current === undefined) throw new ApiError('not_found');
      if (inviteBody(current, await zoneOf(invite.workspace_id, client)).status !== 'pending') {
        throw new ApiError('invite_accepted');
      }
      const active = await activeMemberCount(invite.workspace_id, client);
      if (active >= seats.limit) throw new ApiError('workspace_full');
      const handle = await uniqueHandle(invite.workspace_id, invite.email, client);
      await client.query(
        'update people set workspace_id = $2, role = $3, handle = $4, removed = false where id = $1',
        [ctx.actor.id, invite.workspace_id, invite.role, handle],
      );
      await client.query(`update invites set status = 'accepted' where id = $1`, [inviteId]);
      const channelIds =
        invite.role === 'member'
          ? await defaultChannelIds(invite.workspace_id, client)
          : invite.channel_ids;
      for (const channelId of channelIds) {
        await client.query(
          `insert into channel_members (channel_id, person_id, joined_at) values ($1, $2, $3)
           on conflict do nothing`,
          [channelId, ctx.actor.id, at],
        );
        await client.query(
          `insert into read_markers (person_id, channel_id, thread_root_id, up_to)
           select $2, $1, 0, coalesce(max(id), 0) from messages where channel_id = $1 and thread_root_id is null
           on conflict (person_id, channel_id, thread_root_id) do update set up_to = excluded.up_to`,
          [channelId, ctx.actor.id],
        );
      }
      if (invite.role === 'guest') {
        for (const projectId of invite.project_ids) {
          await client.query(
            'insert into project_guests (project_id, person_id) values ($1, $2) on conflict do nothing',
            [projectId, ctx.actor.id],
          );
        }
      }
      await emitUnread(client, invite.workspace_id, [ctx.actor.id], at);
      await appendEvent(
        client,
        invite.workspace_id,
        'presence',
        { person_id: ctx.actor.id, status: 'active' },
        { type: 'workspace' },
        at,
      );
    });

    const row = await db.one<PersonRow>(
      'select id, name, email, handle, role, workspace_id, removed, away from people where id = $1',
      [ctx.actor.id],
    );
    if (row === undefined) throw new ApiError('not_found');
    const actor = { ...ctx.actor, workspaceId: invite.workspace_id, role: invite.role };
    return {
      status: 200,
      body: {
        person: personBody(row),
        workspace: await workspaceBody(actor, invite.workspace_id),
      },
    };
  }),
];

function idList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => !isUuid(entry))) {
    throw new ApiError('validation', {
      fields: { [field]: 'Choose items of this workspace.' },
      message: 'Choose items of this workspace.',
    });
  }
  return [...new Set(value as string[])];
}
