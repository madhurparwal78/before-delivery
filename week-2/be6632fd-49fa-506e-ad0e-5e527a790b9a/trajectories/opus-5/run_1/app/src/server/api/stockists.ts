import { requireRole, requireSession, type Session } from '../auth.ts';
import { LIMITS } from '../config.ts';
import { query, queryOne, transact } from '../db/pool.ts';
import { dropQueuedMailTo } from '../db/outbox.ts';
import { STATUS_COPY } from '../../domain/copy.ts';
import { danishSortKey } from '../../domain/danish.ts';
import { marketCity, marketCurrency, type Currency, type Market } from '../../domain/markets.ts';
import { csvDocument } from '../../domain/text.ts';
import { formatInstant } from '../../domain/time.ts';
import type { Ctx } from '../http/context.ts';
import { conflict, notFound } from '../http/errors.ts';
import { sendJson, sendText } from '../http/respond.ts';
import { email as emailField, Problems, text } from '../http/validate.ts';
import { newId } from '../services/crypto.ts';
import { readMarketValue } from './dropinput.ts';

interface StockistRow {
  id: string;
  workspace_id: string;
  name: string;
  sort_key: string;
  market: Market;
  currency: Currency;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_erased: boolean;
  notes: string;
  status: 'active' | 'archived';
  archived_at_ms: number | null;
  created_at_ms: number;
}

function stockistShape(row: StockistRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    market: row.market,
    city: marketCity(row.market),
    currency: row.currency,
    contactName: row.contact_erased ? STATUS_COPY.erasedContact : row.contact_name,
    contactEmail: row.contact_erased ? null : row.contact_email,
    contactPhone: row.contact_erased ? null : row.contact_phone,
    contactErased: row.contact_erased,
    notes: row.notes,
    status: row.status,
    archivedAt: row.archived_at_ms === null ? null : formatInstant(Number(row.archived_at_ms)),
    createdAt: formatInstant(Number(row.created_at_ms)),
  };
}

/** Exactly the fields a stockist buyer may read about their own store. */
function buyerStockistShape(row: StockistRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    market: row.market,
    city: marketCity(row.market),
    currency: row.currency,
  };
}

function encodeCursor(sortKey: string, id: string): string {
  return Buffer.from(JSON.stringify([sortKey, id]), 'utf8').toString('base64url');
}

function decodeCursor(value: string): [string, string] | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [sortKey, id] = parsed;
    if (typeof sortKey !== 'string' || typeof id !== 'string') return null;
    return [sortKey, id];
  } catch {
    return null;
  }
}

export async function listStockists(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  requireRole(session, 'merchandiser', 'finance_lead', 'launch_producer', 'stockist_buyer');

  if (session.role === 'stockist_buyer') {
    const own = await queryOne<StockistRow>(
      "select * from stockists where id = $1 and status = 'active'",
      [session.stockistId],
    );
    sendJson(ctx.response, 200, {
      items: own === null ? [] : [buyerStockistShape(own)],
      nextCursor: null,
    });
    return;
  }

  const archived = ctx.query('archived') === 'true';
  const search = (ctx.query('q') ?? '').trim();
  const limitParam = ctx.query('limit');
  const limit =
    limitParam === null
      ? LIMITS.stockistPageDefault
      : Math.min(LIMITS.stockistPageMax, Math.max(1, Number(limitParam) || LIMITS.stockistPageDefault));
  const cursor = ctx.query('cursor');
  const after = cursor === null ? null : decodeCursor(cursor);

  const rows = await query<StockistRow>(
    `select * from stockists
      where workspace_id = $1
        and status = $2
        and ($3 = '' or name ilike '%' || $3 || '%')
        and ($4::text is null or (sort_key collate "C", id) > ($4 collate "C", $5))
      order by sort_key collate "C", id
      limit $6`,
    [
      session.workspaceId,
      archived ? 'archived' : 'active',
      search,
      after?.[0] ?? null,
      after?.[1] ?? '',
      limit + 1,
    ],
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  sendJson(ctx.response, 200, {
    items: page.map(stockistShape),
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last.sort_key, last.id) : null,
  });
}

async function requireStockist(
  ctx: Ctx,
  session: Session,
  options: { includeArchived: boolean } = { includeArchived: false },
): Promise<StockistRow> {
  const row = await queryOne<StockistRow>(
    'select * from stockists where id = $1 and workspace_id = $2',
    [ctx.params['id'] as string, session.workspaceId],
  );
  if (row === null) throw notFound();
  if (!options.includeArchived && row.status !== 'active') throw notFound();
  if (session.role === 'stockist_buyer' && row.id !== session.stockistId) throw notFound();
  return row;
}

export async function getStockist(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  requireRole(session, 'merchandiser', 'finance_lead', 'launch_producer', 'stockist_buyer');
  const row = await requireStockist(ctx, session);
  sendJson(
    ctx.response,
    200,
    session.role === 'stockist_buyer' ? buyerStockistShape(row) : stockistShape(row),
  );
}

export async function createStockist(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  requireRole(session, 'merchandiser');
  const body = ctx.json();
  const problems = new Problems();
  const name = text(problems, body, 'name', { max: 80 });
  const market = readMarketValue(body['market'], problems, 'market');
  const contactName = text(problems, body, 'contactName', { max: 80, required: false });
  const contactEmail = Object.hasOwn(body, 'contactEmail') && body['contactEmail'] !== ''
    ? emailField(problems, body, 'contactEmail')
    : '';
  const contactPhone = text(problems, body, 'contactPhone', { max: 40, required: false });
  const notes = text(problems, body, 'notes', { max: 2000, required: false });
  problems.throwIfAny();
  const checkedMarket = market as Market;

  const id = newId();
  await query(
    `insert into stockists (id, workspace_id, name, sort_key, market, currency,
                            contact_name, contact_email, contact_phone, notes, status, created_at_ms)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11)`,
    [
      id,
      session.workspaceId,
      name,
      danishSortKey(name),
      checkedMarket,
      marketCurrency(checkedMarket),
      contactName === '' ? null : contactName,
      contactEmail === '' ? null : contactEmail,
      contactPhone === '' ? null : contactPhone,
      notes,
      ctx.nowMs,
    ],
  );
  const row = await queryOne<StockistRow>('select * from stockists where id = $1', [id]);
  if (row === null) throw notFound();
  sendJson(ctx.response, 201, stockistShape(row));
}

export async function archiveStockist(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const row = await requireStockist(ctx, session);
  requireRole(session, 'merchandiser');
  await query("update stockists set status = 'archived', archived_at_ms = $2 where id = $1", [
    row.id,
    ctx.nowMs,
  ]);
  const saved = await queryOne<StockistRow>('select * from stockists where id = $1', [row.id]);
  sendJson(ctx.response, 200, stockistShape(saved as StockistRow));
}

export async function restoreStockist(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const row = await requireStockist(ctx, session, { includeArchived: true });
  requireRole(session, 'merchandiser');
  if (row.status === 'active') throw conflict('stockist_active');
  await query("update stockists set status = 'active', archived_at_ms = null where id = $1", [row.id]);
  const saved = await queryOne<StockistRow>('select * from stockists where id = $1', [row.id]);
  sendJson(ctx.response, 200, stockistShape(saved as StockistRow));
}

export async function eraseStockistContact(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const row = await requireStockist(ctx, session);
  requireRole(session, 'merchandiser');
  await transact(async (tx) => {
    await tx.query(
      `update stockists
          set contact_name = null, contact_email = null, contact_phone = null, contact_erased = true
        where id = $1`,
      [row.id],
    );
    if (row.contact_email !== null) await dropQueuedMailTo(tx, row.contact_email);
  });
  const saved = await queryOne<StockistRow>('select * from stockists where id = $1', [row.id]);
  sendJson(ctx.response, 200, stockistShape(saved as StockistRow));
}

export async function exportStockists(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  requireRole(session, 'merchandiser', 'finance_lead', 'launch_producer');
  const rows = await query<StockistRow>(
    `select * from stockists where workspace_id = $1 and status = 'active' order by sort_key collate "C", id`,
    [session.workspaceId],
  );
  const body = csvDocument([
    ['Name', 'Market', 'City', 'Currency', 'Contact name', 'Contact email', 'Contact phone'],
    ...rows.map((row) => [
      row.name,
      row.market,
      marketCity(row.market),
      row.currency,
      row.contact_erased ? STATUS_COPY.erasedContact : (row.contact_name ?? ''),
      row.contact_erased ? STATUS_COPY.erasedContact : (row.contact_email ?? ''),
      row.contact_erased ? STATUS_COPY.erasedContact : (row.contact_phone ?? ''),
    ]),
  ]);
  sendText(ctx.response, 200, 'text/csv; charset=utf-8', body, {
    'content-disposition': 'attachment; filename="stockists.csv"',
  });
}
