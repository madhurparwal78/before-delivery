// Sheets, issue, links, rig views and mask jobs (DP-38 to DP-51).

import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { route, respond, fail, respondBytes, respondNoContent, type Ctx, type Route } from './route-context.js';
import { problems } from './api-core.js';
import { renderPdf } from './press.js';
import { renderSheetHtml, scaleDenominator, brusselsWallClock } from './sheet-html.js';
import { writeOutbox } from './events.js';
import { beginKeyed, finishKeyed } from './keyed.js';
import { computeCell } from './photometrics.js';
import { fromInteger, fromString, roundHalfEven, toString as decToString } from '../shared/decimal.js';
import { sha256Hex } from './hash.js';
import type { ModelRecord, SiteRecord, LayoutRecord } from './layout-types.js';
import { loadPlacements, loadLayout, geometriesOf, cellInputs, four } from './layout-helpers.js';

const TECH_LINK_TOKEN_BYTES = 24;
const RATE_LIMIT_REQUESTS = 30;
const RATE_LIMIT_SECONDS = 60;

export function sheetRoutes(): Route[] {
  return [
    route('POST', '/api/layouts/:layoutId/issue', issueSheet, { keyed: true }),
    route('POST', '/api/layouts/:layoutId/mask-jobs', postMaskJob, { keyed: true }),
    route('GET', '/api/sheets/:sheetId', getSheet),
    route('GET', '/api/sheets/:sheetId/pdf', getSheetPdf),
    route('POST', '/api/sheets/:sheetId/withdraw', withdrawSheet),
    route('POST', '/api/sheets/:sheetId/link', newLink),
    route('DELETE', '/api/sheets/:sheetId/link', endLink),
    route('GET', '/api/mask-jobs/:jobId', getMaskJob),
    route('DELETE', '/api/mask-jobs/:jobId', cancelMaskJob),
    route('GET', '/api/mask-jobs/:jobId/bundle', getMaskBundle),
    route('GET', '/api/rig/:token', getRig),
    route('GET', '/api/rig/:token/sheet.pdf', getRigPdf),
    route('POST', '/api/rig/:token/circuits/:circuitId/live', setRigCircuitLive),
    route('GET', '/api/rig/:token/events', rigEvents),
    route('GET', '/api/events', appEvents),
  ];
}

// Issue checks run in order: every placement Bodied, every serial still on the shelf or
// at the site, no overload, then the binding; Issued commits only after the PDF is
// rendered and its stored object's size and checksum are read back and agree.
async function issueSheet(ctx: Ctx): Promise<void> {
  const loaded = await ctx.db.withClient(async (client) => {
    const { layout, site } = await loadLayout(client, ctx.params.layoutId!);
    const placements = await loadPlacements(client, layout.id);
    return { layout, site, placements };
  });
  if (!loaded.ok) fail(loaded.problem);
  const { layout, site, placements } = loaded.value;

  const shortfall = placements.filter((p) => p.status !== 'Bodied').length;
  if (shortfall > 0) fail(problems.layoutNeedsBodies(shortfall));

  const checked = await ctx.db.withClient(async (client) => {
    for (const placement of placements) {
      if (placement.body_serial === null) continue;
      const location = await locationOf(client, placement.body_serial);
      if (location !== 'shelf' && location !== `site:${site.id}`) {
        return { kind: 'unavailable' as const, serial: placement.body_serial };
      }
    }
    return { kind: 'ok' as const };
  });
  if (!checked.ok) fail(checked.problem);
  if (checked.value.kind === 'unavailable') fail(problems.bodyNotAvailable(checked.value.serial));

  const circuits = await ctx.db.withClient(async (client) => {
    const rows = await client.query<{ id: string; name: string; kind: string; capacity_watts: number }>(
      'SELECT id, name, kind, capacity_watts FROM circuits WHERE site_id = $1 ORDER BY name',
      [site.id],
    );
    const loads = new Map<string, number>();
    for (const placement of placements) {
      if (placement.body_serial === null) continue;
      const unit = await client.query<{ model_code: string }>('SELECT model_code FROM units WHERE serial = $1', [placement.body_serial]);
      const model = (await client.query<ModelRecord>('SELECT * FROM models WHERE code = $1', [unit.rows[0]?.model_code ?? ''])).rows[0];
      if (model === undefined) continue;
      loads.set(placement.circuit_id, (loads.get(placement.circuit_id) ?? 0) + model.rated_watts);
    }
    return rows.rows.map((circuit) => {
      const load = loads.get(circuit.id) ?? 0;
      return { id: circuit.id, name: circuit.name, kind: circuit.kind, loadWatts: load, capacityWatts: circuit.capacity_watts, overloaded: load > circuit.capacity_watts };
    });
  });
  if (!circuits.ok) fail(circuits.problem);
  const overloaded = circuits.value.find((c) => c.overloaded);
  if (overloaded !== undefined) fail(problems.circuitOverloaded(overloaded.name, overloaded.loadWatts, overloaded.capacityWatts));

  // The lowest contrast among covered cells that have a reading.
  const cellsResult = await ctx.db.withClient(async (client) => {
    const cells = await cellInputs(client, site);
    const geometries = await geometriesOf(client, placements);
    return { cells, geometries };
  });
  if (!cellsResult.ok) fail(cellsResult.problem);
  let lowest: number | null = null;
  for (const cell of cellsResult.value.cells) {
    if (cell.ambientLux === null) continue;
    const figures = computeCell(cellsResult.value.geometries, cell);
    if (figures.contributions.length === 0) continue;
    const contrast = four(figures.contrast ?? fromInteger(0));
    lowest = lowest === null ? contrast : Math.min(lowest, contrast);
  }

  const sheetVersion = await ctx.db.withClient(async (client) => {
    const result = await client.query<{ version: number }>(
      'SELECT COALESCE(MAX(version), 0) + 1 AS version FROM sheets WHERE layout_id = $1',
      [layout.id],
    );
    return result.rows[0]!.version;
  });
  if (!sheetVersion.ok) fail(sheetVersion.problem);

  const html = renderSheetHtml({
    siteName: site.name,
    layoutName: layout.name,
    version: sheetVersion.value,
    showTimeLocal: brusselsWallClock(site.show_at),
    lowestContrast: lowest === null ? null : lowest.toFixed(1),
    scaleDenominator: scaleDenominator(Number(site.width_metres), Number(site.height_metres)),
    wallWidthMetres: site.width_metres,
    wallHeightMetres: site.height_metres,
    placements: placements.map((p) => ({
      bodySerial: p.body_serial ?? 'Needs a body',
      lensSerial: p.lens_serial,
      aimAcross: oneDecimal(p.aim_across),
      aimDown: oneDecimal(p.aim_down),
      standoff: oneDecimal(p.standoff),
      ratio: oneDecimal(p.ratio),
      shiftAcross: oneDecimal(p.shift_across),
      shiftDown: oneDecimal(p.shift_down),
    })),
    circuits: circuits.value.map((c) => ({ name: c.name, kind: c.kind, loadWatts: c.loadWatts, capacityWatts: c.capacityWatts })),
  });

  const pdf = await renderPdf(ctx.config.gotenbergUrl, html);
  if (pdf === null) fail(problems.pressUnavailable());

  const sheetId = `sheet_${randomBytes(9).toString('hex')}`;
  const key = `sheets/${sheetId}/rig-sheet.pdf`;
  const sha = sha256Hex(pdf.pdf);
  try {
    await ctx.s3.put(key, pdf.pdf, 'application/pdf');
    const head = await ctx.s3.head(key);
    const readBack = await ctx.s3.get(key);
    if (head === null || head.size !== pdf.pdf.length || readBack === null || sha256Hex(readBack) !== sha) {
      fail(problems.sheetStoreUnavailable());
    }
  } catch {
    fail(problems.sheetStoreUnavailable());
  }

  const issued = await ctx.db.withClient(async (client) => {
    const keyed = await beginKeyed(ctx, client);
    if (keyed.kind === 'replay') return { kind: 'replay' as const, status: keyed.status!, body: keyed.body };
    const fresh = await loadLayout(client, layout.id);
    if (fresh.layout.version !== layout.version) return { kind: 'conflict' as const };
    // one active sheet per layout
    const active = await client.query<{ id: string }>(
      `SELECT id FROM sheets WHERE layout_id = $1 AND status IN ('Issued','Out of step')`,
      [layout.id],
    );
    if (active.rows.length > 0) return { kind: 'already' as const };
    const nowResult = await client.query<{ now: Date }>('SELECT now() AS now');
    const now = new Date(nowResult.rows[0]!.now);
    await client.query(
      `INSERT INTO sheets (id, layout_id, version, status, issued_at, layout_hash, layout_version, sha256, bytes, key, lowest_contrast)
       VALUES ($1,$2,$3,'Issued',$4,$5,$6,$7,$8,$9,$10)`,
      [sheetId, layout.id, sheetVersion.value, now, layout.layout_hash, layout.version, sha, String(pdf.pdf.length), key, lowest === null ? null : lowest.toFixed(1)],
    );
    for (const placement of placements) {
      if (placement.body_serial !== null) {
        await client.query('INSERT INTO sheet_bindings (sheet_id, serial) VALUES ($1,$2) ON CONFLICT DO NOTHING', [sheetId, placement.body_serial]);
      }
      await client.query('INSERT INTO sheet_bindings (sheet_id, serial) VALUES ($1,$2) ON CONFLICT DO NOTHING', [sheetId, placement.lens_serial]);
    }
    await client.query(`UPDATE layouts SET sheet_status = 'Issued' WHERE id = $1`, [layout.id]);
    await writeOutbox(client, 'sheet.changed', 'sheet', sheetId, { id: sheetId, status: 'Issued' });
    const json = await sheetJsonFor(client, sheetId);
    await finishKeyed(ctx, client, 201, json);
    return { kind: 'fresh' as const, body: json };
  });
  if (!issued.ok) fail(issued.problem);
  if (issued.value.kind === 'replay') {
    respond(ctx, issued.value.status, issued.value.body as never, { 'Idempotency-Replayed': 'true' });
    return;
  }
  if (issued.value.kind === 'conflict') fail(problems.layoutChanged());
  if (issued.value.kind === 'already') fail(problems.sheetAlreadyIssued());
  respond(ctx, 201, issued.value.body);
}

function oneDecimal(text: string): string {
  const decimal = fromString(text);
  if (decimal === null) return text;
  return decToString(roundHalfEven(decimal, 1));
}

async function locationOf(client: PoolClient, serial: string): Promise<string> {
  const rows = await client.query<{ location: string }>(
    `SELECT e.location FROM movement_entries e
       JOIN movements m ON m.id = e.movement_id
      WHERE m.serial = $1 AND e.delta = 1
        AND NOT EXISTS (SELECT 1 FROM movements r WHERE r.reverses_id = m.id AND r.serial = m.serial)
      ORDER BY m.at DESC, m.id DESC LIMIT 1`,
    [serial],
  );
  return rows.rows[0]?.location ?? 'outside';
}

async function sheetJsonFor(client: PoolClient, sheetId: string): Promise<Record<string, unknown>> {
  const sheet = (await client.query<SheetRecord>('SELECT * FROM sheets WHERE id = $1', [sheetId])).rows[0];
  if (sheet === undefined) fail(problems.notFound());
  const link = (await client.query<{ token: string; ends_at: Date }>(
    'SELECT token, ends_at FROM links WHERE sheet_id = $1 AND NOT revoked ORDER BY created_at DESC LIMIT 1',
    [sheetId],
  )).rows[0];
  const circuits = await sheetCircuits(client, sheetId);
  return {
    id: sheet.id,
    layoutId: sheet.layout_id,
    version: sheet.version,
    status: sheet.status,
    issuedAt: instant(sheet.issued_at),
    layoutHash: sheet.layout_hash,
    sha256: sheet.sha256,
    bytes: Number(sheet.bytes),
    key: sheet.key,
    techUrl: link === undefined ? null : `/rig/${link.token}`,
    linkEndsAt: link === undefined ? null : instant(link.ends_at),
    linkActive: link !== undefined,
    lowestContrast: sheet.lowest_contrast,
    circuits,
  };
}

interface SheetRecord {
  id: string;
  layout_id: string;
  version: number;
  status: 'Issued' | 'Out of step' | 'Withdrawn';
  issued_at: Date;
  layout_hash: string;
  layout_version: number;
  sha256: string;
  bytes: string;
  key: string;
  lowest_contrast: string | null;
}

function instant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

async function sheetCircuits(client: PoolClient, sheetId: string): Promise<unknown[]> {
  const sheet = (await client.query<SheetRecord>('SELECT * FROM sheets WHERE id = $1', [sheetId])).rows[0];
  if (sheet === undefined) return [];
  const layout = (await client.query<LayoutRecord>('SELECT * FROM layouts WHERE id = $1', [sheet.layout_id])).rows[0];
  if (layout === undefined) return [];
  const rows = await client.query<{ id: string; name: string; kind: string; capacity_watts: number }>(
    'SELECT id, name, kind, capacity_watts FROM circuits WHERE site_id = (SELECT site_id FROM layouts WHERE id = $1) ORDER BY name',
    [sheet.layout_id],
  );
  const placements = await loadPlacements(client, sheet.layout_id);
  const loads = new Map<string, number>();
  for (const placement of placements) {
    if (placement.body_serial === null) continue;
    const unit = await client.query<{ model_code: string }>('SELECT model_code FROM units WHERE serial = $1', [placement.body_serial]);
    const model = (await client.query<ModelRecord>('SELECT * FROM models WHERE code = $1', [unit.rows[0]?.model_code ?? ''])).rows[0];
    if (model === undefined) continue;
    loads.set(placement.circuit_id, (loads.get(placement.circuit_id) ?? 0) + model.rated_watts);
  }
  const live = await client.query<{ circuit_id: string; live: boolean; confirmed_at: Date }>(
    'SELECT circuit_id, live, confirmed_at FROM circuit_live WHERE sheet_id = $1',
    [sheetId],
  );
  const liveByCircuit = new Map(live.rows.map((row) => [row.circuit_id, row]));
  return rows.rows.map((circuit) => {
    const state = liveByCircuit.get(circuit.id);
    return {
      id: circuit.id,
      name: circuit.name,
      kind: circuit.kind,
      loadWatts: loads.get(circuit.id) ?? 0,
      capacityWatts: circuit.capacity_watts,
      live: state?.live ?? false,
      confirmedAt: state === undefined ? null : instant(state.confirmed_at),
    };
  });
}

async function getSheet(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    return sheetJsonFor(client, ctx.params.sheetId!);
  });
  if (!result.ok) fail(result.problem);
  respond(ctx, 200, result.value);
}

async function getSheetPdf(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const sheet = (await client.query<SheetRecord>('SELECT * FROM sheets WHERE id = $1', [ctx.params.sheetId])).rows[0];
    return sheet ?? null;
  });
  if (!result.ok) fail(result.problem);
  if (result.value === null) fail(problems.notFound());
  const bytes = await ctx.s3.get(result.value.key);
  if (bytes === null) fail(problems.sheetStoreUnavailable());
  respondBytes(ctx, 200, bytes, 'application/pdf', { ETag: `"${result.value.sha256}"` });
}

async function withdrawSheet(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const sheet = (await client.query<SheetRecord>('SELECT * FROM sheets WHERE id = $1 FOR UPDATE', [ctx.params.sheetId])).rows[0];
    if (sheet === undefined) return { kind: 'missing' as const };
    if (sheet.status === 'Withdrawn') return { kind: 'withdrawn' as const };
    await client.query(`UPDATE sheets SET status = 'Withdrawn', withdrawn_at = now() WHERE id = $1`, [sheet.id]);
    await client.query(`UPDATE sheet_bindings SET active = false WHERE sheet_id = $1`, [sheet.id]);
    await client.query(`UPDATE layouts SET sheet_status = 'Withdrawn' WHERE id = $1`, [sheet.layout_id]);
    await client.query(`UPDATE links SET revoked = true WHERE sheet_id = $1`, [sheet.id]);
    await writeOutbox(client, 'sheet.changed', 'sheet', sheet.id, { id: sheet.id, status: 'Withdrawn' });
    const json = await sheetJsonFor(client, sheet.id);
    await client.query('COMMIT');
    return { kind: 'ok' as const, body: json };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'missing') fail(problems.notFound());
  if (result.value.kind === 'withdrawn') fail(problems.sheetWithdrawn());
  respond(ctx, 200, result.value.body);
}

// A sheet has at most one active link; regeneration kills the old one at once and
// keeps the same end.
async function newLink(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const sheet = (await client.query<SheetRecord>('SELECT * FROM sheets WHERE id = $1 FOR UPDATE', [ctx.params.sheetId])).rows[0];
    if (sheet === undefined) return { kind: 'missing' as const };
    if (sheet.status === 'Withdrawn') return { kind: 'withdrawn' as const };
    const existing = (await client.query<{ ends_at: Date }>(
      'SELECT ends_at FROM links WHERE sheet_id = $1 AND NOT revoked ORDER BY created_at DESC LIMIT 1',
      [sheet.id],
    )).rows[0];
    const endsAt = existing === undefined
      ? new Date(sheet.issued_at.getTime() + ctx.config.techLinkSeconds * 1000)
      : existing.ends_at;
    const now = new Date();
    if (endsAt.getTime() <= now.getTime()) return { kind: 'window' as const };
    await client.query('UPDATE links SET revoked = true WHERE sheet_id = $1', [sheet.id]);
    const token = randomBytes(TECH_LINK_TOKEN_BYTES).toString('base64url');
    await client.query('INSERT INTO links (token, sheet_id, ends_at) VALUES ($1,$2,$3)', [token, sheet.id, endsAt]);
    const json = await sheetJsonFor(client, sheet.id);
    await client.query('COMMIT');
    return { kind: 'ok' as const, body: json, token };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'missing') fail(problems.notFound());
  if (result.value.kind === 'withdrawn') fail(problems.sheetWithdrawn());
  if (result.value.kind === 'window') fail(problems.linkWindowOver());
  respond(ctx, 201, result.value.body);
}

async function endLink(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    await client.query('UPDATE links SET revoked = true WHERE sheet_id = $1', [ctx.params.sheetId]);
    await client.query('COMMIT');
  });
  if (!result.ok) fail(result.problem);
  respondNoContent(ctx);
}

// The link is a capability URL; before its window a revoked token answers link_ended,
// an unknown token link_not_found, and after it every token answers link_window_over.
async function resolveToken(ctx: Ctx): Promise<{ sheet: SheetRecord; layout: LayoutRecord } | Problem2> {
  const token = ctx.params.token!;
  const result = await ctx.db.withClient(async (client) => {
    const link = (await client.query<{ sheet_id: string; ends_at: Date; revoked: boolean }>(
      'SELECT sheet_id, ends_at, revoked FROM links WHERE token = $1',
      [token],
    )).rows[0];
    const nowResult = await client.query<{ now: Date }>('SELECT now() AS now');
    const now = new Date(nowResult.rows[0]!.now);
    if (link === undefined) return { kind: 'not_found' as const, now };
    if (link.ends_at.getTime() <= now.getTime()) return { kind: 'window' as const, now };
    if (link.revoked) return { kind: 'ended' as const, now };
    const sheet = (await client.query<SheetRecord>('SELECT * FROM sheets WHERE id = $1', [link.sheet_id])).rows[0];
    if (sheet === undefined || sheet.status === 'Withdrawn') return { kind: 'ended' as const, now };
    const layout = (await client.query<LayoutRecord>('SELECT * FROM layouts WHERE id = $1', [sheet.layout_id])).rows[0]!;
    return { kind: 'ok' as const, sheet, layout, now };
  });
  if (!result.ok) return problems.databaseUnavailable();
  const value = result.value;
  if (value.kind === 'not_found') return problems.linkNotFound();
  if (value.kind === 'window') return problems.linkWindowOver();
  if (value.kind === 'ended') return problems.linkEnded();
  return { sheet: value.sheet, layout: value.layout };
}

type Problem2 = { status: number; code: string };

async function getRig(ctx: Ctx): Promise<void> {
  const limited = await applyRateLimit(ctx);
  if (limited !== null) fail(limited);
  const resolved = await resolveToken(ctx);
  if ('status' in resolved) fail(resolved as never);
  const result = await ctx.db.withClient(async (client) => {
    const site = (await client.query<SiteRecord>('SELECT * FROM sites WHERE id = $1', [resolved.layout.site_id])).rows[0]!;
    const circuits = await sheetCircuits(client, resolved.sheet.id);
    return {
      siteName: site.name,
      layoutName: resolved.layout.name,
      sheetStatus: resolved.sheet.status,
      issuedAt: instant(resolved.sheet.issued_at),
      linkEndsAt: null,
      showAt: instant(site.show_at),
      lowestContrast: resolved.sheet.lowest_contrast,
      circuits,
    };
  });
  if (!result.ok) fail(result.problem);
  respond(ctx, 200, result.value, {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
}

async function applyRateLimit(ctx: Ctx): Promise<Problem2 | null> {
  const token = ctx.params.token!;
  const result = await ctx.db.withClient(async (client) => {
    await client.query('DELETE FROM link_requests WHERE token = $1 AND at < now() - interval \'60 seconds\'', [token]);
    const count = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM link_requests WHERE token = $1',
      [token],
    );
    if (count.rows[0]!.n >= RATE_LIMIT_REQUESTS) {
      const oldest = await client.query<{ at: Date }>(
        'SELECT at FROM link_requests WHERE token = $1 ORDER BY at LIMIT 1',
        [token],
      );
      const retryAfter = Math.ceil((new Date(oldest.rows[0]!.at).getTime() + RATE_LIMIT_SECONDS * 1000 - Date.now()) / 1000);
      return { kind: 'limited' as const, retryAfter };
    }
    await client.query('INSERT INTO link_requests (token, at) VALUES ($1, now())', [token]);
    await client.query('COMMIT');
    return { kind: 'ok' as const };
  });
  if (!result.ok) return problems.databaseUnavailable();
  if (result.value.kind === 'limited') {
    return problems.linkRateLimited(result.value.retryAfter);
  }
  return null;
}

async function getRigPdf(ctx: Ctx): Promise<void> {
  const limited = await applyRateLimit(ctx);
  if (limited !== null) fail(limited);
  const resolved = await resolveToken(ctx);
  if ('status' in resolved) fail(resolved as never);
  const bytes = await ctx.s3.get(resolved.sheet.key);
  if (bytes === null) fail(problems.sheetStoreUnavailable());
  respondBytes(ctx, 200, bytes, 'application/pdf', {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
}

// The link changes nothing but the live state of its own circuits.
async function setRigCircuitLive(ctx: Ctx): Promise<void> {
  const body = readJsonBody(ctx);
  const limited = await applyRateLimit(ctx);
  if (limited !== null) fail(limited);
  const resolved = await resolveToken(ctx);
  if ('status' in resolved) fail(resolved as never);
  const applied = await ctx.db.withClient(async (client) => {
    const circuit = (await client.query<{ id: string }>(
      'SELECT id FROM circuits WHERE id = $1',
      [ctx.params.circuitId],
    )).rows[0];
    if (circuit === undefined) return { kind: 'missing' as const };
    const circuits = await sheetCircuits(client, resolved.sheet.id);
    if (!circuits.some((c) => (c as { id: string }).id === circuit.id)) return { kind: 'missing' as const };
    const live = body.live;
    const existing = (await client.query<{ live: boolean }>(
      'SELECT live FROM circuit_live WHERE sheet_id = $1 AND circuit_id = $2',
      [resolved.sheet.id, circuit.id],
    )).rows[0];
    if (existing !== undefined && existing.live === live) return { kind: 'same' as const };
    await client.query(
      `INSERT INTO circuit_live (sheet_id, circuit_id, live, confirmed_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (sheet_id, circuit_id) DO UPDATE SET live = EXCLUDED.live, confirmed_at = now()`,
      [resolved.sheet.id, circuit.id, live],
    );
    const nowResult = await client.query<{ now: Date }>('SELECT now() AS now');
    await writeOutbox(client, 'circuit.confirmed', 'sheet', resolved.sheet.id, {
      circuitId: circuit.id,
      live,
      confirmedAt: instant(new Date(nowResult.rows[0]!.now)),
    });
    await client.query('COMMIT');
    return { kind: 'ok' as const };
  });
  if (!applied.ok) fail(applied.problem);
  if (applied.value.kind === 'missing') fail(problems.notFound());
  if (applied.value.kind === 'same') {
    // a tick that changes nothing writes no event
    respond(ctx, 200, { id: ctx.params.circuitId, live: body.live });
    return;
  }
  respond(ctx, 200, { id: ctx.params.circuitId, live: body.live });
}

function readJsonBody(ctx: Ctx): { live: boolean } {
  if (typeof ctx.jsonBody !== 'object' || ctx.jsonBody === null) fail(problems.malformedBody());
  const object = ctx.jsonBody as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length !== 1 || keys[0] !== 'live') fail(problems.unknownField(keys[0] ?? ''));
  if (typeof object.live !== 'boolean') fail(problems.validationFailed({ '/live': 'Say true or false.' }));
  return { live: object.live };
}

async function rigEvents(ctx: Ctx): Promise<void> {
  const limited = await applyRateLimit(ctx);
  if (limited !== null) fail(limited);
  const resolved = await resolveToken(ctx);
  if ('status' in resolved) fail(resolved as never);
  ctx.service.sse.subscribe(ctx.req, ctx.res, (event) => {
    if (event.aggregate !== 'sheet' || event.aggregate_id !== resolved.sheet.id) return false;
    return event.type === 'sheet.changed' || event.type === 'circuit.confirmed';
  });
}

async function appEvents(ctx: Ctx): Promise<void> {
  ctx.service.sse.subscribe(ctx.req, ctx.res, () => true);
}

// Mask jobs: one step per placement plus one storing step, from the layout as it stood.
async function postMaskJob(ctx: Ctx): Promise<void> {
  const loaded = await ctx.db.withClient(async (client) => {
    const { layout } = await loadLayout(client, ctx.params.layoutId!);
    const placements = await loadPlacements(client, layout.id);
    return { layout, placements };
  });
  if (!loaded.ok) fail(loaded.problem);
  const { layout, placements } = loaded.value;
  const shortfall = placements.filter((p) => p.status !== 'Bodied').length;
  if (shortfall > 0) fail(problems.layoutNeedsBodies(shortfall));
  const result = await ctx.db.withClient(async (client) => {
    const keyed = await beginKeyed(ctx, client);
    if (keyed.kind === 'replay') return { kind: 'replay' as const, status: keyed.status!, body: keyed.body };
    const id = `mask_${randomBytes(9).toString('hex')}`;
    await client.query(
      `INSERT INTO mask_jobs (id, layout_id, layout_hash, phase, steps_done, steps_total)
       VALUES ($1,$2,$3,'queued',0,$4)`,
      [id, layout.id, layout.layout_hash, placements.length + 1],
    );
    for (let position = 0; position < placements.length; position++) {
      await client.query(
        'INSERT INTO mask_steps (job_id, position, serial, state) VALUES ($1,$2,$3,\'pending\')',
        [id, position, placements[position]!.body_serial ?? ''],
      );
    }
    await client.query(
      'INSERT INTO mask_steps (job_id, position, serial, state) VALUES ($1,$2,\'\', \'pending\')',
      [id, placements.length],
    );
    await writeOutbox(client, 'mask_job.changed', 'mask_job', id, { id, phase: 'queued', stepsDone: 0, stepsTotal: placements.length + 1 });
    const json = { id, layoutId: layout.id, layoutHash: layout.layout_hash, phase: 'queued', stepsDone: 0, stepsTotal: placements.length + 1, sha256: null, key: null };
    await finishKeyed(ctx, client, 202, json);
    return { kind: 'fresh' as const, body: json };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'replay') {
    respond(ctx, result.value.status, result.value.body as never, { 'Idempotency-Replayed': 'true' });
    return;
  }
  respond(ctx, 202, result.value.body);
}

async function getMaskJob(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const job = (await client.query<MaskJobRecord>('SELECT * FROM mask_jobs WHERE id = $1', [ctx.params.jobId])).rows[0];
    if (job === undefined) return null;
    return {
      id: job.id,
      layoutId: job.layout_id,
      layoutHash: job.layout_hash,
      phase: job.phase,
      stepsDone: job.steps_done,
      stepsTotal: job.steps_total,
      sha256: job.sha256,
      key: job.key,
    };
  });
  if (!result.ok) fail(result.problem);
  if (result.value === null) fail(problems.notFound());
  respond(ctx, 200, result.value);
}

interface MaskJobRecord {
  id: string;
  layout_id: string;
  layout_hash: string;
  phase: 'queued' | 'rendering' | 'storing' | 'waiting_for_store' | 'done' | 'cancelled';
  steps_done: number;
  steps_total: number;
  sha256: string | null;
  key: string | null;
}

async function cancelMaskJob(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const job = (await client.query<MaskJobRecord>('SELECT * FROM mask_jobs WHERE id = $1 FOR UPDATE', [ctx.params.jobId])).rows[0];
    if (job === undefined) return { kind: 'missing' as const };
    if (job.phase === 'done' || job.phase === 'cancelled') return { kind: 'finished' as const };
    await client.query(`UPDATE mask_jobs SET phase = 'cancelled' WHERE id = $1`, [job.id]);
    await writeOutbox(client, 'mask_job.changed', 'mask_job', job.id, { id: job.id, phase: 'cancelled', stepsDone: job.steps_done, stepsTotal: job.steps_total });
    await client.query('COMMIT');
    return { kind: 'ok' as const, body: { id: job.id, layoutId: job.layout_id, layoutHash: job.layout_hash, phase: 'cancelled', stepsDone: job.steps_done, stepsTotal: job.steps_total, sha256: null, key: null } };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'missing') fail(problems.notFound());
  if (result.value.kind === 'finished') fail(problems.jobFinished());
  respond(ctx, 200, result.value.body);
}

async function getMaskBundle(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const job = (await client.query<MaskJobRecord>('SELECT * FROM mask_jobs WHERE id = $1', [ctx.params.jobId])).rows[0];
    if (job === undefined) return null;
    return job;
  });
  if (!result.ok) fail(result.problem);
  if (result.value === null) fail(problems.notFound());
  const job = result.value;
  if (job.phase !== 'done' || job.key === null) fail(problems.notFound());
  const bytes = await ctx.s3.get(job.key);
  if (bytes === null) fail(problems.sheetStoreUnavailable());
  respondBytes(ctx, 200, bytes, 'application/zip');
}
