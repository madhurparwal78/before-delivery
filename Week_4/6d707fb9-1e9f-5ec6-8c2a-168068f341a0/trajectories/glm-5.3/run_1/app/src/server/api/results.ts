import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { newId, stableHash } from "../engine/ids.js";
import { instantOf, lisbonDate, shownTime } from "../engine/time.js";
import { requireDesk } from "../app.js";
import {
  errLibraryUnavailable,
  errNotFound,
  errScoreBusy,
  errScoreUnavailable,
  errStaleEdit,
  errValidation,
  errValidationMessage,
} from "./errors.js";
import { COPY } from "../engine/copy.js";
import { one, rows } from "../db/pool.js";
import { styleOfDesk, assertWritable, assertLabelOpen, linesOfStyle } from "./styles.js";
import { workOutFootprint, workOutScenario, type FactorRow, type MeasureFigure } from "../engine/footprint.js";
import { MEASURE_IDS, MEASURE_UNITS, MATERIALS } from "../engine/domain.js";
import { shownDifference, groupInt } from "../engine/display.js";
import { sub, add, mul, divRound } from "../engine/decimal.js";
import { askScoreOutcome, type ScoreInputs } from "../services/providers.js";

interface ResultRow {
  id: string;
  style_id: string;
  desk_id: string;
  edition: string;
  worked_out_at: string;
  data_quality_percent: number;
  data_quality_grade: string;
  factor_rows: FactorRow[];
  measures: MeasureFigure[];
}

export function resultOut(r: ResultRow, current: boolean): unknown {
  return {
    id: r.id,
    styleId: r.style_id,
    edition: r.edition,
    workedOutAt: r.worked_out_at,
    dataQualityPercent: r.data_quality_percent,
    dataQualityGrade: r.data_quality_grade,
    measures: r.measures,
    current,
  };
}

/** The newest edition in effect on today's Lisbon date. */
export async function newestEditionInEffect(
  providers: import("../services/providers.js").Providers,
  editions: { edition: string; validFrom: string }[],
): Promise<string> {
  const today = lisbonDate(new Date());
  let newest: string | null = null;
  let bestValid = "";
  for (const e of editions) {
    if (e.validFrom <= today && e.validFrom > bestValid) {
      bestValid = e.validFrom;
      newest = e.edition;
    }
  }
  return newest ?? editions[0]?.edition ?? "";
}

export async function registerResultRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/styles/:id/results", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const style = await styleOfDesk(deskId, id);
    assertWritable(style);
    await assertLabelOpen(style);
    const lines = await linesOfStyle(id);
    if (lines.length === 0) throw errValidationMessage(COPY.noLines);
    const missing = lines.find((l) => l.tier1_country === null);
    if (missing) {
      throw errValidationMessage(COPY.tier1Missing(materialName(missing.material_id)));
    }
    // Read the edition list and every page of the newest edition in effect, every time.
    let editions: { edition: string; validFrom: string }[];
    let factorRows: FactorRow[];
    let edition: string;
    try {
      editions = await app.state.providers.readEditions();
      edition = await newestEditionInEffect(app.state.providers, editions);
      factorRows = await app.state.providers.readFactors(edition);
    } catch {
      throw errLibraryUnavailable(COPY.libraryUnavailable);
    }
    const legs = await rows<{ mode: string; km: string }>(`SELECT mode, km FROM legs WHERE style_id = $1 ORDER BY position`, [id]);
    const out = workOutFootprint(
      factorRows,
      lines.map((l) => ({
        materialId: l.material_id,
        massGrams: l.mass_grams,
        tier1Country: l.tier1_country,
        answeredEnergyMjPerKg: l.answered_energy_mj,
        answeredWaterLitresPerKg: l.answered_water_l,
        answeredFibreOrigin: l.answered_fibre_origin,
      })),
      legs.map((l) => ({ mode: l.mode, km: l.km })),
      { washes: style.washes },
    );
    const resultId = newId();
    await rows(
      `INSERT INTO results (id, style_id, desk_id, edition, worked_out_at, data_quality_percent, data_quality_grade, factor_rows, measures)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [resultId, id, deskId, edition, instantOf(new Date()), out.dataQualityPercent, out.dataQualityGrade, JSON.stringify(factorRows), JSON.stringify(out.measures)],
    );
    await rows(`UPDATE styles SET state = 'worked' WHERE id = $1 AND state = 'draft'`, [id]);
    await rows(
      `INSERT INTO factor_reads (desk_id, editions, read_at) VALUES ($1,$2,$3)`,
      [deskId, JSON.stringify(editions), instantOf(new Date())],
    );
    reply.status(201);
    return resultOut(
      {
        id: resultId,
        style_id: id,
        desk_id: deskId,
        edition,
        worked_out_at: instantOf(new Date()),
        data_quality_percent: out.dataQualityPercent,
        data_quality_grade: out.dataQualityGrade,
        factor_rows: factorRows,
        measures: out.measures,
      },
      true,
    );
  });

  app.get("/api/styles/:id/results", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    await styleOfDesk(deskId, id);
    const list = await rows<ResultRow>(
      `SELECT * FROM results WHERE style_id = $1 ORDER BY worked_out_at DESC, id DESC`,
      [id],
    );
    const latest = list[0]?.id ?? null;
    return { results: list.map((r) => resultOut(r, r.id === latest)) };
  });

  app.get("/api/results/:id", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const r = await one<ResultRow>(`SELECT * FROM results WHERE id = $1`, [id]);
    if (!r || r.desk_id !== deskId) throw errNotFound();
    const latest = await one<{ id: string }>(
      `SELECT id FROM results WHERE style_id = $1 ORDER BY worked_out_at DESC, id DESC LIMIT 1`,
      [r.style_id],
    );
    return resultOut(r, latest?.id === r.id);
  });

  app.get("/api/results/:id/factors", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const r = await one<ResultRow>(`SELECT * FROM results WHERE id = $1`, [id]);
    if (!r || r.desk_id !== deskId) throw errNotFound();
    const query = req.query as Record<string, string>;
    const measure = query.measure ?? "";
    const stage = query.stage ?? "";
    if (!MEASURE_IDS.includes(measure as never)) throw errValidation({ measure: COPY.emptyField });
    if (!["materials", "making", "transport", "use", "endOfLife"].includes(stage)) {
      throw errValidation({ stage: COPY.emptyField });
    }
    const measureKey = measure as (typeof MEASURE_IDS)[number];
    const rowsOut = factorRowsForStage(r.factor_rows, measureKey, stage as "materials" | "making" | "transport" | "use" | "endOfLife");
    return { edition: r.edition, rows: rowsOut };
  });

  app.post("/api/factors/check", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    let editions: { edition: string; validFrom: string }[];
    try {
      editions = await app.state.providers.readEditions();
    } catch {
      throw errLibraryUnavailable(COPY.libraryUnavailable);
    }
    await rows(`INSERT INTO factor_reads (desk_id, editions, read_at) VALUES ($1,$2,$3)`, [
      deskId, JSON.stringify(editions), instantOf(new Date()),
    ]);
    const newest = await newestEditionInEffect(app.state.providers, editions);
    return { editions, newestInEffect: newest, checkedAt: instantOf(new Date()) };
  });

  app.post("/api/styles/:id/scenarios/preview", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const style = await styleOfDesk(deskId, id);
    const body = req.body as Record<string, unknown>;
    const resultId = typeof body?.resultId === "string" ? body.resultId : "";
    const baseline = await one<ResultRow>(`SELECT * FROM results WHERE id = $1 AND style_id = $2`, [resultId, id]);
    if (!baseline || baseline.desk_id !== deskId) throw errNotFound();
    const changes = readScenarioChanges(body);
    const out = await scenarioMeasures(style.id, baseline, changes);
    return { measures: out.measures, differences: out.differences };
  });

  app.get("/api/styles/:id/scenarios", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    await styleOfDesk(deskId, id);
    const list = await rows<{ id: string; name: string; result_id: string; changes: unknown; measures: MeasureFigure[]; differences: unknown; saved_at: string }>(
      `SELECT id, name, result_id, changes, measures, differences, saved_at FROM scenarios WHERE style_id = $1 ORDER BY saved_at DESC`,
      [id],
    );
    return {
      scenarios: list.map((s) => ({
        id: s.id,
        name: s.name,
        resultId: s.result_id,
        savedAt: s.saved_at,
        changes: s.changes,
        measures: s.measures,
        differences: s.differences,
      })),
    };
  });

  app.post("/api/styles/:id/scenarios", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const style = await styleOfDesk(deskId, id);
    assertWritable(style);
    await assertLabelOpen(style);
    const body = req.body as Record<string, unknown>;
    const name = typeof body?.name === "string" ? body.name : "";
    const resultId = typeof body?.resultId === "string" ? body.resultId : "";
    if (name.length === 0 || name.length > 120) throw errValidation({ name: COPY.emptyField });
    const baseline = await one<ResultRow>(`SELECT * FROM results WHERE id = $1 AND style_id = $2`, [resultId, id]);
    if (!baseline || baseline.desk_id !== deskId) throw errNotFound();
    const latest = await one<{ id: string }>(`SELECT id FROM results WHERE style_id = $1 ORDER BY worked_out_at DESC, id DESC LIMIT 1`, [id]);
    if (latest?.id !== resultId) {
      throw errStaleEdit(COPY.staleBaseline(shownTime(new Date(style.changed_at), "Europe/Lisbon")));
    }
    const changes = readScenarioChanges(body);
    const out = await scenarioMeasures(id, baseline, changes);
    const scenarioId = newId();
    await rows(
      `INSERT INTO scenarios (id, style_id, name, result_id, changes, measures, differences, saved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [scenarioId, id, name, resultId, JSON.stringify(changes), JSON.stringify(out.measures), JSON.stringify(out.differences), instantOf(new Date())],
    );
    reply.status(201);
    return {
      id: scenarioId,
      name,
      resultId,
      savedAt: instantOf(new Date()),
      changes,
      measures: out.measures,
      differences: out.differences,
    };
  });

  app.post("/api/styles/:id/score", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const style = await styleOfDesk(deskId, id);
    assertWritable(style);
    await assertLabelOpen(style);
    const lines = await linesOfStyle(id);
    if (lines.length === 0) throw errValidationMessage(COPY.noLines);
    const missing = lines.find((l) => !l.tier1_country || !l.tier2_country || !l.tier3_country);
    if (missing) throw errValidationMessage(COPY.missingOrigin(materialName(missing.material_id)));
    const inputs = buildScoreInputs(style, lines);
    const stored = await one<{ inputs_hash: string; score: number; per_100g: number; run_id: string; shown: string; worst_case_facts: string[] }>(
      `SELECT inputs_hash, score, per_100g, run_id, shown, worst_case_facts FROM scores WHERE style_id = $1`,
      [id],
    );
    const hash = stableHash(inputs);
    if (stored && stored.inputs_hash === hash) {
      // Same inputs never call twice: the stored score is shown and becomes current again.
      await rows(`UPDATE scores SET state = 'current' WHERE style_id = $1`, [id]);
      const worst = stored.worst_case_facts ?? [];
      return scoreOut("current", stored.score, stored.per_100g, stored.run_id, worst);
    }
    const existing = await one<{ state: string; busy_until: string | null; score: number | null; per_100g: number | null; run_id: string | null; shown: string | null; worst_case_facts: string[] }>(
      `SELECT state, busy_until, score, per_100g, run_id, shown, worst_case_facts FROM scores WHERE style_id = $1`,
      [id],
    );
    if (existing && existing.state === "busy") {
      const busyUntil = existing.busy_until ?? "";
      if (busyUntil > instantOf(new Date())) {
        throw errScoreBusy(COPY.scoreBusy(shownTime(new Date(busyUntil), "Europe/Lisbon")), busyUntil);
      }
    }
    const worstCaseFacts: string[] = [];
    if (style.repair_service === null) worstCaseFacts.push("repairService");
    if (style.range_size === null) worstCaseFacts.push("rangeSize");
    const outcome = await askScoreOutcome(app.state.providers, inputs);
    if (outcome.kind === "busy") {
      const busyUntil = instantOf(outcome.busyUntil);
      await rows(
        `INSERT INTO scores (style_id, state, busy_until, inputs_hash, inputs_body, asked_at)
         VALUES ($1,'busy',$2,$3,$4,$5)
         ON CONFLICT (style_id) DO UPDATE SET state = 'busy', busy_until = $2, inputs_hash = $3, inputs_body = $4, asked_at = $5`,
        [id, busyUntil, hash, JSON.stringify(inputs), instantOf(new Date())],
      );
      throw errScoreBusy(COPY.scoreBusy(shownTime(outcome.busyUntil, "Europe/Lisbon")), busyUntil);
    }
    if (outcome.kind === "unreachable") {
      throw errScoreUnavailable(COPY.scoreUnavailable);
    }
    const shown = COPY.scoreShown(groupInt(String(outcome.score)), groupInt(String(outcome.per100g)));
    await rows(
      `INSERT INTO scores (style_id, state, score, per_100g, run_id, shown, worst_case_facts, busy_until, inputs_hash, inputs_body, asked_at)
       VALUES ($1,'current',$2,$3,$4,$5,$6,NULL,$7,$8,$9)
       ON CONFLICT (style_id) DO UPDATE SET state = 'current', score = $2, per_100g = $3, run_id = $4, shown = $5, worst_case_facts = $6, busy_until = NULL, inputs_hash = $7, inputs_body = $8, asked_at = $9`,
      [id, outcome.score, outcome.per100g, outcome.runId, shown, worstCaseFacts, hash, JSON.stringify(inputs), instantOf(new Date())],
    );
    reply.status(200);
    return scoreOut("current", outcome.score, outcome.per100g, outcome.runId, worstCaseFacts);
  });
}

function materialName(id: string): string {
  return MATERIALS.find((m) => m.id === id)?.name ?? id;
}

export function factorRowsForStage(
  rowsIn: FactorRow[],
  measure: (typeof MEASURE_IDS)[number],
  stage: string,
): { id: string; kind: string; value: string; unit: string }[] {
  const fieldKey = measureField(measure);
  const unitSuffix = (kind: string): string => {
    if (kind === "material" || kind === "endOfLife") return " per kg";
    if (kind === "grid") return " per MJ";
    if (kind === "mode") return " per tonne-km";
    return " per wash";
  };
  const kinds = stage === "materials" ? ["material"] : stage === "making" ? ["grid"] : stage === "transport" ? ["mode"] : stage === "use" ? ["use"] : ["endOfLife"];
  return rowsIn
    .filter((r) => kinds.includes(r.kind))
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      value: (r as unknown as Record<string, string>)[fieldKey],
      unit: `${MEASURE_UNITS[measure]}${unitSuffix(r.kind)}`,
    }));
}

function measureField(measure: string): string {
  const map: Record<string, string> = {
    climate: "climate",
    water: "water",
    fossilEnergy: "fossil",
    landUse: "land",
    freshwaterToxicity: "toxicity",
    microfibres: "microfibres",
  };
  return map[measure] ?? measure;
}

export interface ScenarioChangeSet {
  recycled: { lineId: string; percent: number }[];
  materialSwaps: { lineId: string; materialId: string }[];
  factorySwaps: { lineId: string; country: string }[];
  legModes: { legIndex: number; mode: string }[];
}

function readScenarioChanges(body: Record<string, unknown>): ScenarioChangeSet {
  const readList = <T>(raw: unknown, map: (rec: Record<string, unknown>) => T): T[] =>
    Array.isArray(raw) ? (raw as unknown[]).map((x) => map(x as Record<string, unknown>)) : [];
  return {
    recycled: readList(body?.recycled, (r) => ({ lineId: String(r.lineId ?? ""), percent: Number(r.percent ?? 0) })),
    materialSwaps: readList(body?.materialSwaps, (r) => ({ lineId: String(r.lineId ?? ""), materialId: String(r.materialId ?? "") })),
    factorySwaps: readList(body?.factorySwaps, (r) => ({ lineId: String(r.lineId ?? ""), country: String(r.country ?? "") })),
    legModes: readList(body?.legModes, (r) => ({ legIndex: Number(r.legIndex ?? 0), mode: String(r.mode ?? "") })),
  };
}

async function scenarioMeasures(
  styleId: string,
  baseline: ResultRow,
  changes: ScenarioChangeSet,
): Promise<{ measures: MeasureFigure[]; differences: { measure: string; shown: string }[] }> {
  const style = await one<{ washes: number }>(`SELECT washes FROM styles WHERE id = $1`, [styleId]);
  const lines = (await linesOfStyle(styleId)).map((l) => ({
    id: l.id,
    materialId: l.material_id,
    massGrams: l.mass_grams,
    tier1Country: l.tier1_country,
    answeredEnergyMjPerKg: l.answered_energy_mj,
    answeredWaterLitresPerKg: l.answered_water_l,
    answeredFibreOrigin: l.answered_fibre_origin,
  }));
  const legs = (await rows<{ id: string; mode: string; km: string }>(`SELECT id, mode, km FROM legs WHERE style_id = $1 ORDER BY position`, [styleId])).map((l) => ({
    id: l.id,
    mode: l.mode,
    km: l.km,
  }));
  const out = workOutScenario(baseline.factor_rows, lines, legs, { washes: style?.washes ?? 30 }, changes);
  const differences = out.measures.map((m) => {
    const base = baseline.measures.find((b) => b.measure === m.measure);
    const diff = base ? sub(m.total, base.total) : "0";
    return { measure: m.measure, shown: shownDifference(diff, base?.total ?? "0") };
  });
  return { measures: out.measures, differences };
}

export function buildScoreInputs(
  style: { gtin: string; garment: string; washes: number; repair_service: boolean | null; range_size: number | null },
  lines: { id: string; material_id: string; mass_grams: string; tier1_country: string | null; tier2_country: string | null; tier3_country: string | null }[],
): ScoreInputs {
  const totalMass = lines.reduce((acc, l) => add(acc, l.mass_grams), "0");
  return {
    gtin: style.gtin,
    garment: style.garment,
    massGrams: totalMass,
    washes: style.washes,
    materials: lines.map((l) => ({
      id: l.material_id,
      sharePercent: divRound(mul(l.mass_grams, "100"), totalMass, 1),
      tier1: l.tier1_country ?? "",
      tier2: l.tier2_country ?? "",
      tier3: l.tier3_country ?? "",
    })),
    repairService: style.repair_service ?? false,
    rangeSize: style.range_size ?? 100000,
  };
}

function scoreOut(state: string, score: number, per100g: number, runId: string, worstCaseFacts: string[]): unknown {
  return {
    state,
    score,
    per100g,
    runId,
    shown: COPY.scoreShown(groupInt(String(score)), groupInt(String(per100g))),
    worstCaseFacts,
    busyUntil: null,
  };
}
