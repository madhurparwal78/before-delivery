import { db, writeTx } from '../db.ts';
import { conflict, notFound, preconditionRequired, staleCycle, validation } from '../http/errors.ts';
import {
  jsonBody,
  param,
  requireRole,
  viewerOf,
  type ApiResult,
  type RequestContext,
} from '../http/context.ts';
import { effectiveStatus, isLegalTransition } from '../domain/cycleState.ts';
import { toIsoSeconds } from '../domain/clubTime.ts';
import {
  buildCycle,
  cycleSummary,
  getCycleRow,
  listCycleRows,
  listLineRows,
  listPledges,
  listProducts,
  nextCyclePosition,
  persistCutoffSwitch,
  type CycleRow,
  type Viewer,
} from '../store.ts';
import { applyFields, assertEditable, resolveCycleFields } from '../services/cycleFields.ts';
import { closeCycle } from '../services/close.ts';
import type { CycleStatus } from '../../shared/types.ts';

function etagOf(cycle: CycleRow): string {
  return `"r${cycle.revision}"`;
}

function cycleResult(cycle: CycleRow, viewer: Viewer, nowMs: number, status = 200): ApiResult {
  return {
    status,
    body: buildCycle(cycle, viewer, nowMs),
    headers: { ETag: etagOf(cycle) },
  };
}

function requireCycle(ctx: RequestContext, viewer: Viewer): CycleRow {
  const cycle = getCycleRow(param(ctx, 'cycleId'));
  if (!cycle) throw notFound();
  if (cycle.status === 'draft' && viewer.role !== 'coordinator') throw notFound();
  return cycle;
}

function requireMatch(ctx: RequestContext, cycle: CycleRow): void {
  const header = ctx.headers['if-match'];
  const raw = Array.isArray(header) ? header[0] : header;
  const etag = etagOf(cycle);
  if (raw === undefined || raw === '') throw preconditionRequired(etag);
  if (raw.replace(/^W\//, '').trim() !== etag) throw staleCycle(etag);
}

export function listCycles(ctx: RequestContext): ApiResult {
  const viewer = viewerOf(ctx);
  const rows = listCycleRows().filter((cycle) => viewer.role === 'coordinator' || cycle.status !== 'draft');
  return { status: 200, body: { cycles: rows.map((cycle) => cycleSummary(cycle, ctx.now)) } };
}

export function getCycle(ctx: RequestContext): ApiResult {
  const viewer = viewerOf(ctx);
  const cycle = requireCycle(ctx, viewer);
  return cycleResult(cycle, viewer, ctx.now);
}

export function createCycle(ctx: RequestContext): ApiResult {
  const viewer = requireRole(ctx, ['coordinator']);
  const body = jsonBody(ctx);
  const resolved = resolveCycleFields(body, null, 'create', ctx.now);
  const cycle = writeTx(() => {
    const position = nextCyclePosition();
    const id = `cy-${43 + position}`;
    db.prepare(
      `INSERT INTO cycles (id, name, status, revision, cutoff_at, pickup_start_at, pickup_end_at, created_at, position)
       VALUES (?, ?, 'draft', 1, NULL, NULL, NULL, ?, ?)`,
    ).run(id, resolved.name ?? '', toIsoSeconds(new Date(ctx.now)), position);
    applyFields(id, resolved);
    return getCycleRow(id)!;
  });
  return cycleResult(cycle, viewer, ctx.now, 201);
}

export function patchCycle(ctx: RequestContext): ApiResult {
  const viewer = requireRole(ctx, ['coordinator']);
  const existing = requireCycle(ctx, viewer);
  const body = jsonBody(ctx);
  const updated = writeTx(() => {
    const cycle = getCycleRow(existing.id)!;
    requireMatch(ctx, cycle);
    assertEditable(cycle, body, ctx.now);
    const resolved = resolveCycleFields(body, cycle, 'patch', ctx.now);
    applyFields(cycle.id, resolved);
    db.prepare('UPDATE cycles SET revision = revision + 1 WHERE id = ?').run(cycle.id);
    return getCycleRow(cycle.id)!;
  });
  return cycleResult(updated, viewer, ctx.now);
}

const DRAFT_FIELDS = ['name', 'cutoff_local', 'pickup_start_local', 'pickup_end_local', 'product_ids'];

export function transitionsIdempotencyMode(ctx: RequestContext): 'required' | 'optional' {
  try {
    const parsed = JSON.parse(ctx.rawBody.toString('utf8')) as { to?: unknown };
    return parsed?.to === 'closed' ? 'required' : 'optional';
  } catch {
    return 'optional';
  }
}

export async function transition(ctx: RequestContext): Promise<ApiResult> {
  const viewer = requireRole(ctx, ['coordinator']);
  const cycle = requireCycle(ctx, viewer);
  const body = jsonBody(ctx);
  const target = body.to;
  if (typeof target !== 'string') throw validation({ to: 'Name the status to move to.' });
  const hasFields = DRAFT_FIELDS.some((field) => field in body);

  if (target === 'closed') {
    const header = ctx.headers['idempotency-key'];
    const key = (Array.isArray(header) ? header[0] : header) ?? '';
    return closeTransition(ctx, cycle, viewer, key);
  }

  const updated = writeTx(() => {
    const current = persistCutoffSwitch(getCycleRow(cycle.id)!, ctx.now);
    if (hasFields) requireMatch(ctx, current);
    const from = effectiveStatus(current.status, current.cutoff_at === null ? null : Date.parse(current.cutoff_at), ctx.now);
    if (!isLegalTransition(from, target as CycleStatus)) {
      throw conflict('illegal_transition', 'That move is not allowed from this status.');
    }
    if (target === 'open') {
      const resolved = resolveCycleFields(body, current, 'open', ctx.now);
      applyFields(current.id, resolved);
    }
    if (target === 'ordered') assertOrderable(current);
    db.prepare('UPDATE cycles SET status = ?, revision = revision + 1 WHERE id = ?').run(target, current.id);
    return getCycleRow(current.id)!;
  });
  return cycleResult(updated, viewer, ctx.now);
}

function assertOrderable(cycle: CycleRow): void {
  const products = new Map(listProducts().map((product) => [product.id, product]));
  const lines = listLineRows(cycle.id);
  let ordered = 0;
  for (const line of lines) {
    const product = products.get(line.product_id)!;
    const pledges = listPledges(cycle.id, product.id);
    const pledged = pledges.reduce((total, pledge) => total + pledge.units, 0);
    if (line.status === 'dropped') continue;
    if (line.status !== 'taken_up' && pledged < product.pack) {
      throw conflict('unresolved_lines', 'Drop or take up every unfilled case first.');
    }
    ordered += 1;
  }
  if (ordered === 0) throw conflict('nothing_to_order', 'Every case was dropped, so there is nothing to order.');
}

async function closeTransition(
  ctx: RequestContext,
  cycle: CycleRow,
  viewer: Viewer,
  idempotencyKey: string,
): Promise<ApiResult> {
  const current = getCycleRow(cycle.id)!;
  const from = effectiveStatus(
    current.status,
    current.cutoff_at === null ? null : Date.parse(current.cutoff_at),
    ctx.now,
  );
  if (!isLegalTransition(from, 'closed')) {
    throw conflict('illegal_transition', 'That move is not allowed from this status.');
  }
  return closeCycle(current, viewer, idempotencyKey, ctx.now);
}
