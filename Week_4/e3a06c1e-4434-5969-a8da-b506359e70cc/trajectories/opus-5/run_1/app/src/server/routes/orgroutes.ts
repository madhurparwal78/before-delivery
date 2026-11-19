import { randomBytes, randomUUID } from 'node:crypto';
import { isUuid, requireAction, requireActor } from '../auth.js';
import { drivePlanChange, usageView } from '../billing.js';
import { query, queryOne } from '../db/pool.js';
import { fingerprintOf, withIdempotency } from '../domain/idempotency.js';
import { billingUnavailable, conflict, notFound } from '../http/errors.js';
import { empty, json, type Reply, type Router } from '../http/router.js';
import { FieldErrors } from '../http/validate.js';
import { billingReachable } from '../services/killbill.js';
import { loadProjectsForOrg } from '../store.js';
import { isRole } from './publicroutes.js';
import { fieldCopy } from '../../shared/copy.js';
import { checkEmail, checkText } from '../../shared/text.js';
import type { Plan, PlanChangeState, Role } from '../../shared/types.js';

interface MemberListRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  joined_at: Date;
  project_ids: string[];
}

interface PlanChangeRow {
  id: string;
  target: Plan;
  state: PlanChangeState;
  requested_at: Date;
  decided_at: Date | null;
}

const planChangeView = (row: PlanChangeRow) => ({
  id: row.id,
  target: row.target,
  state: row.state,
  requested_at: row.requested_at.toISOString(),
  decided_at: row.decided_at === null ? null : row.decided_at.toISOString(),
});

const readProjectIds = async (raw: unknown, orgId: string): Promise<string[] | 'invalid'> => {
  if (!Array.isArray(raw)) return 'invalid';
  const ids = raw.filter(isUuid);
  if (ids.length !== raw.length) throw notFound();
  if (ids.length === 0) return [];
  const rows = await query<{ id: string }>('select id from projects where org_id = $1 and id = any($2::uuid[])', [
    orgId,
    ids,
  ]);
  if (rows.length !== new Set(ids).size) throw notFound();
  return ids;
};

export const registerOrgRoutes = (router: Router): void => {
  router.add('GET', '/api/org/members', async (ctx) => {
    const actor = await requireActor(ctx);
    requireAction(actor, 'manage_org');
    const members = await query<MemberListRow>(
      `select m.id, m.name, m.email, m.role, m.joined_at,
         coalesce(array_agg(mp.project_id) filter (where mp.project_id is not null), '{}') as project_ids
         from members m left join member_projects mp on mp.member_id = m.id
        where m.org_id = $1 group by m.id order by m.joined_at, m.name`,
      [actor.org.id],
    );
    const invitations = await query<{
      id: string;
      name: string;
      email: string;
      role: Role;
      project_ids: string[];
    }>(
      'select id, name, email, role, project_ids from invitations where org_id = $1 and used = false order by created_at',
      [actor.org.id],
    );
    return json(200, {
      members: members.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        project_ids: row.project_ids,
        joined_at: row.joined_at.toISOString(),
      })),
      invitations: invitations.map((row) => ({ ...row, used: false as const })),
    });
  });

  router.add('POST', '/api/org/invitations', async (ctx) => {
    const actor = await requireActor(ctx);
    requireAction(actor, 'manage_org');
    const body = ctx.body;
    const projectIds = body.project_ids === undefined ? [] : await readProjectIds(body.project_ids, actor.org.id);

    const email = checkEmail(body.email);
    if (email.ok) {
      const taken = await queryOne<{ id: string }>(
        `select id from members where lower(email) = lower($1)
         union all select id from invitations where lower(email) = lower($1) and used = false`,
        [email.value],
      );
      if (taken !== null) throw conflict('email_taken', 'That email already belongs to a member or invitation.');
    }

    const fields = new FieldErrors();
    const name = checkText(body.name, 1, 100);
    if (!name.ok) fields.add('name', fieldCopy.invitationName);
    if (!email.ok) fields.add('email', fieldCopy.invitationEmail);
    if (!isRole(body.role)) fields.add('role', fieldCopy.role);
    if (projectIds === 'invalid') fields.add('project_ids', fieldCopy.projectIds);
    fields.raiseIfAny();

    const id = randomUUID();
    const token = randomBytes(24).toString('hex');
    await query(
      'insert into invitations (id, org_id, name, email, role, project_ids, token) values ($1, $2, $3, $4, $5, $6::uuid[], $7)',
      [id, actor.org.id, name.value, email.value, body.role as string, projectIds as string[], token],
    );
    return json(201, { id, invite_url: `/join/${token}` });
  }, 'json');

  router.add('PATCH', '/api/org/members/:memberId', async (ctx) => {
    const actor = await requireActor(ctx);
    requireAction(actor, 'manage_org');
    const memberId = ctx.params.memberId as string;
    if (!isUuid(memberId)) throw notFound();
    const member = await queryOne<{ id: string }>('select id from members where id = $1 and org_id = $2', [
      memberId,
      actor.org.id,
    ]);
    if (member === null) throw notFound();
    const body = ctx.body;
    if (memberId === actor.member.id) throw conflict('self_change', "You can't change your own membership.");
    const projectIds = body.project_ids === undefined ? null : await readProjectIds(body.project_ids, actor.org.id);

    const fields = new FieldErrors();
    if (body.role !== undefined && !isRole(body.role)) fields.add('role', fieldCopy.role);
    if (projectIds === 'invalid') fields.add('project_ids', fieldCopy.projectIds);
    fields.raiseIfAny();

    if (body.role !== undefined) await query('update members set role = $2 where id = $1', [memberId, body.role as string]);
    if (projectIds !== null) {
      await query('delete from member_projects where member_id = $1', [memberId]);
      for (const projectId of projectIds as string[])
        await query('insert into member_projects (member_id, project_id) values ($1, $2)', [memberId, projectId]);
    }
    const updated = await queryOne<MemberListRow>(
      `select m.id, m.name, m.email, m.role, m.joined_at,
         coalesce(array_agg(mp.project_id) filter (where mp.project_id is not null), '{}') as project_ids
         from members m left join member_projects mp on mp.member_id = m.id
        where m.id = $1 group by m.id`,
      [memberId],
    );
    if (updated === null) throw notFound();
    return json(200, {
      member: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        project_ids: updated.project_ids,
        joined_at: updated.joined_at.toISOString(),
      },
    });
  }, 'json');

  router.add('DELETE', '/api/org/members/:memberId', async (ctx) => {
    const actor = await requireActor(ctx);
    requireAction(actor, 'manage_org');
    const memberId = ctx.params.memberId as string;
    if (!isUuid(memberId)) throw notFound();
    const member = await queryOne<{ id: string }>('select id from members where id = $1 and org_id = $2', [
      memberId,
      actor.org.id,
    ]);
    if (member === null) throw notFound();
    if (memberId === actor.member.id) throw conflict('self_change', "You can't remove your own membership.");
    await query('delete from members where id = $1', [memberId]);
    return empty(204);
  });

  router.add('GET', '/api/usage', async (ctx) => {
    const actor = await requireActor(ctx);
    requireAction(actor, 'read_usage');
    const projects = await loadProjectsForOrg(actor.org.id);
    return json(200, await usageView(projects, new Date()));
  });

  router.add('GET', '/api/org/plan', async (ctx) => {
    const actor = await requireActor(ctx);
    requireAction(actor, 'manage_org');
    const change = await queryOne<PlanChangeRow>(
      'select id, target, state, requested_at, decided_at from plan_changes where org_id = $1 order by requested_at desc limit 1',
      [actor.org.id],
    );
    return json(200, {
      plan: actor.org.plan,
      billing_reachable: await billingReachable(),
      change: change === null ? null : planChangeView(change),
    });
  });

  router.add('POST', '/api/org/plan-changes', async (ctx) => {
    const actor = await requireActor(ctx);
    requireAction(actor, 'manage_org');
    const body = ctx.body;
    const rawKey = ctx.req.headers['idempotency-key'];
    const keyText = typeof rawKey === 'string' ? checkText(rawKey, 1, 100) : null;
    const key = keyText !== null && keyText.ok ? keyText.value : null;

    const run = async (): Promise<Reply> => {
      const plan = body.plan;
      if (plan === 'pilot' || plan === 'scale') {
        if (plan === actor.org.plan) throw conflict('plan_unchanged', `You're already on the ${plan} plan.`);
        const open = await queryOne<{ id: string }>(
          "select id from plan_changes where org_id = $1 and state = 'requested'",
          [actor.org.id],
        );
        if (open !== null) throw conflict('change_pending', 'A plan change is already waiting for billing.');
      }
      const fields = new FieldErrors();
      if (plan !== 'pilot' && plan !== 'scale') fields.add('plan', fieldCopy.plan);
      if (keyText !== null && !keyText.ok) fields.add('idempotency_key', fieldCopy.idempotencyKey);
      fields.raiseIfAny();

      if (!(await billingReachable())) throw billingUnavailable();

      const id = randomUUID();
      const created = await query<PlanChangeRow>(
        `insert into plan_changes (id, org_id, target, state) values ($1, $2, $3, 'requested')
         on conflict (org_id) where state = 'requested' do nothing
         returning id, target, state, requested_at, decided_at`,
        [id, actor.org.id, plan as string],
      );
      const row = created[0];
      if (row === undefined) throw conflict('change_pending', 'A plan change is already waiting for billing.');
      void drivePlanChange(row.id).catch(() => undefined);
      return json(202, { change: planChangeView(row) });
    };

    return withIdempotency(
      actor.member.id,
      key,
      fingerprintOf(ctx.method, ctx.path, [String(body.plan ?? '')]),
      run,
    );
  }, 'json');
};
