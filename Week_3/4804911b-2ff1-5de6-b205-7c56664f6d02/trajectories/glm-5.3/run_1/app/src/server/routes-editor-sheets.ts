import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { App } from './main.js';
import { sendJson, readRaw } from './api/http.js';
import { refuseSheet, parseCsv, REFUSAL_MESSAGES, MAX_SHEET_BYTES } from './domain/sheet.js';
import { resolveRow, normaliseDescription, type Catalogue } from './domain/resolve.js';

interface SheetRowOut {
  rowNumber: number;
  raw: { code: string; description: string; newMrp: string; oldGst: string; newGst: string };
  status: string;
  matchedBy: string | null;
  skuCode: string | null;
  candidates: string[];
  reason: string | null;
  newMrpPaise: number | null;
  oldRate: number | null;
  newRate: number | null;
  mergedIntoRow: number | null;
  ignored: boolean;
}

function rowToOut(r: Record<string, unknown>, rowNumber: number): SheetRowOut {
  return {
    rowNumber,
    raw: {
      code: String(r.code ?? ''),
      description: String(r.description ?? ''),
      newMrp: String(r.new_mrp ?? ''),
      oldGst: String(r.old_gst ?? ''),
      newGst: String(r.new_gst ?? ''),
    },
    status: String(r.status),
    matchedBy: (r.matched_by as string | null) ?? null,
    skuCode: (r.sku_code as string | null) ?? null,
    candidates: r.candidates ? (JSON.parse(String(r.candidates)) as string[]) : [],
    reason: (r.reason as string | null) ?? null,
    newMrpPaise: (r.new_mrp_paise as number | null) ?? null,
    oldRate: (r.old_rate as number | null) ?? null,
    newRate: (r.new_rate as number | null) ?? null,
    mergedIntoRow: (r.merged_into_row as number | null) ?? null,
    ignored: Boolean(r.ignored),
  };
}

async function loadCatalogue(app: App): Promise<Catalogue> {
  const drinks = await app.pool.query<{ id: string; name: string }>('SELECT id, name FROM drinks ORDER BY lineup_order');
  const skus = await app.pool.query<{ code: string; drink_id: string; drink_name: string; variant: string; format: string; size_ml: number }>(
    `SELECT s.code, s.drink_id, d.name AS drink_name, s.variant, s.format, s.size_ml FROM skus s JOIN drinks d ON d.id = s.drink_id ORDER BY s.catalogue_order`
  );
  const aliasRows = await app.pool.query<{ sku_code: string; alias: string }>('SELECT sku_code, alias FROM aliases');
  const aliases = new Map<string, string>();
  for (const a of aliasRows.rows) aliases.set(normaliseDescription(a.alias), a.sku_code);
  return {
    drinks: drinks.rows.map((d) => ({ id: d.id, name: d.name })),
    skus: skus.rows.map((s) => ({ code: s.code, drinkId: s.drink_id, drinkName: s.drink_name, variant: s.variant, name: `${s.drink_name} ${s.variant}`, format: s.format as 'carton' | 'pet' | 'glass' | 'can', sizeMl: s.size_ml })),
    aliases,
  };
}

function sheetCounts(rows: SheetRowOut[]): { matched: number; ambiguous: number; unmatched: number; settled: number } {
  let matched = 0;
  let ambiguous = 0;
  let unmatched = 0;
  let settled = 0;
  for (const r of rows) {
    if (r.status === 'matched') matched++;
    else if (r.status === 'ambiguous') ambiguous++;
    else if (r.status === 'unmatched') unmatched++;
    else settled++;
  }
  return { matched, ambiguous, unmatched, settled };
}

async function sheetOut(app: App, id: string, includeRows: boolean): Promise<Record<string, unknown> | null> {
  const s = await app.pool.query<{ id: string; filename: string; sha256: string; size_bytes: number; imported_at: Date; row_count: number }>(
    'SELECT id, filename, sha256, size_bytes, imported_at, row_count FROM sheets WHERE id = $1',
    [id]
  );
  if (s.rows.length === 0) return null;
  const sheet = s.rows[0];
  const rows = await app.pool.query('SELECT * FROM sheet_rows WHERE sheet_id = $1 ORDER BY row_number', [id]);
  const outRows = rows.rows.map((r) => rowToOut(r as unknown as Record<string, unknown>, Number((r as unknown as { row_number: number }).row_number)));
  const counts = sheetCounts(outRows);
  const base: Record<string, unknown> = {
    id: sheet.id,
    filename: sheet.filename,
    sha256: sheet.sha256,
    sizeBytes: sheet.size_bytes,
    importedAt: sheet.imported_at.toISOString(),
    rowCount: sheet.row_count,
    counts,
    reused: false,
  };
  if (includeRows) base.rows = outRows;
  return base;
}

/** The duplicate rule: same SKU with same values merges, different values conflicts. */
async function rerunDuplicates(app: App, sheetId: string): Promise<void> {
  const rows = await app.pool.query('SELECT * FROM sheet_rows WHERE sheet_id = $1 ORDER BY row_number', [sheetId]);
  const bySku = new Map<string, Array<{ row_number: number; new_mrp_paise: number | null; old_rate: number | null; new_rate: number | null; ignored: boolean; status: string; settled_final: boolean }>>();
  for (const r of rows.rows) {
    const rr = r as unknown as Record<string, unknown>;
    if (rr.status === 'unmatched' && rr.reason === 'unreadable_values') continue;
    if (rr.ignored) continue;
    if (rr.sku_code === null) continue;
    if (rr.merged_into_row !== null) continue;
    const final = rr.status === 'settled' && rr.reason === 'conflicting_prices' && Boolean(rr.final_settled);
    const list = bySku.get(String(rr.sku_code)) ?? [];
    list.push({ row_number: Number(rr.row_number), new_mrp_paise: (rr.new_mrp_paise as number | null), old_rate: (rr.old_rate as number | null), new_rate: (rr.new_rate as number | null), ignored: false, status: String(rr.status), settled_final: final });
    bySku.set(String(rr.sku_code), list);
  }
  const conflicted = new Set<number>();
  const merged = new Map<number, number>();
  for (const [, list] of bySku) {
    if (list.length < 2) continue;
    const groups = new Map<string, number[]>();
    for (const r of list) {
      const key = `${r.new_mrp_paise}|${r.old_rate}|${r.new_rate}`;
      const g = groups.get(key) ?? [];
      g.push(r.row_number);
      groups.set(key, g);
    }
    for (const [, g] of groups) {
      if (g.length > 1) {
        const first = Math.min(...g);
        for (const rn of g) if (rn !== first) merged.set(rn, first);
      }
    }
    if (groups.size > 1) {
      for (const r of list) {
        if (r.settled_final) continue;
        conflicted.add(r.row_number);
      }
    }
  }
  for (const rn of conflicted) {
    await app.pool.query(
      "UPDATE sheet_rows SET status = 'ambiguous', reason = 'conflicting_prices', matched_by = NULL, candidates = $3, merged_into_row = NULL WHERE sheet_id = $1 AND row_number = $2 AND (status <> 'settled' OR reason <> 'conflicting_prices' OR final_settled IS NOT TRUE)",
      [sheetId, rn, JSON.stringify([bySku.get(findSkuOfRow(rows.rows, rn)) ?? []].flat() as unknown as string[])]
    );
  }
  for (const [rn, first] of merged) {
    if (conflicted.has(rn)) continue;
    await app.pool.query("UPDATE sheet_rows SET merged_into_row = $3 WHERE sheet_id = $1 AND row_number = $2", [sheetId, rn, first]);
  }
}

function findSkuOfRow(rows: Array<unknown>, rowNumber: number): string {
  for (const r of rows) {
    const rr = r as unknown as Record<string, unknown>;
    if (Number(rr.row_number) === rowNumber) return String(rr.sku_code ?? '');
  }
  return '';
}

export async function apiImportSheet(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const ct = String(req.headers['content-type'] ?? '');
  if (!ct.toLowerCase().includes('multipart/form-data')) {
    return sendJson(res, 400, { error: 'bad_json', message: 'Send the sheet as multipart/form-data.' });
  }
  const { bytes, overLimit } = await readRaw(req, MAX_SHEET_BYTES + 65536);
  if (overLimit || bytes.length > MAX_SHEET_BYTES) {
    return sendJson(res, 413, { error: 'sheet_too_large', message: REFUSAL_MESSAGES.sheet_too_large });
  }
  // Extract the file part from the multipart body.
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
  if (!boundaryMatch) return sendJson(res, 400, { error: 'bad_json', message: 'Send the sheet as multipart/form-data.' });
  const boundary = `--${boundaryMatch[1] ?? boundaryMatch[2]}`;
  const fileBytes = extractMultipartFile(bytes, boundary);
  if (!fileBytes) return sendJson(res, 422, { error: 'validation', message: 'Send the sheet as multipart/form-data.', fields: { file: 'Choose a file.' } });
  const refusal = refuseSheet(fileBytes.bytes);
  if (refusal) return sendJson(res, refusal.status, { error: refusal.code, message: REFUSAL_MESSAGES[refusal.code] });
  const sha = app.storage.sha256(fileBytes.bytes);
  // Re-import: same bytes resolve to the one stored sheet.
  const known = await app.pool.query<{ id: string }>('SELECT id FROM sheets WHERE sha256 = $1', [sha]);
  if (known.rows.length > 0) {
    const sheet = await sheetOut(app, known.rows[0].id, true);
    return sendJson(res, 200, { sheet: { ...(sheet as Record<string, unknown>), reused: true } });
  }
  // A sheet record exists only once MinIO has confirmed its object.
  let stored: boolean;
  try {
    await app.storage.putObject(`${app.copyId}/sheets/${sha}`, fileBytes.bytes, 'text/csv');
    stored = true;
  } catch {
    return sendJson(res, 503, { error: 'storage_unavailable', message: 'Stored copies are unavailable right now. The prices on this page are still correct.' });
  }
  if (!stored) return sendJson(res, 503, { error: 'storage_unavailable', message: 'Stored copies are unavailable right now. The prices on this page are still correct.' });
  const catalogue = await loadCatalogue(app);
  const parsed = parseCsv(fileBytes.text);
  void catalogue;
  const id = randomBytes(12).toString('hex');
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const again = await client.query<{ id: string }>('SELECT id FROM sheets WHERE sha256 = $1 FOR UPDATE', [sha]);
    if (again.rows.length > 0) {
      await client.query('COMMIT');
      const sheet = await sheetOut(app, again.rows[0].id, true);
      return sendJson(res, 200, { sheet: { ...(sheet as Record<string, unknown>), reused: true } });
    }
    const filename = fileBytes.filename ?? 'sheet.csv';
    await client.query(
      'INSERT INTO sheets (id, filename, sha256, size_bytes, imported_at, row_count, object_confirmed) VALUES ($1, $2, $3, $4, now(), $5, true)',
      [id, filename, sha, fileBytes.bytes.length, parsed.rows.length]
    );
    for (let i = 0; i < parsed.rows.length; i++) {
      const raw = parsed.rows[i];
      const resolved = resolveRow(raw, catalogue);
      await client.query(
        `INSERT INTO sheet_rows (sheet_id, row_number, code, description, new_mrp, old_gst, new_gst, status, matched_by, sku_code, candidates, reason, new_mrp_paise, old_rate, new_rate, ignored)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, false)`,
        [
          id,
          i + 1,
          raw.code,
          raw.description,
          raw.newMrp,
          raw.oldGst,
          raw.newGst,
          resolved.status,
          resolved.matchedBy,
          resolved.skuCode,
          resolved.candidates.length > 0 ? JSON.stringify(resolved.candidates) : null,
          resolved.reason,
          resolved.newMrpPaise,
          resolved.oldRate,
          resolved.newRate,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  await rerunDuplicates(app, id);
  const sheet = await sheetOut(app, id, true);
  sendJson(res, 201, { sheet });
}

interface ExtractedFile {
  bytes: Buffer;
  text: string;
  filename: string | null;
}

function extractMultipartFile(body: Buffer, boundary: string): ExtractedFile | null {
  const start = body.indexOf(Buffer.from(`${boundary}\r\n`));
  if (start === -1) return null;
  const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), start);
  if (headerEnd === -1) return null;
  const headerText = body.subarray(start, headerEnd).toString('utf8');
  const next = body.indexOf(Buffer.from(`\r\n${boundary}`), headerEnd);
  const contentEnd = next === -1 ? body.length : next;
  let content = body.subarray(headerEnd + 4, contentEnd);
  // strip the final boundary CRLF if present
  if (content.subarray(content.length - 2).toString('latin1') === '\r\n') {
    content = content.subarray(0, content.length - 2);
  }
  const nameMatch = /filename="([^"]*)"/.exec(headerText);
  const fieldMatch = /name="([^"]*)"/.exec(headerText);
  if (!fieldMatch || fieldMatch[1] !== 'file') return null;
  const filename = nameMatch ? nameMatch[1].split(/[\\/]/).pop() ?? null : null;
  return { bytes: content, text: content.toString('utf8'), filename };
}

export async function apiListSheets(app: App, res: ServerResponse): Promise<void> {
  const r = await app.pool.query<{ id: string }>('SELECT id FROM sheets ORDER BY imported_at DESC, id');
  const sheets = [];
  for (const s of r.rows) {
    const out = await sheetOut(app, s.id, false);
    if (out) sheets.push(out);
  }
  sendJson(res, 200, { sheets });
}

export async function apiGetSheet(app: App, res: ServerResponse, id: string): Promise<void> {
  const sheet = await sheetOut(app, id, true);
  if (!sheet) return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
  sendJson(res, 200, { sheet });
}

export async function apiSheetLink(app: App, res: ServerResponse, id: string): Promise<void> {
  const s = await app.pool.query<{ sha256: string }>('SELECT sha256 FROM sheets WHERE id = $1', [id]);
  if (s.rows.length === 0) return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
  try {
    const link = await app.storage.presignGet(`${app.copyId}/sheets/${s.rows[0].sha256}`);
    sendJson(res, 200, { url: link, expiresInSeconds: 60, sha256: s.rows[0].sha256 }, { 'Cache-Control': 'no-store' });
  } catch {
    sendJson(res, 503, { error: 'storage_unavailable', message: 'Stored copies are unavailable right now. The prices on this page are still correct.' });
  }
}

export async function apiSheetDownload(app: App, res: ServerResponse, id: string): Promise<void> {
  const s = await app.pool.query<{ sha256: string; filename: string }>('SELECT sha256, filename FROM sheets WHERE id = $1', [id]);
  if (s.rows.length === 0) return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
  try {
    const link = await app.storage.presignGet(`${app.copyId}/sheets/${s.rows[0].sha256}`);
    res.writeHead(302, { Location: link, 'Cache-Control': 'no-store' });
    res.end();
  } catch {
    sendJson(res, 503, { error: 'storage_unavailable', message: 'Stored copies are unavailable right now. The prices on this page are still correct.' });
  }
}

export { loadCatalogue, sheetOut, rerunDuplicates };
