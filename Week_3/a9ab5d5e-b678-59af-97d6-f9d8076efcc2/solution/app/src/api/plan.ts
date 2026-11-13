import { appendLog, inHousehold } from '../db';
import {
  StoredVersion,
  adoptedOnly,
  draftOf,
  loadAppliedSwaps,
  loadVersions,
  householdToday,
  refreshStatement,
  sharesFor,
  splitForCost,
} from '../db/repo';
import { Deriver } from '../domain/derive';
import { PlanVersion } from '../domain/plan';
import { compareDates, dateYear } from '../domain/time';
import { fail, failField } from '../errors';
import { ApiResponse, Ctx } from '../http/context';
import { readYearParam, requireIfMatch, requireIfNoneMatchStar } from '../http/protocol';
import { Json } from '../lib/json';
import { amendmentNotice, queueNotices } from '../services/notices';
import { readVersionBody } from './planBody';

function versionEtag(version: StoredVersion): string {
  return `"plan-${version.id}-${version.rev}"`;
}

function serialiseVersion(version: StoredVersion): Json {
  return {
    id: version.id,
    number: version.number,
    status: version.status,
    effectiveFrom: version.body.effectiveFrom,
    exchangeZone: version.body.exchangeZone,
    firstExchangeAt: version.body.firstExchangeAt,
    base: { pattern: version.body.base.pattern, anchor: version.body.base.anchor },
    splitBp: { planning: version.body.splitBp.planning, other: version.body.splitBp.other },
    maxConsecutiveNights: version.body.maxConsecutiveNights,
    rules: version.body.rules as unknown as Json,
  };
}

export async function getPlan(ctx: Ctx): Promise<ApiResponse> {
  const versions = await loadVersions(ctx.home.id);
  const draft = draftOf(versions);
  return {
    status: 200,
    json: { versions: versions.map(serialiseVersion) },
    headers: draft ? { ETag: versionEtag(draft) } : {},
  };
}

export async function putDraft(ctx: Ctx): Promise<ApiResponse> {
  const body = readVersionBody(ctx);
  const household = ctx.home;
  return inHousehold(household.id, async (client) => {
    const versions = await loadVersions(household.id, client);
    const draft = draftOf(versions);
    if (draft) {
      if (ctx.header('if-none-match') !== undefined) fail('precondition_failed');
      requireIfMatch(ctx, versionEtag(draft));
      const updated = await client.query(
        `UPDATE plan_versions SET body = $2, effective_from = $3, rev = rev + 1
         WHERE id = $1 RETURNING rev`,
        [draft.id, JSON.stringify(body), body.effectiveFrom],
      );
      const rev = (updated.rows[0] as { rev: number }).rev;
      await appendLog(client, household.id, ctx.user.role, 'plan.draft_saved', draft.id);
      const stored: StoredVersion = { ...draft, body, rev, effectiveFrom: body.effectiveFrom };
      return { status: 200, json: serialiseVersion(stored), headers: { ETag: versionEtag(stored) } };
    }
    requireIfNoneMatchStar(ctx);
    const number = versions.reduce((highest, version) => Math.max(highest, version.number), 0) + 1;
    const created = await client.query(
      `INSERT INTO plan_versions (id, household_id, number, status, effective_from, body)
       VALUES (nextval('entity_ids'), $1, $2, 'draft', $3, $4)
       RETURNING id::text AS id, rev`,
      [household.id, number, body.effectiveFrom, JSON.stringify(body)],
    );
    const row = created.rows[0] as { id: string; rev: number };
    await appendLog(client, household.id, ctx.user.role, 'plan.draft_saved', row.id);
    const stored: StoredVersion = {
      id: row.id,
      number,
      status: 'draft',
      body,
      rev: row.rev,
      effectiveFrom: body.effectiveFrom,
    };
    return { status: 201, json: serialiseVersion(stored), headers: { ETag: versionEtag(stored) } };
  });
}

export async function deleteDraft(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  return inHousehold(household.id, async (client) => {
    const versions = await loadVersions(household.id, client);
    const draft = draftOf(versions);
    if (!draft) fail('not_found');
    requireIfMatch(ctx, versionEtag(draft));
    await client.query('DELETE FROM plan_versions WHERE id = $1', [draft.id]);
    await appendLog(client, household.id, ctx.user.role, 'plan.draft_deleted', draft.id);
    return { status: 204 };
  });
}

export async function adoptDraft(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  return inHousehold(household.id, async (client) => {
    const versions = await loadVersions(household.id, client);
    const draft = draftOf(versions);
    if (!draft) fail('not_found');
    requireIfMatch(ctx, versionEtag(draft));
    const adopted = adoptedOnly(versions);
    const today = householdToday(versions, ctx.now);
    if (adopted.length > 0 && compareDates(draft.effectiveFrom, today) <= 0) {
      failField('effectiveFrom', 'An amendment must start after today.');
    }
    const blocking = await client.query(
      `SELECT 1 FROM costs WHERE household_id = $1 AND state <> 'draft' AND custody_day >= $2 LIMIT 1`,
      [household.id, draft.effectiveFrom],
    );
    if (blocking.rows.length > 0) fail('costs_logged_after_effective_date');
    const updated = await client.query(
      "UPDATE plan_versions SET status = 'adopted', rev = rev + 1 WHERE id = $1 RETURNING rev",
      [draft.id],
    );
    const rev = (updated.rows[0] as { rev: number }).rev;
    const stored: StoredVersion = { ...draft, status: 'adopted', rev };
    const allVersions = [...versions.filter((version) => version.id !== draft.id), stored];
    const deriver = new Deriver(adoptedOnly(allVersions), []);
    const draftCosts = await client.query(
      `SELECT id::text AS id, incurred_at, amount_minor, paid_by, agreed_split_planning_bp
       FROM costs WHERE household_id = $1 AND state = 'draft'`,
      [household.id],
    );
    for (const row of draftCosts.rows) {
      const custodyDay = deriver.custodyDayFor((row.incurred_at as Date).getTime());
      if (custodyDay === null || compareDates(custodyDay, draft.effectiveFrom) < 0) continue;
      const split = splitForCost(row.agreed_split_planning_bp as number | null, allVersions, custodyDay);
      const shares = sharesFor(row.amount_minor as number, split.planningBp, row.paid_by as 'planning' | 'other');
      await client.query(
        `UPDATE costs SET custody_day = $2, version_id = $3, split_planning_bp = $4, share_planning = $5,
            share_other = $6, rev = rev + 1
         WHERE id = $1`,
        [row.id as string, custodyDay, split.versionId, split.planningBp, shares.planning, shares.other],
      );
    }
    await appendLog(client, household.id, ctx.user.role, 'plan.adopted', draft.id);
    if (stored.number > 1) await queueNotices(client, household, [amendmentNotice(household)]);
    await refreshStatement(client, household);
    return { status: 200, json: serialiseVersion(stored), headers: { ETag: versionEtag(stored) } };
  });
}

export async function previewPlan(ctx: Ctx): Promise<ApiResponse> {
  const body = readVersionBody(ctx);
  const household = ctx.home;
  const versions = await loadVersions(household.id);
  const adopted = adoptedOnly(versions);
  const defaultYear =
    adopted.length > 0 ? dateYear(householdToday(versions, ctx.now)) : dateYear(body.effectiveFrom);
  const year = readYearParam(ctx, defaultYear);
  const swaps = await loadAppliedSwaps(household.id);
  const preview: PlanVersion = { id: 'preview', number: 0, status: 'draft', body };
  const others = adopted.filter((version) => version.body.effectiveFrom !== body.effectiveFrom);
  const deriver = new Deriver([...others, preview], swaps);
  const nights = { planning: 0, other: 0 };
  for (const night of deriver.range(`${year}-01-01`, `${year}-12-31`)) {
    if (night.owner) nights[night.owner] += 1;
  }
  return { status: 200, json: { year, nights } };
}
