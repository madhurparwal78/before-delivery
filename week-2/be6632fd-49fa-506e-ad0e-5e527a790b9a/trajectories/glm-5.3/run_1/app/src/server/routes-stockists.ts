import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../domain/errors.js';
import { MESSAGES } from '../domain/copy.js';
import { MARKETS, MARKET_ORDER, type Market } from '../domain/markets.js';
import { danishCompare } from '../domain/danish.js';
import { requireStaff, requireRole } from './auth.js';
import { Validator, isEmail, requiredString, graphemeLimit } from './validate.js';
import { id } from './startup.js';
import { csvDocument } from '../domain/csv.js';
import { toInstantString } from '../domain/dates.js';

export interface StockistRow {
  id: string; workspace_id: string; name: string; market: string; currency: string;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  contact_erased: boolean; notes: string; status: string; archived_at: Date | null; created_at: Date;
}

function stockistOut(s: StockistRow, buyer: boolean): Record<string, unknown> {
  const city = MARKETS.find(m => m.market === s.market)?.city ?? s.market;
  if (buyer) return { id: s.id, name: s.name, market: s.market, city, currency: s.currency };
  return {
    id: s.id, name: s.name, market: s.market, city, currency: s.currency,
    contactName: s.contact_erased ? null : s.contact_name,
    contactEmail: s.contact_erased ? null : s.contact_email,
    contactPhone: s.contact_erased ? null : s.contact_phone,
    contactErased: s.contact_erased,
    notes: s.notes, status: s.status,
    archivedAt: s.archived_at ? toInstantString(s.archived_at) : null,
    createdAt: toInstantString(s.created_at)
  };
}

// A cursor holds the last item's sort position, so pages never repeat or skip a
// stockist while others are added or archived.
function encodeCursor(name: string, id: string): string {
  return Buffer.from(JSON.stringify({ name, id })).toString('base64url');
}

function decodeCursor(cursor: string): { name: string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { name?: string; id?: string };
    if (typeof parsed.name !== 'string' || typeof parsed.id !== 'string') return null;
    return { name: parsed.name, id: parsed.id };
  } catch { return null; }
}

export function registerStockistRoutes(app: FastifyInstance): void {
  app.get('/api/stockists', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireStaff(req);
    const state = req.appState;
    const q = req.query as Record<string, string | undefined>;
    const buyer = auth.member.role === 'stockist_buyer';
    if (buyer) {
      const own = await state.db.query('SELECT * FROM stockists WHERE id = $1', [auth.member.stockist_id]);
      reply.code(200).send({ items: own.rows.map((s: StockistRow) => stockistOut(s, true)), nextCursor: null });
      return;
    }
    const limit = Math.min(50, Math.max(1, Number(q.limit ?? 25) || 25));
    const archived = q.archived === 'true';
    const search = (q.q ?? '').trim().toLowerCase();
    const res = await state.db.query('SELECT * FROM stockists WHERE workspace_id = $1 AND status = $2', [auth.workspaceId, archived ? 'archived' : 'active']);
    const all = res.rows as StockistRow[];
    let filtered = all;
    if (search) filtered = filtered.filter(s => s.name.toLowerCase().includes(search));
    filtered.sort((a, b) => danishCompare(a.name, b.name) || a.id.localeCompare(b.id));
    let start = 0;
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      if (c) {
        const idx = filtered.findIndex(s => s.id === c.id);
        if (idx !== -1) start = idx + 1;
      }
    }
    const page = filtered.slice(start, start + limit);
    const nextCursor = start + limit < filtered.length && page.length > 0 ? encodeCursor(page[page.length - 1].name, page[page.length - 1].id) : null;
    reply.code(200).send({ items: page.map(s => stockistOut(s, false)), nextCursor });
  });

  app.post('/api/stockists', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['merchandiser']);
    const state = req.appState;
    const body = req.body as Record<string, unknown>;
    const v = new Validator();
    const name = requiredString(body.name);
    if (!name) v.add('name', MESSAGES.required);
    else if (!graphemeLimit(name, 100)) v.add('name', MESSAGES.tooLong(100));
    const market = typeof body.market === 'string' ? body.market : '';
    if (!MARKET_ORDER.includes(market as Market)) v.add('market', MESSAGES.unknownMarket);
    const contactEmail = typeof body.contactEmail === 'string' && body.contactEmail.trim() ? body.contactEmail.trim() : null;
    if (contactEmail && !isEmail(contactEmail)) v.add('contactEmail', MESSAGES.email);
    v.throwIfAny();
    const sid = id('stk');
    const currency = MARKETS.find(m => m.market === market)!.currency;
    await state.db.query(
      'INSERT INTO stockists (id, workspace_id, name, market, currency, contact_name, contact_email, contact_phone, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [sid, auth.workspaceId, name, market, currency,
        typeof body.contactName === 'string' && body.contactName ? body.contactName : null,
        contactEmail,
        typeof body.contactPhone === 'string' && body.contactPhone ? body.contactPhone : null,
        typeof body.notes === 'string' ? body.notes : '']
    );
    const fresh = await state.db.query('SELECT * FROM stockists WHERE id = $1', [sid]);
    reply.code(201).send(stockistOut(fresh.rows[0], false));
  });

  app.get('/api/stockists.csv', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['merchandiser', 'finance_lead', 'launch_producer']);
    const state = req.appState;
    const res = await state.db.query('SELECT * FROM stockists WHERE workspace_id = $1 AND status = $2', [auth.workspaceId, 'active']);
    const rows: (string | number | null)[][] = [['Name', 'Market', 'City', 'Currency', 'Contact name', 'Contact email', 'Contact phone']];
    for (const s of (res.rows as StockistRow[]).sort((a, b) => danishCompare(a.name, b.name))) {
      const city = MARKETS.find(m => m.market === s.market)?.city ?? s.market;
      rows.push([s.name, s.market, city, s.currency, s.contact_erased ? MESSAGES.contactErased : s.contact_name,
        s.contact_erased ? MESSAGES.contactErased : s.contact_email, s.contact_erased ? MESSAGES.contactErased : s.contact_phone]);
    }
    reply.code(200).header('content-type', 'text/csv; charset=utf-8').send(csvDocument(rows));
  });

  app.get('/api/stockists/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireStaff(req);
    const state = req.appState;
    const { id: sid } = req.params as { id: string };
    const res = await state.db.query('SELECT * FROM stockists WHERE id = $1 AND workspace_id = $2', [sid, auth.workspaceId]);
    if (!res.rows[0]) throw new ApiError('not_found');
    if (auth.member.role === 'stockist_buyer' && auth.member.stockist_id !== sid) throw new ApiError('not_found');
    if (res.rows[0].status === 'archived' && auth.member.role !== 'stockist_buyer') throw new ApiError('not_found');
    reply.code(200).send(stockistOut(res.rows[0], auth.member.role === 'stockist_buyer'));
  });

  app.post('/api/stockists/:id/archive', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['merchandiser']);
    const state = req.appState;
    const { id: sid } = req.params as { id: string };
    const res = await state.db.query('SELECT * FROM stockists WHERE id = $1 AND workspace_id = $2', [sid, auth.workspaceId]);
    if (!res.rows[0] || res.rows[0].status === 'archived') throw new ApiError('not_found');
    await state.db.query("UPDATE stockists SET status = 'archived', archived_at = now() WHERE id = $1", [sid]);
    const fresh = await state.db.query('SELECT * FROM stockists WHERE id = $1', [sid]);
    reply.code(200).send(stockistOut(fresh.rows[0], false));
  });

  app.post('/api/stockists/:id/restore', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['merchandiser']);
    const state = req.appState;
    const { id: sid } = req.params as { id: string };
    const res = await state.db.query('SELECT * FROM stockists WHERE id = $1 AND workspace_id = $2', [sid, auth.workspaceId]);
    if (!res.rows[0]) throw new ApiError('not_found');
    if (res.rows[0].status !== 'archived') throw new ApiError('stockist_active');
    await state.db.query("UPDATE stockists SET status = 'active', archived_at = NULL WHERE id = $1", [sid]);
    const fresh = await state.db.query('SELECT * FROM stockists WHERE id = $1', [sid]);
    reply.code(200).send(stockistOut(fresh.rows[0], false));
  });

  app.post('/api/stockists/:id/erase-contact', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['merchandiser']);
    const state = req.appState;
    const { id: sid } = req.params as { id: string };
    const res = await state.db.query('SELECT * FROM stockists WHERE id = $1 AND workspace_id = $2', [sid, auth.workspaceId]);
    if (!res.rows[0] || res.rows[0].status === 'archived') throw new ApiError('not_found');
    await state.db.query(
      "UPDATE stockists SET contact_name = NULL, contact_email = NULL, contact_phone = NULL, contact_erased = true WHERE id = $1",
      [sid]
    );
    // Delete every queued, undelivered email to that address.
    const s = res.rows[0] as StockistRow;
    if (s.contact_email) {
      await state.db.query(
        "DELETE FROM jobs WHERE kind = 'mail' AND claimed_at IS NULL AND payload->>'to' = $1",
        [s.contact_email]
      );
    }
    const fresh = await state.db.query('SELECT * FROM stockists WHERE id = $1', [sid]);
    reply.code(200).send(stockistOut(fresh.rows[0], false));
  });
}
