import { PoolClient } from 'pg';
import { knownIdOrNotFound } from '../db/ids';
import { appendLog, inHousehold, nextId, rows } from '../db';
import {
  Household,
  SwapRecord,
  adoptedOnly,
  loadAppliedSwaps,
  loadVersions,
  mapSwap,
  serialiseSwap,
  swapColumns,
  swapEtag,
} from '../db/repo';
import { AppliedSwap, Deriver, intervalDates } from '../domain/derive';
import { NightInterval, ParentRole, otherRole, versionForDate } from '../domain/plan';
import { PlainDate, epochDay, isValidDate } from '../domain/time';
import { ApiError, fail, failField } from '../errors';
import { ApiResponse, Ctx } from '../http/context';
import { makeCursor, readPageRequest, requireIfMatch } from '../http/protocol';
import { answeredNotice, queueNotices, requestSentNotice, supersedeQueuedReminders } from '../services/notices';
import { reportedState, REPORTED_STATE_SQL, storedMoments } from '../domain/deadlines';
import { declineReason } from './requests';

const NIGHTS_MESSAGE = 'Enter a first and last night, at most 28 nights.';
const GIVER_MESSAGE = 'Every night in a swap must be with the parent giving it.';

function readInterval(ctx: Ctx, field: string, message: string): NightInterval {
  const value = ctx.value(field);
  if (typeof value !== 'string') failField(field, message);
  const parts = value.split('/');
  if (parts.length !== 2) failField(field, message);
  const [start, end] = parts as [string, string];
  if (!isValidDate(start) || !isValidDate(end)) failField(field, message);
  const nights = epochDay(end) - epochDay(start);
  if (nights < 1 || nights > 28) failField(field, message);
  return { start, end };
}

async function loadSwap(client: PoolClient | null, householdId: string, id: string): Promise<SwapRecord> {
  knownIdOrNotFound(id);
  const sql = `SELECT ${swapColumns} FROM swaps WHERE household_id = $1 AND id = $2`;
  const found = client ? (await client.query(sql, [householdId, id])).rows : await rows(sql, [householdId, id]);
  const row = found[0];
  if (!row) fail('not_found');
  return mapSwap(row);
}

async function deriverFor(
  client: PoolClient,
  householdId: string,
  extra: AppliedSwap[] = [],
  excludeId: string | null = null,
): Promise<Deriver> {
  const versions = await loadVersions(householdId, client);
  const applied = (await loadAppliedSwaps(householdId, client)).filter((swap) => swap.id !== excludeId);
  return new Deriver(adoptedOnly(versions), [...applied, ...extra]);
}

interface SwapClaim {
  id: string;
  nights: NightInterval;
  makeupNights: NightInterval | null;
  toParent: ParentRole;
}

function checkOwnership(deriver: Deriver, claim: SwapClaim): void {
  const giver = otherRole(claim.toParent);
  for (const night of intervalDates(claim.nights)) {
    if (deriver.owner(night) !== giver) failField('nights', GIVER_MESSAGE);
  }
  if (!claim.makeupNights) return;
  const swapped = epochDay(claim.nights.end) - epochDay(claim.nights.start);
  const makeup = epochDay(claim.makeupNights.end) - epochDay(claim.makeupNights.start);
  if (swapped !== makeup) failField('makeupNights', 'Make-up nights must match the number of nights swapped.');
  const overlaps =
    claim.nights.start < claim.makeupNights.end && claim.makeupNights.start < claim.nights.end;
  if (overlaps) failField('makeupNights', "Make-up nights can't overlap the nights swapped.");
  const earlierFirst = claim.nights.start <= claim.makeupNights.start;
  const earlier = earlierFirst ? claim.nights : claim.makeupNights;
  const later = earlierFirst ? claim.makeupNights : claim.nights;
  if (epochDay(later.start) - epochDay(earlier.end) > 365) {
    failField('makeupNights', 'Take make-up nights within one year.');
  }
  for (const night of intervalDates(claim.makeupNights)) {
    if (deriver.owner(night) !== claim.toParent) {
      failField('makeupNights', 'Every make-up night must be with the parent receiving the swap.');
    }
  }
}

function movedNights(claim: SwapClaim): PlainDate[] {
  const nights = intervalDates(claim.nights);
  return claim.makeupNights ? [...nights, ...intervalDates(claim.makeupNights)] : nights;
}

function runLimitMessage(limit: number): string {
  return `That swap would keep the child with one parent for more than ${limit} nights in a row.`;
}

/** The run limit, applied with accepted swaps over derived nights across year and version boundaries. */
function checkRunLimit(deriver: Deriver, claim: SwapClaim, onAccept: boolean): void {
  for (const night of movedNights(claim)) {
    const limit = deriver.maxConsecutiveNightsOn(night);
    if (limit === null) continue;
    if (deriver.runLengthAt(night) > limit) {
      if (onAccept) throw new ApiError('swap_run_too_long', { errors: { nights: runLimitMessage(limit) } });
      failField('nights', runLimitMessage(limit));
    }
  }
}

async function checkOverlap(client: PoolClient, householdId: string, claim: SwapClaim): Promise<void> {
  const found = await client.query(
    `SELECT id::text AS id, nights_start, nights_end, makeup_start, makeup_end
     FROM swaps WHERE household_id = $1 AND id <> $2 AND state IN ('sent','accepted')`,
    [householdId, claim.id],
  );
  const mine = [claim.nights, ...(claim.makeupNights ? [claim.makeupNights] : [])];
  for (const row of found.rows) {
    const theirs: NightInterval[] = [
      { start: row.nights_start as PlainDate, end: row.nights_end as PlainDate },
    ];
    if (row.makeup_start !== null) {
      theirs.push({ start: row.makeup_start as PlainDate, end: row.makeup_end as PlainDate });
    }
    for (const a of mine) {
      for (const b of theirs) {
        if (a.start < b.end && b.start < a.end) {
          throw new ApiError('swap_overlaps', { conflictingRequestId: row.id as string });
        }
      }
    }
  }
}

function claimOf(swap: SwapRecord): SwapClaim {
  return { id: swap.id, nights: swap.nights, makeupNights: swap.makeupNights, toParent: swap.toParent };
}

export async function listSwaps(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const page = readPageRequest(ctx, household.id);
  const state = ctx.url.searchParams.get('state');
  const states = ['draft', 'sent', 'accepted', 'declined', 'lapsed', 'withdrawn', 'settled'];
  if (state !== null && !states.includes(state)) failField('state', 'This value is out of range.');
  const found = await rows(
    `SELECT ${swapColumns} FROM swaps
     WHERE household_id = $1
       AND ($2::text IS NULL OR ${REPORTED_STATE_SQL} = $2)
       AND ($3::bigint IS NULL OR id < $3)
     ORDER BY swaps.id DESC LIMIT $4`,
    [household.id, state, page.afterId, page.limit + 1],
  );
  const zone = await ctx.zone();
  const items = found.slice(0, page.limit).map((row) => serialiseSwap(mapSwap(row), zone, ctx.now));
  const last = found[page.limit - 1];
  return {
    status: 200,
    json: {
      items,
      next: found.length > page.limit && last ? makeCursor(household.id, last.id as string) : null,
    },
  };
}

export async function getSwap(ctx: Ctx): Promise<ApiResponse> {
  const swap = await loadSwap(null, ctx.home.id, ctx.params.id as string);
  const zone = await ctx.zone();
  return { status: 200, json: serialiseSwap(swap, zone, ctx.now), headers: { ETag: swapEtag(swap) } };
}

async function assertCanCreate(client: PoolClient, household: Household): Promise<void> {
  const versions = await loadVersions(household.id, client);
  if (adoptedOnly(versions).length === 0) fail('no_adopted_plan');
  if (!household.other.joined) fail('other_parent_not_joined');
}

export async function createSwap(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  return inHousehold(household.id, async (client) => {
    await assertCanCreate(client, household);
    const nights = readInterval(ctx, 'nights', NIGHTS_MESSAGE);
    const toParent = ctx.choice('toParent', ['planning', 'other'] as const, 'This value is out of range.');
    const makeupNights =
      ctx.value('makeupNights') === undefined || ctx.value('makeupNights') === null
        ? null
        : readInterval(ctx, 'makeupNights', 'Make-up nights must match the number of nights swapped.');
    const note = ctx.optionalText('note', 'Use at most 500 characters.', { min: 1, max: 500, multiline: true });
    const id = await nextId(client);
    const claim: SwapClaim = { id, nights, makeupNights, toParent };
    const deriver = await deriverFor(client, household.id);
    checkOwnership(deriver, claim);
    await client.query(
      `INSERT INTO swaps (id, household_id, nights_start, nights_end, makeup_start, makeup_end, to_parent,
          created_by, note, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')`,
      [
        id,
        household.id,
        nights.start,
        nights.end,
        makeupNights ? makeupNights.start : null,
        makeupNights ? makeupNights.end : null,
        toParent,
        ctx.user.role,
        note,
      ],
    );
    await appendLog(client, household.id, ctx.user.role, 'swap.drafted', id);
    const swap = await loadSwap(client, household.id, id);
    const zone = await ctx.zone();
    return {
      status: 201,
      json: serialiseSwap(swap, zone, ctx.now),
      headers: { ETag: swapEtag(swap) },
    };
  });
}

export async function deleteSwap(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  return inHousehold(household.id, async (client) => {
    const swap = await loadSwap(client, household.id, ctx.params.id as string);
    if (swap.createdBy !== ctx.user.role) fail('not_your_request');
    requireIfMatch(ctx, swapEtag(swap));
    if (swap.state !== 'draft') fail('invalid_transition');
    await client.query('DELETE FROM swaps WHERE id = $1', [swap.id]);
    await appendLog(client, household.id, ctx.user.role, 'swap.deleted', swap.id);
    return { status: 204 };
  });
}

export async function sendSwap(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const swap = await loadSwap(null, household.id, ctx.params.id as string);
  if (swap.createdBy !== ctx.user.role) fail('not_your_request');
  return inHousehold(household.id, async (client) => {
    const current = await loadSwap(client, household.id, swap.id);
    requireIfMatch(ctx, swapEtag(current));
    if (current.state !== 'draft') fail('invalid_transition');
    const claim = claimOf(current);
    const deriver = await deriverFor(client, household.id);
    checkOwnership(deriver, claim);
    const intervals: ['nights' | 'makeupNights', NightInterval][] = [['nights', current.nights]];
    if (current.makeupNights) intervals.push(['makeupNights', current.makeupNights]);
    let earliestHandover: number | null = null;
    for (const [field, interval] of intervals) {
      const handover = deriver.handoverOn(interval.start);
      const moment = handover ? handover.epochMs : (deriver.custodyDayStart(interval.start) as number | null);
      if (moment !== null && moment <= ctx.now) {
        failField(field, "The first night's handover has already passed.");
      }
      if (moment !== null && (earliestHandover === null || moment < earliestHandover)) earliestHandover = moment;
    }
    await checkOverlap(client, household.id, claim);
    const withClaim = await deriverFor(client, household.id, [
      { id: claim.id, nights: claim.nights, makeupNights: claim.makeupNights, toParent: claim.toParent },
    ]);
    checkRunLimit(withClaim, claim, false);
    const moments = storedMoments(ctx.now, earliestHandover);
    const versions = await loadVersions(household.id, client);
    const version = versionForDate(adoptedOnly(versions), current.nights.start);
    const answerZone = version ? version.body.exchangeZone : await ctx.zone();
    await client.query(
      `UPDATE swaps SET state = 'sent', sent_at = to_timestamp($2 / 1000.0), answer_by = to_timestamp($3 / 1000.0),
          answer_zone = $4, reminder_at = CASE WHEN $5::bigint IS NULL THEN NULL ELSE to_timestamp($5 / 1000.0) END,
          rev = rev + 1
       WHERE id = $1`,
      [current.id, ctx.now, moments.answerBy, answerZone, moments.reminderAt],
    );
    await appendLog(client, household.id, ctx.user.role, 'swap.sent', current.id);
    await queueNotices(client, household, [
      requestSentNotice(household, otherRole(ctx.user.role), 'swaps', current.id),
    ]);
    const sent = await loadSwap(client, household.id, current.id);
    const zone = await ctx.zone();
    return { status: 200, json: serialiseSwap(sent, zone, ctx.now), headers: { ETag: swapEtag(sent) } };
  });
}

export async function withdrawSwap(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const swap = await loadSwap(null, household.id, ctx.params.id as string);
  if (swap.createdBy !== ctx.user.role) fail('not_your_request');
  return inHousehold(household.id, async (client) => {
    const current = await loadSwap(client, household.id, swap.id);
    if (reportedState(current.state, current.answerBy, ctx.now) === 'lapsed') fail('request_lapsed');
    if (current.state !== 'sent') {
      requireIfMatch(ctx, swapEtag(current));
      fail('invalid_transition');
    }
    requireIfMatch(ctx, swapEtag(current));
    await client.query("UPDATE swaps SET state = 'withdrawn', rev = rev + 1 WHERE id = $1", [current.id]);
    await supersedeQueuedReminders(client, household.id, 'swaps', current.id);
    await appendLog(client, household.id, ctx.user.role, 'swap.withdrawn', current.id);
    const updated = await loadSwap(client, household.id, current.id);
    const zone = await ctx.zone();
    return { status: 200, json: serialiseSwap(updated, zone, ctx.now), headers: { ETag: swapEtag(updated) } };
  });
}

export async function acceptSwap(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const swap = await loadSwap(null, household.id, ctx.params.id as string);
  if (swap.createdBy === ctx.user.role) fail('not_your_answer');
  return inHousehold(household.id, async (client) => {
    const current = await loadSwap(client, household.id, swap.id);
    if (reportedState(current.state, current.answerBy, ctx.now) === 'lapsed') fail('request_lapsed');
    if (current.state !== 'sent') {
      requireIfMatch(ctx, swapEtag(current));
      fail('invalid_transition');
    }
    requireIfMatch(ctx, swapEtag(current));
    const claim = claimOf(current);
    const deriver = await deriverFor(client, household.id);
    const giver = otherRole(claim.toParent);
    for (const night of intervalDates(claim.nights)) {
      if (deriver.owner(night) !== giver) fail('swap_nights_changed');
    }
    if (claim.makeupNights) {
      for (const night of intervalDates(claim.makeupNights)) {
        if (deriver.owner(night) !== claim.toParent) fail('swap_nights_changed');
      }
    }
    const withClaim = await deriverFor(client, household.id, [claim]);
    checkRunLimit(withClaim, claim, true);
    const laterEnd =
      claim.makeupNights && claim.makeupNights.end > claim.nights.end ? claim.makeupNights.end : claim.nights.end;
    const settleHandover = withClaim.handoverOn(laterEnd);
    const settleAt = settleHandover ? settleHandover.epochMs : withClaim.custodyDayStart(laterEnd);
    await client.query(
      `UPDATE swaps SET state = 'accepted', answered_at = now(), rev = rev + 1,
          settle_at = CASE WHEN $2::bigint IS NULL THEN NULL ELSE to_timestamp($2 / 1000.0) END
       WHERE id = $1`,
      [current.id, settleAt],
    );
    await supersedeQueuedReminders(client, household.id, 'swaps', current.id);
    await appendLog(client, household.id, ctx.user.role, 'swap.accepted', current.id);
    await queueNotices(client, household, [answeredNotice(household, current.createdBy, true)]);
    const updated = await loadSwap(client, household.id, current.id);
    const zone = await ctx.zone();
    return { status: 200, json: serialiseSwap(updated, zone, ctx.now), headers: { ETag: swapEtag(updated) } };
  });
}

export async function declineSwap(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const swap = await loadSwap(null, household.id, ctx.params.id as string);
  if (swap.createdBy === ctx.user.role) fail('not_your_answer');
  return inHousehold(household.id, async (client) => {
    const current = await loadSwap(client, household.id, swap.id);
    if (reportedState(current.state, current.answerBy, ctx.now) === 'lapsed') fail('request_lapsed');
    if (current.state !== 'sent') {
      requireIfMatch(ctx, swapEtag(current));
      fail('invalid_transition');
    }
    requireIfMatch(ctx, swapEtag(current));
    const reason = declineReason(ctx);
    await client.query(
      "UPDATE swaps SET state = 'declined', answered_at = now(), decline_reason = $2, rev = rev + 1 WHERE id = $1",
      [current.id, reason],
    );
    await supersedeQueuedReminders(client, household.id, 'swaps', current.id);
    await appendLog(client, household.id, ctx.user.role, 'swap.declined', current.id);
    await queueNotices(client, household, [answeredNotice(household, current.createdBy, false)]);
    const updated = await loadSwap(client, household.id, current.id);
    const zone = await ctx.zone();
    return { status: 200, json: serialiseSwap(updated, zone, ctx.now), headers: { ETag: swapEtag(updated) } };
  });
}

/** Lapsing and swap settling belong to the system. */
export async function systemOnlySwapAction(ctx: Ctx): Promise<ApiResponse> {
  await loadSwap(null, ctx.home.id, ctx.params.id as string);
  return fail('invalid_transition');
}
