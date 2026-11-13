// Bringing consignors and pieces over from the previous tool (DP-43 to DP-45).

import crypto from 'node:crypto';
import type { Route, RouteContext } from '../http.js';
import { sendJson } from '../http.js';
import { ApiError } from '../errors.js';
import { CATEGORIES, SIZES, CONDITIONS } from '../../shared/vocab.js';
import { brusselsDateOf, daysBetween, brusselsMidnight } from '../../shared/time.js';
import { isValidIban, normaliseIban } from '../../shared/iban.js';
import { tagCodeFromSequence } from '../../shared/tagcode.js';
import { ladderInForceOn } from '../rows.js';

const HEADER = 'item_no,consignor_name,consignor_email,consignor_phone,consignor_iban,category,brand,description,size,condition,asking_price,intake_date';

interface ParsedRow {
  row: number;
  itemNo: string;
  consignorName: string;
  consignorEmail: string;
  consignorPhone: string;
  consignorIban: string;
  category: string;
  brand: string;
  description: string;
  size: string;
  condition: string;
  askingPrice: string;
  intakeDate: string;
}

interface MatchedConsignor { id: string; name: string; email: string | null; phone: string | null; iban: string | null; isNew: boolean }

export const importRoutes: Route[] = [
  {
    method: 'POST', pattern: '/api/imports/preview', bodyLimit: 2000000, auth: 'owner',
    handle: async (ctx) => {
      const parsed = await parseFile(ctx);
      const plan = await planImport(ctx, parsed.rows);
      sendJson(ctx.res, 200, {
        rows: plan.rows,
        counts: plan.counts,
      });
    },
  },
  {
    method: 'POST', pattern: '/api/imports', bodyLimit: 2000000, auth: 'owner',
    handle: async (ctx) => {
      const parsed = await parseFile(ctx);
      const plan = await planImport(ctx, parsed.rows);
      const savable = plan.rows.filter((r) => r.status === 'matched' || r.status === 'new');
      let piecesCreated = 0;
      const consignorsCreated = plan.rows.filter((r) => r.status === 'new').length;
      for (const row of savable) {
        if (row.status === 'new') {
          const id = crypto.randomUUID();
          await ctx.services.pool.query(
            `INSERT INTO consignors (id, name, email, phone, iban, status, created_at)
             VALUES ($1, $2, $3, $4, $5, 'active', $6)`,
            [id, row.consignorName, row.consignorEmail || null, row.consignorPhone || null,
             row.consignorIban ? normaliseIban(row.consignorIban) : null, new Date()]
          );
        }
        await savePiece(ctx, row);
        piecesCreated++;
      }
      sendJson(ctx.res, 200, {
        counts: plan.counts,
        piecesCreated,
        consignorsCreated,
      });
    },
  },
];

async function parseFile(ctx: RouteContext): Promise<{ rows: ParsedRow[] }> {
  const contentType = (ctx.req.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith('text/csv')) {
    throw new ApiError(415, 'unsupported_media_type', 'Send the spreadsheet as text/csv.');
  }
  const raw = ctx.body!;
  if (raw.length === 0) {
    throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { file: 'Choose a spreadsheet file.' });
  }
  let text = raw.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r\n|\n/);
  const header = lines.shift() ?? '';
  if (header.trim() !== HEADER) {
    throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { file: 'The header must be exactly the expected columns.' });
  }
  const rows: ParsedRow[] = [];
  lines.forEach((line, i) => {
    if (line.length === 0) return;
    const fields = splitCsvLine(line);
    rows.push({
      row: i + 2,
      itemNo: fields[0] ?? '',
      consignorName: fields[1] ?? '',
      consignorEmail: fields[2] ?? '',
      consignorPhone: fields[3] ?? '',
      consignorIban: fields[4] ?? '',
      category: fields[5] ?? '',
      brand: fields[6] ?? '',
      description: fields[7] ?? '',
      size: fields[8] ?? '',
      condition: fields[9] ?? '',
      askingPrice: fields[10] ?? '',
      intakeDate: fields[11] ?? '',
      ...(fields.length !== 12 ? { fieldCount: fields.length } : {}),
    });
  });
  return { rows };
}

/** RFC 4180-style splitting: quoted fields may hold commas and doubled quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

interface PlannedRow extends ParsedRow {
  status: 'matched' | 'new' | 'refused' | 'already';
  consignorId?: string;
  reason?: string;
  fieldCount?: number;
}

/** Matching and refusal rules, in file order, for the preview and Save alike (DP-44). */
async function planImport(ctx: RouteContext, rows: ParsedRow[]): Promise<{ rows: PlannedRow[]; counts: { matched: number; new: number; refused: number; already: number } }> {
  const planned: PlannedRow[] = [];
  const seenItemNos = new Set<string>();
  const createdByName = new Map<string, string>(); // normalised name -> consignor id, for rows of this file
  const createdByEmail = new Set<string>();

  for (const r of rows) {
    const p: PlannedRow = { ...r, status: 'refused' };

    // Refusals, in the published order.
    if (!p.itemNo || p.itemNo.trim().length === 0) { p.reason = 'Missing item number.'; planned.push(p); continue; }
    if (seenItemNos.has(p.itemNo)) { p.reason = 'Item number appears twice in this file.'; planned.push(p); continue; }
    seenItemNos.add(p.itemNo);
    if (p.fieldCount !== undefined) { p.reason = `This row has ${p.fieldCount} fields; the header has 12.`; planned.push(p); continue; }
    if (!p.consignorName || p.consignorName.trim().length === 0) { p.reason = 'Missing consignor name.'; planned.push(p); continue; }
    if (p.consignorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.consignorEmail)) { p.reason = 'Email address isn\u2019t valid.'; planned.push(p); continue; }
    if (p.consignorIban && !isValidIban(p.consignorIban)) { p.reason = 'IBAN doesn\u2019t pass its check.'; planned.push(p); continue; }

    // Already brought over?
    const existing = await ctx.services.pool.query<{ id: string }>(
      'SELECT id FROM pieces WHERE import_item_no = $1', [p.itemNo]
    );
    if (existing.rows.length > 0) { p.status = 'already'; planned.push(p); continue; }

    // Matching: email first, then normalised name, else create (DP-44).
    let consignor: MatchedConsignor | null = null;
    if (p.consignorEmail) {
      const byEmail = await ctx.services.pool.query(
        "SELECT id, name, email, phone, iban FROM consignors WHERE lower(email) = lower($1) AND status <> 'erased'", [p.consignorEmail]
      );
      consignor = byEmail.rows[0] ?? null;
    }
    if (!consignor) {
      const norm = normaliseName(p.consignorName);
      const byName = await ctx.services.pool.query(
        "SELECT id, name, email, phone, iban FROM consignors WHERE status <> 'erased'"
      );
      const matches = byName.rows.filter((r) => normaliseName(r.name) === norm);
      if (matches.length === 1) consignor = matches[0];
      else if (matches.length > 1) { p.reason = 'More than one consignor has this name.'; planned.push(p); continue; }
    }
    if (consignor) {
      p.status = 'matched';
      p.consignorId = consignor.id;
      planned.push(p);
      continue;
    }
    // Validation of the piece fields for a new consignor row.
    if (!CATEGORIES.some((c) => c.value === p.category.toLowerCase())) { p.reason = 'Unknown category.'; planned.push(p); continue; }
    if (!p.brand || p.brand.trim().length === 0 || p.brand.length > 60) { p.reason = 'Missing brand.'; planned.push(p); continue; }
    if (!p.description || p.description.trim().length === 0 || p.description.length > 120) { p.reason = 'Missing description.'; planned.push(p); continue; }
    if (!SIZES.some((s) => s.value === p.size.toLowerCase())) { p.reason = 'Unknown size.'; planned.push(p); continue; }
    if (!CONDITIONS.some((c) => c.value === normaliseCondition(p.condition))) { p.reason = 'Unknown condition.'; planned.push(p); continue; }
    const cents = priceCentsOf(p.askingPrice);
    if (cents === null || cents < 100 || cents > 1000000) { p.reason = 'Asking price must be between \u20AC1.00 and \u20AC10,000.00.'; planned.push(p); continue; }
    const today = brusselsDateOf(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.intakeDate) || daysBetween(today, p.intakeDate) > 730 || daysBetween(today, p.intakeDate) < 0) {
      p.reason = 'Intake date must be today or up to 730 days back.';
      planned.push(p);
      continue;
    }
    p.status = 'new';
    planned.push(p);
    createdByName.set(normaliseName(p.consignorName), p.itemNo);
    if (p.consignorEmail) createdByEmail.add(p.consignorEmail.toLowerCase());
  }

  // A consignor created by an earlier row counts as existing for later rows.
  const createdIds = new Map<string, string>();
  for (const p of planned) {
    if (p.status !== 'new') continue;
    const id = crypto.randomUUID();
    createdIds.set(normaliseName(p.consignorName), id);
  }

  const counts = {
    matched: planned.filter((p) => p.status === 'matched').length,
    new: planned.filter((p) => p.status === 'new').length,
    refused: planned.filter((p) => p.status === 'refused').length,
    already: planned.filter((p) => p.status === 'already').length,
  };
  return { rows: planned, counts };
}

function normaliseName(name: string): string {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normaliseCondition(label: string): string {
  const found = CONDITIONS.find((c) => c.label.toLowerCase() === label.trim().toLowerCase());
  return found?.value ?? label.trim().toLowerCase();
}

function priceCentsOf(text: string): number | null {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text.trim())) return null;
  const [w, f = ''] = text.trim().split('.');
  return Number(w) * 100 + Number((f + '00').slice(0, 2));
}

async function savePiece(ctx: RouteContext, row: PlannedRow): Promise<void> {
  const today = brusselsDateOf(new Date());
  void today;
  const consignorId = row.consignorId ?? (await ctx.services.pool.query<{ id: string }>(
    "SELECT id FROM consignors WHERE status <> 'erased' AND lower(email) = lower($1)", [row.consignorEmail]
  )).rows[0]?.id;
  if (!consignorId) return;
  const ladder = await ladderInForceOn(ctx.services.pool, row.intakeDate);
  const { rows: maxTag } = await ctx.services.pool.query<{ max: string | null }>(
    "SELECT MAX(tag_digits) AS max FROM pieces WHERE tag_digits ~ '^[0-9]{8}$'"
  );
  const highest = maxTag[0]?.max ? Number(maxTag[0].max.slice(0, 7)) : 999999;
  const next = tagCodeFromSequence(Math.max(highest, 999999) + 1).replace(/\D/g, '');
  const id = crypto.randomUUID();
  await ctx.services.pool.query(
    `INSERT INTO pieces (id, tag_digits, consignor_id, category, brand, description, size, condition,
       asking_price_cents, intake_date, ladder_id, status, import_item_no, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'on_rail', $12, $13)`,
    [id, next, consignorId, row.category.toLowerCase(), row.brand.trim(), row.description.trim(),
     row.size.toLowerCase(), normaliseCondition(row.condition), priceCentsOf(row.askingPrice)!, row.intakeDate,
     ladder!.id, row.itemNo, new Date()]
  );
  await ctx.services.pool.query(
    'INSERT INTO price_history (piece_id, asking_price_cents, effective_from) VALUES ($1, $2, $3)',
    [id, priceCentsOf(row.askingPrice)!, brusselsMidnight(row.intakeDate)]
  );
}

