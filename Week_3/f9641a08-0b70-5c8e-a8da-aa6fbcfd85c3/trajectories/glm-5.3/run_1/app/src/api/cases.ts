import { Router } from 'express';
import { h } from './h.js';
import type { Client } from '../db/pool.js';
import { pool, withClient, inTransaction } from '../db/pool.js';
import { CONFIG } from '../config.js';
import { Errors, dateText } from '../domain/errors.js';
import { readSession, requireSignedIn, type SessionInfo } from './session.js';
import { publish } from '../domain/events.js';
import { moveStock, availableFor } from '../domain/ledger.js';
import { sniff, pdfIsSafe, cleanFilename } from '../services/sniff.js';
import { s3 } from '../services/s3.js';
import { sha256Hex } from '../domain/password.js';
import { warrantyYearsFor } from './public.js';

export const caseRouter = Router();

// --- helpers -----------------------------------------------------------------

type OrderLineRow = {
  id: string; order_number: string; sku: string; product: string; colour: string; size: string;
  quantity: number; line_subtotal: number; line_discount: number; line_tax: number; fulfillment: string;
  user_id: string; delivered_at: Date | null; category: string;
};

async function loadOwnLine(client: Client, lineId: number, userId: number): Promise<OrderLineRow> {
  const res = await client.query<OrderLineRow>(`
    SELECT l.id::TEXT AS id, o.number AS order_number, l.sku, l.product, l.colour, l.size, l.quantity,
           l.line_subtotal, l.line_discount, l.line_tax, l.fulfillment, o.user_id::TEXT AS user_id,
           o.delivered_at, p.category
    FROM order_lines l
    JOIN orders o ON o.number = l.order_id
    JOIN variants v ON v.sku = l.sku
    JOIN products p ON p.slug = v.product_slug
    WHERE l.id = $1`, [lineId]);
  if (res.rows.length === 0) throw Errors.notFound();
  if (Number(res.rows[0].user_id) !== userId) throw Errors.notFound();
  return res.rows[0];
}

function openStatuses(kind: 'return' | 'trial' | 'warranty'): string[] {
  if (kind === 'return') return ['requested','approved','in_transit','received','inspected'];
  if (kind === 'trial') return ['requested','approved','returned'];
  return ['submitted','under_review','approved','repair','replacement'];
}

async function nextCaseNumber(client: Client, prefix: 'RT' | 'TR' | 'WC'): Promise<string> {
  const table = prefix === 'RT' ? 'return_cases' : prefix === 'TR' ? 'trial_cases' : 'warranty_claims';
  const res = await client.query<{ n: string }>(
    `SELECT COALESCE(MAX(SUBSTRING(number FROM 4)::INT), 1000) + 1 AS n FROM ${table}`);
  return `${prefix}-${res.rows[0].n}`;
}

async function publishCase(client: Client, kind: 'return' | 'trial' | 'warranty', number: string, status: string, userId: number): Promise<void> {
  await publish(client, kind, { number, status, version: 1 }, { userId, sessionId: null, staffVisible: true });
  await publish(client, 'queue', { kind, number, status }, { userId: null, sessionId: null, staffVisible: true });
}

// --- returns -----------------------------------------------------------------

caseRouter.post('/returns', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const body = req.body as Record<string, unknown>;
  const lineId = Number(body.order_line_id);
  const quantity = Number(body.quantity);
  const reason = typeof body.reason === 'string' ? body.reason : '';
  const outcome = body.outcome === 'refund' || body.outcome === 'exchange' ? body.outcome : '';
  const exchangeSku = typeof body.exchange_sku === 'string' ? body.exchange_sku : null;

  const created = await inTransaction(async (client) => {
    const line = await loadOwnLine(client, lineId, userId);
    const now = new Date();
    const fields: Record<string, string> = {};

    if (line.fulfillment !== 'delivered') throw Errors.notEligible();
    if (line.delivered_at === null) throw Errors.notEligible();
    const endsAt = new Date(line.delivered_at.getTime() + CONFIG.returnWindowDays * 86400000);
    if (now >= endsAt) throw Errors.windowClosedReturns(CONFIG.returnWindowDays, dateText(endsAt));

    // An open case blocks a new one before any quantity check.
    const open = await client.query(`SELECT id FROM return_cases WHERE order_line_id = $1 AND status = ANY($2)`, [lineId, openStatuses('return')]);
    if (open.rows.length > 0) throw Errors.duplicateRequest();

    if (!['Changed my mind','Wrong size','Colour not as expected','Arrived damaged','Other'].includes(reason)) fields.reason = 'Choose a reason.';
    if (outcome === '') fields.outcome = 'Choose a refund or an exchange.';
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) fields.quantity = 'Choose a quantity from 1 to 10.';
    const returnedSoFar = await client.query<{ n: string }>(
      `SELECT COALESCE(SUM(quantity), 0)::TEXT AS n FROM return_cases WHERE order_line_id = $1 AND status <> 'rejected'`, [lineId]);
    const leftToReturn = line.quantity - Number(returnedSoFar.rows[0].n);
    if (quantity > leftToReturn) throw Errors.notEligible();

    // exchange candidate check
    let exchangeSkuValid: string | null = null;
    if (outcome === 'exchange') {
      const candidate = await client.query<{ sku: string; price: number }>(
        `SELECT v.sku, v.price FROM variants v WHERE v.sku = $1 AND v.product_slug = (SELECT product_slug FROM variants WHERE sku = $2)`,
        [exchangeSku, line.sku]);
      if (candidate.rows.length === 0 || candidate.rows[0].sku === line.sku) {
        fields.exchange_sku = 'Choose another colour or size of the same bag at the same price.';
      } else {
        const original = await client.query<{ price: number }>(`SELECT price FROM variants WHERE sku = $1`, [line.sku]);
        if (candidate.rows[0].price !== original.rows[0].price) {
          fields.exchange_sku = 'Choose another colour or size of the same bag at the same price.';
        } else {
          exchangeSkuValid = candidate.rows[0].sku;
        }
      }
    }
    if (Object.keys(fields).length > 0) throw Errors.validationFailed(fields);

    if (outcome === 'exchange' && exchangeSkuValid !== null) {
      const available = await availableFor(client, [exchangeSkuValid]);
      if ((available.get(exchangeSkuValid) ?? 0) <= 0) {
        const err = Errors.outOfStockGone('');
        throw new (err.constructor as new (status: number, code: string, message: string) => typeof err)(409, 'out_of_stock', `Sorry, that variant is sold out.`);
      }
    }

    const number = await nextCaseNumber(client, 'RT');
    await client.query(
      `INSERT INTO return_cases (number, order_line_id, user_id, status, quantity, reason, outcome, exchange_sku)
       VALUES ($1,$2,$3,'requested',$4,$5,$6,$7)`,
      [number, lineId, userId, quantity, reason, outcome, exchangeSkuValid]);
    await client.query(`INSERT INTO case_history (case_type, case_id, status) VALUES ('return', (SELECT id FROM return_cases WHERE number = $1), 'requested')`, [number]);
    await publishCase(client, 'return', number, 'requested', userId);
    return number;
  });
  res.status(201).json(await returnBody(created, userId));
}));

export async function returnBody(number: string, userId: number): Promise<Record<string, unknown>> {
  return withClient(async (client) => {
    const row = await client.query<{ id: string; number: string; status: string; version: number; order_line_id: string; quantity: number; reason: string; outcome: string; exchange_sku: string | null; exchange_order_number: string | null; rejection_reason: string | null; refund_amount: number | null; user_id: string }>(
      `SELECT id::TEXT AS id, number, status, version, order_line_id::TEXT AS order_line_id, quantity, reason, outcome, exchange_sku, exchange_order_number, rejection_reason, refund_amount, user_id::TEXT AS user_id FROM return_cases WHERE number = $1`, [number]);
    if (row.rows.length === 0 || Number(row.rows[0].user_id) !== userId) throw Errors.notFound();
    const c = row.rows[0];
    const history = await client.query<{ status: string; at: Date }>(
      `SELECT status, at FROM case_history WHERE case_type = 'return' AND case_id = $1 ORDER BY at, id`, [Number(c.id)]);
    return {
      number: c.number, status: c.status, version: c.version,
      order_number: (await client.query<{ order_number: string }>(`SELECT o.number AS order_number FROM order_lines l JOIN orders o ON o.number = l.order_id WHERE l.id = $1`, [Number(c.order_line_id)])).rows[0].order_number,
      order_line_id: Number(c.order_line_id),
      history: history.rows.map((h) => ({ status: h.status, at: h.at.toISOString() })),
      quantity: c.quantity, reason: c.reason, outcome: c.outcome,
      exchange_sku: c.exchange_sku, exchange_order_number: c.exchange_order_number,
      refund_amount: c.refund_amount, rejection_reason: c.rejection_reason,
    };
  });
}

caseRouter.get('/returns', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const rows = await pool.query<{ number: string }>(
    `SELECT number FROM return_cases WHERE user_id = $1 ORDER BY created_at DESC, number DESC`, [userId]);
  const list = [];
  for (const row of rows.rows) list.push(await returnBody(row.number, userId));
  res.status(200).json(list);
}));

caseRouter.get('/returns/:number', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  res.status(200).json(await returnBody(req.params.number, userId));
}));

// --- trials -------------------------------------------------------------------

caseRouter.post('/trials', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const body = req.body as Record<string, unknown>;
  const lineId = Number(body.order_line_id);
  const note = typeof body.note === 'string' ? body.note : '';

  const created = await inTransaction(async (client) => {
    const line = await loadOwnLine(client, lineId, userId);
    if (line.fulfillment !== 'delivered') throw Errors.notEligible();
    if (line.delivered_at === null) throw Errors.notEligible();
    if (!['luggage','backpacks','totes'].includes(line.category)) throw Errors.notEligible();
    const now = new Date();
    const endsAt = new Date(line.delivered_at.getTime() + CONFIG.trialWindowDays * 86400000);
    if (now >= endsAt) throw Errors.windowClosedTrials(CONFIG.trialWindowDays, dateText(endsAt));
    if (note.length > 500) throw Errors.validationFailed({ note: 'Keep the note to 500 characters or fewer.' });

    const open = await client.query(`SELECT id FROM trial_cases WHERE order_line_id = $1 AND status = ANY($2)`, [lineId, openStatuses('trial')]);
    if (open.rows.length > 0) throw Errors.duplicateRequest();

    const number = await nextCaseNumber(client, 'TR');
    await client.query(
      `INSERT INTO trial_cases (number, order_line_id, user_id, status, note) VALUES ($1,$2,$3,'requested',$4)`,
      [number, lineId, userId, note === '' ? null : note]);
    await client.query(`INSERT INTO case_history (case_type, case_id, status) VALUES ('trial', (SELECT id FROM trial_cases WHERE number = $1), 'requested')`, [number]);
    await publishCase(client, 'trial', number, 'requested', userId);
    return number;
  });
  res.status(201).json(await trialBody(created, userId));
}));

export async function trialBody(number: string, userId: number): Promise<Record<string, unknown>> {
  return withClient(async (client) => {
    const row = await client.query<{ id: string; number: string; status: string; version: number; order_line_id: string; note: string | null; rejection_reason: string | null; refund_amount: number | null; user_id: string }>(
      `SELECT id::TEXT AS id, number, status, version, order_line_id::TEXT AS order_line_id, note, rejection_reason, refund_amount, user_id::TEXT AS user_id FROM trial_cases WHERE number = $1`, [number]);
    if (row.rows.length === 0 || Number(row.rows[0].user_id) !== userId) throw Errors.notFound();
    const c = row.rows[0];
    const history = await client.query<{ status: string; at: Date }>(
      `SELECT status, at FROM case_history WHERE case_type = 'trial' AND case_id = $1 ORDER BY at, id`, [Number(c.id)]);
    return {
      number: c.number, status: c.status, version: c.version,
      order_number: (await client.query<{ order_number: string }>(`SELECT o.number AS order_number FROM order_lines l JOIN orders o ON o.number = l.order_id WHERE l.id = $1`, [Number(c.order_line_id)])).rows[0].order_number,
      order_line_id: Number(c.order_line_id),
      history: history.rows.map((h) => ({ status: h.status, at: h.at.toISOString() })),
      note: c.note, refund_amount: c.refund_amount, rejection_reason: c.rejection_reason,
    };
  });
}

caseRouter.get('/trials', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const rows = await pool.query<{ number: string }>(
    `SELECT number FROM trial_cases WHERE user_id = $1 ORDER BY created_at DESC, number DESC`, [userId]);
  const list = [];
  for (const row of rows.rows) list.push(await trialBody(row.number, userId));
  res.status(200).json(list);
}));

caseRouter.get('/trials/:number', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  res.status(200).json(await trialBody(req.params.number, userId));
}));

// --- warranty registrations ---------------------------------------------------

caseRouter.post('/warranty/registrations', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const lineId = Number((req.body as { order_line_id?: unknown }).order_line_id);
  const result = await inTransaction(async (client) => {
    const line = await loadOwnLine(client, lineId, userId);
    if (line.fulfillment !== 'delivered' || line.delivered_at === null) throw Errors.notEligible();
    const years = warrantyYearsFor(line.category);
    const coveredUntil = new Date(line.delivered_at);
    coveredUntil.setFullYear(coveredUntil.getFullYear() + years);
    const now = new Date();
    if (now >= coveredUntil) throw Errors.warrantyExpired(dateText(coveredUntil));
    const existing = await client.query<{ id: string; covered_until: Date }>(
      `SELECT id::TEXT AS id, covered_until FROM warranty_registrations WHERE order_line_id = $1`, [lineId]);
    if (existing.rows.length > 0) {
      return { id: Number(existing.rows[0].id), order_line_id: lineId, covered_until: existing.rows[0].covered_until.toISOString(), existing: true };
    }
    const insert = await client.query<{ id: string; covered_until: Date }>(
      `INSERT INTO warranty_registrations (order_line_id, user_id, covered_until) VALUES ($1,$2,$3) RETURNING id::TEXT AS id, covered_until`,
      [lineId, userId, coveredUntil]);
    return { id: Number(insert.rows[0].id), order_line_id: lineId, covered_until: insert.rows[0].covered_until.toISOString(), existing: false };
  });
  res.status(result.existing ? 200 : 201).json({ id: result.id, order_line_id: result.order_line_id, covered_until: result.covered_until });
}));

// --- evidence -----------------------------------------------------------------

caseRouter.post('/warranty/evidence', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const file = (req as unknown as { file?: { buffer: Buffer; originalname: string } }).file;
  const kind = String((req.body as { kind?: unknown }).kind ?? '');
  if (kind !== 'photo' && kind !== 'receipt') throw Errors.validationFailed({ kind: 'Choose photo or receipt.' });
  if (file === undefined) throw Errors.validationFailed({ file: 'Choose a file to upload.' });
  const sniffed = sniff(file.buffer);
  if (sniffed.type === null || (kind === 'photo' && sniffed.type === 'pdf') || (kind === 'receipt' && sniffed.type !== 'pdf')) {
    throw Errors.unsupportedFileEvidence();
  }
  if (sniffed.type === 'pdf' && !pdfIsSafe(file.buffer)) throw Errors.unsupportedFileEvidence();
  const filename = cleanFilename(file.originalname);
  const sha = sha256Hex(file.buffer);

  const stored = await s3.put(`evidence/${userId}/tmp`, file.buffer, sniffed.content_type!);
  let evidenceId: number;
  if (stored) {
    const insert = await pool.query<{ id: string }>(
      `INSERT INTO evidence (user_id, kind, filename, content_type, bytes, sha256, status) VALUES ($1,$2,$3,$4,$5,$6,'stored') RETURNING id::TEXT AS id`,
      [userId, kind, filename, sniffed.content_type!, file.buffer.length, sha]);
    evidenceId = Number(insert.rows[0].id);
    const key = `evidence/${userId}/${evidenceId}`;
    const confirmed = await s3.put(key, file.buffer, sniffed.content_type!);
    if (!confirmed) {
      await pool.query(`DELETE FROM evidence WHERE id = $1`, [evidenceId]);
      throw Errors.storageUnavailableEvidence();
    }
  } else {
    throw Errors.storageUnavailableEvidence();
  }
  const row = await pool.query<{ stored_at: Date }>(`SELECT stored_at FROM evidence WHERE id = $1`, [evidenceId]);
  res.status(201).json({
    id: evidenceId, kind, filename, content_type: sniffed.content_type, bytes: file.buffer.length,
    sha256: sha, status: 'stored', stored_at: row.rows[0].stored_at.toISOString(),
  });
}));

caseRouter.get('/warranty/evidence/:id/content', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const id = Number(req.params.id);
  const row = await pool.query<{ user_id: string; kind: string; content_type: string; filename: string }>(
    `SELECT user_id::TEXT AS user_id, kind, content_type, filename FROM evidence WHERE id = $1`, [id]);
  if (row.rows.length === 0 || Number(row.rows[0].user_id) !== userId) throw Errors.notFound();
  const content = await s3.get(`evidence/${userId}/${id}`);
  if (content === null) throw Errors.notFound();
  res.setHeader('content-type', row.rows[0].content_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (row.rows[0].kind === 'receipt') res.setHeader('Content-Disposition', `attachment; filename="${row.rows[0].filename}"`);
  res.status(200).send(content);
}));

// --- claims ---------------------------------------------------------------------

caseRouter.post('/warranty/claims', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const body = req.body as Record<string, unknown>;
  const registrationId = Number(body.registration_id);
  const component = typeof body.component === 'string' ? body.component : '';
  const description = typeof body.description === 'string' ? body.description : '';
  const evidenceIds = Array.isArray(body.evidence_ids) ? body.evidence_ids.map((e) => Number(e)) : [];

  const created = await inTransaction(async (client) => {
    const reg = await client.query<{ id: string; order_line_id: string; user_id: string; covered_until: Date }>(
      `SELECT id::TEXT AS id, order_line_id::TEXT AS order_line_id, user_id::TEXT AS user_id, covered_until FROM warranty_registrations WHERE id = $1`, [registrationId]);
    if (reg.rows.length === 0 || Number(reg.rows[0].user_id) !== userId) throw Errors.notFound();
    const now = new Date();
    if (now >= reg.rows[0].covered_until) throw Errors.warrantyExpired(dateText(reg.rows[0].covered_until));

    const fields: Record<string, string> = {};
    if (!['Wheels','Handle','Shell','Zipper','Lock'].includes(component)) fields.component = 'Choose the part that failed.';
    if (description.length < 20 || description.length > 1000) fields.description = 'Describe the fault in 20 to 1,000 characters.';
    const photos = evidenceIds.length;
    if (photos < 1 || photos > 6) fields.evidence_ids = 'Add 1 to 5 photos and at most one receipt.';
    if (Object.keys(fields).length > 0) throw Errors.validationFailed(fields);

    const evidenceRows = await client.query<{ id: string; user_id: string; kind: string; claim_id: string | null }>(
      `SELECT e.id::TEXT AS id, e.user_id::TEXT AS user_id, e.kind, ce.claim_id::TEXT AS claim_id
       FROM evidence e LEFT JOIN claim_evidence ce ON ce.evidence_id = e.id WHERE e.id = ANY($1)`, [evidenceIds]);
    if (evidenceRows.rows.length !== evidenceIds.length) throw Errors.notFound();
    for (const row of evidenceRows.rows) {
      if (Number(row.user_id) !== userId) throw Errors.notFound();
      if (row.claim_id !== null) throw Errors.notFound();
    }
    const receipts = evidenceRows.rows.filter((r) => r.kind === 'receipt').length;
    if (receipts > 1) throw Errors.validationFailed({ evidence_ids: 'Add 1 to 5 photos and at most one receipt.' });

    const line = await client.query<{ sku: string }>(`SELECT sku FROM order_lines WHERE id = $1`, [Number(reg.rows[0].order_line_id)]);
    const open = await client.query(
      `SELECT id FROM warranty_claims WHERE registration_id = $1 AND component = $2 AND status = ANY($3)`,
      [registrationId, component, openStatuses('warranty')]);
    if (open.rows.length > 0) throw Errors.duplicateRequest();

    const number = await nextCaseNumber(client, 'WC');
    const insert = await client.query<{ id: string }>(
      `INSERT INTO warranty_claims (number, registration_id, user_id, status, component, description) VALUES ($1,$2,$3,'submitted',$4,$5) RETURNING id::TEXT AS id`,
      [number, registrationId, userId, component, description]);
    for (const id of evidenceIds) {
      await client.query(`INSERT INTO claim_evidence (claim_id, evidence_id) VALUES ($1,$2)`, [Number(insert.rows[0].id), id]);
    }
    await client.query(`INSERT INTO case_history (case_type, case_id, status) VALUES ('warranty', $1, 'submitted')`, [Number(insert.rows[0].id)]);
    await publishCase(client, 'warranty', number, 'submitted', userId);
    return number;
  });
  res.status(201).json(await claimBody(created, userId));
}));

export async function claimBody(number: string, userId: number): Promise<Record<string, unknown>> {
  return withClient(async (client) => {
    const row = await client.query<{ id: string; number: string; status: string; version: number; registration_id: string; component: string; description: string; resolution_order_number: string | null; rejection_reason: string | null; user_id: string }>(
      `SELECT id::TEXT AS id, number, status, version, registration_id::TEXT AS registration_id, component, description, resolution_order_number, rejection_reason, user_id::TEXT AS user_id FROM warranty_claims WHERE number = $1`, [number]);
    if (row.rows.length === 0 || Number(row.rows[0].user_id) !== userId) throw Errors.notFound();
    const c = row.rows[0];
    const history = await client.query<{ status: string; at: Date }>(
      `SELECT status, at FROM case_history WHERE case_type = 'warranty' AND case_id = $1 ORDER BY at, id`, [Number(c.id)]);
    const evidence = await client.query<{ id: string; kind: string; filename: string; status: string }>(
      `SELECT e.id::TEXT AS id, e.kind, e.filename, e.status FROM evidence e JOIN claim_evidence ce ON ce.evidence_id = e.id WHERE ce.claim_id = $1 ORDER BY e.id`, [Number(c.id)]);
    const line = await client.query<{ order_number: string; line_id: string }>(
      `SELECT o.number AS order_number, l.id::TEXT AS line_id
       FROM warranty_registrations r JOIN order_lines l ON l.id = r.order_line_id JOIN orders o ON o.number = l.order_id WHERE r.id = $1`, [Number(c.registration_id)]);
    return {
      number: c.number, status: c.status, version: c.version,
      order_number: line.rows[0].order_number,
      order_line_id: Number(line.rows[0].line_id),
      history: history.rows.map((h) => ({ status: h.status, at: h.at.toISOString() })),
      component: c.component, description: c.description,
      resolution_order_number: c.resolution_order_number, rejection_reason: c.rejection_reason,
      evidence: evidence.rows.map((e) => ({ id: Number(e.id), kind: e.kind, filename: e.filename, status: e.status })),
    };
  });
}

caseRouter.get('/warranty/claims', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  const rows = await pool.query<{ number: string }>(
    `SELECT number FROM warranty_claims WHERE user_id = $1 ORDER BY created_at DESC, number DESC`, [userId]);
  const list = [];
  for (const row of rows.rows) list.push(await claimBody(row.number, userId));
  res.status(200).json(list);
}));

caseRouter.get('/warranty/claims/:number', h(async (req, res) => {
  const session = await readSession(req, res);
  const userId = requireSignedIn(session);
  res.status(200).json(await claimBody(req.params.number, userId));
}));
