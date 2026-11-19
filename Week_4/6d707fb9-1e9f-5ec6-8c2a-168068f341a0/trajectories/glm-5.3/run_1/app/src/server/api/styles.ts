import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { newId } from "../engine/ids.js";
import { instantOf, shownTime, lisbonDate } from "../engine/time.js";
import { requireDesk } from "../app.js";
import { errConflict, errNotFound, errStaleEdit, errValidation } from "./errors.js";
import { COPY } from "../engine/copy.js";
import { one, rows } from "../db/pool.js";
import { checkGtin, fibresTotalOk, massFromWeightArea } from "../engine/rules.js";
import { foldMatches } from "../engine/fold.js";
import { shownMass, shownTotal } from "../engine/display.js";
import { add, cmp, isDecimal } from "../engine/decimal.js";
import { MATERIALS, GARMENTS, type GarmentId } from "../engine/domain.js";
import { labelOfDesk } from "./labels.js";

export interface StyleCore {
  id: string;
  desk_id: string;
  label_id: string;
  style_code: string | null;
  name: string;
  season: string;
  gtin: string;
  garment: string;
  washes: number;
  repair_service: boolean | null;
  range_size: number | null;
  notes: string | null;
  state: string;
  version: number;
  changed_at: string;
  changed_by: string | null;
}

/** A style of this desk, or 404 exactly like an unknown id (and like another desk's id). */
export async function styleOfDesk(deskId: string, styleId: string): Promise<StyleCore> {
  const r = await one<StyleCore>(`SELECT * FROM styles WHERE id = $1`, [styleId]);
  if (!r || r.desk_id !== deskId) throw errNotFound();
  return r;
}

export async function labelStateOf(style: StyleCore): Promise<{ state: string; name: string }> {
  const label = await one<{ state: string; name: string }>(`SELECT state, name FROM labels WHERE id = $1`, [style.label_id]);
  return label ?? { state: "open", name: "" };
}

export function assertWritable(style: StyleCore): void {
  if (style.state === "archived") throw errConflict(COPY.archivedStyle);
}

export async function assertLabelOpen(style: StyleCore): Promise<void> {
  const label = await labelStateOf(style);
  if (label.state !== "open") throw errConflict(COPY.closedLabel);
}

export interface LineRow {
  id: string;
  style_id: string;
  position: number;
  material_id: string;
  fabric_weight_gsm: string | null;
  area_m2: string | null;
  mass_grams: string;
  tier1_factory: string | null;
  tier1_town: string | null;
  tier1_country: string | null;
  tier2_factory: string | null;
  tier2_town: string | null;
  tier2_country: string | null;
  tier3_factory: string | null;
  tier3_town: string | null;
  tier3_country: string | null;
  answered_energy_mj: string | null;
  answered_water_l: string | null;
  answered_fibre_origin: string | null;
}

export interface FibreRow {
  id: string;
  line_id: string;
  position: number;
  name: string;
  share_percent: string;
}

export function lineOut(line: LineRow, fibres: FibreRow[], materialName: string): unknown {
  const tier = (f: string | null, t: string | null, c: string | null) => {
    if (f === null && t === null && c === null) return null;
    return { factory: f, town: t, country: c };
  };
  return {
    id: line.id,
    position: line.position,
    materialId: line.material_id,
    materialName,
    fabricWeightGsm: line.fabric_weight_gsm,
    areaM2: line.area_m2,
    massGrams: line.mass_grams,
    massShown: shownMass(line.mass_grams),
    fibres: fibres.map((f) => ({ name: f.name, sharePercent: f.share_percent })),
    tier1: tier(line.tier1_factory, line.tier1_town, line.tier1_country),
    tier2: tier(line.tier2_factory, line.tier2_town, line.tier2_country),
    tier3: tier(line.tier3_factory, line.tier3_town, line.tier3_country),
    answeredFacts: {
      energyMjPerKg: line.answered_energy_mj,
      waterLitresPerKg: line.answered_water_l,
      fibreOrigin: line.answered_fibre_origin,
    },
  };
}

export function materialNameOf(id: string): string {
  return MATERIALS.find((m) => m.id === id)?.name ?? id;
}

async function fibresOfLine(lineId: string): Promise<FibreRow[]> {
  return rows<FibreRow>(`SELECT id, line_id, position, name, share_percent FROM line_fibres WHERE line_id = $1 ORDER BY position`, [lineId]);
}

export async function linesOfStyle(styleId: string): Promise<LineRow[]> {
  return rows<LineRow>(`SELECT * FROM lines WHERE style_id = $1 ORDER BY position`, [styleId]);
}

export async function versionOf(styleId: string): Promise<number> {
  const r = await one<{ version: number }>(`SELECT version FROM styles WHERE id = $1`, [styleId]);
  if (!r) throw errNotFound();
  return r.version;
}

/** The stale-edit rule in one place: an old baseVersion answers 412 with the published copy. */
export async function checkStale(style: StyleCore, baseVersion: unknown): Promise<void> {
  if (baseVersion === undefined || baseVersion === null) return;
  const given = typeof baseVersion === "number" ? baseVersion : Number.parseInt(String(baseVersion), 10);
  if (!Number.isFinite(given) || given !== style.version) {
    const time = style.changed_at;
    const message =
      style.changed_by !== null
        ? COPY.staleByAnswer(lisbonTimeText(time), style.changed_by)
        : COPY.staleElsewhere(lisbonTimeText(time));
    throw errStaleEdit(message);
  }
}

export function lisbonTimeText(instant: string): string {
  return shownTime(new Date(instant), "Europe/Lisbon");
}

export async function bumpStyleVersion(styleId: string, changedBy: string | null): Promise<void> {
  const now = instantOf(new Date());
  await rows(`UPDATE styles SET version = version + 1, changed_at = $1, changed_by = $2 WHERE id = $3`, [now, changedBy, styleId]);
  await rows(`UPDATE scores SET state = 'outdated' WHERE style_id = $1 AND state = 'current'`, [styleId]);
}

export function registerStyleRoutes(app: FastifyInstance): void {
  app.get("/api/materials", async (req: FastifyRequest) => {
    const q = (req.query as Record<string, string>)?.q ?? "";
    const needle = q.trim();
    if (needle.length === 0) return { materials: MATERIALS.map((m) => ({ id: m.id, name: m.name })) };
    return {
      materials: MATERIALS.filter((m) => foldMatches(m.name, needle)).map((m) => ({ id: m.id, name: m.name })),
    };
  });

  app.get("/api/styles", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const query = req.query as Record<string, string>;
    return listStyles(deskId, query);
  });

  app.post("/api/styles", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const body = req.body as Record<string, unknown>;
    const labelId = typeof body?.labelId === "string" ? body.labelId : "";
    const label = await labelOfDesk(deskId, labelId);
    if (label.state !== "open") throw errConflict(COPY.closedLabel);
    const fields = await validateStyleBody(body, null, labelId);
    if (Object.keys(fields).length > 0) throw errValidation(fields);
    const id = newId();
    await insertStyle(deskId, body, id, labelId);
    reply.status(201);
    const style = await styleOfDesk(deskId, id);
    return await styleOut(style);
  });

  app.get("/api/styles/:id", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const style = await styleOfDesk(deskId, id);
    return await styleOut(style);
  });

  app.patch("/api/styles/:id", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const style = await styleOfDesk(deskId, id);
    assertWritable(style);
    await assertLabelOpen(style);
    const body = req.body as Record<string, unknown>;
    await checkStale(style, body?.baseVersion);
    const fields = await validateStyleBody(body, style, style.label_id);
    if (Object.keys(fields).length > 0) throw errValidation(fields);
    await applyStylePatch(style, body);
    const after = await styleOfDesk(deskId, id);
    return await styleOut(after);
  });

  app.post("/api/styles/:id/duplicate", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const style = await styleOfDesk(deskId, id);
    assertWritable(style);
    await assertLabelOpen(style);
    const newStyleId = newId();
    await rows(
      `INSERT INTO styles (id, desk_id, label_id, style_code, name, season, gtin, garment, washes, repair_service, range_size, notes, state, version, changed_at, changed_by)
       VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,'draft',1,$12,NULL)`,
      [
        newStyleId, deskId, style.label_id, `${style.name} (copy)`, style.season, style.gtin, style.garment,
        style.washes, style.repair_service, style.range_size, style.notes, instantOf(new Date()),
      ],
    );
    const lines = await linesOfStyle(id);
    for (const line of lines) {
      const newLineId = newId();
      await rows(
        `INSERT INTO lines (id, style_id, position, material_id, fabric_weight_gsm, area_m2, mass_grams,
          tier1_factory, tier1_town, tier1_country, tier2_factory, tier2_town, tier2_country, tier3_factory, tier3_town, tier3_country)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          newLineId, newStyleId, line.position, line.material_id, line.fabric_weight_gsm, line.area_m2, line.mass_grams,
          line.tier1_factory, line.tier1_town, line.tier1_country,
          line.tier2_factory, line.tier2_town, line.tier2_country,
          line.tier3_factory, line.tier3_town, line.tier3_country,
        ],
      );
      const fibres = await fibresOfLine(line.id);
      for (const f of fibres) {
        await rows(
          `INSERT INTO line_fibres (id, line_id, position, name, share_percent) VALUES ($1,$2,$3,$4,$5)`,
          [newId(), newLineId, f.position, f.name, f.share_percent],
        );
      }
    }
    const legs = await rows<{ mode: string; km: string; position: number }>(
      `SELECT mode, km, position FROM legs WHERE style_id = $1 ORDER BY position`,
      [id],
    );
    for (const leg of legs) {
      await rows(`INSERT INTO legs (id, style_id, position, mode, km) VALUES ($1,$2,$3,$4,$5)`, [
        newId(), newStyleId, leg.position, leg.mode, leg.km,
      ]);
    }
    reply.status(201);
    const after = await styleOfDesk(deskId, newStyleId);
    return await styleOut(after);
  });

  app.post("/api/styles/:id/archive", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const style = await styleOfDesk(deskId, id);
    const label = await labelStateOf(style);
    if (label.state !== "open") throw errConflict(COPY.closedLabel);
    if (style.state === "published") throw errConflict(COPY.archiveWithPassport);
    if (style.state === "archived") throw errConflict(COPY.archivedStyle);
    await rows(`UPDATE styles SET state = 'archived' WHERE id = $1`, [id]);
    const after = await styleOfDesk(deskId, id);
    return await styleOut(after);
  });

  app.get("/api/styles/:id/lines", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    await styleOfDesk(deskId, id);
    return linesBundle(id);
  });

  app.post("/api/styles/:id/lines", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const style = await styleOfDesk(deskId, id);
    assertWritable(style);
    await assertLabelOpen(style);
    const body = req.body as Record<string, unknown>;
    await checkStale(style, body?.baseVersion);
    const parsed = parseLineBody(body);
    if (parsed.error) throw errValidation(parsed.error);
    const lineId = newId();
    const maxPos = await one<{ max: number | null }>(`SELECT MAX(position) AS max FROM lines WHERE style_id = $1`, [id]);
    const position = (maxPos?.max ?? 0) + 1;
    await insertLine(id, lineId, position, parsed.value!);
    await bumpStyleVersion(id, null);
    reply.status(201);
    const line = await one<LineRow>(`SELECT * FROM lines WHERE id = $1`, [lineId]);
    const fibres = await fibresOfLine(lineId);
    return lineOut(line!, fibres, materialNameOf(line!.material_id));
  });

  app.patch("/api/styles/:id/lines/:lineId", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id, lineId } = req.params as { id: string; lineId: string };
    const style = await styleOfDesk(deskId, id);
    assertWritable(style);
    await assertLabelOpen(style);
    const line = await one<LineRow>(`SELECT * FROM lines WHERE id = $1 AND style_id = $2`, [lineId, id]);
    if (!line) throw errNotFound();
    const body = req.body as Record<string, unknown>;
    await checkStale(style, body?.baseVersion);
    const parsed = parseLineBody(body, line);
    if (parsed.error) throw errValidation(parsed.error);
    await updateLine(lineId, parsed.value!);
    await bumpStyleVersion(id, null);
    const after = await one<LineRow>(`SELECT * FROM lines WHERE id = $1`, [lineId]);
    const fibres = await fibresOfLine(lineId);
    return lineOut(after!, fibres, materialNameOf(after!.material_id));
  });

  app.delete("/api/styles/:id/lines/:lineId", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id, lineId } = req.params as { id: string; lineId: string };
    const style = await styleOfDesk(deskId, id);
    assertWritable(style);
    await assertLabelOpen(style);
    const query = req.query as Record<string, string>;
    await checkStale(style, query?.baseVersion);
    const line = await one<LineRow>(`SELECT * FROM lines WHERE id = $1 AND style_id = $2`, [lineId, id]);
    if (!line) throw errNotFound();
    await rows(`DELETE FROM lines WHERE id = $1`, [lineId]);
    await reorderLines(id);
    await bumpStyleVersion(id, null);
    reply.status(204);
    return reply.send(null);
  });

  app.post("/api/styles/:id/lines/:lineId/move", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id, lineId } = req.params as { id: string; lineId: string };
    const style = await styleOfDesk(deskId, id);
    assertWritable(style);
    await assertLabelOpen(style);
    const body = req.body as Record<string, unknown>;
    // The one exception to the ladder's order: a stale move answers 412 even at the end.
    await checkStale(style, body?.baseVersion);
    const direction = body?.direction;
    if (direction !== "up" && direction !== "down") {
      throw errValidation({ direction: COPY.emptyField });
    }
    const lines = await linesOfStyle(id);
    const line = lines.find((l) => l.id === lineId);
    if (!line) throw errNotFound();
    const position = line.position;
    const total = lines.length;
    if ((direction === "up" && position === 1) || (direction === "down" && position === total)) {
      throw errConflict(COPY.lineAtEnd);
    }
    const swapWith = direction === "up" ? position - 1 : position + 1;
    const other = lines.find((l) => l.position === swapWith)!;
    await rows(`UPDATE lines SET position = $1 WHERE id = $2`, [swapWith, lineId]);
    await rows(`UPDATE lines SET position = $1 WHERE id = $2`, [position, other.id]);
    await bumpStyleVersion(id, null);
    const after = await linesOfStyle(id);
    const withFibres = await Promise.all(
      after.map(async (l) => lineOut(l, await fibresOfLine(l.id), materialNameOf(l.material_id))),
    );
    return { lines: withFibres, position: swapWith, total, version: await versionOf(id) };
  });

  app.post("/api/styles/:id/legs", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const style = await styleOfDesk(deskId, id);
    assertWritable(style);
    await assertLabelOpen(style);
    const body = req.body as Record<string, unknown>;
    await checkStale(style, body?.baseVersion);
    const mode = typeof body?.mode === "string" ? body.mode : "";
    const km = typeof body?.km === "string" ? body.km : "";
    const fields: Record<string, string> = {};
    if (!["sea", "road", "rail", "air"].includes(mode)) fields.mode = COPY.emptyField;
    if (!isDecimal(km) || km.startsWith("-")) fields.km = COPY.emptyField;
    if (Object.keys(fields).length > 0) throw errValidation(fields);
    const legId = newId();
    const maxPos = await one<{ max: number | null }>(`SELECT MAX(position) AS max FROM legs WHERE style_id = $1`, [id]);
    await rows(`INSERT INTO legs (id, style_id, position, mode, km) VALUES ($1,$2,$3,$4,$5)`, [
      legId, id, (maxPos?.max ?? 0) + 1, mode, km,
    ]);
    await bumpStyleVersion(id, null);
    reply.status(201);
    return { id: legId, mode, km, version: await versionOf(id) };
  });

  app.delete("/api/styles/:id/legs/:legId", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id, legId } = req.params as { id: string; legId: string };
    const style = await styleOfDesk(deskId, id);
    assertWritable(style);
    await assertLabelOpen(style);
    const query = req.query as Record<string, string>;
    await checkStale(style, query?.baseVersion);
    const leg = await one<{ id: string }>(`SELECT id FROM legs WHERE id = $1 AND style_id = $2`, [legId, id]);
    if (!leg) throw errNotFound();
    await rows(`DELETE FROM legs WHERE id = $1`, [legId]);
    await rows(
      `UPDATE legs SET position = sub.rn FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS rn FROM legs WHERE style_id = $1) sub WHERE legs.id = sub.id`,
      [id],
    );
    await bumpStyleVersion(id, null);
    reply.status(204);
    return reply.send(null);
  });
}

/** The full Style record as published, including latest result, score and newer factors. */
export async function styleOut(style: StyleCore): Promise<Record<string, unknown>> {
  const label = await one<{ name: string }>(`SELECT name FROM labels WHERE id = $1`, [style.label_id]);
  const lines = await linesOfStyle(style.id);
  const legs = await rows<{ id: string; mode: string; km: string }>(`SELECT id, mode, km FROM legs WHERE style_id = $1 ORDER BY position`, [style.id]);
  const latest = await one<{ id: string; edition: string; worked_out_at: string; data_quality_percent: number; data_quality_grade: string; measures: unknown }>(
    `SELECT id, edition, worked_out_at, data_quality_percent, data_quality_grade, measures FROM results WHERE style_id = $1 ORDER BY worked_out_at DESC, id DESC LIMIT 1`,
    [style.id],
  );
  const score = await one<{ state: string; score: number | null; per_100g: number | null; run_id: string | null; shown: string | null; worst_case_facts: string[]; busy_until: string | null }>(
    `SELECT state, score, per_100g, run_id, shown, worst_case_facts, busy_until FROM scores WHERE style_id = $1`,
    [style.id],
  );
  const passport = await one<{ edition: number; state: string }>(
    `SELECT edition, state FROM passports WHERE style_id = $1 AND state = 'published' ORDER BY edition DESC LIMIT 1`,
    [style.id],
  );
  const fibresByLine = new Map<string, FibreRow[]>();
  for (const line of lines) {
    fibresByLine.set(line.id, await fibresOfLine(line.id));
  }
  const lineOuts = await Promise.all(lines.map(async (l) => lineOut(l, fibresByLine.get(l.id) ?? [], materialNameOf(l.material_id))));
  const dossiers = await rows<{ id: string; state: string; made_at: string; signed_off_by: string | null; signed_off_at: string | null; result_id: string; edition: string }>(
    `SELECT id, state, made_at, signed_off_by, signed_off_at, result_id, edition FROM dossiers WHERE style_id = $1 ORDER BY made_at DESC`,
    [style.id],
  );
  return {
    id: style.id,
    labelId: style.label_id,
    labelName: label?.name ?? "",
    styleCode: style.style_code,
    name: style.name,
    season: style.season,
    gtin: style.gtin,
    garment: style.garment,
    washes: style.washes,
    repairService: style.repair_service,
    rangeSize: style.range_size,
    notes: style.notes,
    state: style.state,
    legs,
    lines: lineOuts,
    version: style.version,
    changedAt: style.changed_at,
    changedBy: style.changed_by,
    latestResult: latest
      ? {
          id: latest.id,
          styleId: style.id,
          edition: latest.edition,
          workedOutAt: latest.worked_out_at,
          dataQualityPercent: latest.data_quality_percent,
          dataQualityGrade: latest.data_quality_grade,
          measures: latest.measures,
          current: true,
        }
      : null,
    newerFactors: await newerFactorsFor(style.desk_id, latest?.edition ?? null),
    score: score
      ? {
          state: score.state,
          score: score.score,
          per100g: score.per_100g,
          runId: score.run_id,
          shown: score.shown,
          worstCaseFacts: score.worst_case_facts ?? [],
          busyUntil: score.busy_until,
        }
      : { state: "none", score: null, per100g: null, runId: null, shown: null, worstCaseFacts: [], busyUntil: null },
    passport: passport ?? null,
    dossiers: dossiers.map((d) => ({
      id: d.id,
      styleId: style.id,
      resultId: d.result_id,
      edition: d.edition,
      state: d.state,
      madeAt: d.made_at,
      signedOffBy: d.signed_off_by,
      signedOffAt: d.signed_off_at,
    })),
  };
}

/** Newer factors, decided by the server whenever the style is read. */
async function newerFactorsFor(deskId: string, latestEdition: string | null): Promise<string | null> {
  if (latestEdition === null) return null;
  const reads = await rows<{ editions: unknown; read_at: string }>(
    `SELECT editions, read_at FROM factor_reads WHERE desk_id = $1 ORDER BY read_at DESC`,
    [deskId],
  );
  if (reads.length === 0) return null;
  const allEditions: { edition: string; validFrom: string }[] = [];
  for (const read of reads) {
    const list = read.editions as { edition: string; validFrom: string }[];
    for (const e of list) {
      if (!allEditions.some((x) => x.edition === e.edition)) allEditions.push(e);
    }
  }
  const used = allEditions.find((e) => e.edition === latestEdition);
  if (!used) return null;
  const today = lisbonDate(new Date());
  let newest: string | null = null;
  let bestValid = "";
  for (const e of allEditions) {
    if (e.validFrom > used.validFrom && e.validFrom <= today) {
      if (newest === null || e.validFrom > bestValid) {
        newest = e.edition;
        bestValid = e.validFrom;
      }
    }
  }
  return newest;
}

export async function linesBundle(styleId: string): Promise<{ lines: unknown[]; version: number }> {
  const lines = await linesOfStyle(styleId);
  const out = await Promise.all(
    lines.map(async (l) => lineOut(l, await fibresOfLine(l.id), materialNameOf(l.material_id))),
  );
  return { lines: out, version: await versionOf(styleId) };
}

async function reorderLines(styleId: string): Promise<void> {
  await rows(
    `UPDATE lines SET position = sub.rn FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS rn FROM lines WHERE style_id = $1) sub WHERE lines.id = sub.id`,
    [styleId],
  );
}

interface LineInputParsed {
  materialId: string;
  fabricWeightGsm: string | null;
  areaM2: string | null;
  massGrams: string;
  fibres: { name: string; sharePercent: string }[];
  tiers: {
    tier1: { factory: string | null; town: string | null; country: string | null };
    tier2: { factory: string | null; town: string | null; country: string | null };
    tier3: { factory: string | null; town: string | null; country: string | null };
  };
}

function parseLineBody(
  body: Record<string, unknown>,
  existing?: LineRow,
): { value?: LineInputParsed; error?: Record<string, string> } {
  const materialId = typeof body?.materialId === "string" ? body.materialId : existing?.material_id ?? "";
  if (!MATERIALS.some((m) => m.id === materialId)) return { error: { materialId: COPY.emptyField } };
  const weightRaw = body?.fabricWeightGsm;
  const areaRaw = body?.areaM2;
  const massRaw = body?.massGrams;
  const hasWeight = typeof weightRaw === "string" && weightRaw.length > 0;
  const hasArea = typeof areaRaw === "string" && areaRaw.length > 0;
  const hasMass = typeof massRaw === "string" && massRaw.length > 0;
  let massGrams: string;
  let fabricWeightGsm: string | null = null;
  let areaM2: string | null = null;
  if (hasMass) {
    if (!isDecimal(massRaw as string) || (massRaw as string).startsWith("-")) {
      return { error: { massGrams: COPY.massForm } };
    }
    massGrams = massRaw as string;
  } else if (hasWeight && hasArea) {
    if (!isDecimal(weightRaw as string) || !isDecimal(areaRaw as string)) {
      return { error: { fabricWeightGsm: COPY.massForm } };
    }
    fabricWeightGsm = weightRaw as string;
    areaM2 = areaRaw as string;
    massGrams = massFromWeightArea(fabricWeightGsm, areaM2);
  } else {
    return { error: { fabricWeightGsm: COPY.massForm } };
  }
  const fibresRaw = body?.fibres;
  if (!Array.isArray(fibresRaw)) return { error: { fibres: COPY.massForm } };
  const fibres: { name: string; sharePercent: string }[] = [];
  for (const f of fibresRaw) {
    const rec = f as Record<string, unknown>;
    const name = typeof rec?.name === "string" ? rec.name : "";
    const share = typeof rec?.sharePercent === "string" ? rec.sharePercent : "";
    if (name.length === 0) return { error: { "fibres.0.name": COPY.emptyField } };
    if (!/^\d+\.\d$/.test(share)) return { error: { "fibres.0.sharePercent": COPY.fibreShareForm } };
    fibres.push({ name, sharePercent: share });
  }
  if (fibres.length === 0) return { error: { fibres: COPY.emptyField } };
  if (!fibresTotalOk(fibres.map((f) => f.sharePercent))) {
    const total = fibres.reduce((acc, f) => add(acc, f.sharePercent), "0");
    return { error: { fibres: COPY.fibresOff(total) } };
  }
  const readTier = (n: 1 | 2 | 3) => {
    const raw = (body as Record<string, unknown>)?.[`tier${n}`];
    if (raw === null) return { factory: null, town: null, country: null };
    if (raw === undefined) {
      if (existing) {
        return {
          factory: existing[`tier${n}_factory`],
          town: existing[`tier${n}_town`],
          country: existing[`tier${n}_country`],
        };
      }
      return { factory: null, town: null, country: null };
    }
    const rec = raw as Record<string, unknown>;
    const factory = typeof rec?.factory === "string" ? rec.factory : null;
    const town = typeof rec?.town === "string" ? rec.town : null;
    const country = typeof rec?.country === "string" ? rec.country : null;
    if (factory === null && town === null && country === null) return { factory: null, town: null, country: null };
    return { factory, town, country };
  };
  return {
    value: {
      materialId,
      fabricWeightGsm,
      areaM2,
      massGrams,
      fibres,
      tiers: { tier1: readTier(1), tier2: readTier(2), tier3: readTier(3) },
    },
  };
}

async function insertLine(styleId: string, lineId: string, position: number, v: LineInputParsed): Promise<void> {
  await rows(
    `INSERT INTO lines (id, style_id, position, material_id, fabric_weight_gsm, area_m2, mass_grams,
      tier1_factory, tier1_town, tier1_country, tier2_factory, tier2_town, tier2_country, tier3_factory, tier3_town, tier3_country)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      lineId, styleId, position, v.materialId, v.fabricWeightGsm, v.areaM2, v.massGrams,
      v.tiers.tier1.factory, v.tiers.tier1.town, v.tiers.tier1.country,
      v.tiers.tier2.factory, v.tiers.tier2.town, v.tiers.tier2.country,
      v.tiers.tier3.factory, v.tiers.tier3.town, v.tiers.tier3.country,
    ],
  );
  for (let i = 0; i < v.fibres.length; i++) {
    await rows(`INSERT INTO line_fibres (id, line_id, position, name, share_percent) VALUES ($1,$2,$3,$4,$5)`, [
      newId(), lineId, i + 1, v.fibres[i].name, v.fibres[i].sharePercent,
    ]);
  }
}

async function updateLine(lineId: string, v: LineInputParsed): Promise<void> {
  await rows(
    `UPDATE lines SET material_id = $1, fabric_weight_gsm = $2, area_m2 = $3, mass_grams = $4,
      tier1_factory = $5, tier1_town = $6, tier1_country = $7,
      tier2_factory = $8, tier2_town = $9, tier2_country = $10,
      tier3_factory = $11, tier3_town = $12, tier3_country = $13
     WHERE id = $14`,
    [
      v.materialId, v.fabricWeightGsm, v.areaM2, v.massGrams,
      v.tiers.tier1.factory, v.tiers.tier1.town, v.tiers.tier1.country,
      v.tiers.tier2.factory, v.tiers.tier2.town, v.tiers.tier2.country,
      v.tiers.tier3.factory, v.tiers.tier3.town, v.tiers.tier3.country,
      lineId,
    ],
  );
  await rows(`DELETE FROM line_fibres WHERE line_id = $1`, [lineId]);
  for (let i = 0; i < v.fibres.length; i++) {
    await rows(`INSERT INTO line_fibres (id, line_id, position, name, share_percent) VALUES ($1,$2,$3,$4,$5)`, [
      newId(), lineId, i + 1, v.fibres[i].name, v.fibres[i].sharePercent,
    ]);
  }
}

async function validateStyleBody(
  body: Record<string, unknown>,
  existing: StyleCore | null,
  labelId: string,
): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};
  const name = typeof body?.name === "string" ? body.name : existing?.name ?? "";
  const season = typeof body?.season === "string" ? body.season : existing?.season ?? "";
  const gtin = typeof body?.gtin === "string" ? body.gtin : existing?.gtin ?? "";
  if (name.length === 0 || name.length > 120) fields.name = COPY.emptyField;
  if (season.length === 0 || season.length > 120) fields.season = COPY.emptyField;
  const gtinCheck = checkGtin(gtin);
  if (!gtinCheck.ok) {
    fields.gtin = gtinCheck.problem === "digit" ? COPY.gtinCheckDigit(gtinCheck.expectedDigit!) : COPY.gtinLength;
  }
  if (typeof body?.styleCode === "string" && body.styleCode.length > 0) {
    const clash = await one<{ id: string }>(
      `SELECT id FROM styles WHERE label_id = $1 AND style_code = $2 AND id <> $3`,
      [labelId, body.styleCode, existing?.id ?? ""],
    );
    if (clash) fields.styleCode = COPY.styleCodeTaken;
  }
  if (body?.garment !== undefined) {
    if (typeof body?.garment !== "string" || !GARMENTS.includes(body.garment as GarmentId)) {
      fields.garment = COPY.emptyField;
    }
  }
  if (body?.washes !== undefined) {
    const w = body.washes;
    if (typeof w !== "number" || !Number.isInteger(w) || w < 0) fields.washes = COPY.emptyField;
  }
  if (body?.rangeSize !== undefined && body?.rangeSize !== null) {
    const r = body.rangeSize;
    if (typeof r !== "number" || !Number.isInteger(r) || r < 0) fields.rangeSize = COPY.emptyField;
  }
  if (body?.notes !== undefined && body?.notes !== null) {
    if (typeof body?.notes !== "string" || [...(body.notes as string)].length > 2000) fields.notes = COPY.emptyField;
  }
  return fields;
}

async function insertStyle(deskId: string, body: Record<string, unknown>, id: string, labelId: string): Promise<void> {
  const garment = typeof body?.garment === "string" ? body.garment : "tshirt";
  const washes = typeof body?.washes === "number" ? body.washes : 30;
  const repair = body?.repairService === true ? true : body?.repairService === false ? false : null;
  const rangeSize = typeof body?.rangeSize === "number" ? body.rangeSize : null;
  const notes = typeof body?.notes === "string" ? body.notes : null;
  const styleCode = typeof body?.styleCode === "string" && body.styleCode.length > 0 ? body.styleCode : null;
  await rows(
    `INSERT INTO styles (id, desk_id, label_id, style_code, name, season, gtin, garment, washes, repair_service, range_size, notes, state, version, changed_at, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',1,$13,NULL)`,
    [id, deskId, labelId, styleCode, body?.name, body?.season, body?.gtin, garment, washes, repair, rangeSize, notes, instantOf(new Date())],
  );
}

async function applyStylePatch(style: StyleCore, body: Record<string, unknown>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, value: unknown) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (typeof body?.name === "string") push("name", body.name);
  if (typeof body?.season === "string") push("season", body.season);
  if (typeof body?.gtin === "string") push("gtin", body.gtin);
  if (typeof body?.garment === "string") push("garment", body.garment);
  if (typeof body?.washes === "number") push("washes", body.washes);
  if ("repairService" in body) push("repair_service", body.repairService === null ? null : body.repairService === true);
  if ("rangeSize" in body) push("range_size", body.rangeSize === null ? null : body.rangeSize);
  if ("notes" in body) push("notes", body.notes === null ? null : body.notes);
  if ("styleCode" in body) push("style_code", body.styleCode === null || body.styleCode === "" ? null : body.styleCode);
  params.push(style.id);
  await rows(`UPDATE styles SET ${sets.join(", ")}, version = version + 1, changed_at = $${params.length + 1}, changed_by = NULL WHERE id = $${params.length}`, [...params, instantOf(new Date())]);
  await rows(`UPDATE scores SET state = 'outdated' WHERE style_id = $1 AND state = 'current'`, [style.id]);
}

export async function listStyles(
  deskId: string,
  query: Record<string, string>,
): Promise<{ styles: unknown[]; nextCursor: string | null }> {
  const { fold } = await import("../engine/fold.js");
  const label = query.label ?? "";
  const season = query.season ?? "";
  const state = query.state ?? "";
  const sort = query.sort === "climate" ? "climate" : "name";
  const q = query.q ?? "";
  const cursor = query.cursor ?? "";
  const all = await rows<StyleCore>(`SELECT * FROM styles WHERE desk_id = $1`, [deskId]);
  const labelNames = new Map<string, string>(
    (await rows<{ id: string; name: string }>(`SELECT id, name FROM labels WHERE desk_id = $1`, [deskId])).map((l) => [l.id, l.name]),
  );
  const latestResults = new Map<string, { climate: string }>();
  for (const r of await rows<{ style_id: string; measures: { measure: string; total: string }[] }>(
    `SELECT style_id, measures FROM results WHERE (style_id, worked_out_at) IN (
       SELECT style_id, MAX(worked_out_at) FROM results GROUP BY style_id)`,
  )) {
    const climate = r.measures.find((m) => m.measure === "climate");
    if (climate) latestResults.set(r.style_id, { climate: climate.total });
  }
  const requestSuppliers = new Map<string, string[]>();
  for (const r of await rows<{ style_id: string; supplier_name: string; sent_at: string }>(
    `SELECT style_id, supplier_name, sent_at FROM requests WHERE desk_id = $1 ORDER BY sent_at ASC`,
    [deskId],
  )) {
    const list = requestSuppliers.get(r.style_id) ?? [];
    if (!list.includes(r.supplier_name)) list.push(r.supplier_name);
    requestSuppliers.set(r.style_id, list);
  }
  const linesByStyle = new Map<string, LineRow[]>();
  for (const l of await rows<LineRow>(`SELECT * FROM lines WHERE style_id = ANY($1)`, [all.map((s) => s.id)])) {
    const list = linesByStyle.get(l.style_id) ?? [];
    list.push(l);
    linesByStyle.set(l.style_id, list);
  }

  const suppliersOf = (style: StyleCore): string[] => {
    const lines = (linesByStyle.get(style.id) ?? []).slice().sort((a, b) => a.position - b.position);
    const names: string[] = [];
    for (const line of lines) {
      for (const t of [line.tier1_factory, line.tier2_factory, line.tier3_factory]) {
        if (t && !names.some((n) => n === t)) names.push(t);
      }
    }
    for (const s of requestSuppliers.get(style.id) ?? []) {
      if (!names.some((n) => n === s)) names.push(s);
    }
    return names;
  };

  let list = all.filter((s) => s.state !== "archived" || state === "archived");
  if (label.length > 0) list = list.filter((s) => s.label_id === label);
  if (season.length > 0) list = list.filter((s) => s.season === season);
  if (state.length > 0) list = list.filter((s) => s.state === state);
  if (q.trim().length > 0) {
    list = list.filter((s) => {
      if (foldMatches(s.name, q)) return true;
      return suppliersOf(s).some((n) => foldMatches(n, q));
    });
  }
  if (sort === "name") {
    list.sort((a, b) => {
      const fa = fold(a.name);
      const fb = fold(b.name);
      if (fa !== fb) return fa < fb ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
  } else {
    list.sort((a, b) => {
      const ca = latestResults.get(a.id)?.climate ?? null;
      const cb = latestResults.get(b.id)?.climate ?? null;
      if (ca === null && cb === null) return fold(a.name) < fold(b.name) ? -1 : fold(a.name) > fold(b.name) ? 1 : a.id < b.id ? -1 : 1;
      if (ca === null) return 1;
      if (cb === null) return -1;
      const c = cmp(ca, cb);
      if (c !== 0) return c;
      return a.id < b.id ? -1 : 1;
    });
  }
  const cursorValueOf = (s: StyleCore): string => {
    if (sort === "name") return `${fold(s.name)}\u0000${s.id}`;
    const c = latestResults.get(s.id)?.climate ?? "";
    return `${c}\u0000${s.id}`;
  };
  let startIndex = 0;
  if (cursor.length > 0) {
    const idx = list.findIndex((s) => cursorValueOf(s) === cursor);
    if (idx !== -1) startIndex = idx;
  }
  const page = list.slice(startIndex, startIndex + 25);
  const nextCursor = startIndex + 25 < list.length ? cursorValueOf(list[startIndex + 24]) : null;
  return {
    styles: page.map((s) => {
      const climate = latestResults.get(s.id);
      const shown = climate ? shownTotalOf(climate.climate) : null;
      return {
        id: s.id,
        labelId: s.label_id,
        labelName: labelNames.get(s.label_id) ?? "",
        styleCode: s.style_code,
        name: s.name,
        season: s.season,
        gtin: s.gtin,
        garment: s.garment,
        state: s.state,
        suppliers: suppliersOf(s),
        climateShown: shown,
      };
    }),
    nextCursor,
  };
}

function shownTotalOf(climate: string): string {
  return shownTotal(climate, "kg CO\u2082e");
}
