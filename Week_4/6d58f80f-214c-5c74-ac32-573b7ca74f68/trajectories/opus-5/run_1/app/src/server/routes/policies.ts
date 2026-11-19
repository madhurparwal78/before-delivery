import { db, newId, withTransaction } from '../db.js';
import { authed, requireFound, type Ctx, type Route } from '../http/api.js';
import { conflict, validation } from '../http/errors.js';
import { isValidDate, today } from '../domain/clock.js';
import { BIN_DAYS, GRANT_DAYS, POLICY_DATE } from '../../shared/copy.js';
import { POLICY_LIMITS, allPolicies, policyInForce } from '../domain/policies.js';
import { serializePolicy } from '../domain/serialize.js';
import { writeLedger } from '../domain/ledger.js';
import { publishPolicies } from '../events.js';
import { requireAdmin, requireStaff } from './helpers.js';
import type { PolicyKind } from '../../shared/types.js';
import type { PolicyRow } from '../domain/rows.js';

const inForceIds = async (): Promise<Set<string>> => {
  const now = today();
  const ids = new Set<string>();
  for (const kind of ['bin_retention_days', 'partner_grant_days'] as PolicyKind[]) {
    ids.add((await policyInForce(kind, now)).id);
  }
  return ids;
};

const serializeAll = async (rows: PolicyRow[]) => {
  const inForce = await inForceIds();
  return rows.map((row) => serializePolicy(row, inForce.has(row.id) ? row.id : null));
};

export const policyRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/policies',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      requireStaff(self);
      const rows = await allPolicies();
      return { status: 200, body: { today: today(), policies: await serializeAll(rows) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/policies',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      requireAdmin(self);
      const kind = ctx.body.kind;
      if (kind !== 'bin_retention_days' && kind !== 'partner_grant_days') {
        throw validation({ kind: 'Choose bin retention or grant length.' });
      }
      const limits = POLICY_LIMITS[kind];
      const days = ctx.body.days;
      const effectiveFrom = ctx.body.effectiveFrom;
      const fields: Record<string, string> = {};
      if (
        typeof days !== 'number' ||
        !Number.isInteger(days) ||
        days < limits.min ||
        days > limits.max
      ) {
        fields.days = kind === 'bin_retention_days' ? BIN_DAYS : GRANT_DAYS;
      }
      if (!isValidDate(effectiveFrom) || effectiveFrom <= today()) {
        fields.effectiveFrom = POLICY_DATE;
      }
      if (Object.keys(fields).length > 0) throw validation(fields);

      const clash = await db.query('SELECT 1 FROM policies WHERE kind = $1 AND effective_from = $2', [
        kind,
        effectiveFrom,
      ]);
      if (clash.rows.length > 0) throw conflict('policy_exists');

      const row = await withTransaction(async (tx) => {
        const { rows } = await tx.query<PolicyRow>(
          `INSERT INTO policies (id, kind, days, effective_from) VALUES ($1,$2,$3,$4)
           RETURNING id, kind, days, effective_from`,
          [newId(), kind, days, effectiveFrom],
        );
        const created = rows[0];
        if (created === undefined) throw new Error('policy insert returned nothing');
        await writeLedger(tx, {
          actorId: self.person.id,
          action: 'policy_scheduled',
          detail: { kind, days: days as number, effectiveFrom: effectiveFrom as string },
        });
        return created;
      });
      await publishPolicies();
      const inForce = await inForceIds();
      return {
        status: 201,
        body: { policy: serializePolicy(row, inForce.has(row.id) ? row.id : null) },
      };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/policies/:id',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const { rows } = await db.query<PolicyRow>(
        'SELECT id, kind, days, effective_from FROM policies WHERE id = $1',
        [self.params.id ?? ''],
      );
      const policy = requireFound(rows[0] ?? null);
      requireAdmin(self);
      if (policy.effective_from <= today()) throw conflict('policy_started');
      await withTransaction(async (tx) => {
        await tx.query('DELETE FROM policies WHERE id = $1', [policy.id]);
        await writeLedger(tx, {
          actorId: self.person.id,
          action: 'policy_withdrawn',
          detail: {
            kind: policy.kind,
            days: policy.days,
            effectiveFrom: policy.effective_from,
          },
        });
      });
      await publishPolicies();
      return { status: 204 };
    },
  },
];
