import { query } from '../db/pool';
import { dec } from '../domain/decimal';
import { copy } from '../domain/copy';
import type { CountryId, FactorRow, ModeId } from '../domain/factors';
import { materialName } from '../domain/factors';
import {
  type FootprintInput,
  indexRows,
  workOutDataQuality,
  workOutFootprint,
} from '../domain/footprint';
import { problem } from '../http/problem';
import { newId, nextSortIndex } from '../ids';
import { type KeptInput, factorRowsOf, latestResult, readLegs, readLines } from './read';
import type { LegRow, LineRow, ResultRow, StyleRowRecord } from './rows';

export interface BuiltInput {
  input: FootprintInput;
  kept: KeptInput;
  lines: LineRow[];
  legs: LegRow[];
}

/** A style with no lines, or a line with no tier 1 country, is refused before any call. */
export async function buildInput(style: StyleRowRecord): Promise<BuiltInput> {
  const lines = await readLines(style.id);
  if (lines.length === 0) throw problem.validation(copy.noLines);
  for (const line of lines) {
    if (!line.tier1 || line.tier1.country === null) {
      throw problem.validation(copy.noTierOne(materialName(line.material_id)));
    }
  }
  const legs = await readLegs(style.id);
  const input: FootprintInput = {
    lines: lines.map((line) => ({
      materialId: line.material_id,
      massGrams: dec(line.mass_grams),
      tier1Country: (line.tier1 as { country: CountryId }).country,
      answeredEnergyMjPerKg: line.answered_energy_mj === null ? null : dec(line.answered_energy_mj),
      answeredWaterLitresPerKg: line.answered_water_litres === null ? null : dec(line.answered_water_litres),
      hasAnsweredFacts:
        line.answered_energy_mj !== null || line.answered_water_litres !== null || line.answered_origin !== null,
    })),
    legs: legs.map((leg) => ({ mode: leg.mode as ModeId, km: dec(leg.km) })),
    washes: style.washes,
  };
  const kept: KeptInput = {
    lines: lines.map((line) => ({
      lineId: line.id,
      materialId: line.material_id,
      massGrams: dec(line.mass_grams).toFixed(),
      tier1Country: (line.tier1 as { country: CountryId }).country,
      answeredEnergyMjPerKg: line.answered_energy_mj,
      answeredWaterLitresPerKg: line.answered_water_litres,
      hasAnsweredFacts:
        line.answered_energy_mj !== null || line.answered_water_litres !== null || line.answered_origin !== null,
    })),
    legs: legs.map((leg) => ({ mode: leg.mode, km: dec(leg.km).toFixed() })),
    washes: style.washes,
  };
  return { input, kept, lines, legs };
}

export function inputOfKept(kept: KeptInput): FootprintInput {
  return {
    lines: kept.lines.map((line) => ({
      materialId: line.materialId,
      massGrams: dec(line.massGrams),
      tier1Country: line.tier1Country as CountryId | null,
      answeredEnergyMjPerKg: line.answeredEnergyMjPerKg === null ? null : dec(line.answeredEnergyMjPerKg),
      answeredWaterLitresPerKg:
        line.answeredWaterLitresPerKg === null ? null : dec(line.answeredWaterLitresPerKg),
      hasAnsweredFacts: line.hasAnsweredFacts,
    })),
    legs: kept.legs.map((leg) => ({ mode: leg.mode as ModeId, km: dec(leg.km) })),
    washes: kept.washes,
  };
}

/** Each result keeps its edition and the rows it was worked out from, for good. */
export async function storeResult(
  style: StyleRowRecord,
  edition: string,
  rows: FactorRow[],
  built: BuiltInput,
  now: number,
): Promise<ResultRow> {
  const measures = workOutFootprint(built.input, indexRows(rows));
  const quality = workOutDataQuality(built.input.lines);
  const id = newId();
  await query('update results set is_current = false where style_id = $1', [style.id]);
  await query(
    `insert into results (id, style_id, edition, worked_out_at, data_quality_percent, data_quality_grade,
      measures, factor_rows, input, is_current, sort_index)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)`,
    [
      id,
      style.id,
      edition,
      now,
      quality.dataQualityPercent,
      quality.dataQualityGrade,
      JSON.stringify(measures),
      JSON.stringify(rows),
      JSON.stringify(built.kept),
      nextSortIndex(),
    ],
  );
  if (style.state === 'draft') await query(`update styles set state = 'worked' where id = $1`, [style.id]);
  const made = await query<ResultRow>('select * from results where id = $1', [id]);
  return made[0] as ResultRow;
}

/** A supplier's answer makes a new result from the rows kept with the latest one. */
export async function remakeResultFromKeptRows(style: StyleRowRecord, now: number): Promise<void> {
  const previous = await latestResult(style.id);
  if (!previous) return;
  const built = await buildInput(style);
  await storeResult(style, previous.edition, factorRowsOf(previous), built, now);
}
