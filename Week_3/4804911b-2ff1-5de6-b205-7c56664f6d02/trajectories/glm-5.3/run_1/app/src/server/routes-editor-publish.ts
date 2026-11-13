import type { IncomingMessage, ServerResponse } from 'node:http';
import type { App } from './main.js';
import { sendJson, readJson, BodyLimitError } from './api/http.js';
import { runPublishChecks, checkCorrectionDateMove, type CheckContext } from './domain/checks.js';
import { isoToDay, type IsoDate } from '../shared/domain.js';
import { parseRows, loadCheckContext, loadSkuNames, previewBody, versionBodyFull } from './routes-editor-notices.js';

const MAX_JSON_BYTES = 1000000;

/**
 * Publishing: the notice state machine and the publish checks, in the published
 * order. Several simultaneous publishes of one draft give exactly one 200.
 */
export async function apiPublish(app: App, req: IncomingMessage, res: ServerResponse, draftId: string): Promise<void> {
  let body: { baseRevision?: unknown };
  try {
    body = (await readJson(req, MAX_JSON_BYTES)) as typeof body;
  } catch (e) {
    if (e instanceof BodyLimitError) return sendJson(res, 413, { error: 'body_too_large', message: 'That request is too large.' });
    return sendJson(res, 400, { error: 'bad_json', message: "That request isn't valid JSON." });
  }
  if (typeof body.baseRevision !== 'number' || !Number.isInteger(body.baseRevision)) {
    return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { baseRevision: 'Send the revision you saved.' } });
  }
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const d = await client.query<{ id: string; revision: number; title: string; effective_date: IsoDate; run_out_until: IsoDate | null; sheet_id: string | null }>(
      'SELECT id, revision, title, effective_date::text, run_out_until::text, sheet_id FROM drafts WHERE id = $1 FOR UPDATE',
      [draftId]
    );
    if (d.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
    }
    if (d.rows[0].revision !== body.baseRevision) {
      await client.query('ROLLBACK');
      return sendJson(res, 409, { error: 'stale_draft', message: 'This draft changed in another tab. Reload to see it.' });
    }
    const rows = await client.query<{ sku_code: string; kind: string; revised_mrp_paise: number; old_rate: number | null; new_rate: number | null }>(
      'SELECT sku_code, kind, revised_mrp_paise, old_rate, new_rate FROM draft_rows WHERE draft_id = $1 ORDER BY row_index',
      [draftId]
    );
    const rowInputs = rows.rows.map((r) => ({
      skuCode: r.sku_code,
      kind: r.kind as 'sticker' | 'new_print',
      revisedMrpPaise: r.revised_mrp_paise,
      oldRate: r.old_rate,
      newRate: r.new_rate,
    }));
    const ctx = await loadCheckContext(app);
    const blocking = runPublishChecks(rowInputs, d.rows[0].effective_date, d.rows[0].run_out_until, ctx);
    if (blocking) {
      await client.query('ROLLBACK');
      return sendJson(res, blocking.status, blocking.body);
    }
    // Assign the number VT-<year>-<sequence> in Asia/Kolkata. The year's counter
    // is guarded by an advisory lock so simultaneous publishes number in order.
    const year = app.clock.year();
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`notice-seq-${year}`]);
    const seqRow = await client.query<{ max: number }>('SELECT max(sequence_in_year) AS max FROM notices WHERE publish_year = $1', [year]);
    const seq = (seqRow.rows[0].max ?? 0) + 1;
    const number = `VT-${year}-${String(seq).padStart(2, '0')}`;
    await client.query('INSERT INTO notices (number, publish_year, sequence_in_year) VALUES ($1, $2, $3)', [number, year, seq]);
    await client.query(
      "INSERT INTO notice_versions (number, version, title, effective_date, run_out_until, published_at, reason, print_state, sheet_id) VALUES ($1, 1, $2, $3, $4, now(), NULL, 'pending', $5)",
      [number, d.rows[0].title, d.rows[0].effective_date, d.rows[0].run_out_until, d.rows[0].sheet_id]
    );
    const skuNames = await loadSkuNames(app);
    for (let i = 0; i < rows.rows.length; i++) {
      const r = rows.rows[i];
      await client.query(
        'INSERT INTO notice_rows (number, version, row_index, sku_code, name, kind, old_mrp_paise, revised_mrp_paise, old_rate, new_rate) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [number, i, r.sku_code, skuNames.get(r.sku_code) ?? r.sku_code, r.kind, oldMrp(r.sku_code, d.rows[0].effective_date, ctx), r.revised_mrp_paise, r.old_rate, r.new_rate]
      );
    }
    // One delivery per live endpoint at publish time, in the same transaction.
    const eps = await client.query<{ id: string; account_id: string }>(
      "SELECT id, account_id FROM endpoints WHERE removed = false"
    );
    for (const ep of eps.rows) {
      const eventId = `${number}-v1-${ep.id}`;
      await client.query(
        "INSERT INTO deliveries (event_id, account_id, endpoint_id, notice_number, notice_version, event_type, state) VALUES ($1, $2, $3, $4, 1, 'notice.published', 'pending') ON CONFLICT (event_id) DO NOTHING",
        [eventId, ep.account_id, ep.id, number]
      );
      await client.query('INSERT INTO outbox (kind, payload) VALUES ($1, $2)', ['send', JSON.stringify({ jobId: eventId, kind: 'send', eventId })]);
    }
    await client.query("INSERT INTO outbox (kind, payload) VALUES ($1, $2)", ['render', JSON.stringify({ jobId: `render-${number}-v1`, kind: 'render', number, version: 1 })]);
    // Index work for each SKU in the notice.
    const seenSkus = new Set(rowInputs.map((r) => r.skuCode));
    for (const sku of seenSkus) {
      await client.query('INSERT INTO outbox (kind, payload) VALUES ($1, $2)', ['index', JSON.stringify({ jobId: `index-${sku}`, kind: 'index', skuCode: sku })]);
    }
    await client.query('DELETE FROM drafts WHERE id = $1', [draftId]);
    await client.query('DELETE FROM draft_rows WHERE draft_id = $1', [draftId]);
    await client.query('COMMIT');
    const published = await versionBodyFull(app, number, 1);
    sendJson(res, 200, { number, version: published });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

function oldMrp(skuCode: string, effectiveDate: IsoDate, ctx: CheckContext): number {
  const dayBefore = isoToDay(effectiveDate)! - 1;
  let best: { eff: number; mrp: number } | null = null;
  for (const p of ctx.publishedRows) {
    if (p.skuCode !== skuCode || !p.isLatestVersion) continue;
    const ed = isoToDay(p.effectiveDate)!;
    if (ed <= dayBefore) {
      if (!best || ed > best.eff) best = { eff: ed, mrp: p.revisedMrpPaise };
    }
  }
  if (best) return best.mrp;
  return ctx.skus.get(skuCode)?.launchMrpPaise ?? 0;
}

export async function apiPreview(app: App, req: IncomingMessage, res: ServerResponse, draftId: string): Promise<void> {
  let body: { title?: unknown; effectiveDate?: unknown; runOutUntil?: unknown; rows?: unknown; baseRevision?: unknown };
  try {
    body = (await readJson(req, MAX_JSON_BYTES)) as typeof body;
  } catch (e) {
    if (e instanceof BodyLimitError) return sendJson(res, 413, { error: 'body_too_large', message: 'That request is too large.' });
    return sendJson(res, 400, { error: 'bad_json', message: "That request isn't valid JSON." });
  }
  const d = await app.pool.query('SELECT id FROM drafts WHERE id = $1', [draftId]);
  if (d.rows.length === 0) return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const eff = typeof body.effectiveDate === 'string' ? body.effectiveDate : '';
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(eff) || isoToDay(eff) === null) {
    const fields: Record<string, string> = {};
    if (!title) fields.title = 'The title is 1 to 120 characters.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eff)) fields.effectiveDate = 'The date reads YYYY-MM-DD.';
    return sendJson(res, 200, { blocking: { error: 'validation', message: 'Some fields need attention.', fields }, rows: [] });
  }
  const runOut = typeof body.runOutUntil === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.runOutUntil) ? body.runOutUntil : null;
  const { rows, fields } = parseRows(body.rows);
  if (!rows) {
    return sendJson(res, 200, { blocking: { error: 'validation', message: 'Some fields need attention.', fields }, rows: [] });
  }
  sendJson(res, 200, await previewBody(app, rows, eff, runOut));
}

export async function apiCorrection(app: App, req: IncomingMessage, res: ServerResponse, number: string): Promise<void> {
  return apiCorrectionInner(app, req, res, number, false);
}

export async function apiCorrectionPreview(app: App, req: IncomingMessage, res: ServerResponse, number: string): Promise<void> {
  return apiCorrectionInner(app, req, res, number, true);
}

async function apiCorrectionInner(app: App, req: IncomingMessage, res: ServerResponse, number: string, previewOnly: boolean): Promise<void> {
  let body: { baseVersion?: unknown; reason?: unknown; effectiveDate?: unknown; runOutUntil?: unknown; rows?: unknown };
  try {
    body = (await readJson(req, MAX_JSON_BYTES)) as typeof body;
  } catch (e) {
    if (e instanceof BodyLimitError) return sendJson(res, 413, { error: 'body_too_large', message: 'That request is too large.' });
    return sendJson(res, 400, { error: 'bad_json', message: "That request isn't valid JSON." });
  }
  const num = number.toUpperCase();
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT 1 FROM notices WHERE number = $1 FOR UPDATE', [num]);
    if (exists.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
    }
    const latest = await client.query<{ version: number; title: string; effective_date: IsoDate; run_out_until: IsoDate | null; sheet_id: string | null }>(
      'SELECT version, title, effective_date::text, run_out_until::text, sheet_id FROM notice_versions WHERE number = $1 ORDER BY version DESC LIMIT 1 FOR UPDATE',
      [num]
    );
    const latestVersion = latest.rows[0].version;
    if (typeof body.baseVersion !== 'number' || body.baseVersion !== latestVersion) {
      await client.query('ROLLBACK');
      return sendJson(res, 409, { error: 'stale_version', message: 'A newer version exists. Reload to see it.' });
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      await client.query('ROLLBACK');
      return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { reason: 'Say why the notice is corrected.' } });
    }
    const { rows, fields } = parseRows(body.rows);
    if (!rows) {
      await client.query('ROLLBACK');
      return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields });
    }
    // runOutUntil: absent keeps the notice's current value; null clears it.
    const currentRunOut = latest.rows[0].run_out_until;
    const bodyHasRunOut = Object.prototype.hasOwnProperty.call(body, 'runOutUntil');
    const runOut = !bodyHasRunOut ? currentRunOut : typeof body.runOutUntil === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.runOutUntil) ? body.runOutUntil : null;
    let eff: IsoDate;
    if (typeof body.effectiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.effectiveDate) && isoToDay(body.effectiveDate) !== null) {
      eff = body.effectiveDate;
    } else {
      await client.query('ROLLBACK');
      return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { effectiveDate: 'The date reads YYYY-MM-DD.' } });
    }
    const ctx = await loadCheckContext(app, { number: num, latestVersion, effectiveDate: latest.rows[0].effective_date });
    ctx.currentRunOut = (n: string) => (n === num ? currentRunOut : null);
    const dateMove = checkCorrectionDateMove(rows, eff, ctx);
    if (dateMove) {
      await client.query('ROLLBACK');
      return sendJson(res, dateMove.status, dateMove.body);
    }
    const blocking = runPublishChecks(rows, eff, runOut, ctx);
    if (blocking) {
      await client.query('ROLLBACK');
      if (previewOnly) return sendJson(res, 200, { blocking: blocking.body, rows: (await previewRows(app, rows, eff, runOut, { number: num, latestVersion, effectiveDate: latest.rows[0].effective_date })).rows });
      return sendJson(res, blocking.status, blocking.body);
    }
    if (previewOnly) {
      await client.query('ROLLBACK');
      return sendJson(res, 200, await previewRows(app, rows, eff, runOut, { number: num, latestVersion, effectiveDate: latest.rows[0].effective_date }));
    }
    // A correction immediately creates the next version; the prior becomes superseded.
    const newVersion = latestVersion + 1;
    await client.query(
      "INSERT INTO notice_versions (number, version, title, effective_date, run_out_until, published_at, reason, print_state, sheet_id) VALUES ($1, $2, $3, $4, $5, now(), $6, 'pending', $7)",
      [num, newVersion, latest.rows[0].title, eff, runOut, reason, latest.rows[0].sheet_id]
    );
    await client.query('UPDATE notice_versions SET superseded_by = $2 WHERE number = $1 AND version = $3', [num, newVersion, latestVersion]);
    await client.query('DELETE FROM notice_rows WHERE number = $1 AND version = $2', [num, newVersion]);
    const skuNames = await loadSkuNames(app);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      await client.query(
        'INSERT INTO notice_rows (number, version, row_index, sku_code, name, kind, old_mrp_paise, revised_mrp_paise, old_rate, new_rate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [num, newVersion, i, r.skuCode, skuNames.get(r.skuCode) ?? r.skuCode, r.kind, oldMrp(r.skuCode, eff, ctx), r.revisedMrpPaise, r.oldRate, r.newRate]
      );
    }
    const eps = await client.query<{ id: string; account_id: string }>('SELECT id, account_id FROM endpoints WHERE removed = false');
    for (const ep of eps.rows) {
      const eventId = `${num}-v${newVersion}-${ep.id}`;
      await client.query(
        "INSERT INTO deliveries (event_id, account_id, endpoint_id, notice_number, notice_version, event_type, state) VALUES ($1, $2, $3, $4, $5, 'notice.corrected', 'pending') ON CONFLICT (event_id) DO NOTHING",
        [eventId, ep.account_id, ep.id, num, newVersion]
      );
      await client.query('INSERT INTO outbox (kind, payload) VALUES ($1, $2)', ['send', JSON.stringify({ jobId: eventId, kind: 'send', eventId })]);
    }
    await client.query("INSERT INTO outbox (kind, payload) VALUES ($1, $2)", ['render', JSON.stringify({ jobId: `render-${num}-v${newVersion}`, kind: 'render', number: num, version: newVersion })]);
    const seenSkus = new Set(rows.map((r) => r.skuCode));
    for (const sku of seenSkus) {
      await client.query('INSERT INTO outbox (kind, payload) VALUES ($1, $2)', ['index', JSON.stringify({ jobId: `index-${sku}`, kind: 'index', skuCode: sku })]);
    }
    await client.query('COMMIT');
    const bodyOut = await versionBodyFull(app, num, newVersion);
    sendJson(res, 201, { number: num, version: bodyOut });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function previewRows(app: App, rows: Array<{ skuCode: string; kind: string; revisedMrpPaise: number; oldRate: number | null; newRate: number | null }>, eff: IsoDate, runOut: IsoDate | null, correctionOf: { number: string; latestVersion: number; effectiveDate: IsoDate }): Promise<Record<string, unknown>> {
  return previewBody(app, rows.map((r) => ({ ...r, kind: r.kind as 'sticker' | 'new_print' })), eff, runOut, correctionOf);
}
