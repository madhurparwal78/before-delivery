import type { ServerResponse } from 'node:http';
import { sendJson } from './api/http.js';
import type { App } from './main.js';
import { runPublishChecks, ceilingFor, type PublishedRow, type SkuInfo, type CheckContext } from './domain/checks.js';
import { isoToDay, type IsoDate } from '../shared/domain.js';

interface RowInput {
  skuCode: string;
  kind: 'sticker' | 'new_print';
  revisedMrpPaise: number;
  oldRate: number | null;
  newRate: number | null;
}

function parseRows(raw: unknown): { rows: RowInput[] | null; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  if (!Array.isArray(raw)) {
    fields.rows = 'A notice needs rows.';
    return { rows: null, fields };
  }
  const rows: RowInput[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) {
      fields.rows = 'Each row needs skuCode, kind and revisedMrpPaise.';
      return { rows: null, fields };
    }
    const rr = r as Record<string, unknown>;
    const skuCode = rr.skuCode;
    const kind = rr.kind;
    const revised = rr.revisedMrpPaise;
    const oldRate = rr.oldRate;
    const newRate = rr.newRate;
    if (typeof skuCode !== 'string' || typeof kind !== 'string' || typeof revised !== 'number') {
      fields.rows = 'Each row needs skuCode, kind and revisedMrpPaise.';
      return { rows: null, fields };
    }
    if (kind !== 'sticker' && kind !== 'new_print') {
      fields.rows = 'Kind reads Sticker or New print.';
      return { rows: null, fields };
    }
    if (!Number.isInteger(revised) || revised <= 0) {
      fields.rows = 'Prices are whole paise above zero.';
      return { rows: null, fields };
    }
    if (kind === 'sticker') {
      if (typeof oldRate !== 'number' || typeof newRate !== 'number' || !Number.isInteger(oldRate) || !Number.isInteger(newRate) || oldRate < 0 || oldRate > 100 || newRate < 0 || newRate > 100 || oldRate === newRate) {
        fields.rows = 'A sticker row needs two whole rates from 0 to 100 that differ.';
        return { rows: null, fields };
      }
    }
    rows.push({ skuCode, kind, revisedMrpPaise: revised, oldRate: typeof oldRate === 'number' ? oldRate : null, newRate: typeof newRate === 'number' ? newRate : null });
  }
  return { rows, fields };
}

async function loadCheckContext(app: App, correctionOf?: { number: string; latestVersion: number; effectiveDate: IsoDate }): Promise<CheckContext> {
  const skus = new Map<string, SkuInfo>();
  const skuRows = await app.pool.query<{ code: string; name: string; launch_mrp_paise: number }>(
    `SELECT s.code, d.name || ' ' || s.variant AS name, s.launch_mrp_paise FROM skus s JOIN drinks d ON d.id = s.drink_id`
  );
  for (const s of skuRows.rows) skus.set(s.code, { code: s.code, name: s.name, launchMrpPaise: s.launch_mrp_paise });
  const latest = await app.pool.query<{ number: string; version: number }>(
    'SELECT number, max(version) AS version FROM notice_versions GROUP BY number'
  );
  const latestVersions = new Map<string, number>();
  for (const l of latest.rows) latestVersions.set(l.number, l.version);
  const rowRows = await app.pool.query<{ number: string; version: number; effective_date: string; sku_code: string; kind: string; revised_mrp_paise: number; old_rate: number | null; new_rate: number | null }>(
    `SELECT r.number, r.version, v.effective_date::text, r.sku_code, r.kind, r.revised_mrp_paise, r.old_rate, r.new_rate
     FROM notice_rows r JOIN notice_versions v ON v.number = r.number AND v.version = r.version
     ORDER BY r.number, r.version, r.row_index`
  );
  const publishedRows: PublishedRow[] = rowRows.rows.map((r) => ({
    number: r.number,
    version: r.version,
    effectiveDate: r.effective_date,
    skuCode: r.sku_code,
    kind: r.kind as 'sticker' | 'new_print',
    revisedMrpPaise: r.revised_mrp_paise,
    oldRate: r.old_rate,
    newRate: r.new_rate,
    isLatestVersion: latestVersions.get(r.number) === r.version,
  }));
  const batchRows = await app.pool.query<{ code: string; sku_code: string; packed_date: string }>(
    "SELECT code, sku_code, packed_date::text FROM batches WHERE old_wrapper = true"
  );
  const oldWrapperBatches = new Map<string, Array<{ code: string; packedDate: IsoDate }>>();
  for (const b of batchRows.rows) {
    const list = oldWrapperBatches.get(b.sku_code) ?? [];
    list.push({ code: b.code, packedDate: b.packed_date });
    oldWrapperBatches.set(b.sku_code, list);
  }
  const runOuts = new Map<string, IsoDate | null>();
  for (const [num, ver] of latestVersions) {
    const v = await app.pool.query<{ run_out_until: string | null }>('SELECT run_out_until::text AS run_out_until FROM notice_versions WHERE number = $1 AND version = $2', [num, ver]);
    runOuts.set(num, v.rows[0]?.run_out_until ?? null);
  }
  return {
    skus,
    publishedRows,
    today: app.clock.today(),
    correctionOf,
    oldWrapperBatches,
    currentRunOut: (num: string) => runOuts.get(num) ?? null,
  };
}

async function draftRowsFromSheet(app: App, sheetId: string): Promise<RowInput[]> {
  const rows = await app.pool.query(
    `SELECT sku_code, new_mrp_paise, old_rate, new_rate, old_gst, new_gst, ignored, merged_into_row, status, reason FROM sheet_rows WHERE sheet_id = $1 ORDER BY row_number`,
    [sheetId]
  );
  const out: RowInput[] = [];
  for (const r of rows.rows) {
    const rr = r as unknown as Record<string, unknown>;
    if (rr.ignored) continue;
    if (rr.merged_into_row !== null) continue;
    if (rr.sku_code === null || rr.new_mrp_paise === null) continue;
    const hasRates = rr.old_rate !== null && rr.new_rate !== null;
    out.push({
      skuCode: String(rr.sku_code),
      kind: hasRates ? 'sticker' : 'new_print',
      revisedMrpPaise: Number(rr.new_mrp_paise),
      oldRate: hasRates ? Number(rr.old_rate) : null,
      newRate: hasRates ? Number(rr.new_rate) : null,
    });
  }
  return out;
}

async function loadSkuNames(app: App): Promise<Map<string, string>> {
  const r = await app.pool.query<{ code: string; name: string }>(`SELECT s.code, d.name || ' ' || s.variant AS name FROM skus s JOIN drinks d ON d.id = s.drink_id`);
  return new Map(r.rows.map((x) => [x.code, x.name]));
}

function draftBody(
  d: { id: string; revision: number; title: string; effective_date: IsoDate; run_out_until: IsoDate | null; sheet_id: string | null },
  rows: Array<{ sku_code: string; kind: string; revised_mrp_paise: number; old_rate: number | null; new_rate: number | null }>,
  skuNames: Map<string, string>,
  publishedRows: PublishedRow[],
  launchPaise: Map<string, number>
): Record<string, unknown> {
  const outRows = rows.map((r) => {
    const old = oldMrpPaiseFor(r, d.effective_date, publishedRows, launchPaise.get(r.sku_code) ?? 0);
    return {
      skuCode: r.sku_code,
      name: skuNames.get(r.sku_code) ?? r.sku_code,
      kind: r.kind,
      oldMrpPaise: old,
      revisedMrpPaise: r.revised_mrp_paise,
      oldRate: r.old_rate,
      newRate: r.new_rate,
      ceilingPaise: r.kind === 'sticker' && r.old_rate !== null && r.new_rate !== null ? ceilingFor(old, r.old_rate, r.new_rate) : null,
    };
  });
  return {
    id: d.id,
    state: 'draft',
    revision: d.revision,
    title: d.title,
    effectiveDate: d.effective_date,
    runOutUntil: d.run_out_until,
    sheet: d.sheet_id ? { id: d.sheet_id, sha256: sheetSha.get(d.sheet_id) ?? '' } : null,
    rows: outRows,
  };
}

const sheetSha = new Map<string, string>();

function oldMrpPaiseFor(r: { sku_code: string; kind: string }, effectiveDate: IsoDate, publishedRows: PublishedRow[], launchPaise: number): number {
  const dayBefore = isoToDay(effectiveDate)! - 1;
  let best: { eff: number; mrp: number } | null = null;
  for (const p of publishedRows) {
    if (p.skuCode !== r.sku_code || !p.isLatestVersion) continue;
    const ed = isoToDay(p.effectiveDate)!;
    if (ed <= dayBefore) {
      if (!best || ed > best.eff) best = { eff: ed, mrp: p.revisedMrpPaise };
    }
  }
  return best ? best.mrp : launchPaise;
}

export {
  parseRows,
  loadCheckContext,
  draftRowsFromSheet,
  loadSkuNames,
  draftBody,
  oldMrpPaiseFor,
  sheetSha,
  versionBodyFull,
  previewBody,
};
export type { RowInput };

// ---------- editor: notices ----------

async function apiEditorNoticesBody(app: App): Promise<Record<string, unknown>> {
  const today = app.clock.today();
  const { skus } = await app.pool.query<{ skus: number }>('SELECT count(*)::int AS skus FROM skus').then((r) => r.rows[0]);
  const drinksCount = (await app.pool.query<{ c: number }>('SELECT count(*)::int AS c FROM drinks')).rows[0].c;
  const latest = await app.pool.query<{ number: string; version: number; effective_date: string }>(
    `SELECT number, max(version) AS version, min(effective_date)::text AS effective_date FROM notice_versions
     WHERE (number, version) IN (SELECT number, max(version) FROM notice_versions GROUP BY number)
     GROUP BY number`
  );
  let noticesCount = 0;
  let scheduled = 0;
  for (const l of latest.rows) {
    if (isoToDay(l.effective_date)! <= isoToDay(today)!) noticesCount++;
    else scheduled++;
  }
  const drafts = await app.pool.query('SELECT id FROM drafts ORDER BY created_at DESC, id');
  const draftOut = [];
  const skuNames = await loadSkuNames(app);
  const ctx = await loadCheckContext(app);
  const launch = await app.pool.query<{ code: string; launch_mrp_paise: number }>('SELECT code, launch_mrp_paise FROM skus');
  const launchPaise = new Map(launch.rows.map((x) => [x.code, x.launch_mrp_paise]));
  const shaRows = await app.pool.query<{ id: string; sha256: string }>('SELECT id, sha256 FROM sheets');
  for (const shaRow of shaRows.rows) {
    sheetSha.set(shaRow.id, shaRow.sha256);
  }
  for (const d of drafts.rows) {
    const row = await app.pool.query<{ id: string; revision: number; title: string; effective_date: string; run_out_until: string | null; sheet_id: string | null }>(
      'SELECT id, revision, title, effective_date::text, run_out_until::text, sheet_id FROM drafts WHERE id = $1',
      [d.id]
    );
    const rows = await app.pool.query<{ sku_code: string; kind: string; revised_mrp_paise: number; old_rate: number | null; new_rate: number | null }>(
      'SELECT sku_code, kind, revised_mrp_paise, old_rate, new_rate FROM draft_rows WHERE draft_id = $1 ORDER BY row_index',
      [d.id]
    );
    draftOut.push(draftBody(row.rows[0], rows.rows, skuNames, ctx.publishedRows, launchPaise));
  }
  const noticesOut = [];
  for (const l of latest.rows) {
    const body = await versionBodyFull(app, l.number, l.version);
    if (body) noticesOut.push(body);
  }
  noticesOut.sort((a, b) => {
    const ea = isoToDay(String((a as Record<string, unknown>).effectiveDate))!;
    const eb = isoToDay(String((b as Record<string, unknown>).effectiveDate))!;
    return eb - ea;
  });
  const held = await app.pool.query<{ c: number }>('SELECT count(*)::int AS c FROM held_work');
  return {
    copyId: app.copyId,
    messagesQueued: !app.svix.reachable,
    workQueued: !app.queue.reachable,
    searchState: app.search.reachable ? (app.search.behind ? 'behind' : 'current') : 'down',
    heldWork: held.rows[0].c,
    counts: { drinks: drinksCount, skus, notices: noticesCount, scheduledRevisions: scheduled },
    drafts: draftOut,
    notices: noticesOut,
  };
}

async function versionBodyFull(app: App, number: string, version: number): Promise<Record<string, unknown> | null> {
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
  const maxV = (await app.pool.query<{ max: number }>('SELECT max(version) AS max FROM notice_versions WHERE number = $1', [number])).rows[0].max;
  const state = maxV > version ? 'superseded' : isoToDay(row.effective_date)! <= isoToDay(today)! ? 'in_effect' : 'scheduled';
  const outRows = rows.rows.map((r) => ({
    skuCode: r.sku_code,
    name: r.name,
    kind: r.kind,
    oldMrpPaise: r.old_mrp_paise,
    revisedMrpPaise: r.revised_mrp_paise,
    oldRate: r.old_rate,
    newRate: r.new_rate,
    ceilingPaise: r.kind === 'sticker' && r.old_rate !== null && r.new_rate !== null ? ceilingFor(r.old_mrp_paise, r.old_rate, r.new_rate) : null,
  }));
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
    sheet: row.sheet_id ? { id: row.sheet_id, sha256: sheetSha.get(row.sheet_id) ?? '' } : null,
    rows: outRows,
  };
}

export async function apiEditorNotices(app: App, res: ServerResponse): Promise<void> {
  const body = await apiEditorNoticesBody(app);
  sendJson(res, 200, body);
}

/** Batches the one price decision would sticker from this notice if published and today were its effective date. */
async function stickerBatches(app: App, skuCode: string, effectiveDate: IsoDate): Promise<string[]> {
  const batches = await app.pool.query<{ code: string; packed_date: string; shelf_days: number }>(
    `SELECT b.code, b.packed_date::text, s.shelf_days FROM batches b JOIN skus s ON s.code = b.sku_code WHERE b.sku_code = $1 ORDER BY b.code`,
    [skuCode]
  );
  const out: string[] = [];
  const effDay = isoToDay(effectiveDate)!;
  for (const b of batches.rows) {
    const packedDay = isoToDay(b.packed_date)!;
    const bb = packedDay + b.shelf_days;
    if (effDay > bb) continue; // past best-before on that date
    if (packedDay < effDay) out.push(b.code); // printed before the effective date
  }
  return out;
}

async function previewBody(
  app: App,
  rows: RowInput[],
  effectiveDate: IsoDate,
  runOutUntil: IsoDate | null,
  correctionOf?: { number: string; latestVersion: number; effectiveDate: IsoDate }
): Promise<Record<string, unknown>> {
  const ctx = await loadCheckContext(app, correctionOf);
  const blocking = runPublishChecks(rows, effectiveDate, runOutUntil, ctx);
  const skuNames = await loadSkuNames(app);
  const launch = await app.pool.query<{ code: string; launch_mrp_paise: number }>('SELECT code, launch_mrp_paise FROM skus');
  const launchPaise = new Map(launch.rows.map((x) => [x.code, x.launch_mrp_paise]));
  const outRows = [];
  for (const r of rows) {
    const old = oldMrpPaiseFor({ sku_code: r.skuCode, kind: r.kind }, effectiveDate, ctx.publishedRows, launchPaise.get(r.skuCode) ?? 0);
    outRows.push({
      skuCode: r.skuCode,
      name: skuNames.get(r.skuCode) ?? r.skuCode,
      kind: r.kind,
      oldMrpPaise: old,
      ceilingPaise: r.kind === 'sticker' && r.oldRate !== null && r.newRate !== null ? ceilingFor(old, r.oldRate, r.newRate) : null,
      revisedMrpPaise: r.revisedMrpPaise,
      stickerBatches: r.kind === 'sticker' ? await stickerBatches(app, r.skuCode, effectiveDate) : [],
    });
  }
  return { blocking: blocking ? blocking.body : null, rows: outRows };
}
