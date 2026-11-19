// Usage totals, plan state and plan changes.

import { randomUUID } from 'node:crypto';
import { errors } from './errors';
import { json, route, type Ctx, type Route } from './router';
import { readJson } from './body';
import { requireAction, visibleProjectIds } from './access';
import { planCostCents, type PlanId } from '../src-shared/billing';
import { checkText } from '../src-shared/text';
import { FIELD_MESSAGES } from '../src-shared/copy';
import { iso } from './api';
import { beginIdempotent, finishIdempotent, fingerprint } from './idempotency';

function currentMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function billingRoutes(): Route[] {
  return [
    route('GET', '/api/usage', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'readUsage');
      const now = new Date();
      const month = currentMonth(now);
      const start = monthStart(now).toISOString();
      const reachable = await ctx.billing.reachable();
      const visible = await visibleProjectIds(ctx.db, member);
      const projects: {
        project_id: string; name: string; sessions: number; billable_seconds: number;
        cost_cents: number; billing_state: 'confirmed' | 'pending'; pending_sessions: number;
        by_plan: { plan: PlanId; billable_seconds: number; cost_cents: number }[];
      }[] = [];
      let orgTotal = 0;
      for (const pid of visible) {
        const { rows: proj } = await ctx.db.query(`SELECT name FROM projects WHERE id=$1`, [pid]);
        const { rows } = await ctx.db.query(
          `SELECT plan, billable_seconds, billing_state FROM sessions
            WHERE project_id=$1 AND ended_at >= $2 AND billing_state IN ('pending','confirmed')`,
          [pid, start],
        );
        const byPlan = new Map<PlanId, number>();
        let totalSeconds = 0;
        let pending = 0;
        for (const r of rows) {
          const secs = r.billable_seconds as number;
          totalSeconds += secs;
          byPlan.set(r.plan as PlanId, (byPlan.get(r.plan as PlanId) ?? 0) + secs);
          if (r.billing_state === 'pending') pending++;
        }
        const plans = [...byPlan.entries()].map(([plan, secs]) => ({ plan, billable_seconds: secs, cost_cents: planCostCents(plan, secs) }));
        const cost = plans.reduce((acc, p) => acc + p.cost_cents, 0);
        orgTotal += cost;
        projects.push({
          project_id: pid, name: proj[0].name, sessions: rows.length,
          billable_seconds: totalSeconds, cost_cents: cost,
          billing_state: pending > 0 ? 'pending' : 'confirmed',
          pending_sessions: pending,
          by_plan: plans.sort((a, b) => a.plan.localeCompare(b.plan)),
        });
      }
      json(ctx, 200, {
        month,
        billing_reachable: reachable,
        org_total_cents: orgTotal,
        projects: projects.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }),

    route('GET', '/api/org/plan', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'managePlan');
      const { rows } = await ctx.db.query(`SELECT plan FROM orgs WHERE id=$1`, [member.org_id]);
      const reachable = await ctx.billing.reachable();
      const { rows: changes } = await ctx.db.query(
        `SELECT id, target, state, requested_at, decided_at FROM plan_changes WHERE org_id=$1 ORDER BY requested_at DESC LIMIT 1`,
        [member.org_id],
      );
      const change = changes.length === 0 || changes[0].state !== 'requested' ? null : {
        id: String(changes[0].id), target: changes[0].target,
        state: changes[0].state as 'requested',
        requested_at: iso(changes[0].requested_at),
        decided_at: changes[0].decided_at ? iso(changes[0].decided_at) : null,
      };
      json(ctx, 200, { plan: rows[0].plan, billing_reachable: reachable, change });
    }),

    route('POST', '/api/org/plan-changes', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'managePlan');
      const body = await readJson(ctx.req);
      const target = body.plan;
      if (target !== 'pilot' && target !== 'scale') throw errors.validation({ plan: FIELD_MESSAGES.plan });
      const idempotencyKey = ctx.req.headers['idempotency-key'];
      const { rows: org } = await ctx.db.query(`SELECT plan, slug FROM orgs WHERE id=$1`, [member.org_id]);
      const currentPlan = org[0].plan as PlanId;
      if (target === currentPlan) throw errors.conflict('plan_unchanged', 'The organisation is already on this plan.');

      const reachable = await ctx.billing.reachable();
      if (!reachable) throw errors.unavailable('billing_unavailable', 'Billing is unreachable, so the plan hasn\u2019t changed.');

      // Exactly one of two simultaneous requests wins.
      const id = randomUUID();
      const inserted = await ctx.db.query(
        `INSERT INTO plan_changes (id, org_id, target, state)
         SELECT $1, $2, $3, 'requested'
          WHERE NOT EXISTS (SELECT 1 FROM plan_changes WHERE org_id=$2 AND state='requested')
         RETURNING id`,
        [id, member.org_id, target],
      );
      if (inserted.rows.length === 0) throw errors.conflict('change_pending', 'A plan change is already waiting for billing.');

      const changeRow = {
        id, target, state: 'requested' as const,
        requested_at: iso(new Date()), decided_at: null,
      };
      // The reply is 202 with state requested; billing decides below.
      const respond = async () => {
        json(ctx, 202, { change: changeRow });
      };

      const fp = fingerprint(['POST', '/api/org/plan-changes', member.org_id, target]);
      const kc = idempotencyKey === undefined ? null : String(Array.isArray(idempotencyKey) ? idempotencyKey[0] : idempotencyKey);
      if (kc !== null) {
        const check = checkText(kc, 1, 100);
        if (!check.ok) {
          await ctx.db.query(`DELETE FROM plan_changes WHERE id=$1`, [id]);
          throw errors.validation({ idempotency_key: FIELD_MESSAGES.idempotencyKey });
        }
        const begun = await beginIdempotent(ctx.db, member.id, check.value, 'POST', '/api/org/plan-changes', fp);
        if (begun !== 'new') {
          await ctx.db.query(`DELETE FROM plan_changes WHERE id=$1 AND state='requested'`, [id]);
          if (begun === 'in_progress') throw errors.conflict('idempotency_in_progress', 'The same request is still running.');
          // Replay the stored 202 even after the change was confirmed.
          ctx.res.writeHead(begun.status, { 'Content-Type': begun.contentType, 'Content-Length': begun.body.length });
          ctx.res.end(begun.body);
          return;
        }
        await respond202Stored(ctx, member.id, check.value, async () => {
          // The stored body must say requested even after confirmation.
          await respondRaw(ctx, 202, { change: changeRow });
        });
        // Ask Kill Bill and settle the change.
        await settlePlanChange(ctx, member.org_id, id, target, org[0].slug, currentPlan);
        return;
      }
      await respondRaw(ctx, 202, { change: changeRow });
      await settlePlanChange(ctx, member.org_id, id, target, org[0].slug, currentPlan);
    }),
  ];
}

async function respond202Stored(ctx: Ctx, memberId: string, key: string, respond: () => Promise<void>): Promise<void> {
  const chunks: Buffer[] = [];
  const origWrite = ctx.res.write.bind(ctx.res);
  const origEnd = ctx.res.end.bind(ctx.res);
  const captured = { status: 200 };
  (ctx.res as unknown as { write: unknown }).write = (chunk: unknown) => {
    chunks.push(Buffer.from(chunk as Buffer | string));
    return true;
  };
  (ctx.res as unknown as { end: unknown }).end = (chunk?: unknown) => {
    if (chunk) chunks.push(Buffer.from(chunk as Buffer | string));
    origEnd();
    return ctx.res;
  };
  const origWriteHead = ctx.res.writeHead.bind(ctx.res);
  (ctx.res as unknown as { writeHead: unknown }).writeHead = (status: number, headers?: unknown) => {
    captured.status = status;
    return origWriteHead(status, headers as never);
  };
  await respond();
  const body = Buffer.concat(chunks);
  await finishIdempotent(ctx.db, memberId, key, captured.status, body, String(ctx.res.getHeader('Content-Type') ?? 'application/json'));
}

async function respondRaw(ctx: Ctx, status: number, body: unknown): Promise<void> {
  const data = Buffer.from(JSON.stringify(body), 'utf8');
  ctx.res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length });
  ctx.res.end(data);
}

/** Asks Kill Bill for the change, reads it back, then confirms or fails (DP-50). */
async function settlePlanChange(ctx: Ctx, orgId: string, changeId: string, target: PlanId, slug: string, currentPlan: PlanId): Promise<void> {
  const subExternalKey = `${ctx.cfg.billingPrefix}-sub-${slug}`;
  const { rows } = await ctx.db.query(`SELECT billing_account_id, billing_subscription_id FROM orgs WHERE id=$1`, [orgId]);
  const org = rows[0];
  const ok = org?.billing_subscription_id ? await ctx.kb.changePlan(org.billing_subscription_id, `${ctx.cfg.billingPrefix}-${target}`) : false;
  if (!ok) {
    await ctx.db.query(`UPDATE plan_changes SET state='failed', decided_at=now() WHERE id=$1`, [changeId]);
    return;
  }
  // Confirmed only after the server reads the subscription back with the target plan.
  const readBack = org?.billing_account_id ? await ctx.kb.readSubscriptionPlan(org.billing_account_id, subExternalKey) : null;
  if (readBack === `${ctx.cfg.billingPrefix}-${target}`) {
    await ctx.db.query(`UPDATE plan_changes SET state='confirmed', decided_at=now() WHERE id=$1`, [changeId]);
    await ctx.db.query(`UPDATE orgs SET plan=$2 WHERE id=$1`, [orgId, target]);
  } else {
    await ctx.db.query(`UPDATE plan_changes SET state='failed', decided_at=now() WHERE id=$1`, [changeId]);
  }
  void currentPlan;
}
