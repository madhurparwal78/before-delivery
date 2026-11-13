// Layouts, placements, circuits, sheets, links, rig views and mask jobs
// (DP-28 to DP-51).

import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { route, respond, fail, type Ctx, type Route } from './route-context.js';
import { problems } from './api-core.js';
import { FIELD_COPY } from '../shared/copy.js';
import { checkIfMatch, etagOf, parseEtag } from './boundary.js';
import { writeOutbox } from './events.js';
import { beginKeyed, finishKeyed } from './keyed.js';
import { geometryOf, validatePlacement, overlapErrors, type PlacementRow } from './layouts.js';
import { bumpLayout } from './layouts.js';
import { cellInputs, geometriesOf, cellJson } from './layout-cells.js';
import { computeCell } from './photometrics.js';
import { deratedLumens } from './money.js';
import { parseCellOnGrid } from '../shared/cells.js';
import { checkQuantity, deepUnknownMembers, readJsonObject, type FieldErrors } from './validate.js';
import { parseNumberGrammar } from '../shared/grammar.js';
import { fromString, toString as decToString, fromInteger, mul, type Decimal } from '../shared/decimal.js';
import { LENGTH_UNITS } from '../shared/quantities.js';

const PLACEMENT_MEMBERS = [
  'bodySerial', 'holdId', 'model', 'lensSerial', 'aimAcross', 'aimDown',
  'bodyAcross', 'bodyDown', 'standoff', 'ratio', 'shiftAcrossPercent', 'shiftDownPercent', 'circuitId',
];

interface ModelRecord {
  code: string;
  kind: string;
  rated_lumens: number;
  rated_hours: number;
  native_width: number;
  native_height: number;
  rated_watts: number;
  ratio_min: string | null;
  ratio_max: string | null;
  shift_across_max: string | null;
  shift_down_max: string | null;
}

interface SiteRecord {
  id: string;
  name: string;
  width_metres: string;
  height_metres: string;
  columns: number;
  rows: number;
  show_at: Date;
  demo: boolean;
  residual_metres: string | null;
}

interface LayoutRecord {
  id: string;
  site_id: string;
  name: string;
  version: number;
  layout_hash: string;
  sheet_status: 'Draft' | 'Issued' | 'Out of step' | 'Withdrawn';
}

export function layoutRoutes(): Route[] {
  return [
    route('POST', '/api/sites/:siteId/layouts', createLayout, { keyed: true }),
    route('GET', '/api/layouts/:layoutId', getLayout),
    route('GET', '/api/layouts/:layoutId/picker', getPicker),
    route('POST', '/api/layouts/:layoutId/placements', postPlacement, { keyed: true, conditional: true }),
    route('PATCH', '/api/layouts/:layoutId/placements/:placementId', patchPlacement, { conditional: true }),
    route('DELETE', '/api/layouts/:layoutId/placements/:placementId', deletePlacement, { conditional: true }),
    route('GET', '/api/layouts/:layoutId/cells', layoutCells),
    route('GET', '/api/layouts/:layoutId/cells/:cell', layoutCell),
    route('GET', '/api/layouts/:layoutId/circuits', layoutCircuits),
  ];
}

async function loadLayout(client: PoolClient, layoutId: string): Promise<{ layout: LayoutRecord; site: SiteRecord }> {
  const result = await client.query<LayoutRecord>('SELECT * FROM layouts WHERE id = $1', [layoutId]);
  const layout = result.rows[0];
  if (layout === undefined) fail(problems.notFound());
  const siteResult = await client.query<SiteRecord>('SELECT * FROM sites WHERE id = $1', [layout.site_id]);
  return { layout, site: siteResult.rows[0]! };
}

function layoutJson(layout: LayoutRecord, placements: EnrichedPlacement[]): Record<string, unknown> {
  return {
    id: layout.id,
    siteId: layout.site_id,
    name: layout.name,
    version: layout.version,
    sheetStatus: layout.sheet_status,
    hash: layout.layout_hash,
    placements: placements.map((p) => placementJson(p)),
  };
}

interface EnrichedPlacement extends PlacementRow {
  status: 'Bodied' | 'On hold' | 'Needs a body';
}

function placementJson(p: EnrichedPlacement): Record<string, unknown> {
  return {
    id: p.id,
    status: p.status,
    bodySerial: p.body_serial,
    holdId: p.hold_id,
    model: p.model,
    lensSerial: p.lens_serial,
    aimAcross: p.aim_across,
    aimDown: p.aim_down,
    bodyAcross: p.body_across,
    bodyDown: p.body_down,
    standoff: p.standoff,
    ratio: p.ratio,
    shiftAcrossPercent: p.shift_across,
    shiftDownPercent: p.shift_down,
    circuitId: p.circuit_id,
  };
}

async function createLayout(ctx: Ctx): Promise<void> {
  const body = readJsonObject(ctx.jsonBody);
  if (body === null) fail(problems.malformedBody());
  const unknown = deepUnknownMembers(body, (path) => (path === '' ? ['name'] : null));
  if (unknown !== null) fail(problems.unknownField(unknown));
  if (typeof body.name !== 'string' || body.name.length === 0 || body.name.length > 80) {
    fail(problems.validationFailed({ '/name': FIELD_COPY.siteName }));
  }
  const result = await ctx.db.withClient(async (client) => {
    const keyed = await beginKeyed(ctx, client);
    if (keyed.kind === 'replay') return { kind: 'replay' as const, status: keyed.status!, body: keyed.body };
    const site = await client.query<SiteRecord>('SELECT * FROM sites WHERE id = $1', [ctx.params.siteId]);
    if (site.rows.length === 0) fail(problems.notFound());
    const id = `layout_${randomBytes(9).toString('hex')}`;
    await client.query("INSERT INTO layouts (id, site_id, name, sheet_status) VALUES ($1,$2,$3,'Draft')", [id, ctx.params.siteId, body.name]);
    const json = { id, siteId: ctx.params.siteId, name: body.name, version: 0, sheetStatus: 'Draft', hash: '', placements: [] };
    await finishKeyed(ctx, client, 201, json);
    return { kind: 'fresh' as const, body: json };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'replay') {
    respond(ctx, result.value.status, result.value.body as never, { 'Idempotency-Replayed': 'true' });
    return;
  }
  respond(ctx, 201, result.value.body, { ETag: etagOf(0, '') });
}

async function getLayout(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const { layout } = await loadLayout(client, ctx.params.layoutId!);
    const placements = await loadPlacements(client, layout.id);
    return { layout, placements };
  });
  if (!result.ok) fail(result.problem);
  const { layout, placements } = result.value;
  const etag = etagOf(layout.version, layout.layout_hash);
  const ifNoneMatch = parseEtag(ctx.req.headers['if-none-match'] as string | undefined);
  if (ifNoneMatch === layout.version + '-' + layout.layout_hash) {
    respond(ctx, 304, {} as never, { ETag: etag });
    return;
  }
  respond(ctx, 200, layoutJson(layout, placements), { ETag: etag });
}

async function loadPlacements(client: PoolClient, layoutId: string): Promise<EnrichedPlacement[]> {
  const rows = await client.query<PlacementRow>(
    'SELECT * FROM placements WHERE layout_id = $1 ORDER BY position',
    [layoutId],
  );
  const holds = await client.query<{ id: string; status: string }>('SELECT id, status FROM holds');
  const holdStatus = new Map(holds.rows.map((h) => [h.id, h.status]));
  return rows.rows.map((row) => ({
    ...row,
    status: row.body_serial !== null ? 'Bodied' : row.hold_id !== null ? (holdStatus.get(row.hold_id) === 'Held' ? 'On hold' : 'Needs a body') : 'Needs a body',
  }));
}

async function getPicker(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const { layout, site } = await loadLayout(client, ctx.params.layoutId!);
    const shelf = await client.query<{ serial: string; model_code: string; location: string }>(
      `SELECT u.serial, u.model_code, m.location
         FROM units u
         JOIN LATERAL (
           SELECT e.location FROM movement_entries e
             JOIN movements mv ON mv.id = e.movement_id
            WHERE mv.serial = u.serial AND e.delta = 1
              AND NOT EXISTS (SELECT 1 FROM movements r WHERE r.reverses_id = mv.id AND r.serial = mv.serial)
            ORDER BY mv.at DESC, mv.id DESC LIMIT 1
         ) m ON true`,
    );
    const bound = await client.query<{ serial: string }>(
      `SELECT DISTINCT b.serial FROM sheet_bindings b JOIN sheets s ON s.id = b.sheet_id AND s.status <> 'Withdrawn'`,
    );
    const boundSet = new Set(bound.rows.map((b) => b.serial));
    const units = shelf.rows.filter((row) => row.location === 'shelf' || row.location === `site:${site.id}`);
    const models = await client.query<ModelRecord>('SELECT * FROM models');
    const bodies = units.filter((u) => models.rows.find((m) => m.code === u.model_code)?.kind === 'body');
    const lenses = units.filter((u) => models.rows.find((m) => m.code === u.model_code)?.kind === 'lens');
    const modelAgg = new Map<string, number>();
    for (const body of bodies) {
      const entry = modelAgg.get(body.model_code) ?? 0;
      modelAgg.set(body.model_code, entry + 1);
    }
    const holds = await client.query<{ id: string; model: string; serial: string | null; status: string }>(
      `SELECT id, model, serial, status FROM holds WHERE status = 'Held'`,
    );
    return {
      models: [...modelAgg.entries()].map(([model, free]) => ({ model, free })),
      bodies: bodies.map((b) => ({ serial: b.serial, model: b.model_code, location: b.location, free: !boundSet.has(b.serial) })),
      lenses: lenses.map((l) => ({ serial: l.serial, model: l.model_code, location: l.location, free: !boundSet.has(l.serial) })),
      holds: holds.rows.map((h) => ({ id: h.id, model: h.model, serial: h.serial, status: h.status })),
    };
    void layout;
  });
  if (!result.ok) fail(result.problem);
  respond(ctx, 200, result.value);
}

function parsePlacementInput(body: unknown, layout: LayoutRecord, site: SiteRecord): { input: PlacementInputParsed; errors: FieldErrors } {
  const object = readJsonObject(body);
  const errors: FieldErrors = {};
  if (object === null) {
    return { input: null as never, errors: { '': FIELD_COPY.required } };
  }
  const unknown = deepUnknownMembers(object, (path) => (path === '' ? PLACEMENT_MEMBERS : null));
  if (unknown !== null) fail(problems.unknownField(unknown));
  const bodySerial = typeof object.bodySerial === 'string' ? object.bodySerial : null;
  const holdId = typeof object.holdId === 'string' ? object.holdId : null;
  if (bodySerial !== null && holdId !== null) {
    errors['/bodySerial'] = FIELD_COPY.required;
  }
  const lensSerial = typeof object.lensSerial === 'string' ? object.lensSerial : '';
  if (lensSerial === '') errors['/lensSerial'] = FIELD_COPY.required;
  const aimAcross = checkQuantity(object.aimAcross, true, LENGTH_UNITS, FIELD_COPY.badUnit);
  const aimDown = checkQuantity(object.aimDown, true, LENGTH_UNITS, FIELD_COPY.badUnit);
  const bodyAcross = checkQuantity(object.bodyAcross, true, LENGTH_UNITS, FIELD_COPY.badUnit);
  const bodyDown = checkQuantity(object.bodyDown, true, LENGTH_UNITS, FIELD_COPY.badUnit);
  const standoff = checkQuantity(object.standoff, true, LENGTH_UNITS, FIELD_COPY.badUnit);
  const ratio = parseNumberGrammar(typeof object.ratio === 'string' ? object.ratio : '', false);
  const shiftAcross = parseNumberGrammar(typeof object.shiftAcrossPercent === 'string' ? object.shiftAcrossPercent : '', true);
  const shiftDown = parseNumberGrammar(typeof object.shiftDownPercent === 'string' ? object.shiftDownPercent : '', true);
  if (!aimAcross.ok || aimAcross.decimal === null) errors['/aimAcross/text'] = aimAcross.error ?? FIELD_COPY.required;
  if (!aimDown.ok || aimDown.decimal === null) errors['/aimDown/text'] = aimDown.error ?? FIELD_COPY.required;
  if (!bodyAcross.ok || bodyAcross.decimal === null) errors['/bodyAcross/text'] = bodyAcross.error ?? FIELD_COPY.required;
  if (!bodyDown.ok || bodyDown.decimal === null) errors['/bodyDown/text'] = bodyDown.error ?? FIELD_COPY.required;
  if (!standoff.ok || standoff.decimal === null) errors['/standoff/text'] = standoff.error ?? FIELD_COPY.required;
  if (!ratio.ok || ratio.value === null) errors['/ratio'] = FIELD_COPY.badNumber;
  if (!shiftAcross.ok || shiftAcross.value === null) errors['/shiftAcrossPercent'] = FIELD_COPY.badNumber;
  if (!shiftDown.ok || shiftDown.value === null) errors['/shiftDownPercent'] = FIELD_COPY.badNumber;
  if (typeof object.circuitId !== 'string') errors['/circuitId'] = FIELD_COPY.required;
  const model = typeof object.model === 'string' ? object.model : null;
  return {
    input: {
      bodySerial,
      holdId,
      model,
      lensSerial,
      aimAcross: metresOf(object.aimAcross),
      aimDown: metresOf(object.aimDown),
      bodyAcross: metresOf(object.bodyAcross),
      bodyDown: metresOf(object.bodyDown),
      standoff: metresOf(object.standoff),
      ratio: ratio.value === null ? null : fromString(ratio.value)!,
      shiftAcross: shiftAcross.value === null ? null : fromString(shiftAcross.value)!,
      shiftDown: shiftDown.value === null ? null : fromString(shiftDown.value)!,
      circuitId: typeof object.circuitId === 'string' ? object.circuitId : '',
    },
    errors,
  };
  void layout;
  void site;
}

interface PlacementInputParsed {
  bodySerial: string | null;
  holdId: string | null;
  model: string | null;
  lensSerial: string;
  aimAcross: Decimal | null;
  aimDown: Decimal | null;
  bodyAcross: Decimal | null;
  bodyDown: Decimal | null;
  standoff: Decimal | null;
  ratio: Decimal | null;
  shiftAcross: Decimal | null;
  shiftDown: Decimal | null;
  circuitId: string;
}

function metresOf(value: unknown): Decimal | null {
  const object = readJsonObject(value);
  if (object === null) return null;
  const text = typeof object.text === 'string' ? object.text : '';
  const unit = typeof object.unit === 'string' ? object.unit : '';
  const grammar = parseNumberGrammar(text, true);
  if (!grammar.ok || grammar.value === null) return null;
  const decimal = fromString(grammar.value);
  if (decimal === null) return null;
  if (unit === 'm') return decimal;
  if (unit === 'ft') return mul(decimal, fromString('0.3048')!);
  return null;
}

async function postPlacement(ctx: Ctx): Promise<void> {
  const loaded = await ctx.db.withClient(async (client) => {
    const { layout, site } = await loadLayout(client, ctx.params.layoutId!);
    const match = checkIfMatch(ctx.req, `${layout.version}-${layout.layout_hash}`);
    if (match !== null) return { kind: 'etag' as const, problem: match };
    return { kind: 'ok' as const, layout, site };
  });
  if (!loaded.ok) fail(loaded.problem);
  if (loaded.value.kind === 'etag') fail(loaded.value.problem);
  const { layout, site } = loaded.value;

  const parsed = parsePlacementInput(ctx.jsonBody, layout, site);
  const input = parsed.input;
  const errors = parsed.errors;
  if (Object.keys(errors).length > 0) fail(problems.validationFailed(errors));
  if (input.aimAcross === null || input.aimDown === null || input.bodyAcross === null || input.bodyDown === null || input.standoff === null || input.ratio === null || input.shiftAcross === null || input.shiftDown === null) {
    fail(problems.validationFailed({ '': FIELD_COPY.required }));
  }

  const applied = await ctx.db.withClient(async (client) => {
    const keyed = await beginKeyed(ctx, client);
    if (keyed.kind === 'replay') return { kind: 'replay' as const, status: keyed.status!, body: keyed.body };
    const fresh = await loadLayout(client, layout.id);
    if (fresh.layout.version !== layout.version) return { kind: 'conflict' as const };
    const lensUnit = await client.query<{ model_code: string }>('SELECT model_code FROM units WHERE serial = $1', [input.lensSerial]);
    const lensModel = (await client.query<ModelRecord>('SELECT * FROM models WHERE code = $1', [lensUnit.rows[0]?.model_code ?? ''])).rows[0];
    if (lensModel === undefined) fail(problems.validationFailed({ '/lensSerial': `${input.lensSerial} ${FIELD_COPY.lens}` }));
    const lensLocation = await locationOf(client, input.lensSerial);
    if (lensLocation !== 'shelf' && lensLocation !== `site:${site.id}`) {
      fail(problems.validationFailed({ '/lensSerial': `${input.lensSerial} ${FIELD_COPY.lens}` }));
    }
    let bodyModel: ModelRecord | undefined;
    if (input.bodySerial !== null) {
      const bodyLocation = await locationOf(client, input.bodySerial);
      if (bodyLocation !== 'shelf' && bodyLocation !== `site:${site.id}`) {
        fail(problems.bodyNotAvailable(input.bodySerial));
      }
      const bodyUnit = await client.query<{ model_code: string }>('SELECT model_code FROM units WHERE serial = $1', [input.bodySerial]);
      bodyModel = (await client.query<ModelRecord>('SELECT * FROM models WHERE code = $1', [bodyUnit.rows[0]?.model_code ?? ''])).rows[0];
      if (bodyModel === undefined) fail(problems.bodyNotAvailable(input.bodySerial));
      const already = await client.query('SELECT id FROM placements WHERE layout_id = $1 AND body_serial = $2', [layout.id, input.bodySerial]);
      if (already.rows.length > 0) fail(problems.bodyAlreadyInLayout(input.bodySerial));
    }
    if (input.holdId !== null) {
      const hold = await client.query<{ status: string; model: string }>('SELECT status, model FROM holds WHERE id = $1', [input.holdId]);
      if (hold.rows[0]?.status !== 'Held') fail(problems.holdNotHeld());
      bodyModel = (await client.query<ModelRecord>('SELECT * FROM models WHERE code = $1', [hold.rows[0]!.model])).rows[0];
    }
    const circuit = await client.query<{ id: string; site_id: string }>('SELECT id, site_id FROM circuits WHERE id = $1', [input.circuitId]);
    if (circuit.rows[0] === undefined || circuit.rows[0].site_id !== site.id) {
      fail(problems.validationFailed({ '/circuitId': FIELD_COPY.required }));
    }
    const lensLimits = {
      ratioMin: fromString(lensModel.ratio_min ?? '1')!,
      ratioMax: fromString(lensModel.ratio_max ?? '2')!,
      shiftAcrossMax: fromString(lensModel.shift_across_max ?? '0')!,
      shiftDownMax: fromString(lensModel.shift_down_max ?? '0')!,
    };
    const placementErrors = validatePlacement(
      {
        bodySerial: input.bodySerial,
        holdId: input.holdId,
        model: input.model,
        lensSerial: input.lensSerial,
        aimAcross: input.aimAcross!,
        aimDown: input.aimDown!,
        bodyAcross: input.bodyAcross!,
        bodyDown: input.bodyDown!,
        standoff: input.standoff!,
        ratio: input.ratio!,
        shiftAcross: input.shiftAcross!,
        shiftDown: input.shiftDown!,
        circuitId: input.circuitId,
      },
      lensLimits,
      [],
      site.columns,
      site.rows,
    );
    if (Object.keys(placementErrors).length > 0) fail(problems.validationFailed(placementErrors));

    const existingRows = await client.query<PlacementRow>('SELECT * FROM placements WHERE layout_id = $1 ORDER BY position', [layout.id]);
    const candidateModel = bodyModel ?? (await client.query<ModelRecord>('SELECT * FROM models WHERE code = $1', [input.model ?? 'VK-20'])).rows[0]!;
    const candidateGeometry = geometryOf(
      {
        id: 'candidate',
        body_serial: input.bodySerial,
        hold_id: input.holdId,
        model: input.model,
        lens_serial: input.lensSerial,
        aim_across: decToString(input.aimAcross!),
        aim_down: decToString(input.aimDown!),
        body_across: decToString(input.bodyAcross!),
        body_down: decToString(input.bodyDown!),
        standoff: decToString(input.standoff!),
        ratio: decToString(input.ratio!),
        shift_across: decToString(input.shiftAcross!),
        shift_down: decToString(input.shiftDown!),
        circuit_id: input.circuitId,
      },
      fromInteger(deratedLumens(candidateModel.rated_lumens, 0n, candidateModel.rated_hours)),
      candidateModel.native_width,
      candidateModel.native_height,
    );
    const existingEnriched = await loadPlacements(client, layout.id);
    const existingGeometries = await geometriesOf(client, existingEnriched);
    const overlap = overlapErrors({ id: 'candidate', geometry: candidateGeometry }, existingGeometries.map((g) => ({ id: g.placementId, geometry: g })), site.columns, site.rows);
    if (overlap !== null) fail(problems.validationFailed(overlap));

    const id = `pl_${randomBytes(9).toString('hex')}`;
    const position = existingRows.rows.length;
    await client.query(
      `INSERT INTO placements (id, layout_id, position, body_serial, hold_id, model, lens_serial, aim_across, aim_down, body_across, body_down, standoff, ratio, shift_across, shift_down, circuit_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [id, layout.id, position, input.bodySerial, input.holdId, input.model, input.lensSerial,
       decToString(input.aimAcross!), decToString(input.aimDown!), decToString(input.bodyAcross!), decToString(input.bodyDown!),
       decToString(input.standoff!), decToString(input.ratio!), decToString(input.shiftAcross!), decToString(input.shiftDown!), input.circuitId],
    );
    const placements = await loadPlacements(client, layout.id);
    const bumped = await bumpLayout(client, layout.id, rawPlacementRows(placements));
    await writeOutbox(client, 'layout.changed', 'layout', layout.id, { id: layout.id, version: bumped.version, hash: bumped.hash });
    const freshLayout = await loadLayout(client, layout.id);
    const freshPlacements = await loadPlacements(client, layout.id);
    const json = layoutJson(freshLayout.layout, freshPlacements);
    await finishKeyed(ctx, client, 201, json);
    return { kind: 'fresh' as const, body: json, etag: etagOf(bumped.version, bumped.hash) };
  });
  if (!applied.ok) fail(applied.problem);
  if (applied.value.kind === 'replay') {
    respond(ctx, applied.value.status, applied.value.body as never, { 'Idempotency-Replayed': 'true' });
    return;
  }
  if (applied.value.kind === 'conflict') fail(problems.layoutChanged());
  respond(ctx, 201, applied.value.body, { ETag: applied.value.etag });
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

function rawPlacementRows(placements: EnrichedPlacement[]): PlacementRow[] {
  return placements.map((p) => ({
    id: p.id,
    body_serial: p.body_serial,
    hold_id: p.hold_id,
    model: p.model,
    lens_serial: p.lens_serial,
    aim_across: p.aim_across,
    aim_down: p.aim_down,
    body_across: p.body_across,
    body_down: p.body_down,
    standoff: p.standoff,
    ratio: p.ratio,
    shift_across: p.shift_across,
    shift_down: p.shift_down,
    circuit_id: p.circuit_id,
  }));
}

async function patchPlacement(ctx: Ctx): Promise<void> {
  const loaded = await ctx.db.withClient(async (client) => {
    const { layout, site } = await loadLayout(client, ctx.params.layoutId!);
    const match = checkIfMatch(ctx.req, `${layout.version}-${layout.layout_hash}`);
    if (match !== null) return { kind: 'etag' as const, problem: match };
    return { kind: 'ok' as const, layout, site };
  });
  if (!loaded.ok) fail(loaded.problem);
  if (loaded.value.kind === 'etag') fail(loaded.value.problem);
  const { layout, site } = loaded.value;
  const parsed = parsePlacementInput(ctx.jsonBody, layout, site);
  const input = parsed.input;
  if (Object.keys(parsed.errors).length > 0) fail(problems.validationFailed(parsed.errors));
  const applied = await ctx.db.withClient(async (client) => {
    const fresh = await loadLayout(client, layout.id);
    if (fresh.layout.version !== layout.version) return { kind: 'conflict' as const };
    const existing = await client.query<PlacementRow>('SELECT * FROM placements WHERE layout_id = $1 AND id = $2', [layout.id, ctx.params.placementId]);
    if (existing.rows.length === 0) return { kind: 'missing' as const };
    await client.query(
      `UPDATE placements SET body_serial = $2, hold_id = $3, model = $4, lens_serial = $5,
              aim_across = $6, aim_down = $7, body_across = $8, body_down = $9, standoff = $10,
              ratio = $11, shift_across = $12, shift_down = $13, circuit_id = $14
        WHERE id = $1`,
      [ctx.params.placementId, input.bodySerial, input.holdId, input.model, input.lensSerial,
       decToString(input.aimAcross!), decToString(input.aimDown!), decToString(input.bodyAcross!), decToString(input.bodyDown!),
       decToString(input.standoff!), decToString(input.ratio!), decToString(input.shiftAcross!), decToString(input.shiftDown!), input.circuitId],
    );
    const placements = await loadPlacements(client, layout.id);
    const bumped = await bumpLayout(client, layout.id, rawPlacementRows(placements));
    await writeOutbox(client, 'layout.changed', 'layout', layout.id, { id: layout.id, version: bumped.version, hash: bumped.hash });
    const freshLayout = await loadLayout(client, layout.id);
    const freshPlacements = await loadPlacements(client, layout.id);
    return { kind: 'ok' as const, body: layoutJson(freshLayout.layout, freshPlacements), etag: etagOf(bumped.version, bumped.hash) };
  });
  if (!applied.ok) fail(applied.problem);
  if (applied.value.kind === 'conflict') fail(problems.layoutChanged());
  if (applied.value.kind === 'missing') fail(problems.notFound());
  respond(ctx, 200, applied.value.body, { ETag: applied.value.etag });
}

async function deletePlacement(ctx: Ctx): Promise<void> {
  const loaded = await ctx.db.withClient(async (client) => {
    const { layout } = await loadLayout(client, ctx.params.layoutId!);
    const match = checkIfMatch(ctx.req, `${layout.version}-${layout.layout_hash}`);
    if (match !== null) return { kind: 'etag' as const, problem: match };
    return { kind: 'ok' as const, layout };
  });
  if (!loaded.ok) fail(loaded.problem);
  if (loaded.value.kind === 'etag') fail(loaded.value.problem);
  const layout = loaded.value.layout;
  const applied = await ctx.db.withClient(async (client) => {
    const fresh = await loadLayout(client, layout.id);
    if (fresh.layout.version !== layout.version) return { kind: 'conflict' as const };
    const result = await client.query('DELETE FROM placements WHERE layout_id = $1 AND id = $2', [layout.id, ctx.params.placementId]);
    if (result.rowCount === 0) return { kind: 'missing' as const };
    const placements = await loadPlacements(client, layout.id);
    const bumped = await bumpLayout(client, layout.id, rawPlacementRows(placements));
    await writeOutbox(client, 'layout.changed', 'layout', layout.id, { id: layout.id, version: bumped.version, hash: bumped.hash });
    const freshLayout = await loadLayout(client, layout.id);
    const freshPlacements = await loadPlacements(client, layout.id);
    return { kind: 'ok' as const, body: layoutJson(freshLayout.layout, freshPlacements), etag: etagOf(bumped.version, bumped.hash) };
  });
  if (!applied.ok) fail(applied.problem);
  if (applied.value.kind === 'conflict') fail(problems.layoutChanged());
  if (applied.value.kind === 'missing') fail(problems.notFound());
  respond(ctx, 200, applied.value.body, { ETag: applied.value.etag });
}

async function layoutCells(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const { layout, site } = await loadLayout(client, ctx.params.layoutId!);
    const placements = await loadPlacements(client, layout.id);
    const cells = await cellInputs(client, site);
    const geometries = await geometriesOf(client, placements);
    return { site, cells, geometries };
  });
  if (!result.ok) fail(result.problem);
  const items = [];
  for (const cell of result.value.cells) {
    const figures = computeCell(result.value.geometries, cell);
    items.push(cellJson(figures));
  }
  respond(ctx, 200, { items });
}

async function layoutCell(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const { layout, site } = await loadLayout(client, ctx.params.layoutId!);
    const placements = await loadPlacements(client, layout.id);
    const geometries = await geometriesOf(client, placements);
    const parsed = parseCellOnGrid(ctx.params.cell!, { columns: site.columns, rows: site.rows });
    if (parsed === null) return null;
    const cells = await cellInputs(client, site);
    const cell = cells.find((c) => c.name === ctx.params.cell);
    if (cell === undefined) return null;
    return { cell, geometries };
  });
  if (!result.ok) fail(result.problem);
  if (result.value === null) fail(problems.notFound());
  const figures = computeCell(result.value.geometries, result.value.cell);
  respond(ctx, 200, cellJson(figures));
}















async function layoutCircuits(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const { site } = await loadLayout(client, ctx.params.layoutId!);
    const circuits = await client.query<{ id: string; name: string; kind: string; capacity_watts: number }>(
      'SELECT id, name, kind, capacity_watts FROM circuits WHERE site_id = $1 ORDER BY name',
      [site.id],
    );
    const placements = await loadPlacements(client, ctx.params.layoutId!);
    const loads = new Map<string, number>();
    for (const placement of placements) {
      if (placement.body_serial === null) continue;
      const unit = await client.query<{ model_code: string }>('SELECT model_code FROM units WHERE serial = $1', [placement.body_serial]);
      const model = (await client.query<ModelRecord>('SELECT * FROM models WHERE code = $1', [unit.rows[0]?.model_code ?? ''])).rows[0];
      if (model === undefined) continue;
      loads.set(placement.circuit_id, (loads.get(placement.circuit_id) ?? 0) + model.rated_watts);
    }
    return circuits.rows.map((circuit) => {
      const load = loads.get(circuit.id) ?? 0;
      return {
        id: circuit.id,
        name: circuit.name,
        kind: circuit.kind,
        loadWatts: load,
        capacityWatts: circuit.capacity_watts,
        overloaded: load > circuit.capacity_watts,
      };
    });
  });
  if (!result.ok) fail(result.problem);
  respond(ctx, 200, { items: result.value });
}
