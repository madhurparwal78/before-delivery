import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { App } from './main.js';
import { sendJson, readJson, clientKey, apiError, BodyLimitError } from './api/http.js';
import { isoToDay, kolkataIsoNow, unitSalePrice } from '../shared/domain.js';
import { noticeShapes, isBatchShaped } from './domain/shapes.js';
import { type PackFacts } from './domain/context.js';
import { stickerCeiling } from './domain/decision.js';

import { apiEndpoints, apiSaveEndpoint, apiTestEndpoint, apiRotateSecret, apiRecover, apiRemoveEndpoint, apiDeliveries, apiRedeliver } from './routes-stockist.js';
import { apiImportSheet, apiListSheets, apiGetSheet, apiSheetLink, apiSheetDownload } from './routes-editor-sheets.js';
import { apiEditorNotices } from './routes-editor-notices.js';
import { apiCreateDraft, apiDraftFromSheet, apiSaveDraft } from './routes-editor-drafts.js';
import { apiPublish, apiPreview, apiCorrection, apiCorrectionPreview } from './routes-editor-publish.js';
import { apiRenameDrink, apiRenameSku, apiSkuHistory, apiRegisterBatch, apiRetryPrint } from './routes-editor-admin.js';
import { apiSettleRow, apiPriceSheet } from './routes-editor-settle.js';

const MAX_JSON_BYTES = 1000000;

async function apiSetClock(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: { now?: unknown };
  try {
    body = (await readJson(req, MAX_JSON_BYTES)) as typeof body;
  } catch (e) {
    if (e instanceof BodyLimitError) return sendError(res, apiError(413, 'body_too_large', message413()));
    return sendError(res, apiError(400, 'bad_json', "That request isn't valid JSON."));
  }
  if (typeof body.now !== 'string') return sendError(res, apiError(422, 'validation', 'Some fields need attention.', { fields: { now: 'Send an ISO 8601 instant with offset.' } }));
  const d = new Date(body.now);
  if (Number.isNaN(d.getTime())) return sendError(res, apiError(422, 'validation', 'Some fields need attention.', { fields: { now: 'Send an ISO 8601 instant with offset.' } }));
  app.clock.setTest(d);
  sendJson(res, 200, { now: kolkataIsoNow(d), today: app.clock.today() });
}

async function apiClearClock(app: App, res: ServerResponse): Promise<void> {
  app.clock.clearTest();
  const now = new Date();
  sendJson(res, 200, { now: kolkataIsoNow(now), today: app.clock.today() });
}

function message413(): string {
  return 'That request is too large.';
}

interface Session {
  token: string;
  accountId: string;
  role: 'editor' | 'stockist';
  displayName: string;
  email: string;
}

async function readSession(app: App, req: IncomingMessage): Promise<Session | null> {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  const m = /(?:^|;\s*)interval_session=([^;]+)/.exec(cookie);
  if (!m) return null;
  const token = m[1];
  try {
    const r = await app.pool.query<{ token: string; account_id: string; role: string; display_name: string; email: string }>(
      `SELECT s.token, s.account_id, a.role, a.display_name, a.email FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = $1`,
      [token]
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    return { token, accountId: row.account_id, role: row.role as 'editor' | 'stockist', displayName: row.display_name, email: row.email };
  } catch {
    return null;
  }
}

function sendError(res: ServerResponse, e: { status: number; body: Record<string, unknown>; headers?: Record<string, string> }): void {
  sendJson(res, e.status, e.body, e.headers);
}

export async function handleApi(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname;
  const method = req.method ?? 'GET';
  const session = await readSession(app, req);
  const parts = path.split('/').filter((p) => p.length > 0); // ['api', ...]

  const rest = parts[0] === 'api' ? parts.slice(1) : [];

  try {
    if (parts[0] === 'api') {
      if (path === '/api/catalogue' && method === 'GET') return apiCatalogue(app, res);
      if (rest[0] === 'skus' && rest[1]) {
        if (method === 'GET' && rest.length === 2) return apiSku(app, res, rest[1]);
      }
      if (rest[0] === 'batches' && rest[1]) {
        if (method === 'GET' && rest.length === 2) return apiBatch(app, req, res, rest[1]);
      }
      if (rest[0] === 'search' && method === 'GET') {
        return apiSearch(app, req, res, url);
      }
      if (rest[0] === 'notices') {
        if (rest.length === 1 && method === 'GET') return apiNotices(app, res);
        if (rest.length === 2 && method === 'GET') return apiNotice(app, res, rest[1]);
        if (rest.length === 5 && rest[2] === 'versions' && rest[4] === 'link' && method === 'GET') return apiNoticeLink(app, res, rest[1], Number(rest[3]));
        if (rest.length === 5 && rest[2] === 'versions' && rest[4] === 'pdf' && method === 'GET') return apiNoticePdf(app, res, rest[1], Number(rest[3]));
      }
      if (rest[0] === 'session') {
        if (rest.length === 1 && method === 'POST') return apiSignIn(app, req, res);
        if (rest.length === 1 && method === 'GET') return apiSession(app, session, res);
        if (rest.length === 1 && method === 'DELETE') return apiSignOut(app, session, res);
      }
      if (rest[0] === 'stockist') {
        if (!session) return sendError(res, apiError(401, 'unauthenticated', 'Sign in first.'));
        if (session.role !== 'stockist') return sendError(res, apiError(403, 'forbidden', 'That is not your screen.'));
        if (rest[1] === 'endpoints' && rest.length === 2 && method === 'GET') return apiEndpoints(app, session, res);
        if (rest[1] === 'endpoints' && rest.length === 2 && method === 'POST') return apiSaveEndpoint(app, req, session, res);
        if (rest[1] === 'endpoints' && rest[3] === 'test' && method === 'POST') return apiTestEndpoint(app, req, session, res, rest[2]);
        if (rest[1] === 'endpoints' && rest[3] === 'rotate-secret' && method === 'POST') return apiRotateSecret(app, session, res, rest[2]);
        if (rest[1] === 'endpoints' && rest[3] === 'recover' && method === 'POST') return apiRecover(app, session, res, rest[2]);
        if (rest[1] === 'endpoints' && rest.length === 3 && method === 'DELETE') return apiRemoveEndpoint(app, session, res, rest[2]);
        if (rest[1] === 'deliveries' && rest.length === 2 && method === 'GET') return apiDeliveries(app, session, res);
        if (rest[1] === 'deliveries' && rest[3] === 'redeliver' && method === 'POST') return apiRedeliver(app, session, res, rest[2]);
        if (rest[1] === 'price-sheet.csv' && method === 'GET') return apiPriceSheet(app, res);
      }
      if (rest[0] === 'editor') {
        if (!session) return sendError(res, apiError(401, 'unauthenticated', 'Sign in first.'));
        if (session.role !== 'editor') return sendError(res, apiError(403, 'forbidden', 'That is not your screen.'));
        if (rest[1] === 'price-sheets' && rest.length === 2 && method === 'POST') return apiImportSheet(app, req, res);
        if (rest[1] === 'price-sheets' && rest.length === 2 && method === 'GET') return apiListSheets(app, res);
        if (rest[1] === 'price-sheets' && rest.length === 3 && method === 'GET') return apiGetSheet(app, res, rest[2]);
        // /api/editor/price-sheets/<id>/link | download | rows/<n>/settle | draft
        if (rest[1] === 'price-sheets' && rest[3] === 'link' && method === 'GET') return apiSheetLink(app, res, rest[2]);
        if (rest[1] === 'price-sheets' && rest[3] === 'download' && method === 'GET') return apiSheetDownload(app, res, rest[2]);
        if (rest[1] === 'price-sheets' && rest[3] === 'rows' && rest[5] === 'settle' && method === 'POST') return apiSettleRow(app, req, res, rest[2], Number(rest[4]));
        if (rest[1] === 'price-sheets' && rest[3] === 'draft' && method === 'POST') return apiDraftFromSheet(app, req, res, rest[2]);
        if (rest[1] === 'notices' && rest.length === 2 && method === 'GET') return apiEditorNotices(app, res);
        if (rest[1] === 'notices' && rest.length === 2 && method === 'POST') return apiCreateDraft(app, req, res);
        if (rest[1] === 'notices' && rest.length === 3 && method === 'PUT') return apiSaveDraft(app, req, res, rest[2]);
        if (rest[1] === 'notices' && rest[3] === 'publish' && method === 'POST') return apiPublish(app, req, res, rest[2]);
        if (rest[1] === 'notices' && rest[3] === 'preview' && method === 'POST') return apiPreview(app, req, res, rest[2]);
        if (rest[1] === 'notices' && rest[3] === 'corrections' && rest.length === 4 && method === 'POST') return apiCorrection(app, req, res, rest[2]);
        if (rest[1] === 'notices' && rest[3] === 'corrections' && rest[4] === 'preview' && method === 'POST') return apiCorrectionPreview(app, req, res, rest[2]);
        if (rest[1] === 'notices' && rest[5] === 'print' && method === 'POST') return apiRetryPrint(app, res, rest[2], Number(rest[4]));
        if (rest[1] === 'drinks' && rest.length === 3 && method === 'PATCH') return apiRenameDrink(app, req, res, rest[2]);
        if (rest[1] === 'skus' && rest.length === 3 && method === 'PATCH') return apiRenameSku(app, req, res, rest[2]);
        if (rest[1] === 'skus' && rest[3] === 'history' && method === 'GET') return apiSkuHistory(app, res, rest[2]);
        if (rest[1] === 'batches' && rest.length === 2 && method === 'POST') return apiRegisterBatch(app, req, res);
      }
      if (rest[0] === 'test' && rest[1] === 'clock') {
        if (!app.clock.testClockEnabled) return sendError(res, apiError(404, 'not_found', 'Not found.'));
        if (method === 'PUT') return apiSetClock(app, req, res);
        if (method === 'DELETE') return apiClearClock(app, res);
      }
      return sendError(res, apiError(404, 'not_found', 'Not found.'));
    }
    return sendError(res, apiError(404, 'not_found', 'Not found.'));
  } catch (e) {
    if (e instanceof BodyLimitError) {
      return sendError(res, apiError(413, 'body_too_large', 'That request is too large.'));
    }
    if (e instanceof Error && e.message === 'bad_json') {
      return sendError(res, apiError(400, 'bad_json', "That request isn't valid JSON."));
    }
    throw e;
  }
}

// ---------- helpers ----------

async function catalogueRows(app: App): Promise<{ drinks: Array<{ id: string; name: string; carbonated: boolean; skus: unknown[] }>; skus: Map<string, { code: string; drinkId: string; drinkName: string; variant: string; name: string; format: string; sizeMl: number; shelfDays: number; sugarMgPer100ml: number; launchMrpPaise: number }> }> {
  const drinks = await app.pool.query('SELECT id, name, carbonated FROM drinks ORDER BY lineup_order');
  const skus = await app.pool.query(
    `SELECT s.code, s.drink_id, d.name AS drink_name, s.variant, s.format, s.size_ml, s.shelf_days, s.sugar_mg_per_100ml, s.launch_mrp_paise
     FROM skus s JOIN drinks d ON d.id = s.drink_id ORDER BY s.catalogue_order`
  );
  const skuMap = new Map<string, { code: string; drinkId: string; drinkName: string; variant: string; name: string; format: string; sizeMl: number; shelfDays: number; sugarMgPer100ml: number; launchMrpPaise: number }>();
  for (const s of skus.rows) {
    skuMap.set(s.code, {
      code: s.code,
      drinkId: s.drink_id,
      drinkName: s.drink_name,
      variant: s.variant,
      name: `${s.drink_name} ${s.variant}`,
      format: s.format,
      sizeMl: s.size_ml,
      shelfDays: s.shelf_days,
      sugarMgPer100ml: s.sugar_mg_per_100ml,
      launchMrpPaise: s.launch_mrp_paise,
    });
  }
  const drinkList = drinks.rows.map((d) => ({ id: d.id, name: d.name, carbonated: d.carbonated, skus: skus.rows.filter((s) => s.drink_id === d.id).map((s) => s.code) }));
  return { drinks: drinkList, skus: skuMap };
}

async function storyBatchFor(app: App, skuCode: string): Promise<string | null> {
  const today = app.clock.today();
  const r = await app.pool.query<{ code: string; packed_date: string; shelf_days: number }>(
    `SELECT b.code, b.packed_date::text, s.shelf_days FROM batches b JOIN skus s ON s.code = b.sku_code WHERE b.sku_code = $1 ORDER BY b.packed_date, b.code`,
    [skuCode]
  );
  if (r.rows.length === 0) return null;
  const alive = r.rows.filter((b) => isoToDay(today)! <= isoToDay(b.packed_date)! + b.shelf_days);
  if (alive.length > 0) return alive[0].code;
  return r.rows[r.rows.length - 1].code;
}

async function packFactsForBatch(app: App, batchCode: string): Promise<PackFacts | null> {
  const batch = await app.prices.getBatch(batchCode);
  if (!batch) return null;
  const sku = await app.prices.getSku(batch.skuCode);
  if (!sku) return null;
  return app.prices.packFacts(sku, batch);
}

// ---------- public endpoints ----------

async function apiCatalogue(app: App, res: ServerResponse): Promise<void> {
  const today = app.clock.today();
  const { drinks, skus } = await catalogueRows(app);
  const notices = await app.pool.query<{ number: string; effective_date: string }>(
    `SELECT number, effective_date::text FROM notice_versions
     WHERE (number, version) IN (SELECT number, max(version) FROM notice_versions GROUP BY number)`
  );
  let inEffect = 0;
  let scheduled = 0;
  const latestByNumber = new Map<string, string>();
  for (const n of notices.rows) {
    latestByNumber.set(n.number, n.effective_date);
  }
  for (const eff of latestByNumber.values()) {
    if (isoToDay(eff)! <= isoToDay(today)!) inEffect++;
    else scheduled++;
  }
  const drinkOut = await Promise.all(
    drinks.map(async (d) => {
      const skuRows = Array.from(skus.values()).filter((s) => s.drinkId === d.id);
      const out = [];
      for (const s of skuRows) {
        const cur = await app.prices.currentMrp(s.code);
        out.push({
          code: s.code,
          variant: s.variant,
          name: s.name,
          format: s.format,
          sizeMl: s.sizeMl,
          shelfDays: s.shelfDays,
          sugarMgPerPack: Math.round((s.sugarMgPer100ml * s.sizeMl) / 100),
          currentMrpPaise: cur.mrpPaise,
        });
      }
      return { id: d.id, name: d.name, carbonated: d.carbonated, skus: out };
    })
  );
  sendJson(res, 200, {
    today,
    counts: { drinks: drinkOut.length, skus: skus.size, notices: inEffect, scheduledRevisions: scheduled },
    drinks: drinkOut,
  });
}

async function apiSku(app: App, res: ServerResponse, code: string): Promise<void> {
  const sku = await app.prices.getSku(code.toUpperCase());
  if (!sku) return sendError(res, apiError(404, 'not_found', 'Not found.'));
  const storyBatchCode = await storyBatchFor(app, sku.code);
  const story = storyBatchCode ? await packFactsForBatch(app, storyBatchCode) : null;
  const cur = await app.prices.currentMrp(sku.code);
  const retail = cur.mrpPaise;
  sendJson(res, 200, {
    code: sku.code,
    variant: sku.variant,
    name: sku.name,
    drinkId: sku.drinkId,
    drinkName: sku.drinkName,
    format: sku.format,
    sizeMl: sku.sizeMl,
    shelfDays: sku.shelfDays,
    sugarMgPerPack: Math.round((sku.sugarMgPer100ml * sku.sizeMl) / 100),
    currentMrpPaise: retail,
    currentSource: cur.source,
    unitSalePrice: unitSalePrice(retail, sku.sizeMl),
    storyBatch: story,
  });
}

async function apiBatch(app: App, req: IncomingMessage, res: ServerResponse, rawCode: string): Promise<void> {
  const code = rawCode.trim().toUpperCase();
  const retry = app.lookupLimiter.hit(clientKey(req));
  if (retry !== null) {
    return sendError(res, apiError(429, 'rate_limited', `Too many tries. Wait ${retry} seconds and try again.`, { retryAfter: retry }, { 'Retry-After': String(retry) }));
  }
  const facts = await packFactsForBatch(app, code);
  if (!facts) {
    if (!isBatchShaped(code)) {
      return sendError(res, apiError(422, 'unknown_batch', "We can't find that batch. Check the code printed near the best-before date."));
    }
    return sendError(res, apiError(404, 'unknown_batch', "We can't find that batch. Check the code printed near the best-before date."));
  }
  sendJson(res, 200, facts);
}

async function apiSearch(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length > 80) {
    return sendError(res, apiError(422, 'validation', 'That query is too long.', { fields: { q: 'At most 80 characters.' } }));
  }
  if (q === '') {
    return sendJson(res, 200, { query: '', searchState: app.search.reachable ? (app.search.behind ? 'behind' : 'current') : 'down', results: [] });
  }
  const shape = noticeShapes(q);
  if (isBatchShaped(q)) {
    const retry = app.lookupLimiter.hit(clientKey(req));
    if (retry !== null) {
      return sendError(res, apiError(429, 'rate_limited', `Too many tries. Wait ${retry} seconds and try again.`, { retryAfter: retry }, { 'Retry-After': String(retry) }));
    }
    const facts: PackFacts | null = await packFactsForBatch(app, q.trim().toUpperCase());
    const state = app.search.reachable ? (app.search.behind ? 'behind' : 'current') : 'down';
    if (!facts) return sendJson(res, 200, { query: q, searchState: state, results: [] });
    return sendJson(res, 200, {
      query: q,
      searchState: state,
      results: [
        {
          kind: 'batch',
          skuCode: facts.skuCode,
          name: facts.skuName,
          batchCode: facts.batchCode,
          retailPricePaise: facts.retailPricePaise,
          sourceNotice: facts.sourceNotice,
        },
      ],
    });
  }
  if (shape === 'sku' || shape === 'notice') {
    // whole matches against Postgres with no typos
    if (shape === 'sku') {
      const sku = await app.prices.getSku(q.toUpperCase());
      if (!sku) return sendJson(res, 200, { query: q, searchState: 'current', results: [] });
      const cur = await app.prices.currentMrp(sku.code);
      return sendJson(res, 200, {
        query: q,
        searchState: app.search.reachable ? (app.search.behind ? 'behind' : 'current') : 'down',
        results: [{ kind: 'sku', skuCode: sku.code, name: sku.name, batchCode: null, retailPricePaise: cur.mrpPaise, sourceNotice: cur.source }],
      });
    }
    const number = q.toUpperCase();
    const latest = await app.pool.query<{ version: number }>(
      'SELECT max(version) AS version FROM notice_versions WHERE number = $1',
      [number]
    );
    if (latest.rows.length === 0 || latest.rows[0].version === null) {
      return sendJson(res, 200, { query: q, searchState: 'current', results: [] });
    }
    const rows = await app.pool.query<{ sku_code: string }>(
      'SELECT sku_code FROM notice_rows WHERE number = $1 AND version = $2 ORDER BY row_index',
      [number, latest.rows[0].version]
    );
    const results = [];
    for (const r of rows.rows) {
      const sku = await app.prices.getSku(r.sku_code);
      const cur = await app.prices.currentMrp(r.sku_code);
      if (!sku) continue;
      results.push({ kind: 'sku', skuCode: sku.code, name: sku.name, batchCode: null, retailPricePaise: cur.mrpPaise, sourceNotice: cur.source });
    }
    return sendJson(res, 200, { query: q, searchState: 'current', results });
  }
  // index search
  const state = app.search.reachable ? (app.search.behind ? 'behind' : 'current') : 'down';
  if (!app.search.reachable) {
    return sendJson(res, 200, { query: q, searchState: 'down', results: [] });
  }
  const ids = await app.search.search(q);
  if (ids === null) {
    return sendJson(res, 200, { query: q, searchState: 'down', results: [] });
  }
  const results = [];
  for (const id of ids) {
    const sku = await app.prices.getSku(id);
    if (!sku) continue;
    const cur = await app.prices.currentMrp(id);
    results.push({ kind: 'sku', skuCode: id, name: sku.name, batchCode: null, retailPricePaise: cur.mrpPaise, sourceNotice: cur.source });
  }
  sendJson(res, 200, { query: q, searchState: state, results });
}

async function apiNotices(app: App, res: ServerResponse): Promise<void> {
  const versions = await app.pool.query(
    `SELECT number, version FROM notice_versions WHERE (number, version) IN (SELECT number, max(version) FROM notice_versions GROUP BY number)
     ORDER BY effective_date DESC, number DESC`
  );
  const out = [];
  for (const v of versions.rows) {
    out.push({
      number: v.number,
      state: (await versionBody(app, v.number, v.version) as { state: string }).state,
      currentVersion: await versionBody(app, v.number, v.version),
    });
  }
  sendJson(res, 200, { notices: out });
}

async function versionBody(app: App, number: string, version: number): Promise<unknown> {
  const v = await app.pool.query<{ title: string; effective_date: string; run_out_until: string | null; published_at: Date; reason: string | null; print_state: string; pdf_sha256: string | null; sheet_id: string | null; superseded_by: number | null }>(
    'SELECT title, effective_date::text, run_out_until::text, published_at, reason, print_state, pdf_sha256, sheet_id, superseded_by FROM notice_versions WHERE number = $1 AND version = $2',
    [number, version]
  );
  if (v.rows.length === 0) return null;
  const row = v.rows[0];
  const rows = await app.pool.query<{ sku_code: string; name: string; kind: string; old_mrp_paise: number; revised_mrp_paise: number; old_rate: number | null; new_rate: number | null }>(
    'SELECT sku_code, name, kind, old_mrp_paise, revised_mrp_paise, old_rate, new_rate FROM notice_rows WHERE number = $1 AND version = $2 ORDER BY row_index',
    [number, version]
  );
  const today = app.clock.today();
  const maxV = await app.pool.query<{ max: number }>('SELECT max(version) AS max FROM notice_versions WHERE number = $1', [number]);
  const latestVersion = maxV.rows[0].max;
  const state = latestVersion > version ? 'superseded' : isoToDay(row.effective_date)! <= isoToDay(today)! ? 'in_effect' : 'scheduled';
  const outRows = [];
  for (const r of rows.rows) {
    const ceiling = r.old_rate !== null && r.new_rate !== null ? stickerCeiling(r.old_mrp_paise, r.old_rate, r.new_rate) : null;
    outRows.push({
      skuCode: r.sku_code,
      name: r.name,
      kind: r.kind,
      oldMrpPaise: r.old_mrp_paise,
      revisedMrpPaise: r.revised_mrp_paise,
      oldRate: r.old_rate,
      newRate: r.new_rate,
      ceilingPaise: r.kind === 'sticker' ? ceiling : null,
    });
  }
  const sheet = row.sheet_id ? await app.pool.query<{ id: string; sha256: string }>('SELECT id, sha256 FROM sheets WHERE id = $1', [row.sheet_id]) : null;
  return {
    version,
    state,
    supersededBy: row.superseded_by,
    title: row.title,
    effectiveDate: row.effective_date,
    runOutUntil: row.run_out_until,
    publishedAt: row.published_at.toISOString(),
    reason: row.reason,
    printState: row.print_state,
    pdfSha256: row.pdf_sha256,
    sheet: sheet && sheet.rows.length > 0 ? { id: sheet.rows[0].id, sha256: sheet.rows[0].sha256 } : null,
    rows: outRows,
  };
}

async function apiNotice(app: App, res: ServerResponse, number: string): Promise<void> {
  const exists = await app.pool.query('SELECT 1 FROM notices WHERE number = $1', [number.toUpperCase()]);
  if (exists.rows.length === 0) return sendError(res, apiError(404, 'not_found', 'Not found.'));
  const today = app.clock.today();
  const versions = await app.pool.query<{ version: number; effective_date: string }>(
    'SELECT version, effective_date::text FROM notice_versions WHERE number = $1 ORDER BY version DESC',
    [number.toUpperCase()]
  );
  const bodies = [];
  for (const v of versions.rows) {
    bodies.push(await versionBody(app, number.toUpperCase(), v.version));
  }
  const latestEff = versions.rows[0]?.effective_date ?? '';
  sendJson(res, 200, {
    number: number.toUpperCase(),
    state: isoToDay(latestEff)! <= isoToDay(today)! ? 'in_effect' : 'scheduled',
    versions: bodies,
  });
}

async function apiNoticeLink(app: App, res: ServerResponse, number: string, version: number): Promise<void> {
  const v = await app.pool.query<{ print_state: string; pdf_sha256: string | null }>(
    'SELECT print_state, pdf_sha256 FROM notice_versions WHERE number = $1 AND version = $2',
    [number.toUpperCase(), version]
  );
  if (v.rows.length === 0) return sendError(res, apiError(404, 'not_found', 'Not found.'));
  if (v.rows[0].print_state !== 'printable') {
    if (v.rows[0].print_state === 'pending') return sendError(res, apiError(409, 'print_pending', 'This notice is still being printed.'));
    return sendError(res, apiError(503, 'print_unavailable', 'Printing is down. The prices on this page are still correct.'));
  }
  try {
    const link = await app.storage.presignGet(`${app.copyId}/notices/${number.toUpperCase()}/v${version}.pdf`);
    sendJson(res, 200, { url: link, expiresInSeconds: 60, sha256: v.rows[0].pdf_sha256 }, { 'Cache-Control': 'no-store' });
  } catch {
    sendJson(res, 503, { error: 'storage_unavailable', message: 'Stored copies are unavailable right now. The prices on this page are still correct.' });
  }
}

async function apiNoticePdf(app: App, res: ServerResponse, number: string, version: number): Promise<void> {
  const err = await apiNoticeLink(app, res, number, version);
  void err;
}

// ---------- session ----------

async function apiSignIn(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: { email?: unknown; password?: unknown };
  try {
    body = (await readJson(req, MAX_JSON_BYTES)) as { email?: unknown; password?: unknown };
  } catch (e) {
    if (e instanceof BodyLimitError) return sendError(res, apiError(413, 'body_too_large', 'That request is too large.'));
    return sendError(res, apiError(400, 'bad_json', "That request isn't valid JSON."));
  }
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) {
    const retry = app.signInLimiter.hit(clientKey(req));
    if (retry !== null) return sendError(res, apiError(429, 'rate_limited', `Too many tries. Wait ${retry} seconds and try again.`, { retryAfter: retry }, { 'Retry-After': String(retry) }));
    return sendError(res, apiError(401, 'bad_credentials', "That email and password don't match."));
  }
  const r = await app.pool.query<{ id: string; role: string; display_name: string; email: string; password_salt: string; password_hash: string }>(
    'SELECT id, role, display_name, email, password_salt, password_hash FROM accounts WHERE lower(email) = lower($1)',
    [email]
  );
  let ok = false;
  if (r.rows.length === 0) {
    // constant-time-ish: hash anyway
    scryptSync(password, 'x', 64);
  } else {
    const row = r.rows[0];
    const hash = scryptSync(password, row.password_salt, 64).toString('hex');
    ok = timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(row.password_hash, 'hex'));
  }
  if (!ok) {
    const retry = app.signInLimiter.hit(clientKey(req));
    if (retry !== null) return sendError(res, apiError(429, 'rate_limited', `Too many tries. Wait ${retry} seconds and try again.`, { retryAfter: retry }, { 'Retry-After': String(retry) }));
    return sendError(res, apiError(401, 'bad_credentials', "That email and password don't match."));
  }
  const token = randomBytes(32).toString('hex');
  await app.pool.query('INSERT INTO sessions (token, account_id, created_at) VALUES ($1, $2, now())', [token, r.rows[0].id]);
  res.setHeader('Set-Cookie', `interval_session=${token}; HttpOnly; Path=/; SameSite=Lax`);
  sendJson(res, 200, { role: r.rows[0].role, email: r.rows[0].email, displayName: r.rows[0].display_name, accountId: r.rows[0].id });
}

async function apiSession(app: App, session: Session | null, res: ServerResponse): Promise<void> {
  if (!session) return sendError(res, apiError(401, 'unauthenticated', 'Sign in first.'));
  sendJson(res, 200, { role: session.role, email: session.email, displayName: session.displayName, accountId: session.accountId });
}

async function apiSignOut(app: App, session: Session | null, res: ServerResponse): Promise<void> {
  if (!session) return sendError(res, apiError(401, 'unauthenticated', 'Sign in first.'));
  await app.pool.query('DELETE FROM sessions WHERE token = $1', [session.token]);
  res.setHeader('Set-Cookie', 'interval_session=; HttpOnly; Path=/; Max-Age=0');
  sendJson(res, 204, {});
}

export { readSession, apiNoticePdf };
export type { Session };

