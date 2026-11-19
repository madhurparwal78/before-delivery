import { COUNTRIES, GARMENTS, MATERIALS, MEASURES, MODES, STAGES, materialName, type MeasureId, type StageId } from "../../shared/catalog";
import type { Line, ScenarioChanges } from "../../shared/api";
import { instantText, localDate, LISBON, wallTime } from "../../shared/time";
import { now, pool, transaction, type DbRow } from "../db";
import { ApiError, fieldErrors, notFound, ok, refused, route, type Call, type Session } from "../http";
import { addSeconds, atLisbon, characters, display, exact, plain, shareOf } from "../figures";
import { factorsOf, scenarioOn, type FootprintInputs, type LibraryRow } from "../footprint";
import { askScoreService, libraryUnavailable, readEditions, readFactors, type EditionEntry } from "../providers";
import {
  assertWritable,
  footprintInputs,
  insertResult,
  latestResultRow,
  legsOf,
  linesOf,
  loadStyle,
  newId,
  object,
  resultJson,
  scoreOf,
  type StyleRecord,
} from "../domain";

const EMPTY = "Give a value here.";
const desk = (call: Call): string => (call.session as Session).assessorId;
const theStyle = (call: Call): Promise<StyleRecord> => loadStyle(pool, desk(call), call.params[0] as string);

async function rememberEditions(editions: EditionEntry[]): Promise<void> {
  for (const entry of editions) {
    await pool.query(
      `INSERT INTO editions_seen (edition, valid_from) VALUES ($1, $2) ON CONFLICT (edition) DO UPDATE SET valid_from = EXCLUDED.valid_from`,
      [entry.edition, entry.validFrom],
    );
  }
}

/** The newest edition with validFrom on or before today's Lisbon date. */
function newestInEffect(editions: EditionEntry[]): EditionEntry | null {
  const today = localDate(now(), LISBON);
  return editions.filter((entry) => entry.validFrom <= today).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? null;
}

route("POST", "/api/styles/:id/results", {
  input: "emptyOrJson",
  resource: theStyle,
  handle: async (call, style) => {
    const lines = await linesOf(pool, style.id);
    if (!lines.length) throw refused("Add a material line first.");
    const gap = lines.find((line) => !line.tier1?.country);
    if (gap) throw refused(`Tier 1 country is missing for ${gap.materialName}.`);
    assertWritable(style);
    const editions = await readEditions();
    await rememberEditions(editions);
    const edition = newestInEffect(editions);
    if (!edition) throw libraryUnavailable();
    const rows = await readFactors(edition.edition);
    const inputs = footprintInputs(lines, await legsOf(pool, style.id), style.washes);
    const needed = [...inputs.lines.flatMap((line) => [line.materialId, line.country]), ...inputs.legs.map((leg) => leg.mode), "wash", "disposal"];
    if (!needed.every((id) => rows.some((row) => row.id === id))) {
      throw libraryUnavailable();
    }
    const id = await transaction(async (tx) => {
      const locked = await loadStyle(tx, desk(call), style.id, true);
      return insertResult(tx, locked, edition.edition, edition.validFrom, rows, inputs, now());
    });
    const made = await pool.query(`SELECT * FROM results WHERE id = $1`, [id]);
    return ok(resultJson(made.rows[0], id), 201);
  },
});

route("GET", "/api/styles/:id/results", {
  resource: theStyle,
  handle: async (_call, style) => {
    const { rows } = await pool.query(`SELECT * FROM results WHERE style_id = $1 ORDER BY seq DESC`, [style.id]);
    return ok({ results: rows.map((row) => resultJson(row, rows[0].id)) });
  },
});

const theResult = async (call: Call): Promise<DbRow> => {
  const { rows } = await pool.query(
    `SELECT r.* FROM results r JOIN styles s ON s.id = r.style_id WHERE r.id = $1 AND s.assessor_id = $2`,
    [call.params[0], desk(call)],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
};

route("GET", "/api/results/:id", {
  resource: theResult,
  handle: async (_call, result) => {
    const latest = await latestResultRow(pool, result.style_id);
    return ok(resultJson(result, latest?.id ?? null));
  },
});

route("GET", "/api/results/:id/factors", {
  resource: theResult,
  handle: async (call, result) => {
    const measure = call.query.get("measure") as MeasureId;
    const stage = call.query.get("stage") as StageId;
    const fields: Record<string, string> = {};
    if (!MEASURES.includes(measure)) fields.measure = EMPTY;
    if (!STAGES.includes(stage)) fields.stage = EMPTY;
    if (Object.keys(fields).length) throw fieldErrors(fields);
    return ok({ edition: result.edition, rows: factorsOf(result.inputs, result.kept_rows, measure, stage) });
  },
});

route("POST", "/api/factors/check", {
  input: "emptyOrJson",
  handle: async () => {
    const editions = await readEditions();
    await rememberEditions(editions);
    return ok({ editions, newestInEffect: newestInEffect(editions)?.edition ?? null, checkedAt: instantText(now()) });
  },
});

// ---- scenarios

async function readChanges(style: StyleRecord, body: Record<string, unknown>): Promise<ScenarioChanges> {
  const lineIds = new Set((await linesOf(pool, style.id)).map((line) => line.id));
  const fields: Record<string, string> = {};
  const listOf = (key: string): Record<string, unknown>[] => {
    const list = body[key];
    if (list === undefined) return [];
    if (!Array.isArray(list)) {
      fields[key] = EMPTY;
      return [];
    }
    list.forEach((change, index) => {
      if (!change || typeof change !== "object" || Array.isArray(change)) fields[`${key}.${index}`] = EMPTY;
    });
    return list;
  };
  const recycled = listOf("recycled");
  const materialSwaps = listOf("materialSwaps");
  const factorySwaps = listOf("factorySwaps");
  const legModes = listOf("legModes");
  if (Object.keys(fields).length) throw fieldErrors(fields);
  for (const change of [...recycled, ...materialSwaps, ...factorySwaps]) {
    if (!lineIds.has(change.lineId as string)) throw notFound();
  }
  recycled.forEach((change, index) => {
    if (!(Number.isInteger(change.percent) && (change.percent as number) >= 0 && (change.percent as number) <= 100)) fields[`recycled.${index}.percent`] = EMPTY;
  });
  materialSwaps.forEach((change, index) => {
    if (!MATERIALS.some((material) => material.id === change.materialId)) fields[`materialSwaps.${index}.materialId`] = EMPTY;
  });
  factorySwaps.forEach((change, index) => {
    if (!COUNTRIES.some((country) => country.id === change.country)) fields[`factorySwaps.${index}.country`] = EMPTY;
  });
  const legCount = (await legsOf(pool, style.id)).length;
  legModes.forEach((change, index) => {
    if (!(Number.isInteger(change.legIndex) && (change.legIndex as number) >= 0 && (change.legIndex as number) < legCount)) fields[`legModes.${index}.legIndex`] = EMPTY;
    if (!MODES.some((mode) => mode.id === change.mode)) fields[`legModes.${index}.mode`] = EMPTY;
  });
  if (Object.keys(fields).length) throw fieldErrors(fields);
  return {
    recycled: recycled.map((change) => ({ lineId: change.lineId as string, percent: change.percent as number })),
    materialSwaps: materialSwaps.map((change) => ({ lineId: change.lineId as string, materialId: change.materialId as string })),
    factorySwaps: factorySwaps.map((change) => ({ lineId: change.lineId as string, country: change.country as string })),
    legModes: legModes.map((change) => ({ legIndex: change.legIndex as number, mode: change.mode as string })),
  };
}

async function resultOfBody(style: StyleRecord, body: Record<string, unknown>): Promise<DbRow> {
  if (typeof body.resultId !== "string" || !body.resultId) throw fieldErrors({ resultId: EMPTY });
  const { rows } = await pool.query(`SELECT * FROM results WHERE id = $1 AND style_id = $2`, [body.resultId, style.id]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

function scenarioJson(row: DbRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    resultId: row.result_id,
    savedAt: instantText(row.saved_at),
    ...(row.changes as object),
    measures: row.measures,
    differences: row.differences,
  };
}

route("POST", "/api/styles/:id/scenarios/preview", {
  input: "json",
  resource: theStyle,
  handle: async (call, style) => {
    const body = object(call.body);
    const result = await resultOfBody(style, body);
    const changes = await readChanges(style, body);
    return ok(scenarioOn(result.measures, result.inputs as FootprintInputs, result.kept_rows as LibraryRow[], changes));
  },
});

route("GET", "/api/styles/:id/scenarios", {
  resource: theStyle,
  handle: async (_call, style) => {
    const { rows } = await pool.query(`SELECT * FROM scenarios WHERE style_id = $1 ORDER BY seq`, [style.id]);
    return ok({ scenarios: rows.map(scenarioJson) });
  },
});

route("POST", "/api/styles/:id/scenarios", {
  input: "json",
  resource: theStyle,
  handle: async (call, style) => {
    const body = object(call.body);
    const result = await resultOfBody(style, body);
    const changes = await readChanges(style, body);
    if (typeof body.name !== "string" || !body.name.trim() || characters(body.name) > 120) throw fieldErrors({ name: EMPTY });
    const latest = await latestResultRow(pool, style.id);
    const newest = latest as DbRow;
    if (newest.id !== result.id) {
      throw new ApiError(412, "stale_edit", `The baseline was worked out again at ${wallTime(newest.worked_out_at)} Lisbon time. Your scenario is still here.`);
    }
    const preview = scenarioOn(result.measures, result.inputs as FootprintInputs, result.kept_rows as LibraryRow[], changes);
    const { rows } = await pool.query(
      `INSERT INTO scenarios (id, style_id, result_id, name, saved_at, changes, measures, differences) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [newId(), style.id, result.id, body.name, now(), JSON.stringify(changes), JSON.stringify(preview.measures), JSON.stringify(preview.differences)],
    );
    return ok(scenarioJson(rows[0]), 201);
  },
});

// ---- textile score

/** The score service's body; same inputs mean the same body after sorting its keys. */
export function scoreBody(style: Pick<StyleRecord, "gtin" | "garment" | "washes" | "repair_service" | "range_size">, lines: Line[]): Record<string, unknown> {
  const totalMass = lines.reduce((sum, line) => sum.plus(line.massGrams), exact(0));
  return {
    gtin: style.gtin,
    garment: style.garment,
    massGrams: plain(totalMass),
    washes: style.washes,
    materials: lines.map((line) => ({
      id: line.materialId,
      sharePercent: shareOf(exact(line.massGrams), totalMass),
      tier1: line.tier1?.country,
      tier2: line.tier2?.country,
      tier3: line.tier3?.country,
    })),
    repairService: style.repair_service ?? false,
    rangeSize: style.range_size ?? 100000,
  };
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, inner]) => [key, sorted(inner)]));
  }
  return value;
}

export function bodyKey(body: unknown): string {
  return JSON.stringify(sorted(body));
}

function busyError(until: Date): ApiError {
  return new ApiError(503, "score_service_busy", `The score service is busy. You can try again at ${atLisbon(until)} Lisbon time.`, undefined, { busyUntil: instantText(until) });
}

route("POST", "/api/styles/:id/score", {
  input: "emptyOrJson",
  resource: theStyle,
  handle: async (call, { id }) => {
    // The style's row stays locked through the call, so askers of one style wait and then find the stored score.
    const answered = await transaction(async (tx) => {
      const style = await loadStyle(tx, desk(call), id, true);
      const lines = await linesOf(tx, id);
      if (!lines.length) throw refused("Add a material line first.");
      const gap = lines.find((line) => !line.tier1?.country || !line.tier2?.country || !line.tier3?.country);
      if (gap) throw refused(`Fibre origin is missing for ${materialName(gap.materialId)}.`);
      assertWritable(style);
      const at = now();
      if (style.busy_until && at < style.busy_until) throw busyError(style.busy_until);
      const body = scoreBody(style, lines);
      const key = bodyKey(body);
      const stored = await tx.query(`SELECT id FROM scores WHERE style_id = $1 AND body_key = $2`, [id, key]);
      let scoreId: string | undefined = stored.rows[0]?.id;
      if (!scoreId) {
        const answer = await askScoreService(body);
        if (answer.kind === "busy") {
          const until = addSeconds(at, answer.retryAfterSeconds);
          await tx.query(`UPDATE styles SET busy_until = $2 WHERE id = $1`, [id, until]);
          // Returned, not thrown: busyUntil has to commit.
          return busyError(until);
        }
        if (answer.kind === "unavailable") {
          throw new ApiError(503, "score_service_unavailable", "The score service is unavailable right now. Nothing changed.");
        }
        const worstCase = [...(style.repair_service === null ? ["repairService"] : []), ...(style.range_size === null ? ["rangeSize"] : [])];
        const made = await tx.query(
          `INSERT INTO scores (id, style_id, body_key, score, per100g, run_id, worst_case_facts) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (style_id, body_key) DO UPDATE SET run_id = scores.run_id RETURNING id`,
          [newId(), id, key, answer.score, answer.per100g, answer.runId, JSON.stringify(worstCase)],
        );
        scoreId = made.rows[0].id as string;
      }
      await tx.query(`UPDATE styles SET score_id = $2, score_state = 'current', busy_until = NULL WHERE id = $1`, [id, scoreId]);
      return ok(await scoreOf(tx, await loadStyle(tx, desk(call), id)));
    });
    if (answered instanceof ApiError) throw answered;
    return answered;
  },
});

// ---- Try one garment

const GARMENT_KILOS: Record<string, string> = { tshirt: "0.25", shirt: "0.30", jeans: "0.80", coat: "1.20" };
const FIBRE_VALUES: Record<string, string> = { "organic-cotton": "3.10", cotton: "4.15", polyester: "3.24", wool: "14.6" };
const COUNTRY_VALUES: Record<string, string> = { PT: "0.92", TR: "1.35", VN: "2.10", EG: "1.74" };

route("GET", "/api/estimate", {
  auth: false,
  handle: async (call) => {
    const garment = call.query.get("garment") ?? "";
    const fibre = call.query.get("fibre") ?? "";
    const country = call.query.get("country") ?? "";
    const fields: Record<string, string> = {};
    if (!GARMENTS.some((entry) => entry.id === garment)) fields.garment = EMPTY;
    if (!(fibre in FIBRE_VALUES)) fields.fibre = EMPTY;
    if (!(country in COUNTRY_VALUES)) fields.country = EMPTY;
    if (Object.keys(fields).length) throw fieldErrors(fields);
    const climate = exact(GARMENT_KILOS[garment] as string).times(exact(FIBRE_VALUES[fibre] as string).plus(COUNTRY_VALUES[country] as string));
    return ok({ garment, fibre, country, climate: plain(climate), shown: `${display(climate)} kg CO₂e`, answeredAt: instantText(now()) });
  },
});
