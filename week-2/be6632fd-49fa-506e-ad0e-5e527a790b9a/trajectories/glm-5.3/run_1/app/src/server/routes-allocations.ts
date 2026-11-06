import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../domain/errors.js';
import { MESSAGES } from '../domain/copy.js';
import { toInstantString, cphToday, dateWords, parseDate } from '../domain/dates.js';
import { largestRemainderSplit } from '../domain/split.js';
import { priceInForce, priceLines, vatOf } from '../domain/pricing.js';
import { requireStaff, requireRole } from './auth.js';
import { Validator } from './validate.js';
import { id } from './startup.js';
import { withTransaction } from './db.js';
import { csvDocument } from '../domain/csv.js';
import { formatMoney } from '../domain/dates.js';

export interface AllocRow {
  id: string; workspace_id: string; drop_id: string; stockist_id: string; status: string; version: number;
  requested_at: Date; total_minor: string | null; price_list_date: string | null; invoice_number: string | null;
  killbill_invoice_id: string | null; internal_note: string; saved_by: string | null; saved_at: Date; confirmed_at: Date | null;
}

async function allocationOut(db: import('./db.js').Db, row: AllocRow, buyer: boolean): Promise<Record<string, unknown>> {
  const drop = await db.query('SELECT name FROM drops WHERE id = $1', [row.drop_id]);
  const stockist = await db.query('SELECT * FROM stockists WHERE id = $1', [row.stockist_id]);
  const lines = await db.query('SELECT * FROM allocation_lines WHERE allocation_id = $1 ORDER BY style_number', [row.id]);
  const member = row.saved_by ? await db.query('SELECT name FROM members WHERE id = $1', [row.saved_by]) : null;
  const lineItems = lines.rows.map((l: Record<string, unknown>) => ({
    styleNumber: l.style_number, styleName: l.style_name,
    requestedQuantity: l.requested_quantity, allocatedQuantity: l.allocated_quantity,
    unitPriceMinor: l.unit_price_minor === null ? null : Number(l.unit_price_minor),
    netMinor: l.net_minor === null ? null : Number(l.net_minor),
    vatMinor: l.vat_minor === null ? null : Number(l.vat_minor),
    lineTotalMinor: l.line_total_minor === null ? null : Number(l.line_total_minor)
  }));
  if (buyer) {
    return {
      id: row.id, dropName: drop.rows[0].name, stockistName: stockist.rows[0].name, status: row.status,
      currency: stockist.rows[0].currency,
      lines: lineItems, totalMinor: row.total_minor === null ? null : Number(row.total_minor),
      priceListEffectiveDate: row.price_list_date, invoiceNumber: row.invoice_number,
      confirmedAt: row.confirmed_at ? toInstantString(row.confirmed_at) : null
    };
  }
  return {
    id: row.id, dropId: row.drop_id, dropName: drop.rows[0].name,
    stockistId: row.stockist_id,
    stockistName: stockist.rows[0].contact_erased ? 'Contact erased' : stockist.rows[0].name,
    market: stockist.rows[0].market, currency: stockist.rows[0].currency,
    status: row.status, version: row.version,
    requestedAt: toInstantString(row.requested_at),
    lines: lineItems,
    totalMinor: row.total_minor === null ? null : Number(row.total_minor),
    priceListEffectiveDate: row.price_list_date,
    invoiceNumber: row.invoice_number, killbillInvoiceId: row.killbill_invoice_id,
    contactName: stockist.rows[0].contact_erased ? 'Contact erased' : stockist.rows[0].contact_name,
    internalNote: row.internal_note,
    savedBy: member && member.rows[0] ? member.rows[0].name : null,
    savedAt: toInstantString(row.saved_at),
    confirmedAt: row.confirmed_at ? toInstantString(row.confirmed_at) : null
  };
}

async function loadAllocation(db: import('./db.js').Db, allocId: string, workspaceId: string): Promise<AllocRow> {
  const res = await db.query('SELECT * FROM allocations WHERE id = $1 AND workspace_id = $2', [allocId, workspaceId]);
  if (!res.rows[0]) throw new ApiError('not_found');
  return res.rows[0];
}

function stockistVisibleToBuyer(row: Record<string, unknown>, stockistId: string | null): boolean {
  return row.id === stockistId;
}

export function registerAllocationRoutes(app: FastifyInstance): void {
  // Record a request (stockist buyer for their own store, merchandiser for any).
  app.post('/api/drops/:dropId/requests', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['stockist_buyer', 'merchandiser']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const body = req.body as Record<string, unknown>;
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    if (drop.rows[0].status === 'draft' && auth.member.role === 'stockist_buyer') throw new ApiError('not_found');
    let stockistId = typeof body.stockistId === 'string' ? body.stockistId : '';
    if (auth.member.role === 'stockist_buyer') stockistId = auth.member.stockist_id ?? '';
    const v = new Validator();
    if (!stockistId) v.add('stockistId', MESSAGES.unknownStockist);
    const stockist = stockistId
      ? await state.db.query('SELECT * FROM stockists WHERE id = $1 AND workspace_id = $2 AND status = $3', [stockistId, auth.workspaceId, 'active'])
      : null;
    if (!stockist?.rows[0]) v.add('stockistId', MESSAGES.unknownStockist);
    else if (auth.member.role === 'stockist_buyer' && !stockistVisibleToBuyer(stockist.rows[0], auth.member.stockist_id)) {
      throw new ApiError('not_found');
    }
    const styleRows = await state.db.query('SELECT * FROM styles WHERE drop_id = $1', [dropId]);
    const styleByNumber = new Map(styleRows.rows.map((s: Record<string, unknown>) => [String(s.style_number).toLowerCase(), s]));
    const lines: { styleNumber: string; quantity: number }[] = [];
    if (!Array.isArray(body.lines) || body.lines.length === 0) v.add('lines', MESSAGES.required);
    else {
      body.lines.forEach((l, i) => {
        if (typeof l !== 'object' || l === null) { v.add(`lines.${i}`, MESSAGES.required); return; }
        const styleNumber = String((l as Record<string, unknown>).styleNumber ?? '').trim();
        const quantity = (l as Record<string, unknown>).quantity;
        const match = styleByNumber.get(styleNumber.toLowerCase());
        if (!match) v.add(`lines.${i}.styleNumber`, MESSAGES.unknownStyle(styleNumber));
        if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 0 || quantity > Number(match ? match.wholesale_edition : 0)) {
          v.add(`lines.${i}.quantity`, MESSAGES.wholeRange(0, Number(match ? match.wholesale_edition : 0)));
        }
        lines.push({ styleNumber: match ? String(match.style_number) : styleNumber, quantity: Number(quantity ?? 0) });
      });
    }
    v.throwIfAny();
    const existing = await state.db.query('SELECT * FROM allocations WHERE drop_id = $1 AND stockist_id = $2', [dropId, stockistId]);
    if (existing.rows[0]) {
      if (existing.rows[0].status !== 'requested') throw new ApiError('allocation_split');
      await withTransaction(state.db, async client => {
        for (const l of lines) {
          await client.query(
            'UPDATE allocation_lines SET requested_quantity = $1 WHERE allocation_id = $2 AND lower(style_number) = lower($3)',
            [l.quantity, existing.rows[0].id, l.styleNumber]
          );
        }
        await client.query('UPDATE allocations SET saved_by = $1, saved_at = now(), version = version + 1 WHERE id = $2', [auth.member.id, existing.rows[0].id]);
      });
      const fresh = await state.db.query('SELECT * FROM allocations WHERE id = $1', [existing.rows[0].id]);
      reply.code(200).send(await allocationOut(state.db, fresh.rows[0], auth.member.role === 'stockist_buyer'));
      return;
    }
    const aid = id('alloc');
    await withTransaction(state.db, async client => {
      await client.query(
        'INSERT INTO allocations (id, workspace_id, drop_id, stockist_id, status, version, requested_at, saved_by) VALUES ($1,$2,$3,$4,$5,$6,now(),$7)',
        [aid, auth.workspaceId, dropId, stockistId, 'requested', 1, auth.member.id]
      );
      for (const l of lines) {
        const st = styleByNumber.get(l.styleNumber.toLowerCase());
        await client.query(
          'INSERT INTO allocation_lines (allocation_id, style_number, style_name, requested_quantity, allocated_quantity) VALUES ($1,$2,$3,$4,$5)',
          [aid, l.styleNumber, st ? String(st.name) : '', l.quantity, 0]
        );
      }
    });
    const fresh = await state.db.query('SELECT * FROM allocations WHERE id = $1', [aid]);
    reply.code(201).send(await allocationOut(state.db, fresh.rows[0], auth.member.role === 'stockist_buyer'));
  });

  app.get('/api/drops/:dropId/allocations', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireStaff(req);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    let res;
    if (auth.member.role === 'stockist_buyer') {
      res = await state.db.query('SELECT * FROM allocations WHERE drop_id = $1 AND stockist_id = $2 ORDER BY requested_at', [dropId, auth.member.stockist_id]);
    } else {
      res = await state.db.query('SELECT * FROM allocations WHERE drop_id = $1 ORDER BY requested_at', [dropId]);
    }
    const buyer = auth.member.role === 'stockist_buyer';
    const items = await Promise.all(res.rows.map((r: AllocRow) => allocationOut(state.db, r, buyer)));
    reply.code(200).send({ items });
  });

  app.get('/api/drops/:dropId/split', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['merchandiser']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const confirmed = await state.db.query("SELECT count(*)::int AS n FROM allocations WHERE drop_id = $1 AND status = 'confirmed'", [dropId]);
    if (confirmed.rows[0].n > 0) throw new ApiError('drop_has_confirmed');
    const items = await proposeSplit(state.db, dropId);
    reply.code(200).send({ items });
  });

  app.post('/api/drops/:dropId/split', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['merchandiser']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const confirmed = await state.db.query("SELECT count(*)::int AS n FROM allocations WHERE drop_id = $1 AND status = 'confirmed'", [dropId]);
    if (confirmed.rows[0].n > 0) throw new ApiError('drop_has_confirmed');
    const proposal = await proposeSplit(state.db, dropId);
    await withTransaction(state.db, async client => {
      for (const p of proposal) {
        await client.query("UPDATE allocations SET status = 'split', version = version + 1, saved_by = $1, saved_at = now() WHERE id = $2", [auth.member.id, p.stockistId]);
        for (const line of p.lines) {
          await client.query('UPDATE allocation_lines SET allocated_quantity = $1 WHERE allocation_id = $2 AND lower(style_number) = lower($3)',
            [line.allocatedQuantity, p.stockistId, line.styleNumber]);
        }
      }
    });
    const res = await state.db.query('SELECT * FROM allocations WHERE drop_id = $1 ORDER BY requested_at', [dropId]);
    const items = await Promise.all(res.rows.map((r: AllocRow) => allocationOut(state.db, r, false)));
    reply.code(200).send({ items });
  });

  app.post('/api/allocations', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['merchandiser']);
    const state = req.appState;
    const body = req.body as Record<string, unknown>;
    const dropId = typeof body.dropId === 'string' ? body.dropId : '';
    const stockistId = typeof body.stockistId === 'string' ? body.stockistId : '';
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const existing = await state.db.query('SELECT * FROM allocations WHERE drop_id = $1 AND stockist_id = $2', [dropId, stockistId]);
    if (existing.rows[0]) throw new ApiError('allocation_exists');
    const stockist = await state.db.query('SELECT * FROM stockists WHERE id = $1 AND workspace_id = $2 AND status = $3', [stockistId, auth.workspaceId, 'active']);
    const v = new Validator();
    if (!stockist.rows[0]) v.add('stockistId', MESSAGES.unknownStockist);
    const styleRows = await state.db.query('SELECT * FROM styles WHERE drop_id = $1', [dropId]);
    const styleByNumber = new Map(styleRows.rows.map((s: Record<string, unknown>) => [String(s.style_number).toLowerCase(), s]));
    const lines: { styleNumber: string; quantity: number }[] = [];
    if (!Array.isArray(body.lines) || body.lines.length === 0) v.add('lines', MESSAGES.required);
    else {
      body.lines.forEach((l, i) => {
        if (typeof l !== 'object' || l === null) { v.add(`lines.${i}`, MESSAGES.required); return; }
        const styleNumber = String((l as Record<string, unknown>).styleNumber ?? '').trim();
        const quantity = (l as Record<string, unknown>).quantity;
        const match = styleByNumber.get(styleNumber.toLowerCase());
        if (!match) v.add(`lines.${i}.styleNumber`, MESSAGES.unknownStyle(styleNumber));
        if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 0 || quantity > Number(match ? match.wholesale_edition : 0)) {
          v.add(`lines.${i}.quantity`, MESSAGES.wholeRange(0, Number(match ? match.wholesale_edition : 0)));
        }
        lines.push({ styleNumber: match ? String(match.style_number) : styleNumber, quantity: Number(quantity ?? 0) });
      });
    }
    v.throwIfAny();
    const aid = id('alloc');
    await withTransaction(state.db, async client => {
      await client.query(
        'INSERT INTO allocations (id, workspace_id, drop_id, stockist_id, status, version, requested_at, internal_note, saved_by) VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8)',
        [aid, auth.workspaceId, dropId, stockistId, 'split', 1, String(body.internalNote ?? ''), auth.member.id]
      );
      for (const l of lines) {
        const st = styleByNumber.get(l.styleNumber.toLowerCase());
        await client.query(
          'INSERT INTO allocation_lines (allocation_id, style_number, style_name, requested_quantity, allocated_quantity) VALUES ($1,$2,$3,$4,$5)',
          [aid, l.styleNumber, st ? String(st.name) : '', l.quantity, l.quantity]
        );
      }
    });
    const fresh = await state.db.query('SELECT * FROM allocations WHERE id = $1', [aid]);
    reply.code(201).send(await allocationOut(state.db, fresh.rows[0], false));
  });

  app.get('/api/allocations', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireStaff(req);
    const state = req.appState;
    const q = req.query as Record<string, string | undefined>;
    let res;
    const buyer = auth.member.role === 'stockist_buyer';
    if (buyer) {
      res = await state.db.query('SELECT * FROM allocations WHERE workspace_id = $1 AND stockist_id = $2 ORDER BY requested_at DESC', [auth.workspaceId, auth.member.stockist_id]);
    } else if (q.status) {
      res = await state.db.query('SELECT * FROM allocations WHERE workspace_id = $1 AND status = $2 ORDER BY requested_at DESC', [auth.workspaceId, q.status]);
    } else {
      res = await state.db.query('SELECT * FROM allocations WHERE workspace_id = $1 ORDER BY requested_at DESC', [auth.workspaceId]);
    }
    const items = await Promise.all(res.rows.map((r: AllocRow) => allocationOut(state.db, r, buyer)));
    reply.code(200).send({ items });
  });

  app.get('/api/allocations/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireStaff(req);
    const state = req.appState;
    const { id: allocId } = req.params as { id: string };
    const row = await loadAllocation(state.db, allocId, auth.workspaceId);
    const buyer = auth.member.role === 'stockist_buyer';
    if (buyer && row.stockist_id !== auth.member.stockist_id) throw new ApiError('not_found');
    reply.code(200).send(await allocationOut(state.db, row, buyer));
  });

  app.patch('/api/allocations/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['merchandiser']);
    const state = req.appState;
    const { id: allocId } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const row = await loadAllocation(state.db, allocId, auth.workspaceId);
    if (row.status === 'confirmed') throw new ApiError('allocation_confirmed');
    const version = Number(body.version);
    const v = new Validator();
    if (!Number.isInteger(version)) v.add('version', MESSAGES.required);
    v.throwIfAny();
    if (version !== row.version) {
      const fresh = await state.db.query('SELECT * FROM allocations WHERE id = $1', [allocId]);
      throw new ApiError('stale_version', {
        savedBy: (await savedByName(state.db, row.saved_by)),
        savedAt: toInstantString(row.saved_at),
        current: await allocationOut(state.db, fresh.rows[0], false)
      });
    }
    const styleRows = await state.db.query('SELECT * FROM styles WHERE drop_id = $1', [row.drop_id]);
    const styleByNumber = new Map(styleRows.rows.map((s: Record<string, unknown>) => [String(s.style_number).toLowerCase(), s]));
    const lines: { styleNumber: string; quantity: number }[] = [];
    if (!Array.isArray(body.lines) || body.lines.length === 0) v.add('lines', MESSAGES.required);
    else {
      body.lines.forEach((l, i) => {
        if (typeof l !== 'object' || l === null) { v.add(`lines.${i}`, MESSAGES.required); return; }
        const styleNumber = String((l as Record<string, unknown>).styleNumber ?? '').trim();
        const quantity = (l as Record<string, unknown>).quantity;
        const match = styleByNumber.get(styleNumber.toLowerCase());
        if (!match) v.add(`lines.${i}.styleNumber`, MESSAGES.unknownStyle(styleNumber));
        if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 0 || quantity > Number(match ? match.wholesale_edition : 0)) {
          v.add(`lines.${i}.quantity`, MESSAGES.wholeRange(0, Number(match ? match.wholesale_edition : 0)));
        }
        lines.push({ styleNumber: match ? String(match.style_number) : styleNumber, quantity: Number(quantity ?? 0) });
      });
    }
    v.throwIfAny();
    await withTransaction(state.db, async client => {
      for (const l of lines) {
        const upd = await client.query(
          'UPDATE allocation_lines SET allocated_quantity = $1 WHERE allocation_id = $2 AND lower(style_number) = lower($3)',
          [l.quantity, allocId, l.styleNumber]
        );
        if (upd.rowCount === 0) {
          const st = styleByNumber.get(l.styleNumber.toLowerCase());
          await client.query(
            'INSERT INTO allocation_lines (allocation_id, style_number, style_name, requested_quantity, allocated_quantity) VALUES ($1,$2,$3,0,$4)',
            [allocId, l.styleNumber, st ? String(st.name) : '', l.quantity]
          );
        }
      }
      await client.query(
        'UPDATE allocations SET version = version + 1, saved_by = $1, saved_at = now(), internal_note = $2, status = CASE WHEN status = $3 THEN $3 ELSE $4 END WHERE id = $5',
        [auth.member.id, body.internalNote !== undefined ? String(body.internalNote) : row.internal_note, 'confirmed', 'split', allocId]
      );
    });
    const fresh = await state.db.query('SELECT * FROM allocations WHERE id = $1', [allocId]);
    reply.code(200).send(await allocationOut(state.db, fresh.rows[0], false));
  });

  app.get('/api/allocations/:id/quote', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['finance_lead']);
    const state = req.appState;
    const { id: allocId } = req.params as { id: string };
    const row = await loadAllocation(state.db, allocId, auth.workspaceId);
    const quoted = await quoteAllocation(state, row);
    reply.code(200).send(quoted);
  });

  app.post('/api/allocations/:id/confirm', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['finance_lead']);
    const state = req.appState;
    const { id: allocId } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const version = Number(body.version);
    const v = new Validator();
    if (!Number.isInteger(version)) v.add('version', MESSAGES.required);
    v.throwIfAny();

    // Confirm-once guard: a transaction-level lock on the allocation row.
    const result = await withTransaction(state.db, async client => {
      const locked = await client.query('SELECT * FROM allocations WHERE id = $1 FOR UPDATE', [allocId]);
      const row = locked.rows[0];
      if (!row || row.workspace_id !== auth.workspaceId) return { code: 'not_found' as const };
      if (row.status === 'confirmed') return { code: 'allocation_confirmed' as const };
      if (row.status !== 'split') return { code: 'allocation_not_split' as const };
      if (version !== row.version) {
        return { code: 'stale' as const, row };
      }
      const stockist = await client.query('SELECT * FROM stockists WHERE id = $1', [row.stockist_id]);
      if (!stockist.rows[0].contact_email) return { code: 'contact_missing' as const };
      const lines = await client.query('SELECT * FROM allocation_lines WHERE allocation_id = $1', [allocId]);
      const priced = lines.rows.filter((l: Record<string, unknown>) => Number(l.allocated_quantity) > 0);
      if (priced.length === 0) return { code: 'allocation_empty' as const };
      return { code: 'ok' as const, row, stockist: stockist.rows[0], priced };
    });
    if (result.code === 'not_found') throw new ApiError('not_found');
    if (result.code === 'allocation_confirmed') throw new ApiError('allocation_confirmed');
    if (result.code === 'allocation_not_split') throw new ApiError('allocation_not_split');
    if (result.code === 'allocation_empty') throw new ApiError('allocation_empty');
    if (result.code === 'contact_missing') throw new ApiError('contact_missing');
    if (result.code === 'stale') {
      const fresh = await state.db.query('SELECT * FROM allocations WHERE id = $1', [allocId]);
      throw new ApiError('stale_version', {
        savedBy: await savedByName(state.db, result.row.saved_by),
        savedAt: toInstantString(result.row.saved_at),
        current: await allocationOut(state.db, fresh.rows[0], false)
      });
    }

    const row = result.row;
    const stockist = result.stockist as Record<string, unknown>;
    const priced = result.priced as Record<string, unknown>[];

    // Price every line from the list in force on the Copenhagen date of now.
    const today = cphToday();
    const lists = await loadPriceLists(state.db, auth.workspaceId);
    const currency = String(stockist.currency);
    const danish = String(stockist.market) === 'copenhagen';
    const missing: string[] = [];
    const lineOut: Record<string, unknown>[] = [];
    for (const l of priced) {
      const unit = priceInForce(lists, today, String(l.style_number), currency);
      if (unit == null) { missing.push(String(l.style_number)); continue; }
      const netMinor = unit * Number(l.allocated_quantity);
      const vatMinor = vatOf(netMinor, danish);
      lineOut.push({
        styleNumber: l.style_number, styleName: l.style_name, quantity: Number(l.allocated_quantity),
        unitPriceMinor: unit, netMinor, vatMinor, lineTotalMinor: netMinor + vatMinor
      });
    }
    if (missing.length > 0) {
      throw new ApiError('price_missing', {});
    }
    const totalMinor = lineOut.reduce((s, l) => s + Number(l.lineTotalMinor), 0);

    // Create the Kill Bill invoice first; on failure nothing is recorded or mailed.
    let invoice: { invoiceId: string; invoiceNumber: string };
    try {
      const accountId = await state.killbill.ensureAccount(`hourline-${row.stockist_id}`, String(stockist.name), currency);
      const items = lineOut.map(l => ({
        description: `${l.styleNumber} ${l.styleName} × ${l.quantity}`,
        amount: currency === 'JPY' ? String(l.lineTotalMinor) : (Number(l.lineTotalMinor) / 100).toFixed(2)
      }));
      invoice = await state.killbill.createInvoice(accountId, currency, items);
    } catch {
      throw new ApiError('billing_unavailable');
    }

    await withTransaction(state.db, async client => {
      for (const l of lineOut) {
        await client.query(
          'UPDATE allocation_lines SET unit_price_minor = $1, net_minor = $2, vat_minor = $3, line_total_minor = $4 WHERE allocation_id = $5 AND lower(style_number) = lower($6)',
          [l.unitPriceMinor, l.netMinor, l.vatMinor, l.lineTotalMinor, allocId, l.styleNumber]
        );
      }
      await client.query(
        "UPDATE allocations SET status = 'confirmed', version = version + 1, total_minor = $1, price_list_date = $2, invoice_number = $3, killbill_invoice_id = $4, saved_by = $5, saved_at = now(), confirmed_at = now() WHERE id = $6",
        [totalMinor, today, invoice.invoiceNumber, invoice.invoiceId, auth.member.id, allocId]
      );
      // One confirmation email, queued only once the invoice exists.
      const drop = await client.query('SELECT name FROM drops WHERE id = $1', [row.drop_id]);
      const linesText = lineOut.map(l =>
        `${l.styleNumber} × ${l.quantity}: unit ${formatMoney(Number(l.unitPriceMinor), currency)}, VAT ${formatMoney(Number(l.vatMinor), currency)}, total ${formatMoney(Number(l.lineTotalMinor), currency)}`
      ).join('\n');
      const to = String(stockist.contact_email);
      const toName = stockist.contact_erased ? '' : String(stockist.contact_name ?? '');
      const subject = `Allocation confirmed: ${drop.rows[0].name} for ${stockist.name}`;
      await client.query(
        "INSERT INTO jobs (run_at, kind, payload, workspace_id) VALUES (now(), 'mail', $1, $2)",
        [JSON.stringify({
          kind: 'allocation_confirmation',
          to, toName, subject,
          body: `Allocation confirmed: ${drop.rows[0].name} for ${stockist.name}\n\n${linesText}\n\nTotal: ${formatMoney(totalMinor, currency)}\nInvoice number: ${invoice.invoiceNumber}\nPrices from the list in force on ${dateWords(today)}.\n`
        }), auth.workspaceId]
      );
    });
    const fresh = await state.db.query('SELECT * FROM allocations WHERE id = $1', [allocId]);
    reply.code(200).send(await allocationOut(state.db, fresh.rows[0], false));
  });

  app.get('/api/allocations/:id/line-sheet.csv', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireStaff(req);
    const state = req.appState;
    const { id: allocId } = req.params as { id: string };
    const row = await loadAllocation(state.db, allocId, auth.workspaceId);
    if (auth.member.role === 'stockist_buyer' && row.stockist_id !== auth.member.stockist_id) throw new ApiError('not_found');
    const stockist = await state.db.query('SELECT * FROM stockists WHERE id = $1', [row.stockist_id]);
    const lines = await state.db.query('SELECT * FROM allocation_lines WHERE allocation_id = $1 ORDER BY style_number', [allocId]);
    const rows: (string | number | null)[][] = [
      ['Style number', 'Name', 'Quantity', 'Unit price (minor units)', 'Net (minor units)', 'VAT (minor units)', 'Line total (minor units)', 'Currency', 'Price list from']
    ];
    for (const l of lines.rows) {
      rows.push([
        l.style_number, l.style_name, Number(l.allocated_quantity),
        l.unit_price_minor === null ? null : Number(l.unit_price_minor),
        l.net_minor === null ? null : Number(l.net_minor),
        l.vat_minor === null ? null : Number(l.vat_minor),
        l.line_total_minor === null ? null : Number(l.line_total_minor),
        stockist.rows[0].currency, row.price_list_date
      ]);
    }
    reply.code(200).header('content-type', 'text/csv; charset=utf-8').send(csvDocument(rows));
  });

  app.get('/api/price-lists', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['finance_lead', 'merchandiser']);
    const state = req.appState;
    const res = await state.db.query('SELECT * FROM price_lists WHERE workspace_id = $1 ORDER BY effective_date DESC, created_at DESC', [auth.workspaceId]);
    const today = cphToday();
    const items = [];
    for (const pl of res.rows) {
      const prices = await state.db.query('SELECT * FROM prices WHERE price_list_id = $1', [pl.id]);
      items.push({
        id: pl.id, name: pl.name, effectiveDate: pl.effective_date,
        prices: prices.rows.map((p: Record<string, unknown>) => ({ styleNumber: p.style_number, currency: p.currency, unitPriceMinor: Number(p.unit_price_minor) })),
        createdAt: toInstantString(pl.created_at),
        inForce: pl.effective_date <= today
      });
    }
    reply.code(200).send({ items });
  });

  app.post('/api/price-lists', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['finance_lead']);
    const state = req.appState;
    const body = req.body as Record<string, unknown>;
    const v = new Validator();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) v.add('name', MESSAGES.required);
    const effectiveDate = typeof body.effectiveDate === 'string' ? body.effectiveDate : '';
    const d = parseDate(effectiveDate);
    if (!d) v.add('effectiveDate', MESSAGES.date);
    else if (effectiveDate < cphToday()) v.add('effectiveDate', MESSAGES.priceDatePast);
    if (!Array.isArray(body.prices) || body.prices.length === 0) v.add('prices', MESSAGES.required);
    else {
      body.prices.forEach((p, i) => {
        if (typeof p !== 'object' || p === null) { v.add(`prices.${i}`, MESSAGES.required); return; }
        const unit = (p as Record<string, unknown>).unitPriceMinor;
        if (typeof unit !== 'number' || !Number.isInteger(unit) || unit < 1 || unit > 100000000) {
          v.add(`prices.${i}.unitPriceMinor`, MESSAGES.wholeRange(1, 100000000));
        }
      });
    }
    v.throwIfAny();
    const plid = id('pl');
    await withTransaction(state.db, async client => {
      await client.query('INSERT INTO price_lists (id, workspace_id, name, effective_date) VALUES ($1,$2,$3,$4)', [plid, auth.workspaceId, name, effectiveDate]);
      for (const p of (body.prices as { styleNumber: string; currency: string; unitPriceMinor: number }[])) {
        await client.query(
          'INSERT INTO prices (price_list_id, style_number, currency, unit_price_minor) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [plid, String(p.styleNumber).trim(), String(p.currency), p.unitPriceMinor]
        );
      }
    });
    const fresh = await state.db.query('SELECT * FROM price_lists WHERE id = $1', [plid]);
    const prices = await state.db.query('SELECT * FROM prices WHERE price_list_id = $1', [plid]);
    reply.code(201).send({
      id: plid, name: fresh.rows[0].name, effectiveDate: fresh.rows[0].effective_date,
      prices: prices.rows.map((p: Record<string, unknown>) => ({ styleNumber: p.style_number, currency: p.currency, unitPriceMinor: Number(p.unit_price_minor) })),
      createdAt: toInstantString(fresh.rows[0].created_at)
    });
  });
}

async function savedByName(db: import('./db.js').Db, memberId: string | null): Promise<string> {
  if (!memberId) return 'Someone';
  const res = await db.query('SELECT name FROM members WHERE id = $1', [memberId]);
  return res.rows[0]?.name ?? 'Someone';
}

async function proposeSplit(db: import('./db.js').Db, dropId: string): Promise<{ stockistId: string; stockistName: string; lines: { styleNumber: string; requestedQuantity: number; allocatedQuantity: number }[] }[]> {
  const styles = await db.query('SELECT * FROM styles WHERE drop_id = $1 ORDER BY position', [dropId]);
  const allocations = await db.query("SELECT * FROM allocations WHERE drop_id = $1 AND status <> 'confirmed' ORDER BY requested_at", [dropId]);
  const linesByAlloc = new Map<string, Record<string, number>>();
  for (const a of allocations.rows) {
    const lines = await db.query('SELECT * FROM allocation_lines WHERE allocation_id = $1', [a.id]);
    linesByAlloc.set(a.id, Object.fromEntries(lines.rows.map((l: Record<string, unknown>) => [String(l.style_number).toLowerCase(), Number(l.requested_quantity)])));
  }
  const out: { stockistId: string; stockistName: string; lines: { styleNumber: string; requestedQuantity: number; allocatedQuantity: number }[] }[] = [];
  for (const a of allocations.rows) {
    const st = await db.query('SELECT name FROM stockists WHERE id = $1', [a.stockist_id]);
    out.push({ stockistId: a.id, stockistName: st.rows[0]?.name ?? '', lines: [] });
  }
  for (const style of styles.rows) {
    const key = String(style.style_number).toLowerCase();
    const requests = allocations.rows
      .map((a: AllocRow, i: number) => ({ id: a.id, requested: linesByAlloc.get(a.id)?.[key] ?? 0, requestedAt: new Date(a.requested_at).getTime(), index: i }))
      .filter(r => r.requested > 0);
    const shares = largestRemainderSplit(style.wholesale_edition, requests);
    for (const r of requests) {
      out[r.index].lines.push({
        styleNumber: style.style_number,
        requestedQuantity: r.requested,
        allocatedQuantity: shares.get(r.id) ?? 0
      });
    }
  }
  return out;
}

export async function loadPriceLists(db: import('./db.js').Db, workspaceId: string): Promise<{ effectiveDate: string; createdAt: string; prices: Map<string, number> }[]> {
  const res = await db.query('SELECT * FROM price_lists WHERE workspace_id = $1 ORDER BY effective_date, created_at', [workspaceId]);
  const out: { effectiveDate: string; createdAt: string; prices: Map<string, number> }[] = [];
  for (const pl of res.rows) {
    const prices = await db.query('SELECT * FROM prices WHERE price_list_id = $1', [pl.id]);
    const map = new Map<string, number>();
    for (const p of prices.rows) {
      map.set(`${p.style_number}|${p.currency}`, Number(p.unit_price_minor));
    }
    out.push({ effectiveDate: pl.effective_date, createdAt: String(pl.created_at), prices: map });
  }
  return out;
}

async function quoteAllocation(state: { db: import('./db.js').Db; cfg: import('./providers.js').Config }, row: AllocRow): Promise<Record<string, unknown>> {
  const db = state.db;
  const stockist = await db.query('SELECT * FROM stockists WHERE id = $1', [row.stockist_id]);
  const lists = await loadPriceLists(db, row.workspace_id);
  const today = cphToday();
  const currency = stockist.rows[0].currency;
  const danish = stockist.rows[0].market === 'copenhagen';
  const lines = await db.query('SELECT * FROM allocation_lines WHERE allocation_id = $1 ORDER BY style_number', [row.id]);
  const unitPrice = (styleNumber: string) => priceInForce(lists, today, styleNumber, currency);
  const { lines: priced } = priceLines(
    lines.rows.map((l: Record<string, unknown>) => ({ styleNumber: String(l.style_number), styleName: String(l.style_name), quantity: Number(l.allocated_quantity) })),
    unitPrice, danish, currency
  );
  const totalMinor = priced.reduce((s, l) => s + l.lineTotalMinor, 0);
  return {
    id: row.id, dropId: row.drop_id, status: row.status, version: row.version,
    lines: priced.map(l => ({ ...l })),
    totalMinor, currency, priceListEffectiveDate: today,
    contactName: stockist.rows[0].contact_erased ? 'Contact erased' : stockist.rows[0].contact_name
  };
}
