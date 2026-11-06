import { randomUUID } from 'node:crypto';
import type { MemberRole, ProjectKind } from '../../shared/api.js';
import { limits } from '../config.js';
import { pool, tx } from '../db.js';
import {
  ApiError,
  forbidden,
  groupFull,
  notFound,
  seatTaken,
  validation,
} from '../http/errors.js';
import type { ProjectContext, Route } from '../http/router.js';
import { emailField, nameField } from '../http/validate.js';
import {
  assertMentor,
  memberList,
  sessionView,
  writeAudit,
  type SessionRow,
} from '../repository.js';
import { announceSession, returnBatonToMentor } from '../services/batonWrites.js';
import { publish } from '../services/bus.js';
import { requireIdempotencyKey, withIdempotency } from '../services/idempotency.js';
import { attempt, enqueue } from '../services/mail.js';
import { issueSignInToken, verifyUrl } from './auth.js';

const SEATS: Record<ProjectKind, number> = { one_to_one: 1, group: 6 };

async function announcePresence(projectId: string): Promise<void> {
  const participants = await memberList(pool, projectId);
  await publish({ project_id: projectId, frame: { type: 'presence', participants } });
}

function collectFields(fields: Record<string, unknown>): {
  email: string | null;
  name: string | null;
  problems: Record<string, string>;
} {
  const problems: Record<string, string> = {};
  let email: string | null = null;
  let name: string | null = null;
  try {
    email = emailField(fields, 'email');
  } catch (cause) {
    if (!(cause instanceof ApiError)) throw cause;
    Object.assign(problems, cause.extra['fields']);
  }
  try {
    name = nameField(fields, 'name', "Enter the learner's name of 1 to 80 characters.");
  } catch (cause) {
    if (!(cause instanceof ApiError)) throw cause;
    Object.assign(problems, cause.extra['fields']);
  }
  return { email, name, problems };
}

function inviteMessage(ctx: ProjectContext, email: string, token: string) {
  return {
    to: email,
    subject: `${ctx.user.name} invited you to ${ctx.project.title}`,
    body:
      `${ctx.user.name} invited you to work in "${ctx.project.title}" on Relay Bench.\n\n` +
      `${verifyUrl(token)}\n`,
  };
}

async function inviteLearner(ctx: ProjectContext): Promise<{ status: number; payload: unknown }> {
  const { email, name, problems } = collectFields(ctx.fields());

  const existingMember = await pool.query<{ user_id: string }>(
    `select m.user_id from memberships m join users u on u.id = m.user_id
      where m.project_id = $1 and u.email = $2`,
    [ctx.project.id, email],
  );
  const alreadyMember = email !== null && existingMember.rows.length > 0;

  if (!alreadyMember) {
    const seats = await pool.query<{ taken: string }>(
      `select count(*) as taken from memberships where project_id = $1 and role = 'student'`,
      [ctx.project.id],
    );
    const taken = Number(seats.rows[0]?.taken ?? 0);
    if (taken >= SEATS[ctx.project.kind]) {
      throw ctx.project.kind === 'one_to_one' ? seatTaken() : groupFull();
    }
  }

  if (Object.keys(problems).length > 0) throw validation(problems);
  if (email === null || name === null) throw validation(problems);

  const prepared = await tx(async (client) => {
    const found = await client.query<{ id: string; name: string }>(
      'select id, name from users where email = $1',
      [email],
    );
    let learnerId = found.rows[0]?.id;
    if (learnerId === undefined) {
      learnerId = randomUUID();
      await client.query(
        `insert into users (id, email, name, kind) values ($1, $2, $3, 'learner')`,
        [learnerId, email, name],
      );
    }
    await client.query(
      `insert into memberships (project_id, user_id, role, email_status)
       values ($1, $2, 'student', 'queued')
       on conflict (project_id, user_id) do update set email_status = 'queued'`,
      [ctx.project.id, learnerId],
    );

    const inviteId = randomUUID();
    await client.query(
      `insert into invites (id, project_id, email, name, email_status)
       values ($1, $2, $3, $4, 'queued')`,
      [inviteId, ctx.project.id, email, name],
    );
    const token = await issueSignInToken(client, {
      email,
      inviteName: name,
      projectId: ctx.project.id,
    });
    const outboxId = await enqueue(
      client,
      inviteMessage(ctx, email, token),
      {
        recipientUserId: learnerId,
        inviteId,
        memberProjectId: ctx.project.id,
        memberUserId: learnerId,
      },
    );
    return { learnerId, inviteId, outboxId, token };
  });

  const emailStatus = await attempt(
    prepared.outboxId,
    inviteMessage(ctx, email, prepared.token),
  );

  await announcePresence(ctx.project.id);
  const members = await memberList(pool, ctx.project.id);
  const member = members.filter((row) => row.user_id === prepared.learnerId);

  return {
    status: 201,
    payload: {
      invite: { id: prepared.inviteId, email, name, email_status: emailStatus },
      member: member[0],
    },
  };
}

export const projectRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/projects',
    scope: 'auth',
    body: 'none',
    handler: async (ctx) => {
      const { rows } = await pool.query<{
        id: string;
        title: string;
        kind: ProjectKind;
        role: MemberRole;
        student_count: string;
      }>(
        `select p.id, p.title, p.kind, m.role,
                (select count(*) from memberships s
                  where s.project_id = p.id and s.role = 'student') as student_count
           from projects p join memberships m on m.project_id = p.id
          where m.user_id = $1
          order by p.created_at desc`,
        [ctx.user.id],
      );
      return {
        status: 200,
        payload: {
          projects: rows.map((row) => ({
            id: row.id,
            title: row.title,
            kind: row.kind,
            role: row.role,
            student_count: Number(row.student_count),
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/projects',
    scope: 'auth',
    body: 'json',
    handler: async (ctx) => {
      if (ctx.user.kind !== 'mentor') throw forbidden('Only mentors create projects.');
      const fields = ctx.fields();
      const title = nameField(
        fields,
        'title',
        `Give the project a title of 1 to ${limits.nameChars} characters.`,
      );
      const kind = fields['kind'];
      if (kind !== 'one_to_one' && kind !== 'group') {
        throw validation({ kind: 'Choose a one-to-one or a group project.' });
      }
      const id = randomUUID();
      await tx(async (client) => {
        await client.query(
          'insert into projects (id, title, kind, owner_id) values ($1, $2, $3, $4)',
          [id, title, kind, ctx.user.id],
        );
        await client.query(
          `insert into memberships (project_id, user_id, role, email_status)
           values ($1, $2, 'mentor', 'none')`,
          [id, ctx.user.id],
        );
      });
      return { status: 201, payload: { project: { id, title, kind } } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects/:project_id',
    scope: 'project',
    body: 'none',
    handler: async (ctx) => {
      const owner = await pool.query<{ id: string; name: string }>(
        'select u.id, u.name from users u where u.id = $1',
        [ctx.project.owner_id],
      );
      const sessions = await pool.query<SessionRow>(
        `select id, project_id, title, state, scheduled_for, driver_id, version
           from project_sessions where project_id = $1 order by created_at`,
        [ctx.project.id],
      );
      return {
        status: 200,
        payload: {
          project: {
            id: ctx.project.id,
            title: ctx.project.title,
            kind: ctx.project.kind,
            owner: owner.rows[0],
            members: await memberList(pool, ctx.project.id),
            sessions: sessions.rows.map(sessionView),
          },
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/projects/:project_id/invites',
    scope: 'project',
    body: 'json',
    handler: async (ctx) => {
      assertMentor(ctx.role);
      const key = requireIdempotencyKey(ctx.header('idempotency-key'));
      return withIdempotency(ctx.user.id, key, ctx.fields(), () => inviteLearner(ctx));
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/projects/:project_id/members/:user_id',
    scope: 'project',
    body: 'none',
    handler: async (ctx) => {
      assertMentor(ctx.role);
      const targetId = ctx.params['user_id'] ?? '';
      if (targetId === ctx.project.owner_id) throw forbidden('The owner cannot be removed.');

      const outcome = await tx(async (client) => {
        const { rows } = await client.query<{ name: string }>(
          `select u.name from memberships m join users u on u.id = m.user_id
            where m.project_id = $1 and m.user_id = $2 for update of m`,
          [ctx.project.id, targetId],
        );
        const target = rows[0];
        if (target === undefined) throw notFound();
        const session = await returnBatonToMentor(client, ctx.project.id, targetId);
        await client.query('delete from memberships where project_id = $1 and user_id = $2', [
          ctx.project.id,
          targetId,
        ]);
        await client.query('delete from presence where project_id = $1 and user_id = $2', [
          ctx.project.id,
          targetId,
        ]);
        await writeAudit(client, {
          projectId: ctx.project.id,
          type: 'member_removed',
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          subject: { user_id: targetId, name: target.name },
        });
        return session;
      });

      await publish({
        project_id: ctx.project.id,
        user_id: targetId,
        frame: { type: 'access_revoked' },
      });
      await announcePresence(ctx.project.id);
      if (outcome !== null) await announceSession(outcome);
      return { status: 204 };
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects/:project_id/audit',
    scope: 'project',
    body: 'none',
    handler: async (ctx) => {
      assertMentor(ctx.role);
      const { rows } = await pool.query<{
        id: string;
        type: string;
        actor_id: string | null;
        actor_name: string;
        subject: Record<string, unknown>;
        at: Date;
      }>(
        `select id, type, actor_id, actor_name, subject, at from audit_events
          where project_id = $1 order by at desc, id desc`,
        [ctx.project.id],
      );
      return {
        status: 200,
        payload: {
          events: rows.map((row) => ({
            id: row.id,
            type: row.type,
            actor: { id: row.actor_id, name: row.actor_name },
            subject: row.subject,
            at: row.at.toISOString(),
          })),
        },
      };
    },
  },
];
