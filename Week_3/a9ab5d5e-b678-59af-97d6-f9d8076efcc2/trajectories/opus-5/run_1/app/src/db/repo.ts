import { PoolClient } from 'pg';
import { AppliedSwap, Deriver } from '../domain/derive';
import { StatementCost, buildStatementDocument } from '../domain/documents';
import { allocateShares } from '../domain/money';
import { NightInterval, ParentRole, PlanVersion, VersionBody, earliestVersion, versionForDate } from '../domain/plan';
import { PlainDate, compareDates, formatInstant, localDate } from '../domain/time';
import { Json } from '../lib/json';
import { Queryable, one, rows } from './index';

export interface ParentRecord {
  id: string;
  role: ParentRole;
  name: string;
  email: string;
  joined: boolean;
}

export interface Household {
  id: string;
  name: string;
  currency: string;
  planning: ParentRecord;
  other: ParentRecord;
}

export async function loadHousehold(householdId: string): Promise<Household | null> {
  const household = await one('SELECT id::text AS id, name, currency FROM households WHERE id = $1', [householdId]);
  if (!household) return null;
  const parents = await rows(
    'SELECT id::text AS id, role, name, email, joined FROM parents WHERE household_id = $1',
    [householdId],
  );
  const planning = parents.find((row) => row.role === 'planning') as unknown as ParentRecord;
  const other = parents.find((row) => row.role === 'other') as unknown as ParentRecord;
  return {
    id: household.id as string,
    name: household.name as string,
    currency: household.currency as string,
    planning,
    other,
  };
}

export function parentName(household: Household, role: ParentRole): string {
  return role === 'planning' ? household.planning.name : household.other.name;
}

export interface StoredVersion extends PlanVersion {
  rev: number;
  effectiveFrom: PlainDate;
}

export async function loadVersions(householdId: string, client?: Queryable): Promise<StoredVersion[]> {
  const sql = `SELECT id::text AS id, number, status, effective_from, body, rev
               FROM plan_versions WHERE household_id = $1 ORDER BY number DESC`;
  const found = client ? (await client.query(sql, [householdId])).rows : await rows(sql, [householdId]);
  return found.map((row) => ({
    id: row.id as string,
    number: row.number as number,
    status: row.status as 'draft' | 'adopted',
    body: JSON.parse(row.body as string) as VersionBody,
    rev: row.rev as number,
    effectiveFrom: row.effective_from as PlainDate,
  }));
}

export function adoptedOnly(versions: StoredVersion[]): StoredVersion[] {
  return versions.filter((version) => version.status === 'adopted');
}

export function draftOf(versions: StoredVersion[]): StoredVersion | null {
  return versions.find((version) => version.status === 'draft') ?? null;
}

export async function loadAppliedSwaps(householdId: string, client?: Queryable): Promise<AppliedSwap[]> {
  const sql = `SELECT id::text AS id, nights_start, nights_end, makeup_start, makeup_end, to_parent
               FROM swaps WHERE household_id = $1 AND state IN ('accepted','settled') ORDER BY swaps.id`;
  const found = client ? (await client.query(sql, [householdId])).rows : await rows(sql, [householdId]);
  return found.map((row) => ({
    id: row.id as string,
    nights: { start: row.nights_start as PlainDate, end: row.nights_end as PlainDate },
    makeupNights:
      row.makeup_start === null
        ? null
        : { start: row.makeup_start as PlainDate, end: row.makeup_end as PlainDate },
    toParent: row.to_parent as ParentRole,
  }));
}

export async function makeDeriver(
  householdId: string,
  client?: Queryable,
  extraSwaps: AppliedSwap[] = [],
): Promise<Deriver> {
  const versions = await loadVersions(householdId, client);
  const swaps = await loadAppliedSwaps(householdId, client);
  return new Deriver(adoptedOnly(versions), [...swaps, ...extraSwaps]);
}

/** The household's today: the server clock's date in the governing plan zone. */
export function householdToday(versions: StoredVersion[], nowMs: number): PlainDate {
  const adopted = [...adoptedOnly(versions)].sort((a, b) => compareDates(b.effectiveFrom, a.effectiveFrom));
  for (const version of adopted) {
    const local = localDate(version.body.exchangeZone, nowMs);
    if (compareDates(version.effectiveFrom, local) <= 0) return local;
  }
  const earliest = earliestVersion(adopted);
  if (earliest) return localDate(earliest.body.exchangeZone, nowMs);
  const draft = draftOf(versions);
  if (draft) return localDate(draft.body.exchangeZone, nowMs);
  return localDate('UTC', nowMs);
}

export function householdZone(versions: StoredVersion[], nowMs: number): string {
  const adopted = [...adoptedOnly(versions)].sort((a, b) => compareDates(b.effectiveFrom, a.effectiveFrom));
  for (const version of adopted) {
    const local = localDate(version.body.exchangeZone, nowMs);
    if (compareDates(version.effectiveFrom, local) <= 0) return version.body.exchangeZone;
  }
  const earliest = earliestVersion(adopted);
  if (earliest) return earliest.body.exchangeZone;
  const draft = draftOf(versions);
  if (draft) return draft.body.exchangeZone;
  return 'UTC';
}

export interface SwapRecord {
  id: string;
  nights: NightInterval;
  makeupNights: NightInterval | null;
  toParent: ParentRole;
  createdBy: ParentRole;
  note: string | null;
  state: string;
  sentAt: Date | null;
  answerBy: Date | null;
  answerZone: string | null;
  answeredAt: Date | null;
  declineReason: string | null;
  createdAt: Date;
  rev: number;
}

export function mapSwap(row: Record<string, unknown>): SwapRecord {
  return {
    id: row.id as string,
    nights: { start: row.nights_start as PlainDate, end: row.nights_end as PlainDate },
    makeupNights:
      row.makeup_start === null ? null : { start: row.makeup_start as PlainDate, end: row.makeup_end as PlainDate },
    toParent: row.to_parent as ParentRole,
    createdBy: row.created_by as ParentRole,
    note: row.note as string | null,
    state: row.state as string,
    sentAt: row.sent_at as Date | null,
    answerBy: row.answer_by as Date | null,
    answerZone: row.answer_zone as string | null,
    answeredAt: row.answered_at as Date | null,
    declineReason: row.decline_reason as string | null,
    createdAt: row.created_at as Date,
    rev: row.rev as number,
  };
}

export const swapColumns = `id::text AS id, nights_start, nights_end, makeup_start, makeup_end, to_parent,
  created_by, note, state, sent_at, answer_by, answer_zone, answered_at, decline_reason, created_at, rev`;

export function swapEtag(swap: SwapRecord): string {
  return `"swap-${swap.id}-${swap.rev}"`;
}

/** A sent request reads as lapsed from its answer-by instant, before the sweep writes it. */
export function reportedState(state: string, answerBy: Date | null, nowMs: number): string {
  if (state === 'sent' && answerBy && answerBy.getTime() <= nowMs) return 'lapsed';
  return state;
}

export function serialiseSwap(swap: SwapRecord, zone: string, nowMs: number): Json {
  const answerZone = swap.answerZone ?? zone;
  return {
    id: swap.id,
    nights: `${swap.nights.start}/${swap.nights.end}`,
    makeupNights: swap.makeupNights ? `${swap.makeupNights.start}/${swap.makeupNights.end}` : null,
    toParent: swap.toParent,
    createdBy: swap.createdBy,
    note: swap.note,
    state: reportedState(swap.state, swap.answerBy, nowMs),
    sentAt: swap.sentAt ? formatInstant(answerZone, swap.sentAt.getTime()) : null,
    answerBy: swap.answerBy ? formatInstant(answerZone, swap.answerBy.getTime()) : null,
    answerZone: swap.answerZone,
    answeredAt: swap.answeredAt ? formatInstant(answerZone, swap.answeredAt.getTime()) : null,
    declineReason: swap.declineReason,
    createdAt: formatInstant(zone, swap.createdAt.getTime()),
  };
}

export interface ReceiptRecord {
  id: string;
  contentType: string;
  bytes: number;
  sha256: string;
  filename: string;
}

export interface CostRecord {
  id: string;
  description: string;
  category: string;
  note: string | null;
  amountMinor: number;
  incurredAt: Date;
  custodyDay: PlainDate;
  paidBy: ParentRole;
  versionId: string | null;
  agreedSplitPlanningBp: number | null;
  splitPlanningBp: number;
  sharePlanning: number;
  shareOther: number;
  state: string;
  sentAt: Date | null;
  answerBy: Date | null;
  answerZone: string | null;
  answeredAt: Date | null;
  declineReason: string | null;
  createdAt: Date;
  rev: number;
  receipts: ReceiptRecord[];
}

export const costColumns = `id::text AS id, description, category, note, amount_minor::double precision AS amount_minor,
  incurred_at, custody_day, paid_by, version_id::text AS version_id, agreed_split_planning_bp, split_planning_bp,
  share_planning::double precision AS share_planning, share_other::double precision AS share_other, state,
  sent_at, answer_by, answer_zone, answered_at, decline_reason, created_at, rev`;

export function mapCost(row: Record<string, unknown>): CostRecord {
  return {
    id: row.id as string,
    description: row.description as string,
    category: row.category as string,
    note: row.note as string | null,
    amountMinor: row.amount_minor as number,
    incurredAt: row.incurred_at as Date,
    custodyDay: row.custody_day as PlainDate,
    paidBy: row.paid_by as ParentRole,
    versionId: row.version_id as string | null,
    agreedSplitPlanningBp: row.agreed_split_planning_bp as number | null,
    splitPlanningBp: row.split_planning_bp as number,
    sharePlanning: row.share_planning as number,
    shareOther: row.share_other as number,
    state: row.state as string,
    sentAt: row.sent_at as Date | null,
    answerBy: row.answer_by as Date | null,
    answerZone: row.answer_zone as string | null,
    answeredAt: row.answered_at as Date | null,
    declineReason: row.decline_reason as string | null,
    createdAt: row.created_at as Date,
    rev: row.rev as number,
    receipts: [],
  };
}

export async function attachReceipts(costs: CostRecord[], client?: Queryable): Promise<void> {
  if (costs.length === 0) return;
  const ids = costs.map((cost) => cost.id);
  const sql = `SELECT id::text AS id, cost_id::text AS cost_id, content_type, bytes::double precision AS bytes,
                 sha256, filename FROM receipts r WHERE r.cost_id = ANY($1::bigint[]) ORDER BY r.id`;
  const found = client ? (await client.query(sql, [ids])).rows : await rows(sql, [ids]);
  for (const row of found) {
    const cost = costs.find((candidate) => candidate.id === row.cost_id);
    if (!cost) continue;
    cost.receipts.push({
      id: row.id as string,
      contentType: row.content_type as string,
      bytes: row.bytes as number,
      sha256: row.sha256 as string,
      filename: row.filename as string,
    });
  }
}

export function costEtag(cost: CostRecord): string {
  return `"cost-${cost.id}-${cost.rev}"`;
}

export function costSplitBp(cost: CostRecord): { planning: number; other: number } {
  return { planning: cost.splitPlanningBp, other: 10000 - cost.splitPlanningBp };
}

export function costOwedMinor(cost: CostRecord): number {
  return cost.paidBy === 'planning' ? cost.shareOther : cost.sharePlanning;
}

export function serialiseCost(cost: CostRecord, zone: string, nowMs: number): Json {
  const costZone = cost.answerZone ?? zone;
  return {
    id: cost.id,
    description: cost.description,
    category: cost.category,
    note: cost.note,
    amountMinor: cost.amountMinor,
    incurredAt: formatInstant(costZone, cost.incurredAt.getTime()),
    custodyDay: cost.custodyDay,
    paidBy: cost.paidBy,
    versionId: cost.versionId,
    agreedSplitBp:
      cost.agreedSplitPlanningBp === null
        ? null
        : { planning: cost.agreedSplitPlanningBp, other: 10000 - cost.agreedSplitPlanningBp },
    splitBp: costSplitBp(cost),
    shares: { planning: cost.sharePlanning, other: cost.shareOther },
    owedMinor: costOwedMinor(cost),
    state: reportedState(cost.state, cost.answerBy, nowMs),
    sentAt: cost.sentAt ? formatInstant(costZone, cost.sentAt.getTime()) : null,
    answerBy: cost.answerBy ? formatInstant(costZone, cost.answerBy.getTime()) : null,
    answerZone: cost.answerZone,
    answeredAt: cost.answeredAt ? formatInstant(costZone, cost.answeredAt.getTime()) : null,
    declineReason: cost.declineReason,
    receipts: cost.receipts.map((receipt) => ({
      id: receipt.id,
      contentType: receipt.contentType,
      bytes: receipt.bytes,
      sha256: receipt.sha256,
      filename: receipt.filename,
    })),
  };
}

/** The split that governs a cost: its agreed split, else the version on its custody day. */
export function splitForCost(
  agreedPlanningBp: number | null,
  versions: StoredVersion[],
  custodyDay: PlainDate,
): { planningBp: number; versionId: string | null } {
  if (agreedPlanningBp !== null) {
    const version = versionForDate(adoptedOnly(versions), custodyDay);
    return { planningBp: agreedPlanningBp, versionId: version ? version.id : null };
  }
  const version = versionForDate(adoptedOnly(versions), custodyDay) ?? earliestVersion(adoptedOnly(versions));
  return { planningBp: version ? version.body.splitBp.planning : 5000, versionId: version ? version.id : null };
}

export function sharesFor(amountMinor: number, planningBp: number, paidBy: ParentRole): { planning: number; other: number } {
  return allocateShares(amountMinor, { planning: planningBp, other: 10000 - planningBp }, paidBy);
}

export async function refreshStatement(client: PoolClient, household: Household): Promise<string> {
  const found = await client.query(
    `SELECT custody_day, amount_minor::double precision AS amount_minor, share_planning::double precision AS share_planning,
            share_other::double precision AS share_other, paid_by, state
     FROM costs WHERE household_id = $1 ORDER BY id`,
    [household.id],
  );
  const costs: StatementCost[] = found.rows.map((row) => {
    const paidBy = row.paid_by as ParentRole;
    const shares = { planning: row.share_planning as number, other: row.share_other as number };
    return {
      custodyDay: row.custody_day as PlainDate,
      amountMinor: row.amount_minor as number,
      shares,
      owedMinor: paidBy === 'planning' ? shares.other : shares.planning,
      paidBy,
      state: row.state as string,
    };
  });
  const document = buildStatementDocument(household.id, household.currency, costs);
  await client.query(
    `INSERT INTO statements (household_id, doc) VALUES ($1, $2)
     ON CONFLICT (household_id) DO UPDATE SET doc = EXCLUDED.doc`,
    [household.id, document.bytes.toString('utf8')],
  );
  return document.digest;
}
