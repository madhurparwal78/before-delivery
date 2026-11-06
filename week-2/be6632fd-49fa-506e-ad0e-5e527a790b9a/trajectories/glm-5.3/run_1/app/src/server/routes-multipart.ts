import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { ApiError } from '../domain/errors.js';
import { MESSAGES } from '../domain/copy.js';
import { cphToday, dateWords } from '../domain/dates.js';
import { requireRole, requireStaff } from './auth.js';
import { Validator, graphemeLimit } from './validate.js';
import { id } from './startup.js';
import { withTransaction } from './db.js';
import { csvDocument, parseLegacyAmount, parseLegacyInteger } from '../domain/csv.js';
import { loadPriceLists } from './routes-allocations.js';
import { looksOut } from './routes-content.js';
import { priceInForce } from '../domain/pricing.js';

const LOOK_FILE_LIMIT = 8000000;
const LOOK_ENVELOPE = 100000;
const SHEET_FILE_LIMIT = 1000000;
const SHEET_ENVELOPE = 100000;

export function registerMultipartRoutes(app: FastifyInstance): void {
  // Look uploads: judged by decoded content, orientation applied, metadata removed.
  app.post('/api/drops/:dropId/looks', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['merchandiser']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');

    if (!req.isMultipart?.()) throw new ApiError('unsupported_media_type');
    const parts: Record<string, { buffer: Buffer; filename?: string; contentType?: string }> = {};
    let envelope = 0;
    for await (const part of req.parts({ limits: { fileSize: LOOK_FILE_LIMIT + LOOK_ENVELOPE, files: 1, fields: 10, fieldSize: 65536 } })) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file') throw new ApiError('validation_failed', { fields: { file: MESSAGES.required } });
        const buffer = await part.toBuffer();
        if (buffer.length > LOOK_FILE_LIMIT) throw new ApiError('too_large', { fields: { file: MESSAGES.tooLong(LOOK_FILE_LIMIT) } });
        envelope = Math.max(0, buffer.length - LOOK_FILE_LIMIT);
        if (envelope > LOOK_ENVELOPE) throw new ApiError('too_large');
        parts.file = { buffer, filename: part.filename ?? '', contentType: part.mimetype };
      } else if (part.type === 'field') {
        parts[part.fieldname] = { buffer: Buffer.from(String(part.value ?? ''), 'utf8') };
      }
    }
    if (!parts.file) throw new ApiError('validation_failed', { fields: { file: MESSAGES.required } });
    const v = new Validator();
    const title = parts.title ? parts.title.buffer.toString('utf8').trim() : '';
    if (!title) v.add('title', MESSAGES.required);
    else if (!graphemeLimit(title, 80)) v.add('title', MESSAGES.tooLong(80));
    const altText = parts.altText ? parts.altText.buffer.toString('utf8').trim() : '';
    if (!altText) v.add('altText', MESSAGES.required);
    else if (!graphemeLimit(altText, 250)) v.add('altText', MESSAGES.tooLong(250));
    v.throwIfAny();

    const pipeline = sharp(parts.file.buffer, { failOn: 'error' });
    const meta = await pipeline.metadata().catch(() => null);
    if (!meta || !['jpeg', 'png', 'webp'].includes(meta.format ?? '')) {
      throw new ApiError('validation_failed', { fields: { file: MESSAGES.imageType } });
    }
    if ((meta.width ?? 0) > 12000 || (meta.height ?? 0) > 12000 || (meta.width ?? 0) * (meta.height ?? 1) > 40000000) {
      throw new ApiError('validation_failed', { fields: { file: MESSAGES.imagePixels } });
    }
    const format = meta.format as 'jpeg' | 'png' | 'webp';
    // Turn upright per camera orientation, and strip all metadata.
    let clean: Buffer;
    try {
      clean = await sharp(parts.file.buffer).rotate().toFormat(format).toBuffer();
    } catch {
      throw new ApiError('validation_failed', { fields: { file: MESSAGES.imageType } });
    }
    const cleanMeta = await sharp(clean).metadata();
    const count = await state.db.query('SELECT count(*)::int AS n, coalesce(max(order_version), 1) AS ov FROM looks WHERE drop_id = $1', [dropId]);
    const position = count.rows[0].n + 1;
    const orderVersion = Number(count.rows[0].ov) + (count.rows[0].n > 0 ? 0 : 0) + 1;
    const lookId = id('look');
    try {
      await state.storage.put(`looks/${dropId}/${lookId}.${format === 'jpeg' ? 'jpg' : format}`, clean, `image/${format}`);
    } catch {
      throw new ApiError('storage_unavailable');
    }
    await state.db.query(
      'INSERT INTO looks (id, drop_id, position, title, alt_text, width, height, content_type, size_bytes, ext, order_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [lookId, dropId, position, title, altText, cleanMeta.width, cleanMeta.height, `image/${format}`, clean.length, format === 'jpeg' ? 'jpg' : format, orderVersion]
    );
    await state.db.query(
      `INSERT INTO look_orders (drop_id, order_version, saved_by, saved_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (drop_id) DO UPDATE SET order_version = $2, saved_by = $3, saved_at = now()`,
      [dropId, orderVersion, auth.member.id]
    );
    const fresh = await state.db.query('SELECT * FROM looks WHERE id = $1', [lookId]);
    reply.code(201).send({
      look: {
        id: lookId, position, title, altText,
        imageUrl: `/api/drops/${dropId}/looks/${lookId}/image`,
        width: cleanMeta.width, height: cleanMeta.height,
        contentType: `image/${format}`, sizeBytes: clean.length
      },
      orderVersion
    });
  });

  // Look order
  app.put('/api/drops/:dropId/looks/order', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['merchandiser']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const drop = await state.db.query('SELECT id FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const body = req.body as Record<string, unknown>;
    const orderVersion = Number(body.orderVersion);
    if (!Number.isInteger(orderVersion)) throw new ApiError('validation_failed', { fields: { orderVersion: MESSAGES.required } });
    const lookIds = Array.isArray(body.lookIds) ? body.lookIds.map(String) : null;
    if (!lookIds) throw new ApiError('validation_failed', { fields: { lookIds: MESSAGES.required } });
    const existing = await state.db.query('SELECT id FROM looks WHERE drop_id = $1', [dropId]);
    const existingIds = new Set(existing.rows.map((r: { id: string }) => r.id));
    if (lookIds.length !== existingIds.size || lookIds.some(l => !existingIds.has(l))) {
      throw new ApiError('validation_failed', { fields: { lookIds: MESSAGES.required } });
    }
    const order = await state.db.query('SELECT * FROM look_orders WHERE drop_id = $1', [dropId]);
    if (order.rows[0] && orderVersion !== order.rows[0].order_version) {
      const looks = await state.db.query('SELECT * FROM looks WHERE drop_id = $1 ORDER BY position', [dropId]);
      const member = order.rows[0].saved_by ? await state.db.query('SELECT name FROM members WHERE id = $1', [order.rows[0].saved_by]) : null;
      throw new ApiError('stale_version', {
        savedBy: member?.rows[0]?.name ?? 'Someone',
        savedAt: new Date(order.rows[0].saved_at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        current: {
          items: looks.rows.map((l: Record<string, unknown>) => ({ id: l.id, position: l.position, title: l.title, altText: l.alt_text, imageUrl: `/api/drops/${dropId}/looks/${l.id}/image`, width: l.width, height: l.height, contentType: l.content_type, sizeBytes: Number(l.size_bytes) })),
          orderVersion: order.rows[0].order_version,
          savedBy: member?.rows[0]?.name ?? 'Someone',
          savedAt: new Date(order.rows[0].saved_at).toISOString().replace(/\.\d{3}Z$/, 'Z')
        }
      });
    }
    await withTransaction(state.db, async client => {
      let pos = 0;
      for (const lookId of lookIds) {
        pos += 1;
        await client.query('UPDATE looks SET position = $1 WHERE id = $2', [pos, lookId]);
      }
      await client.query(
        `INSERT INTO look_orders (drop_id, order_version, saved_by, saved_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (drop_id) DO UPDATE SET order_version = $2, saved_by = $3, saved_at = now()`,
        [dropId, order.rows[0] ? Number(order.rows[0].order_version) + 1 : 2, auth.member.id]
      );
    });
    const looks = await state.db.query('SELECT * FROM looks WHERE drop_id = $1 ORDER BY position', [dropId]);
    const freshOrder = await state.db.query('SELECT * FROM look_orders WHERE drop_id = $1', [dropId]);
    reply.code(200).send({
      items: looks.rows.map((l: Record<string, unknown>) => ({ id: l.id, position: l.position, title: l.title, altText: l.alt_text, imageUrl: `/api/drops/${dropId}/looks/${l.id}/image`, width: l.width, height: l.height, contentType: l.content_type, sizeBytes: Number(l.size_bytes) })),
      orderVersion: freshOrder.rows[0].order_version,
      savedBy: auth.member.name,
      savedAt: new Date(freshOrder.rows[0].saved_at).toISOString().replace(/\.\d{3}Z$/, 'Z')
    });
  });

  app.get('/api/drops/:dropId/looks/:lookId/image', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireStaffOrBuyer(req);
    const state = req.appState;
    const { dropId, lookId } = req.params as { dropId: string; lookId: string };
    const drop = await state.db.query('SELECT id FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const look = await state.db.query('SELECT * FROM looks WHERE id = $1 AND drop_id = $2', [lookId, dropId]);
    if (!look.rows[0]) throw new ApiError('not_found');
    try {
      const bytes = await state.storage.get(`looks/${dropId}/${lookId}.${look.rows[0].ext}`);
      reply.code(200).header('content-type', look.rows[0].content_type).send(bytes);
    } catch {
      throw new ApiError('storage_unavailable');
    }
  });

  // Line-sheet export
  app.get('/api/drops/:dropId/line-sheet.csv', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['merchandiser', 'finance_lead', 'launch_producer', 'stockist_buyer']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const currency = String((req.query as Record<string, string | undefined>).currency ?? 'DKK');
    const styles = await state.db.query('SELECT * FROM styles WHERE drop_id = $1 ORDER BY position', [dropId]);
    const lists = await loadPriceLists(state.db, auth.workspaceId);
    const today = cphToday();
    let listFrom: string | null = null;
    const rows: (string | number | null)[][] = [
      ['Style number', 'Name', 'Colour', 'Wholesale edition', 'RRP DKK (minor units)', 'Wholesale price (minor units)', 'Currency', 'Price list from']
    ];
    for (const s of styles.rows) {
      const unit = priceInForce(lists, today, s.style_number, currency);
      if (unit !== null && !listFrom) listFrom = today;
      rows.push([
        s.style_number, s.name, s.colour, s.wholesale_edition, Number(s.rrp_dkk_minor),
        unit ?? null, currency, unit !== null ? dateWords(today) : ''
      ]);
    }
    reply.code(200).header('content-type', 'text/csv; charset=utf-8').send(csvDocument(rows));
  });

  // Legacy line-sheet import
  app.post('/api/drops/:dropId/line-sheet/import', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['merchandiser']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    if (!req.isMultipart?.()) throw new ApiError('unsupported_media_type');
    const filePart = await req.file({ limits: { fileSize: SHEET_FILE_LIMIT + SHEET_ENVELOPE, files: 1 } });
    if (!filePart) throw new ApiError('validation_failed', { fields: { file: MESSAGES.required } });
    const buffer = await filePart.toBuffer();
    if (buffer.length > SHEET_FILE_LIMIT) throw new ApiError('too_large');
    const declared = filePart.mimetype ?? '';
    if (!['text/csv', 'text/plain', 'application/csv', 'application/octet-stream', ''].includes(declared)) {
      throw new ApiError('unsupported_media_type');
    }

    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const rawLines = text.split(eol);
    if (rawLines.length === 1) {
      const alt = text.split('\r\n').length > 1 ? text.split('\r\n') : text.split('\n');
      rawLines.length = 0;
      rawLines.push(...alt);
    }
    const header = rawLines[0] ?? '';
    const headerCells = header.split(';').map(c => c.trim().toLowerCase());
    const expected = ['style no', 'name', 'colour', 'edition', 'rrp dkk'];
    const headerOk = expected.every((e, i) => headerCells[i] === e);
    if (!headerOk) {
      throw new ApiError('validation_failed', { fields: { file: 'The header must read Style no;Name;Colour;Edition;RRP DKK.' } });
    }

    const styles = await state.db.query('SELECT * FROM styles WHERE drop_id = $1', [dropId]);
    const styleByNumber = new Map(styles.rows.map((s: Record<string, unknown>) => [String(s.style_number).trim().toLowerCase(), s]));

    const merged: { styleNumber: string; lines: number[] }[] = [];
    const orphans: { line: number; styleNumber: string }[] = [];
    const invalid: { line: number; field: string; message: string }[] = [];
    const updates = new Map<string, { name: string; colour: string; edition: number; rrp: number; line: number }>();

    for (let i = 1; i < rawLines.length; i++) {
      const line = i + 1;
      const raw = rawLines[i];
      if (raw.trim() === '') continue;
      const cells = raw.split(';');
      const styleNumberRaw = (cells[0] ?? '').trim();
      const key = styleNumberRaw.toLowerCase();
      const style = styleByNumber.get(key);
      if (!style) {
        if (styleNumberRaw !== '') orphans.push({ line, styleNumber: styleNumberRaw });
        continue;
      }
      const name = (cells[1] ?? '').trim();
      const colour = (cells[2] ?? '').trim();
      const edition = parseLegacyInteger(cells[3] ?? '');
      if (edition === null) { invalid.push({ line, field: 'Edition', message: MESSAGES.wholeRange(0, 100000) }); continue; }
      const rrp = parseLegacyAmount(cells[4] ?? '');
      if (rrp === null) { invalid.push({ line, field: 'RRP DKK', message: 'Enter an amount like 2.799,00.' }); continue; }
      const existing = updates.get(key);
      if (existing) {
        const entry = merged.find(m => m.styleNumber === String(style.style_number));
        if (entry) entry.lines.push(line);
      } else {
        merged.push({ styleNumber: String(style.style_number), lines: [line] });
      }
      updates.set(key, { name, colour, edition, rrp, line });
    }

    let updated = 0;
    let unchanged = 0;
    const outcomeRows: { line: number; styleNumber: string; outcome: string }[] = [];
    await withTransaction(state.db, async client => {
      for (const [key, u] of updates) {
        const style = styleByNumber.get(key)!;
        const changed = String(style.name) !== u.name || String(style.colour) !== u.colour ||
          Number(style.wholesale_edition) !== u.edition || Number(style.rrp_dkk_minor) !== u.rrp;
        if (changed) {
          await client.query('UPDATE styles SET name = $1, colour = $2, wholesale_edition = $3, rrp_dkk_minor = $4 WHERE id = $5',
            [u.name, u.colour, u.edition, u.rrp, style.id]);
          updated += 1;
          outcomeRows.push({ line: u.line, styleNumber: String(style.style_number), outcome: 'Updated' });
        } else {
          unchanged += 1;
          outcomeRows.push({ line: u.line, styleNumber: String(style.style_number), outcome: 'Unchanged' });
        }
      }
    });
    for (const o of orphans) outcomeRows.push({ line: o.line, styleNumber: o.styleNumber, outcome: 'Orphan' });
    for (const inv of invalid) outcomeRows.push({ line: inv.line, styleNumber: '', outcome: 'Invalid' });
    outcomeRows.sort((a, b) => a.line - b.line);

    const rowsCount = rawLines.slice(1).filter(l => l.trim() !== '').length;
    reply.code(200).send({
      rows: rowsCount,
      matched: updated + unchanged,
      updated,
      unchanged,
      merged,
      orphans,
      invalid,
      report: outcomeRows
    });
  });
}

function requireStaffOrBuyer(req: FastifyRequest): ReturnType<typeof import('./auth.js').requireStaff> {
  return requireStaff(req);
}
