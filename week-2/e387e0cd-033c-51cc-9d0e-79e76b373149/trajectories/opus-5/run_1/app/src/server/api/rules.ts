import { changeExistsCopy, FIELD_COPY } from '../../shared/copy';
import {
  businessDate,
  dateLabel,
  isBusinessDate,
  nextBusinessDate,
  startOfBusinessDate,
  toInstant,
} from '../../shared/businesstime';
import { query, queryOne } from '../db/pool';
import { newId } from '../db/seed';
import { ApiError, failure } from '../http/errors';
import { ALL_STAFF, define, Registered, Role } from '../http/runtime';
import { FieldCheck, readInteger, readText } from '../http/validate';
import { CaseRow, pathOf, statusOf } from '../store/cases';
import { lapseAnswers } from '../store/caseengine';
import { allJurisdictions, findJurisdiction } from '../store/workspace';

const OFFICER: readonly Role[] = ['compliance_officer'];
const OFFICER_ANALYST: readonly Role[] = ['compliance_officer', 'compliance_analyst'];

interface ChangeRow {
  id: string;
  jurisdiction_code: string;
  threshold_cents: string;
  takes_effect_on: string;
  takes_effect_at: Date;
  announced_by: string | null;
  announced_at: Date;
}

function changeBody(row: ChangeRow, now: Date): Record<string, unknown> {
  return {
    id: row.id,
    thresholdCents: BigInt(row.threshold_cents),
    takesEffectOn: row.takes_effect_on,
    takesEffectAt: toInstant(row.takes_effect_at),
    announcedBy: row.announced_by,
    announcedAt: toInstant(row.announced_at),
    state: row.takes_effect_at.getTime() <= now.getTime() ? 'in_force' : 'scheduled',
  };
}

async function rulesFor(workspaceSlug: string, now: Date): Promise<Record<string, unknown>[]> {
  const jurisdictions = await allJurisdictions();
  const changes = await query<ChangeRow>(
    `SELECT id, jurisdiction_code, threshold_cents, takes_effect_on, takes_effect_at,
            announced_by, announced_at
     FROM threshold_changes WHERE workspace_slug = $1
     ORDER BY jurisdiction_code, takes_effect_at, takes_effect_on`,
    [workspaceSlug],
  );
  return jurisdictions.map((jurisdiction) => {
    const own = changes.filter((change) => change.jurisdiction_code === jurisdiction.code);
    const inForce = own.filter((change) => change.takes_effect_at.getTime() <= now.getTime()).pop();
    return {
      code: jurisdiction.code,
      name: jurisdiction.name,
      currency: jurisdiction.currency,
      ruleInForce:
        inForce === undefined
          ? null
          : { thresholdCents: BigInt(inForce.threshold_cents), since: inForce.takes_effect_on },
      changes: own.map((change) => changeBody(change, now)),
    };
  });
}

export const ruleRoutes: readonly Registered[] = [
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/rules',
    roles: ALL_STAFF,
    handler: async (context) => ({
      status: 200,
      json: { jurisdictions: await rulesFor(context.workspace.slug, context.now) },
    }),
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/rules/:code',
    roles: ALL_STAFF,
    load: async (context) => {
      const row = await findJurisdiction(context.params.code.toUpperCase());
      if (row === null) throw failure('not_found');
      return row;
    },
    handler: async (context) => {
      const all = await rulesFor(context.workspace.slug, context.now);
      const found = all.find((entry) => entry.code === context.loaded.code);
      return { status: 200, json: { jurisdiction: found } };
    },
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/rules/changes',
    roles: OFFICER,
    content: 'json',
    handler: async (context) => {
      const code = readText(context.body, 'jurisdictionCode');
      const thresholdCents = readInteger(context.body, 'thresholdCents');
      const takesEffectOn = readText(context.body, 'takesEffectOn');
      const today = businessDate(context.now, context.workspace.timeZone);
      const jurisdiction =
        code === null ? null : await findJurisdiction(code.toUpperCase());
      if (jurisdiction !== null && takesEffectOn !== null && isBusinessDate(takesEffectOn)) {
        const existing = await queryOne<{ id: string }>(
          `SELECT id FROM threshold_changes
           WHERE workspace_slug = $1 AND jurisdiction_code = $2 AND takes_effect_on = $3`,
          [context.workspace.slug, jurisdiction.code, takesEffectOn],
        );
        if (existing !== null) {
          throw new ApiError(
            409,
            'change_exists',
            changeExistsCopy(jurisdiction.name, dateLabel(takesEffectOn)),
          );
        }
      }
      const check = new FieldCheck();
      if (jurisdiction === null) check.add('jurisdictionCode', FIELD_COPY.jurisdictionCode);
      if (thresholdCents === null || thresholdCents < 0n) {
        check.add('thresholdCents', 'Enter a threshold of zero or more.');
      }
      if (takesEffectOn === null || !isBusinessDate(takesEffectOn) || takesEffectOn < today) {
        check.add('takesEffectOn', FIELD_COPY.takesEffectOn);
      }
      check.settle();
      const date = takesEffectOn as string;
      const takesEffectAt =
        date === today ? context.now : startOfBusinessDate(date, context.workspace.timeZone);
      const id = newId('tc');
      await query(
        `INSERT INTO threshold_changes (id, workspace_slug, jurisdiction_code, threshold_cents,
           takes_effect_on, takes_effect_at, announced_by, announced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          context.workspace.slug,
          (jurisdiction as { code: string }).code,
          (thresholdCents as bigint).toString(),
          date,
          takesEffectAt,
          context.member.name,
          context.now,
        ],
      );
      const row = await queryOne<ChangeRow>(
        `SELECT id, jurisdiction_code, threshold_cents, takes_effect_on, takes_effect_at,
                announced_by, announced_at FROM threshold_changes WHERE id = $1`,
        [id],
      );
      return { status: 201, json: { change: changeBody(row as ChangeRow, context.now) } };
    },
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/reports/daily',
    roles: OFFICER_ANALYST,
    handler: async (context) => {
      const date = context.url.searchParams.get('date') ?? businessDate(context.now, context.workspace.timeZone);
      if (!isBusinessDate(date)) {
        throw failure('invalid', { date: 'Choose a business date.' });
      }
      await lapseAnswers(context.workspace.slug, context.now);
      const startsAt = startOfBusinessDate(date, context.workspace.timeZone);
      const endsAt = startOfBusinessDate(nextBusinessDate(date), context.workspace.timeZone);
      const rows = await query<CaseRow>(
        `SELECT * FROM cases WHERE workspace_slug = $1 AND created_at >= $2 AND created_at < $3
         ORDER BY created_at, reference`,
        [context.workspace.slug, startsAt, endsAt],
      );
      return {
        status: 200,
        json: {
          date,
          timeZone: context.workspace.timeZone,
          startsAt: toInstant(startsAt),
          endsAt: toInstant(endsAt),
          hours: Math.round((endsAt.getTime() - startsAt.getTime()) / 3600000),
          transfers: rows.length,
          cases: rows.map((row) => ({
            reference: row.reference,
            createdAt: toInstant(row.created_at),
            asset: row.asset,
            amount: row.amount,
            fiatValueCents: BigInt(row.fiat_value_cents),
            currency: row.currency,
            thresholdCents: BigInt(row.du_threshold_cents),
            counterpartyName: row.du_counterparty_name,
            path: pathOf(row),
            status: statusOf(row),
          })),
        },
      };
    },
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/rates',
    roles: ALL_STAFF,
    handler: async (context) => {
      const rows = await query<{
        asset: string;
        currency: string;
        rate_cents: string;
        in_force_since: string;
      }>('SELECT asset, currency, rate_cents, in_force_since FROM rates WHERE workspace_slug = $1 ORDER BY asset', [
        context.workspace.slug,
      ]);
      return {
        status: 200,
        json: {
          rates: rows.map((row) => ({
            asset: row.asset,
            currency: row.currency,
            rateCents: BigInt(row.rate_cents),
            inForceSince: row.in_force_since,
          })),
        },
      };
    },
  }),
];
