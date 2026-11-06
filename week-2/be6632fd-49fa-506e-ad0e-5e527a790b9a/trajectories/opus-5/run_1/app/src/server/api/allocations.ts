import { requireRole, requireSession, type Session } from '../auth.ts';
import { query, queryOne, transact, type Transaction } from '../db/pool.ts';
import { queueMail } from '../db/outbox.ts';
import { FIELD_COPY, STATUS_COPY, staleStart } from '../../domain/copy.ts';
import type { Currency } from '../../domain/markets.ts';
import { priceAllocation } from '../../domain/pricing.ts';
import { splitEdition, type SplitRequest } from '../../domain/split.ts';
import { copenhagenToday, formatCopenhagenDate, formatCopenhagenInstant, formatInstant } from '../../domain/time.ts';
import type { Ctx } from '../http/context.ts';
import { ApiError, conflict, notFound, staleVersion, validationFailed } from '../http/errors.ts';
import { sendJson } from '../http/respond.ts';
import { integer, list, Problems, readString, record, text } from '../http/validate.ts';
import { newId } from '../services/crypto.ts';
import { BillingUnavailable, createCommittedInvoice, ensureAccount } from '../services/killbill.ts';
import {
  allocationShape,
  buyerAllocationShape,
  loadAllocationById,
  loadAllocations,
  loadPriceRows,
  type AllocationRecord,
} from '../repo/allocations.ts';
import { loadDropById, type DropRecord } from '../repo/drops.ts';
import { requireDrop } from './drops.ts';

interface LineInput {
  styleNumber: string;
  quantity: number;
}

function readLines(
  body: Record<string, unknown>,
  problems: Problems,
  drop: DropRecord,
): LineInput[] {
  const entries = list(body, 'lines');
  if (entries.length === 0) problems.add('lines', FIELD_COPY.required);
  const lines: LineInput[] = [];
  for (const [index, entry] of entries.entries()) {
    const row = record(entry);
    const styleNumber = text(problems, row, 'styleNumber', { max: 40 }, `lines.${index}.styleNumber`);
    const style = drop.styles.find(
      (candidate) => candidate.styleNumber.toUpperCase() === styleNumber.trim().toUpperCase(),
    );
    if (styleNumber !== '' && style === undefined) {
      problems.add(`lines.${index}.styleNumber`, FIELD_COPY.unknownStyle(styleNumber));
      continue;
    }
    const max = style?.wholesaleEdition ?? 0;
    const quantity = integer(problems, row, 'quantity', 0, max, `lines.${index}.quantity`, 0);
    lines.push({ styleNumber: style?.styleNumber ?? styleNumber, quantity });
  }
  return lines;
}

async function ensureLines(tx: Transaction, allocationId: string, drop: DropRecord): Promise<void> {
  for (const [position, style] of drop.styles.entries()) {
    await tx.query(
      `insert into allocation_lines (allocation_id, style_number, position, requested_quantity, allocated_quantity)
       values ($1,$2,$3,0,0) on conflict do nothing`,
      [allocationId, style.styleNumber, position],
    );
  }
}

async function stockistFor(
  session: Session,
  stockistId: string,
): Promise<{ id: string; name: string } | null> {
  return queryOne<{ id: string; name: string }>(
    "select id, name from stockists where id = $1 and workspace_id = $2 and status = 'active'",
    [stockistId, session.workspaceId],
  );
}

export async function recordRequest(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'merchandiser', 'stockist_buyer');

  const body = ctx.json();
  const stockistId = readString(body, 'stockistId') ?? '';
  if (session.role === 'stockist_buyer' && stockistId !== session.stockistId) throw notFound();
  const stockist = await stockistFor(session, stockistId);
  if (stockist === null) throw notFound();

  const problems = new Problems();
  const lines = readLines(body, problems, drop);
  problems.throwIfAny();

  const existing = await queryOne<{ id: string; status: string }>(
    'select id, status from allocations where drop_id = $1 and stockist_id = $2',
    [drop.id, stockistId],
  );
  if (existing !== null && existing.status !== 'requested') throw conflict('allocation_split');

  const allocationId = existing?.id ?? newId();
  await transact(async (tx) => {
    if (existing === null) {
      await tx.query(
        `insert into allocations (id, workspace_id, drop_id, stockist_id, status, version,
                                  requested_at_ms, internal_note, saved_by, saved_at_ms)
         values ($1,$2,$3,$4,'requested',1,$5,'',$6,$5)`,
        [allocationId, session.workspaceId, drop.id, stockistId, ctx.nowMs, session.name],
      );
    }
    await ensureLines(tx, allocationId, drop);
    await tx.query('update allocation_lines set requested_quantity = 0 where allocation_id = $1', [
      allocationId,
    ]);
    for (const line of lines) {
      await tx.query(
        'update allocation_lines set requested_quantity = $3 where allocation_id = $1 and style_number = $2',
        [allocationId, line.styleNumber, line.quantity],
      );
    }
    if (existing !== null) {
      await tx.query(
        'update allocations set version = version + 1, saved_by = $2, saved_at_ms = $3 where id = $1',
        [allocationId, session.name, ctx.nowMs],
      );
    }
  });

  const saved = await loadAllocationById(allocationId, session.workspaceId);
  if (saved === null) throw notFound();
  sendJson(
    ctx.response,
    existing === null ? 201 : 200,
    session.role === 'stockist_buyer' ? buyerAllocationShape(saved) : allocationShape(saved),
  );
}

export async function listDropAllocations(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  const records =
    session.role === 'stockist_buyer'
      ? await loadAllocations('a.drop_id = $1 and a.stockist_id = $2', [drop.id, session.stockistId])
      : await loadAllocations('a.drop_id = $1 and a.workspace_id = $2', [drop.id, session.workspaceId]);
  sendJson(ctx.response, 200, {
    items: records.map(
      session.role === 'stockist_buyer' ? buyerAllocationShape : allocationShape,
    ),
  });
}

export async function listAllocations(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const status = ctx.query('status');
  if (status !== null && !['requested', 'split', 'confirmed'].includes(status)) {
    throw validationFailed({ status: FIELD_COPY.required });
  }
  const where =
    session.role === 'stockist_buyer'
      ? 'a.stockist_id = $1' + (status === null ? '' : ' and a.status = $2')
      : 'a.workspace_id = $1' + (status === null ? '' : ' and a.status = $2');
  const values =
    session.role === 'stockist_buyer'
      ? [session.stockistId, ...(status === null ? [] : [status])]
      : [session.workspaceId, ...(status === null ? [] : [status])];
  const records = await loadAllocations(where, values);
  sendJson(ctx.response, 200, {
    items: records.map(
      session.role === 'stockist_buyer' ? buyerAllocationShape : allocationShape,
    ),
  });
}

/** Loads an allocation the caller may read, or 404 outside their workspace and store. */
export async function requireAllocation(ctx: Ctx, session: Session): Promise<AllocationRecord> {
  const record = await loadAllocationById(ctx.params['id'] as string, session.workspaceId);
  if (record === null) throw notFound();
  if (session.role === 'stockist_buyer' && record.stockistId !== session.stockistId) throw notFound();
  return record;
}

export async function getAllocation(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const allocation = await requireAllocation(ctx, session);
  sendJson(
    ctx.response,
    200,
    session.role === 'stockist_buyer' ? buyerAllocationShape(allocation) : allocationShape(allocation),
  );
}

export async function createAllocation(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  requireRole(session, 'merchandiser');
  const body = ctx.json();
  const dropId = readString(body, 'dropId') ?? '';
  const drop = await loadDropById(dropId, session.workspaceId, ctx.nowMs);
  if (drop === null) throw notFound();
  const stockistId = readString(body, 'stockistId') ?? '';
  const stockist = await stockistFor(session, stockistId);
  if (stockist === null) throw notFound();

  const problems = new Problems();
  const lines = readLines(body, problems, drop);
  const internalNote = text(problems, body, 'internalNote', { max: 2000, required: false });
  problems.throwIfAny();

  const existing = await queryOne('select 1 from allocations where drop_id = $1 and stockist_id = $2', [
    drop.id,
    stockistId,
  ]);
  if (existing !== null) throw conflict('allocation_exists');

  const allocationId = newId();
  await transact(async (tx) => {
    await tx.query(
      `insert into allocations (id, workspace_id, drop_id, stockist_id, status, version,
                                requested_at_ms, internal_note, saved_by, saved_at_ms)
       values ($1,$2,$3,$4,'split',1,$5,$6,$7,$5)`,
      [allocationId, session.workspaceId, drop.id, stockistId, ctx.nowMs, internalNote, session.name],
    );
    await ensureLines(tx, allocationId, drop);
    for (const line of lines) {
      await tx.query(
        'update allocation_lines set allocated_quantity = $3 where allocation_id = $1 and style_number = $2',
        [allocationId, line.styleNumber, line.quantity],
      );
    }
  });
  const saved = await loadAllocationById(allocationId, session.workspaceId);
  if (saved === null) throw notFound();
  sendJson(ctx.response, 201, allocationShape(saved));
}

export async function patchAllocation(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const allocation = await requireAllocation(ctx, session);
  requireRole(session, 'merchandiser');
  if (allocation.status === 'confirmed') throw conflict('allocation_confirmed');

  const drop = await loadDropById(allocation.dropId, session.workspaceId, ctx.nowMs);
  if (drop === null) throw notFound();
  const body = ctx.json();
  const problems = new Problems();
  const version = integer(problems, body, 'version', 1, 1_000_000_000);
  const lines = readLines(body, problems, drop);
  const internalNote = Object.hasOwn(body, 'internalNote')
    ? text(problems, body, 'internalNote', { max: 2000, required: false })
    : allocation.internalNote;
  problems.throwIfAny();

  if (version !== allocation.version) throw staleConflict(allocation);

  await transact(async (tx) => {
    const current = await tx.queryOne<{ version: number }>(
      'select version from allocations where id = $1 for update',
      [allocation.id],
    );
    if (Number(current?.version) !== version) throw staleConflict(allocation);
    for (const line of lines) {
      await tx.query(
        'update allocation_lines set allocated_quantity = $3 where allocation_id = $1 and style_number = $2',
        [allocation.id, line.styleNumber, line.quantity],
      );
    }
    await tx.query(
      `update allocations set version = version + 1, internal_note = $2, saved_by = $3, saved_at_ms = $4,
                             status = case when status = 'requested' then 'split' else status end
        where id = $1`,
      [allocation.id, internalNote, session.name, ctx.nowMs],
    );
  });

  const saved = await loadAllocationById(allocation.id, session.workspaceId);
  if (saved === null) throw notFound();
  sendJson(ctx.response, 200, allocationShape(saved));
}

function staleConflict(allocation: AllocationRecord): ApiError {
  return staleVersion(
    allocation.savedBy,
    formatInstant(allocation.savedAtMs),
    allocationShape(allocation),
    staleStart(allocation.savedBy, formatCopenhagenInstant(allocation.savedAtMs)),
  );
}

// --- Split ------------------------------------------------------------------

interface ProposedShare {
  stockistId: string;
  stockistName: string;
  lines: { styleNumber: string; requestedQuantity: number; allocatedQuantity: number }[];
}

async function proposeSplit(drop: DropRecord, workspaceId: string): Promise<ProposedShare[]> {
  const records = (
    await loadAllocations('a.drop_id = $1 and a.workspace_id = $2', [drop.id, workspaceId])
  ).filter((record) => record.status !== 'confirmed');

  const shares = new Map<string, ProposedShare>();
  for (const record of records) {
    shares.set(record.id, {
      stockistId: record.stockistId,
      stockistName: record.stockistName,
      lines: [],
    });
  }

  for (const style of drop.styles) {
    const requests: SplitRequest[] = records.map((record) => ({
      key: record.id,
      requestedQuantity:
        record.lines.find((line) => line.styleNumber === style.styleNumber)?.requestedQuantity ?? 0,
      requestedAtMs: record.requestedAtMs,
    }));
    const result = splitEdition(style.wholesaleEdition, requests);
    for (const share of result) {
      const entry = shares.get(share.key);
      if (entry === undefined) continue;
      entry.lines.push({
        styleNumber: style.styleNumber,
        requestedQuantity:
          requests.find((request) => request.key === share.key)?.requestedQuantity ?? 0,
        allocatedQuantity: share.allocatedQuantity,
      });
    }
  }
  return [...shares.values()];
}

export async function getSplit(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'merchandiser');
  const items = await proposeSplit(drop, session.workspaceId);
  sendJson(ctx.response, 200, { items });
}

export async function applySplit(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'merchandiser');

  const confirmed = await queryOne(
    "select 1 from allocations where drop_id = $1 and status = 'confirmed'",
    [drop.id],
  );
  if (confirmed !== null) throw conflict('drop_has_confirmed');

  const records = (
    await loadAllocations('a.drop_id = $1 and a.workspace_id = $2', [drop.id, session.workspaceId])
  ).filter((record) => record.status !== 'confirmed');
  const proposal = await proposeSplit(drop, session.workspaceId);
  const byStockist = new Map(proposal.map((share) => [share.stockistId, share]));

  await transact(async (tx) => {
    for (const record of records) {
      const share = byStockist.get(record.stockistId);
      if (share === undefined) continue;
      for (const line of share.lines) {
        await tx.query(
          'update allocation_lines set allocated_quantity = $3 where allocation_id = $1 and style_number = $2',
          [record.id, line.styleNumber, line.allocatedQuantity],
        );
      }
      await tx.query(
        `update allocations set status = 'split', version = version + 1, saved_by = $2, saved_at_ms = $3
          where id = $1`,
        [record.id, session.name, ctx.nowMs],
      );
    }
  });

  const saved = await loadAllocations('a.drop_id = $1 and a.workspace_id = $2', [
    drop.id,
    session.workspaceId,
  ]);
  sendJson(ctx.response, 200, { items: saved.map(allocationShape) });
}

// --- Quote and confirmation -------------------------------------------------

async function pricedView(
  allocation: AllocationRecord,
  onDate: string,
): Promise<{ shape: Record<string, unknown>; missing: string[]; totalMinor: number; effectiveDate: string | null; lines: ReturnType<typeof priceAllocation>['lines'] }> {
  const rows = await loadPriceRows(allocation.workspaceId);
  const result = priceAllocation(
    allocation.lines.map((line) => ({
      styleNumber: line.styleNumber,
      styleName: line.styleName,
      requestedQuantity: line.requestedQuantity,
      allocatedQuantity: line.allocatedQuantity,
    })),
    allocation.market,
    allocation.currency,
    onDate,
    rows,
  );
  const shape = {
    ...allocationShape(allocation),
    lines: result.lines,
    totalMinor: result.totalMinor,
    priceListEffectiveDate: result.priceListEffectiveDate,
  };
  return {
    shape,
    missing: result.missing,
    totalMinor: result.totalMinor,
    effectiveDate: result.priceListEffectiveDate,
    lines: result.lines,
  };
}

export async function getQuote(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const allocation = await requireAllocation(ctx, session);
  requireRole(session, 'finance_lead');
  if (allocation.status === 'confirmed') {
    sendJson(ctx.response, 200, allocationShape(allocation));
    return;
  }
  const view = await pricedView(allocation, copenhagenToday(ctx.nowMs));
  sendJson(ctx.response, 200, view.shape);
}

export async function confirmAllocation(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const allocation = await requireAllocation(ctx, session);
  requireRole(session, 'finance_lead');

  const body = ctx.json();
  const problems = new Problems();
  const version = integer(problems, body, 'version', 1, 1_000_000_000);
  problems.throwIfAny();

  if (allocation.status === 'confirmed') {
    throw conflict('allocation_confirmed', { message: STATUS_COPY.alreadyConfirmed });
  }
  if (allocation.status !== 'split') throw conflict('allocation_not_split');
  if (version !== allocation.version) throw staleConflict(allocation);

  const onDate = copenhagenToday(ctx.nowMs);
  const view = await pricedView(allocation, onDate);
  const priced = view.lines.filter((line) => line.allocatedQuantity > 0);
  if (priced.length === 0) {
    throw conflict('allocation_empty', { message: STATUS_COPY.allocationEmpty });
  }
  if (view.missing.length > 0) {
    throw conflict('price_missing', {
      message: STATUS_COPY.noPriceInForce(view.missing[0] as string, allocation.currency),
    });
  }
  if (allocation.contactEmail === null || allocation.contactEmail === '') {
    throw conflict('contact_missing', { message: STATUS_COPY.noContact(allocation.stockistName) });
  }

  // Claim the confirmation first, so two simultaneous requests cannot both invoice.
  const claimed = await query<{ id: string }>(
    `update allocations set status = 'confirmed', version = version + 1, saved_by = $2, saved_at_ms = $3,
                            confirmed_at_ms = $3, price_list_effective_date = $4, total_minor = $5
       where id = $1 and status = 'split' and version = $6
       returning id`,
    [allocation.id, session.name, ctx.nowMs, view.effectiveDate, view.totalMinor, version],
  );
  if (claimed.length === 0) {
    const current = await loadAllocationById(allocation.id, session.workspaceId);
    if (current !== null && current.status === 'confirmed') {
      throw conflict('allocation_confirmed', { message: STATUS_COPY.alreadyConfirmed });
    }
    throw staleConflict(current ?? allocation);
  }

  try {
    const accountId = await ensureAccount(
      allocation.stockistId,
      allocation.stockistName,
      allocation.currency,
    );
    const invoice = await createCommittedInvoice(
      accountId,
      allocation.currency,
      priced.map((line) => ({
        description: `${line.styleNumber} ${line.styleName} × ${line.allocatedQuantity}`,
        amountMinor: line.lineTotalMinor ?? 0,
      })),
    );
    await transact(async (tx) => {
      await tx.query(
        'update allocations set invoice_number = $2, killbill_invoice_id = $3 where id = $1',
        [allocation.id, invoice.invoiceNumber, invoice.invoiceId],
      );
      for (const line of view.lines) {
        await tx.query(
          `update allocation_lines
              set unit_price_minor = $3, net_minor = $4, vat_minor = $5, line_total_minor = $6
            where allocation_id = $1 and style_number = $2`,
          [
            allocation.id,
            line.styleNumber,
            line.unitPriceMinor,
            line.netMinor,
            line.vatMinor,
            line.lineTotalMinor,
          ],
        );
      }
      await queueMail(
        tx,
        {
          kind: 'allocation_confirmation',
          email: allocation.contactEmail as string,
          name: allocation.contactName ?? '',
          dropName: allocation.dropName,
          stockistName: allocation.stockistName,
          currency: allocation.currency as Currency,
          lines: priced.map((line) => ({
            styleNumber: line.styleNumber,
            styleName: line.styleName,
            quantity: line.allocatedQuantity,
            unitPriceMinor: line.unitPriceMinor ?? 0,
            vatMinor: line.vatMinor ?? 0,
            lineTotalMinor: line.lineTotalMinor ?? 0,
          })),
          totalMinor: view.totalMinor,
          invoiceNumber: invoice.invoiceNumber,
          priceListEffectiveDate: view.effectiveDate ?? onDate,
        },
        `confirmation:${allocation.id}`,
      );
    });
  } catch (error) {
    await query(
      `update allocations set status = 'split', version = $2, saved_by = $3, saved_at_ms = $4,
                              confirmed_at_ms = null, price_list_effective_date = null, total_minor = null
        where id = $1`,
      [allocation.id, allocation.version, allocation.savedBy, allocation.savedAtMs],
    );
    if (error instanceof BillingUnavailable) {
      throw new ApiError(503, 'billing_unavailable', { message: STATUS_COPY.billingDown });
    }
    throw error;
  }

  const saved = await loadAllocationById(allocation.id, session.workspaceId);
  if (saved === null) throw notFound();
  sendJson(ctx.response, 200, allocationShape(saved));
}

export function priceListDateCopy(date: string): string {
  return `Prices from the list in force on ${formatCopenhagenDate(date)}`;
}
