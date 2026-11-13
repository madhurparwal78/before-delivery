/** Shared helpers for API modules: household context loading. */
import { PoolClient } from 'pg';
import { AppDeps, Household, PlanVersionRow, SwapRow, CostRow } from './apiTypes';
import { problem } from './problems';
import { Ctx } from './http';
import { VersionForNight } from '../domain/derived';
import { PlanRule } from '../domain/plan';

export async function loadHousehold(client: PoolClient | AppDeps['pool'], hid: string): Promise<Household> {
  const res = await client.query(`SELECT * FROM households WHERE id = $1`, [hid]);
  if (res.rows.length === 0) throw problem(404, 'not_found');
  return res.rows[0] as Household;
}

export async function loadVersions(pool: AppDeps['pool'], hid: string): Promise<PlanVersionRow[]> {
  const res = await pool.query(
    `SELECT * FROM plan_versions WHERE household_id = $1 ORDER BY number DESC`,
    [hid],
  );
  return res.rows as PlanVersionRow[];
}

export function toVersionForNight(v: PlanVersionRow): VersionForNight {
  return {
    effectiveFrom: v.effective_from,
    exchangeZone: v.exchange_zone,
    firstExchangeAt: v.first_exchange_at,
    pattern: v.base_pattern,
    anchor: v.base_anchor,
    maxConsecutiveNights: v.max_consecutive_nights,
    rules: (bodyOf(v.body) as { rules: PlanRule[] }).rules,
  };
}

export function versionOut(v: PlanVersionRow): Record<string, unknown> {
  const body = bodyOf(v.body);
  return {
    ...body,
    id: v.id,
    number: v.number,
    status: v.status,
  };
}

export async function loadDerivedSwaps(pool: AppDeps['pool'], hid: string): Promise<import('../domain/derived').DerivedSwap[]> {
  const res = await pool.query(
    `SELECT id, nights_start, nights_end, makeup_start, makeup_end, to_parent, created_by, state
     FROM swaps WHERE household_id = $1 AND state IN ('accepted','settled')`,
    [hid],
  );
  return res.rows.map((r: {
    id: string; nights_start: string; nights_end: string;
    makeup_start: string | null; makeup_end: string | null;
    to_parent: 'planning' | 'other'; created_by: 'planning' | 'other';
  }) => ({
    id: r.id,
    nights: { first: r.nights_start, last: r.nights_end },
    makeupNights: r.makeup_start && r.makeup_end ? { first: r.makeup_start, last: r.makeup_end } : null,
    toParent: r.to_parent,
    createdBy: r.created_by,
    settledAtHandover: true,
  }));
}

export async function loadSwapRow(pool: AppDeps['pool'], hid: string, id: string): Promise<SwapRow> {
  const res = await pool.query(`SELECT * FROM swaps WHERE id = $1 AND household_id = $2`, [id, hid]);
  if (res.rows.length === 0) throw problem(404, 'not_found');
  return res.rows[0] as SwapRow;
}

export async function loadCostRow(pool: AppDeps['pool'], hid: string, id: string): Promise<CostRow> {
  const res = await pool.query(`SELECT * FROM costs WHERE id = $1 AND household_id = $2`, [id, hid]);
  if (res.rows.length === 0) throw problem(404, 'not_found');
  return res.rows[0] as CostRow;
}

/** Strong ETag check: If-Match required and matching. */
export function requireIfMatch(ctx: Ctx, etag: string): void {
  const im = ctx.header('if-match');
  if (!im) throw problem(428, 'precondition_required');
  if (im.trim() !== etag) throw problem(412, 'precondition_failed');
}

export function requireIfNoneMatchStar(ctx: Ctx): void {
  const inm = ctx.header('if-none-match');
  if (inm !== '*') throw problem(412, 'precondition_failed');
}

/** The body column is JSONB: pg returns it parsed already. */
export function bodyOf(b: unknown): Record<string, unknown> {
  if (typeof b === 'string') return JSON.parse(b) as Record<string, unknown>;
  return b as Record<string, unknown>;
}
