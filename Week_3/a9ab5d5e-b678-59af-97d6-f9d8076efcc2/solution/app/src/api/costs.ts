import { createHash } from 'node:crypto';
import { knownIdOrNotFound } from '../db/ids';
import { PoolClient } from 'pg';
import { appendLog, inHousehold, nextId, one, rows } from '../db';
import {
  CostRecord,
  Household,
  adoptedOnly,
  attachReceipts,
  costColumns,
  costEtag,
  loadVersions,
  makeDeriver,
  mapCost,
  refreshStatement,
  serialiseCost,
  sharesFor,
  splitForCost,
} from '../db/repo';
import { earliestVersion, otherRole, versionForDate } from '../domain/plan';
import { PlainDate, addDays, compareDates } from '../domain/time';
import { isPlainIntegerLiteral } from '../lib/json';
import { fail, failField } from '../errors';
import { ApiResponse, Ctx } from '../http/context';
import { makeCursor, notModified, readPageRequest, requireIfMatch } from '../http/protocol';
import { answeredNotice, queueNotices, requestSentNotice, supersedeQueuedReminders } from '../services/notices';
import { StorageUnavailable, deleteObject, receiptKey } from '../services/storage';
import { reportedState, REPORTED_STATE_SQL, storedMoments } from '../domain/deadlines';
import { declineReason } from './requests';

const categories = ['medical', 'school', 'activities', 'child_care', 'clothing', 'other'] as const;
const AMOUNT_MESSAGE = 'Enter the amount as whole minor units from 1 to 100000000000.';
const RANGE_MESSAGE = 'Choose a date from the plan start to one year ahead.';
const DESCRIPTION_MESSAGE = 'Use 1 to 500 characters.';
const NOTE_MESSAGE = 'Use at most 500 characters.';
const SPLIT_MESSAGE = 'The two shares must add up to 100%.';

async function loadCost(client: PoolClient | null, householdId: string, id: string): Promise<CostRecord> {
  knownIdOrNotFound(id);
  const sql = `SELECT ${costColumns} FROM costs WHERE household_id = $1 AND id = $2`;
  const found = client ? (await client.query(sql, [householdId, id])).rows : await rows(sql, [householdId, id]);
  const row = found[0];
  if (!row) fail('not_found');
  const cost = mapCost(row);
  await attachReceipts([cost], client ?? undefined);
  return cost;
}

async function custodyDayOf(client: PoolClient | null, household: Household, incurredAt: number): Promise<PlainDate> {
  const deriver = await makeDeriver(household.id, client ?? undefined);
  const custodyDay = deriver.custodyDayFor(incurredAt);
  if (custodyDay === null) fail('no_adopted_plan');
  return custodyDay;
}

async function assertCustodyDayInRange(ctx: Ctx, custodyDay: PlainDate): Promise<void> {
  const versions = await loadVersions(ctx.home.id);
  const first = earliestVersion(adoptedOnly(versions));
  if (!first) fail('no_adopted_plan');
  const today = await ctx.today();
  if (
    compareDates(custodyDay, first.body.effectiveFrom) < 0 ||
    compareDates(custodyDay, addDays(today, 366)) > 0
  ) {
    failField('incurredAt', RANGE_MESSAGE);
  }
}

function readAgreedSplit(ctx: Ctx): number | null {
  const value = ctx.value('agreedSplitBp');
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) failField('agreedSplitBp', SPLIT_MESSAGE);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'planning' && key !== 'other') failField(`agreedSplitBp.${key}`, 'This field is not accepted.');
  }
  const planning = record.planning;
  const other = record.other;
  if (
    typeof planning !== 'number' ||
    typeof other !== 'number' ||
    !isPlainIntegerLiteral(ctx.literal('agreedSplitBp.planning')) ||
    !isPlainIntegerLiteral(ctx.literal('agreedSplitBp.other')) ||
    planning + other !== 10000 ||
    planning < 0 ||
    other < 0
  ) {
    failField('agreedSplitBp', SPLIT_MESSAGE);
  }
  return planning;
}

export async function listCosts(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const page = readPageRequest(ctx, household.id);
  const state = ctx.url.searchParams.get('state');
  const states = ['draft', 'sent', 'accepted', 'declined', 'lapsed', 'withdrawn', 'settled'];
  if (state !== null && !states.includes(state)) failField('state', 'This value is out of range.');
  const found = await rows(
    `SELECT ${costColumns} FROM costs
     WHERE household_id = $1
       AND ($2::text IS NULL OR ${REPORTED_STATE_SQL} = $2)
       AND ($3::bigint IS NULL OR id < $3)
     ORDER BY costs.id DESC LIMIT $4`,
    [household.id, state, page.afterId, page.limit + 1],
  );
  const costs = found.slice(0, page.limit).map(mapCost);
  await attachReceipts(costs);
  const zone = await ctx.zone();
  const last = found[page.limit - 1];
  return {
    status: 200,
    json: {
      items: costs.map((cost) => serialiseCost(cost, zone, ctx.now)),
      next: found.length > page.limit && last ? makeCursor(household.id, last.id as string) : null,
    },
  };
}

export async function getCost(ctx: Ctx): Promise<ApiResponse> {
  const cost = await loadCost(null, ctx.home.id, ctx.params.id as string);
  const zone = await ctx.zone();
  return { status: 200, json: serialiseCost(cost, zone, ctx.now), headers: { ETag: costEtag(cost) } };
}

export async function createCost(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const versions = await loadVersions(household.id);
  if (adoptedOnly(versions).length === 0) fail('no_adopted_plan');
  if (!household.other.joined) fail('other_parent_not_joined');
  const description = ctx.text('description', DESCRIPTION_MESSAGE, { min: 1, max: 500, multiline: true });
  const category = ctx.choice('category', categories, 'This value is out of range.');
  const amountMinor = ctx.integer('amountMinor', AMOUNT_MESSAGE, { min: 1, max: 100000000000 });
  const incurredAt = ctx.instant('incurredAt');
  const note = ctx.optionalText('note', NOTE_MESSAGE, { min: 1, max: 500, multiline: true });
  const custodyDay = await custodyDayOf(null, household, incurredAt);
  await assertCustodyDayInRange(ctx, custodyDay);
  return inHousehold(household.id, async (client) => {
    const split = splitForCost(null, await loadVersions(household.id, client), custodyDay);
    const shares = sharesFor(amountMinor, split.planningBp, ctx.user.role);
    const id = await nextId(client);
    await client.query(
      `INSERT INTO costs (id, household_id, description, category, note, amount_minor, incurred_at, custody_day,
          paid_by, version_id, split_planning_bp, share_planning, share_other, state)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), $8, $9, $10, $11, $12, $13, 'draft')`,
      [
        id,
        household.id,
        description,
        category,
        note,
        amountMinor,
        incurredAt,
        custodyDay,
        ctx.user.role,
        split.versionId,
        split.planningBp,
        shares.planning,
        shares.other,
      ],
    );
    await appendLog(client, household.id, ctx.user.role, 'cost.drafted', id);
    await refreshStatement(client, household);
    const cost = await loadCost(client, household.id, id);
    const zone = await ctx.zone();
    return { status: 201, json: serialiseCost(cost, zone, ctx.now), headers: { ETag: costEtag(cost) } };
  });
}

export async function patchCost(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const creatorFields = ['description', 'category', 'amountMinor', 'incurredAt', 'note'];
  const touchesCreatorFields = creatorFields.some((field) => ctx.present(field));
  const existing = await loadCost(null, household.id, ctx.params.id as string);
  if (touchesCreatorFields && existing.paidBy !== ctx.user.role) fail('not_your_request');
  return inHousehold(household.id, async (client) => {
    const cost = await loadCost(client, household.id, existing.id);
    requireIfMatch(ctx, costEtag(cost));
    if (touchesCreatorFields && cost.state !== 'draft') fail('invalid_transition');
    if (ctx.present('agreedSplitBp') && cost.state !== 'draft' && cost.state !== 'sent') fail('invalid_transition');
    const description = ctx.present('description')
      ? ctx.text('description', DESCRIPTION_MESSAGE, { min: 1, max: 500, multiline: true })
      : cost.description;
    const category = ctx.present('category') ? ctx.choice('category', categories, 'This value is out of range.') : cost.category;
    const amountMinor = ctx.present('amountMinor')
      ? ctx.integer('amountMinor', AMOUNT_MESSAGE, { min: 1, max: 100000000000 })
      : cost.amountMinor;
    const note = ctx.present('note') ? ctx.optionalText('note', NOTE_MESSAGE, { min: 1, max: 500, multiline: true }) : cost.note;
    let custodyDay = cost.custodyDay;
    let incurredAtMs = cost.incurredAt.getTime();
    if (ctx.present('incurredAt')) {
      incurredAtMs = ctx.instant('incurredAt');
      custodyDay = await custodyDayOf(client, household, incurredAtMs);
      await assertCustodyDayInRange(ctx, custodyDay);
    }
    const agreedPlanningBp = ctx.present('agreedSplitBp') ? readAgreedSplit(ctx) : cost.agreedSplitPlanningBp;
    const versions = await loadVersions(household.id, client);
    const frozen = versions.find((version) => version.id === cost.versionId) ?? null;
    const split =
      cost.state === 'draft'
        ? splitForCost(agreedPlanningBp, versions, custodyDay)
        : {
            planningBp: agreedPlanningBp ?? frozen?.body.splitBp.planning ?? cost.splitPlanningBp,
            versionId: cost.versionId,
          };
    const shares = sharesFor(amountMinor, split.planningBp, cost.paidBy);
    await client.query(
      `UPDATE costs SET description = $2, category = $3, note = $4, amount_minor = $5,
          incurred_at = to_timestamp($6 / 1000.0), custody_day = $7, agreed_split_planning_bp = $8,
          split_planning_bp = $9, share_planning = $10, share_other = $11, version_id = $12, rev = rev + 1
       WHERE id = $1`,
      [
        cost.id,
        description,
        category,
        note,
        amountMinor,
        incurredAtMs,
        custodyDay,
        agreedPlanningBp,
        split.planningBp,
        shares.planning,
        shares.other,
        split.versionId,
      ],
    );
    await appendLog(client, household.id, ctx.user.role, 'cost.edited', cost.id);
    await refreshStatement(client, household);
    const updated = await loadCost(client, household.id, cost.id);
    const zone = await ctx.zone();
    return { status: 200, json: serialiseCost(updated, zone, ctx.now), headers: { ETag: costEtag(updated) } };
  });
}

export async function deleteCost(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const existing = await loadCost(null, household.id, ctx.params.id as string);
  if (existing.paidBy !== ctx.user.role) fail('not_your_request');
  const guard = await loadCost(null, household.id, existing.id);
  requireIfMatch(ctx, costEtag(guard));
  if (guard.state !== 'draft') fail('invalid_transition');
  for (const receipt of guard.receipts) {
    try {
      await deleteObject(receiptKey(household.id, receipt.id));
    } catch (error) {
      if (error instanceof StorageUnavailable) fail('storage_unavailable');
      throw error;
    }
  }
  return inHousehold(household.id, async (client) => {
    const cost = await loadCost(client, household.id, guard.id);
    requireIfMatch(ctx, costEtag(cost));
    if (cost.state !== 'draft') fail('invalid_transition');
    await client.query('DELETE FROM receipts WHERE cost_id = $1', [cost.id]);
    await client.query('DELETE FROM costs WHERE id = $1', [cost.id]);
    await appendLog(client, household.id, ctx.user.role, 'cost.deleted', cost.id);
    await refreshStatement(client, household);
    return { status: 204 };
  });
}

export async function sendCost(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const existing = await loadCost(null, household.id, ctx.params.id as string);
  if (existing.paidBy !== ctx.user.role) fail('not_your_request');
  return inHousehold(household.id, async (client) => {
    const cost = await loadCost(client, household.id, existing.id);
    requireIfMatch(ctx, costEtag(cost));
    if (cost.state !== 'draft') fail('invalid_transition');
    const versions = await loadVersions(household.id, client);
    const version = versionForDate(adoptedOnly(versions), cost.custodyDay);
    const split = splitForCost(cost.agreedSplitPlanningBp, versions, cost.custodyDay);
    const shares = sharesFor(cost.amountMinor, split.planningBp, cost.paidBy);
    const moments = storedMoments(ctx.now, null);
    await client.query(
      `UPDATE costs SET state = 'sent', sent_at = to_timestamp($2 / 1000.0), answer_by = to_timestamp($3 / 1000.0),
          answer_zone = $4, reminder_at = CASE WHEN $5::bigint IS NULL THEN NULL ELSE to_timestamp($5 / 1000.0) END,
          version_id = $6, split_planning_bp = $7, share_planning = $8, share_other = $9, rev = rev + 1
       WHERE id = $1`,
      [
        cost.id,
        ctx.now,
        moments.answerBy,
        version ? version.body.exchangeZone : await ctx.zone(),
        moments.reminderAt,
        split.versionId,
        split.planningBp,
        shares.planning,
        shares.other,
      ],
    );
    await appendLog(client, household.id, ctx.user.role, 'cost.sent', cost.id);
    await queueNotices(client, household, [
      requestSentNotice(household, otherRole(ctx.user.role), 'costs', cost.id),
    ]);
    await refreshStatement(client, household);
    const updated = await loadCost(client, household.id, cost.id);
    const zone = await ctx.zone();
    return { status: 200, json: serialiseCost(updated, zone, ctx.now), headers: { ETag: costEtag(updated) } };
  });
}

type CostOutcome = 'accepted' | 'declined' | 'withdrawn' | 'settled';

async function answerCost(ctx: Ctx, outcome: CostOutcome): Promise<ApiResponse> {
  const household = ctx.home;
  const existing = await loadCost(null, household.id, ctx.params.id as string);
  if (outcome === 'accepted' || outcome === 'declined') {
    if (existing.paidBy === ctx.user.role) fail('not_your_answer');
  } else if (existing.paidBy !== ctx.user.role) {
    fail('not_your_request');
  }
  const reason = outcome === 'declined' ? declineReason(ctx) : null;
  return inHousehold(household.id, async (client) => {
    const cost = await loadCost(client, household.id, existing.id);
    const required = outcome === 'settled' ? 'accepted' : 'sent';
    if (outcome !== 'settled' && reportedState(cost.state, cost.answerBy, ctx.now) === 'lapsed') {
      fail('request_lapsed');
    }
    if (cost.state !== required) {
      requireIfMatch(ctx, costEtag(cost));
      fail('invalid_transition');
    }
    requireIfMatch(ctx, costEtag(cost));
    const answered = outcome === 'accepted' || outcome === 'declined';
    await client.query(
      `UPDATE costs SET state = $2, decline_reason = $3,
          answered_at = CASE WHEN $4 THEN now() ELSE answered_at END, rev = rev + 1
       WHERE id = $1`,
      [cost.id, outcome, reason, answered],
    );
    await supersedeQueuedReminders(client, household.id, 'costs', cost.id);
    await appendLog(client, household.id, ctx.user.role, `cost.${outcome}`, cost.id);
    if (answered) {
      await queueNotices(client, household, [answeredNotice(household, cost.paidBy, outcome === 'accepted')]);
    }
    await refreshStatement(client, household);
    const updated = await loadCost(client, household.id, cost.id);
    const zone = await ctx.zone();
    return { status: 200, json: serialiseCost(updated, zone, ctx.now), headers: { ETag: costEtag(updated) } };
  });
}

export function acceptCost(ctx: Ctx): Promise<ApiResponse> {
  return answerCost(ctx, 'accepted');
}

export function declineCost(ctx: Ctx): Promise<ApiResponse> {
  return answerCost(ctx, 'declined');
}

export function withdrawCost(ctx: Ctx): Promise<ApiResponse> {
  return answerCost(ctx, 'withdrawn');
}

export function settleCost(ctx: Ctx): Promise<ApiResponse> {
  return answerCost(ctx, 'settled');
}

export async function systemOnlyCostAction(ctx: Ctx): Promise<ApiResponse> {
  await loadCost(null, ctx.home.id, ctx.params.id as string);
  return fail('invalid_transition');
}

export async function quoteCost(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const versions = await loadVersions(household.id);
  if (adoptedOnly(versions).length === 0) fail('no_adopted_plan');
  const amountMinor = ctx.integer('amountMinor', AMOUNT_MESSAGE, { min: 1, max: 100000000000 });
  const incurredAt = ctx.instant('incurredAt');
  const custodyDay = await custodyDayOf(null, household, incurredAt);
  await assertCustodyDayInRange(ctx, custodyDay);
  const split = splitForCost(null, versions, custodyDay);
  const shares = sharesFor(amountMinor, split.planningBp, ctx.user.role);
  return {
    status: 200,
    json: {
      splitBp: { planning: split.planningBp, other: 10000 - split.planningBp },
      shares,
      versionId: split.versionId,
      custodyDay,
    },
  };
}

function statementResponse(ctx: Ctx, doc: string): ApiResponse {
  const bytes = Buffer.from(doc, 'utf8');
  const etag = `"${createHash('sha256').update(bytes).digest('hex')}"`;
  if (notModified(ctx, etag)) return { status: 304, headers: { ETag: etag } };
  return {
    status: 200,
    body: bytes,
    headers: { ETag: etag, 'Content-Type': 'application/json; charset=utf-8' },
  };
}

export async function getStatement(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const found = await one('SELECT doc FROM statements WHERE household_id = $1', [household.id]);
  if (found) return statementResponse(ctx, found.doc as string);
  return inHousehold(household.id, async (client) => {
    await refreshStatement(client, household);
    const stored = (await client.query('SELECT doc FROM statements WHERE household_id = $1', [household.id])).rows[0] as {
      doc: string;
    };
    return statementResponse(ctx, stored.doc);
  });
}

export async function rebuildStatement(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  return inHousehold(household.id, async (client) => {
    await refreshStatement(client, household);
    const stored = (await client.query('SELECT doc FROM statements WHERE household_id = $1', [household.id])).rows[0] as {
      doc: string;
    };
    return statementResponse(ctx, stored.doc);
  });
}
