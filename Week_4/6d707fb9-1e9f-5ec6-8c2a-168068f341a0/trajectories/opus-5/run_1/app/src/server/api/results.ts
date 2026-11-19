import { createHash } from 'node:crypto';
import { one, query } from '../db/pool';
import { Decimal, dec, sum } from '../domain/decimal';
import { shownDifference, shownFigure } from '../domain/display';
import { copy } from '../domain/copy';
import {
  type CountryId,
  type FactorRow,
  MEASURE_COLUMNS,
  isCountry,
  isMaterial,
  isMeasure,
  isMode,
  isStage,
  materialName,
  rowUnit,
} from '../domain/factors';
import {
  type MeasureFigure,
  type ScenarioChanges,
  type ScenarioLine,
  estimateClimate,
  ESTIMATE_COUNTRIES,
  ESTIMATE_FIBRES,
  ESTIMATE_GARMENTS,
  indexRows,
  rowsUsed,
  workOutScenario,
} from '../domain/footprint';
import { LISBON, iso, localDate, localTime } from '../domain/time';
import { newId, nextSortIndex } from '../ids';
import { problem } from '../http/problem';
import type { Ctx, Reply } from '../http/router';
import { FieldCollector, requiredText } from '../store/fields';
import { requireWritable } from '../store/guards';
import {
  factorRowsOf,
  findStyle,
  keptInputOf,
  latestResult,
  measuresOf,
  readScore,
  resultShape,
  scoreShape,
} from '../store/read';
import { buildInput, inputOfKept, storeResult } from '../store/results';
import { LibraryUnreachable, readEditions, readFactors } from '../services/library';
import { ScoreBusy, ScoreUnavailable, type ScoreBody, askForScore } from '../services/scoreService';
import { labelOfStyle } from './labels';
import type { ResultRow, StyleRowRecord } from '../store/rows';

async function rememberEditions(editions: { edition: string; validFrom: string }[], now: number): Promise<void> {
  for (const edition of editions) {
    await query(
      `insert into editions_seen (edition, valid_from, seen_at) values ($1,$2,$3)
       on conflict (edition) do update set valid_from = excluded.valid_from`,
      [edition.edition, edition.validFrom, now],
    );
  }
}

function newestInEffect(editions: { edition: string; validFrom: string }[], today: string): string | null {
  let newest: { edition: string; validFrom: string } | null = null;
  for (const edition of editions) {
    if (edition.validFrom > today) continue;
    if (!newest || edition.validFrom > newest.validFrom) newest = edition;
  }
  return newest ? newest.edition : null;
}

/** `Work out footprint` reads the edition list and every page of the newest edition in effect. */
export async function workOutResult(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const label = await labelOfStyle(style);
  const built = await buildInput(style);
  requireWritable(style, label);

  const today = localDate(ctx.now, LISBON);
  let rows: FactorRow[];
  let edition: string;
  try {
    const editions = await readEditions();
    await rememberEditions(editions, ctx.now);
    const newest = newestInEffect(editions, today);
    if (newest === null) throw new LibraryUnreachable('no edition is in effect');
    edition = newest;
    rows = await readFactors(edition);
  } catch (thrown) {
    if (thrown instanceof LibraryUnreachable) throw problem.factorLibraryUnavailable();
    throw thrown;
  }

  const result = await storeResult(style, edition, rows, built, ctx.now);
  return { status: 201, json: resultShape(result) };
}

export async function listResults(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const results = await query<ResultRow>('select * from results where style_id = $1 order by sort_index desc', [
    style.id,
  ]);
  return { status: 200, json: { results: results.map(resultShape) } };
}

async function findResult(deskId: string, resultId: string): Promise<{ result: ResultRow; style: StyleRowRecord }> {
  const result = await one<ResultRow>(
    `select r.* from results r join styles s on s.id = r.style_id join labels l on l.id = s.label_id
     where r.id = $1 and s.assessor_id = $2 and l.state <> 'erased'`,
    [resultId, deskId],
  );
  if (!result) throw problem.notFound();
  const style = await findStyle(deskId, result.style_id);
  return { result, style };
}

export async function readResult(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const { result } = await findResult(desk.id, ctx.params.id as string);
  return { status: 200, json: resultShape(result) };
}

export async function readResultFactors(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const { result } = await findResult(desk.id, ctx.params.id as string);
  const measure = ctx.query.get('measure');
  const stage = ctx.query.get('stage');
  if (!isMeasure(measure) || !isStage(stage)) throw problem.validation(copy.emptyField);
  const rows = factorRowsOf(result);
  const input = inputOfKept(keptInputOf(result));
  const used = rowsUsed(input, indexRows(rows), measure, stage);
  return {
    status: 200,
    json: {
      edition: result.edition,
      rows: used.map((row) => ({
        id: row.id,
        kind: row.kind,
        value: row[MEASURE_COLUMNS[measure]] as string,
        unit: rowUnit(measure, row.kind),
      })),
    },
  };
}

/** `Check for newer factors` reads only the edition list. */
export async function checkFactors(ctx: Ctx): Promise<Reply> {
  ctx.requireDesk();
  let editions: { edition: string; validFrom: string }[];
  try {
    editions = await readEditions();
  } catch (thrown) {
    if (thrown instanceof LibraryUnreachable) throw problem.factorLibraryUnavailable();
    throw thrown;
  }
  await rememberEditions(editions, ctx.now);
  return {
    status: 200,
    json: {
      editions,
      newestInEffect: newestInEffect(editions, localDate(ctx.now, LISBON)),
      checkedAt: iso(ctx.now),
    },
  };
}

interface ReadChanges {
  changes: ScenarioChanges;
  stored: {
    recycled: { lineId: string; percent: number }[];
    materialSwaps: { lineId: string; materialId: string }[];
    factorySwaps: { lineId: string; country: string }[];
    legModes: { legIndex: number; mode: string }[];
  };
}

function readChanges(body: Record<string, unknown>, lineIds: string[], legCount: number): ReadChanges {
  const problems = new FieldCollector();
  const changes: ScenarioChanges = {
    recycled: new Map(),
    materialSwaps: new Map(),
    factorySwaps: new Map(),
    legModes: new Map(),
  };
  const stored: ReadChanges['stored'] = { recycled: [], materialSwaps: [], factorySwaps: [], legModes: [] };

  const recycled = Array.isArray(body.recycled) ? body.recycled : [];
  recycled.forEach((entry, index) => {
    const given = (entry ?? {}) as Record<string, unknown>;
    const lineId = typeof given.lineId === 'string' ? given.lineId : '';
    const percent = given.percent;
    if (!lineIds.includes(lineId)) problems.add(`recycled.${index}.lineId`, copy.emptyField);
    else if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 0 || percent > 100) {
      problems.add(`recycled.${index}.percent`, copy.emptyField);
    } else {
      changes.recycled.set(lineId, percent);
      stored.recycled.push({ lineId, percent });
    }
  });

  const materialSwaps = Array.isArray(body.materialSwaps) ? body.materialSwaps : [];
  materialSwaps.forEach((entry, index) => {
    const given = (entry ?? {}) as Record<string, unknown>;
    const lineId = typeof given.lineId === 'string' ? given.lineId : '';
    if (!lineIds.includes(lineId)) problems.add(`materialSwaps.${index}.lineId`, copy.emptyField);
    else if (!isMaterial(given.materialId)) problems.add(`materialSwaps.${index}.materialId`, copy.emptyField);
    else {
      changes.materialSwaps.set(lineId, given.materialId);
      stored.materialSwaps.push({ lineId, materialId: given.materialId });
    }
  });

  const factorySwaps = Array.isArray(body.factorySwaps) ? body.factorySwaps : [];
  factorySwaps.forEach((entry, index) => {
    const given = (entry ?? {}) as Record<string, unknown>;
    const lineId = typeof given.lineId === 'string' ? given.lineId : '';
    if (!lineIds.includes(lineId)) problems.add(`factorySwaps.${index}.lineId`, copy.emptyField);
    else if (!isCountry(given.country)) problems.add(`factorySwaps.${index}.country`, copy.emptyField);
    else {
      changes.factorySwaps.set(lineId, given.country as CountryId);
      stored.factorySwaps.push({ lineId, country: given.country });
    }
  });

  const legModes = Array.isArray(body.legModes) ? body.legModes : [];
  legModes.forEach((entry, index) => {
    const given = (entry ?? {}) as Record<string, unknown>;
    const legIndex = given.legIndex;
    if (typeof legIndex !== 'number' || !Number.isInteger(legIndex) || legIndex < 0 || legIndex >= legCount) {
      problems.add(`legModes.${index}.legIndex`, copy.emptyField);
    } else if (!isMode(given.mode)) problems.add(`legModes.${index}.mode`, copy.emptyField);
    else {
      changes.legModes.set(legIndex, given.mode);
      stored.legModes.push({ legIndex, mode: given.mode });
    }
  });

  problems.throwIfAny();
  return { changes, stored };
}

export interface ScenarioFigures {
  measures: MeasureFigure[];
  differences: { measure: string; shown: string }[];
}

/** A scenario uses only the rows kept with the result and never touches it. */
export function scenarioFigures(result: ResultRow, changes: ScenarioChanges): ScenarioFigures {
  const kept = keptInputOf(result);
  const rows = indexRows(factorRowsOf(result));
  const lines: ScenarioLine[] = kept.lines.map((line) => ({
    lineId: line.lineId,
    materialId: line.materialId,
    massGrams: dec(line.massGrams),
    tier1Country: line.tier1Country as CountryId | null,
    answeredEnergyMjPerKg: line.answeredEnergyMjPerKg === null ? null : dec(line.answeredEnergyMjPerKg),
    answeredWaterLitresPerKg:
      line.answeredWaterLitresPerKg === null ? null : dec(line.answeredWaterLitresPerKg),
    hasAnsweredFacts: line.hasAnsweredFacts,
  }));
  const legs = inputOfKept(kept).legs;
  const measures = workOutScenario(lines, legs, kept.washes, rows, changes);
  const baseline = measuresOf(result);
  const differences = measures.map((measure) => {
    const base = baseline.find((entry) => entry.measure === measure.measure) as MeasureFigure;
    return {
      measure: measure.measure,
      shown: shownDifference(dec(measure.total), dec(base.total), measure.unit),
    };
  });
  return { measures, differences };
}

async function baselineResult(styleId: string, resultId: unknown): Promise<ResultRow> {
  if (typeof resultId !== 'string' || resultId === '') {
    const latest = await latestResult(styleId);
    if (!latest) throw problem.notFound();
    return latest;
  }
  const result = await one<ResultRow>('select * from results where id = $1 and style_id = $2', [
    resultId,
    styleId,
  ]);
  if (!result) throw problem.notFound();
  return result;
}

export async function previewScenario(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const body = ctx.json();
  const result = await baselineResult(style.id, body.resultId);
  const kept = keptInputOf(result);
  const { changes } = readChanges(
    body,
    kept.lines.map((line) => line.lineId),
    kept.legs.length,
  );
  const figures = scenarioFigures(result, changes);
  return { status: 200, json: figures };
}

export async function listScenarios(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const rows = await query<{
    id: string;
    name: string;
    result_id: string;
    saved_at: string;
    changes: ReadChanges['stored'];
    measures: MeasureFigure[];
    differences: { measure: string; shown: string }[];
  }>('select * from scenarios where style_id = $1 order by sort_index', [style.id]);
  return {
    status: 200,
    json: {
      scenarios: rows.map((row) => ({
        id: row.id,
        name: row.name,
        resultId: row.result_id,
        savedAt: iso(Number(row.saved_at)),
        ...row.changes,
        measures: row.measures,
        differences: row.differences,
      })),
    },
  };
}

export async function saveScenario(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const body = ctx.json();
  const result = await baselineResult(style.id, body.resultId);
  const kept = keptInputOf(result);
  const problems = new FieldCollector();
  const name = requiredText(body, 'name', problems);
  problems.throwIfAny();
  const { changes, stored } = readChanges(
    body,
    kept.lines.map((line) => line.lineId),
    kept.legs.length,
  );

  const latest = await latestResult(style.id);
  if (!latest || latest.id !== result.id) {
    throw problem.staleEdit(
      copy.staleBaseline(localTime(Number((latest as ResultRow).worked_out_at), LISBON)),
    );
  }

  const figures = scenarioFigures(result, changes);
  const id = newId();
  await query(
    `insert into scenarios (id, style_id, name, result_id, saved_at, changes, measures, differences, sort_index)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      style.id,
      name,
      result.id,
      ctx.now,
      JSON.stringify(stored),
      JSON.stringify(figures.measures),
      JSON.stringify(figures.differences),
      nextSortIndex(),
    ],
  );
  return {
    status: 201,
    json: {
      id,
      name,
      resultId: result.id,
      savedAt: iso(ctx.now),
      ...stored,
      measures: figures.measures,
      differences: figures.differences,
    },
  };
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, held]) => `${JSON.stringify(key)}:${sortedJson(held)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function buildScoreBody(
  style: StyleRowRecord,
): Promise<{ body: ScoreBody; worstCaseFacts: string[] }> {
  const built = await buildInput(style);
  const lines = built.lines;
  for (const line of lines) {
    const tiers = [line.tier1, line.tier2, line.tier3];
    if (tiers.some((tier) => !tier || tier.country === null)) {
      throw problem.validation(copy.missingOrigin(materialName(line.material_id)));
    }
  }
  const totalMass = sum(lines.map((line) => dec(line.mass_grams)));
  const worstCaseFacts: string[] = [];
  if (style.repair_service === null) worstCaseFacts.push('repairService');
  if (style.range_size === null) worstCaseFacts.push('rangeSize');
  return {
    body: {
      gtin: style.gtin,
      garment: style.garment,
      massGrams: totalMass.toFixed(),
      washes: style.washes,
      materials: lines.map((line) => ({
        id: line.material_id,
        sharePercent: totalMass.isZero()
          ? '0.0'
          : dec(line.mass_grams).dividedBy(totalMass).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1),
        tier1: (line.tier1 as { country: string }).country,
        tier2: (line.tier2 as { country: string }).country,
        tier3: (line.tier3 as { country: string }).country,
      })),
      repairService: style.repair_service ?? false,
      rangeSize: style.range_size ?? 100000,
    },
    worstCaseFacts,
  };
}

export async function askScore(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const { body, worstCaseFacts } = await buildScoreBody(style);
  const hash = createHash('sha256').update(sortedJson(body)).digest('hex');
  const existing = await readScore(style.id);

  if (existing && existing.body_hash === hash && existing.score !== null) {
    await query(`update scores set state = 'current', worst_case = $1 where style_id = $2`, [
      JSON.stringify(worstCaseFacts),
      style.id,
    ]);
    return { status: 200, json: scoreShape(await readScore(style.id)) };
  }

  if (existing && existing.busy_until !== null && ctx.now < Number(existing.busy_until)) {
    throw problem.scoreServiceBusy(
      copy.scoreBusy(localTime(Number(existing.busy_until), LISBON)),
      iso(Number(existing.busy_until)),
    );
  }

  try {
    const answer = await askForScore(body);
    await query(
      `insert into scores (style_id, state, score, per100g, run_id, body_hash, worst_case, busy_until, asked_at)
       values ($1,'current',$2,$3,$4,$5,$6,null,$7)
       on conflict (style_id) do update set state = 'current', score = excluded.score,
         per100g = excluded.per100g, run_id = excluded.run_id, body_hash = excluded.body_hash,
         worst_case = excluded.worst_case, busy_until = null, asked_at = excluded.asked_at`,
      [style.id, answer.score, answer.per100g, answer.runId, hash, JSON.stringify(worstCaseFacts), ctx.now],
    );
    return { status: 200, json: scoreShape(await readScore(style.id)) };
  } catch (thrown) {
    if (thrown instanceof ScoreBusy) {
      const busyUntil = ctx.now + thrown.retryAfterSeconds;
      await query(
        `insert into scores (style_id, state, worst_case, busy_until) values ($1,'busy',$2,$3)
         on conflict (style_id) do update set state = 'busy', busy_until = $3`,
        [style.id, JSON.stringify(worstCaseFacts), busyUntil],
      );
      throw problem.scoreServiceBusy(copy.scoreBusy(localTime(busyUntil, LISBON)), iso(busyUntil));
    }
    if (thrown instanceof ScoreUnavailable) throw problem.scoreServiceUnavailable();
    throw thrown;
  }
}

export function estimate(ctx: Ctx): Reply {
  const garment = ctx.query.get('garment') ?? '';
  const fibre = ctx.query.get('fibre') ?? '';
  const country = ctx.query.get('country') ?? '';
  const problems = new FieldCollector();
  if (!(garment in ESTIMATE_GARMENTS)) problems.add('garment', copy.emptyField);
  if (!(fibre in ESTIMATE_FIBRES)) problems.add('fibre', copy.emptyField);
  if (!(country in ESTIMATE_COUNTRIES)) problems.add('country', copy.emptyField);
  problems.throwIfAny();
  const climate = estimateClimate(garment, fibre, country);
  return {
    status: 200,
    json: {
      garment,
      fibre,
      country,
      climate: climate.toFixed(),
      shown: `${shownFigure(climate)} kg CO\u2082e`,
      answeredAt: iso(ctx.now),
    },
  };
}
