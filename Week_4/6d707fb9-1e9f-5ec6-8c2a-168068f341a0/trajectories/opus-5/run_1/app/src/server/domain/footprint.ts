import { Decimal, ZERO, dec, sum } from './decimal';
import { sharePercent, shownFigure, shownWithUnit } from './display';
import {
  type CountryId,
  type FactorRow,
  MEASURES,
  MEASURE_COLUMNS,
  MEASURE_UNITS,
  type MeasureId,
  type ModeId,
  STAGES,
  type StageId,
} from './factors';

export interface FootprintLine {
  materialId: string;
  massGrams: Decimal;
  tier1Country: CountryId | null;
  answeredEnergyMjPerKg: Decimal | null;
  answeredWaterLitresPerKg: Decimal | null;
  hasAnsweredFacts: boolean;
}

export interface FootprintLeg {
  mode: ModeId;
  km: Decimal;
}

export interface FootprintInput {
  lines: FootprintLine[];
  legs: FootprintLeg[];
  washes: number;
}

interface StageFigure {
  stage: StageId;
  value: string;
  shown: string;
  share: string;
}

export interface MeasureFigure {
  measure: MeasureId;
  unit: string;
  total: string;
  totalShown: string;
  hotspot: StageId;
  stages: StageFigure[];
}

type RowIndex = Map<string, FactorRow>;

export function indexRows(rows: FactorRow[]): RowIndex {
  return new Map(rows.map((row) => [row.id, row]));
}

function factor(rows: RowIndex, id: string, measure: MeasureId): Decimal {
  const row = rows.get(id);
  if (!row) throw new Error(`the kept factor rows hold no row ${id}`);
  return dec(row[MEASURE_COLUMNS[measure]] as string);
}

function makingMegajoules(rows: RowIndex, line: FootprintLine): Decimal {
  if (line.answeredEnergyMjPerKg) return line.answeredEnergyMjPerKg;
  const row = rows.get(line.materialId);
  if (!row || row.makingMjPerKg == null) {
    throw new Error(`the kept factor rows hold no making energy for ${line.materialId}`);
  }
  return dec(row.makingMjPerKg);
}

const GRAMS_PER_KG = new Decimal(1000);

function massKg(massGrams: Decimal): Decimal {
  return massGrams.dividedBy(GRAMS_PER_KG);
}

function stageValues(input: FootprintInput, rows: RowIndex, measure: MeasureId): Record<StageId, Decimal> {
  const totalMassKg = sum(input.lines.map((line) => massKg(line.massGrams)));

  const materials = sum(
    input.lines.map((line) => massKg(line.massGrams).times(factor(rows, line.materialId, measure))),
  );

  const making = sum(
    input.lines.map((line) => {
      const kg = massKg(line.massGrams);
      if (measure === 'water' && line.answeredWaterLitresPerKg) {
        return kg.times(line.answeredWaterLitresPerKg);
      }
      if (!line.tier1Country) throw new Error('a line has no tier 1 country');
      return kg.times(makingMegajoules(rows, line)).times(factor(rows, line.tier1Country, measure));
    }),
  );

  const transport = sum(
    input.legs.map((leg) =>
      totalMassKg.dividedBy(GRAMS_PER_KG).times(leg.km).times(factor(rows, leg.mode, measure)),
    ),
  );

  const use = new Decimal(input.washes).times(factor(rows, 'wash', measure));
  const endOfLife = totalMassKg.times(factor(rows, 'disposal', measure));

  return { materials, making, transport, use, endOfLife };
}

/** The published footprint sum, in exact decimals, for every measure. */
export function workOutFootprint(input: FootprintInput, rows: RowIndex): MeasureFigure[] {
  return MEASURES.map((measure) => {
    const values = stageValues(input, rows, measure);
    const total = sum(STAGES.map((stage) => values[stage]));
    const stages: StageFigure[] = STAGES.map((stage) => ({
      stage,
      value: values[stage].toFixed(),
      shown: shownFigure(values[stage]),
      share: sharePercent(values[stage], total),
    }));
    let hotspot: StageId = 'materials';
    for (const stage of STAGES) {
      if (values[stage].greaterThan(values[hotspot])) hotspot = stage;
    }
    return {
      measure,
      unit: MEASURE_UNITS[measure],
      total: total.toFixed(),
      totalShown: shownWithUnit(total, MEASURE_UNITS[measure]),
      hotspot,
      stages,
    };
  });
}

interface DataQuality {
  dataQualityPercent: number;
  dataQualityGrade: 'A' | 'B' | 'C';
}

/** The share of mass on lines with supplier-given facts, half up to a whole percent. */
export function workOutDataQuality(lines: FootprintLine[]): DataQuality {
  const totalMass = sum(lines.map((line) => line.massGrams));
  const answeredMass = sum(lines.filter((line) => line.hasAnsweredFacts).map((line) => line.massGrams));
  const percent = totalMass.isZero()
    ? 0
    : Number(answeredMass.dividedBy(totalMass).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
  const grade = percent >= 80 ? 'A' : percent >= 50 ? 'B' : 'C';
  return { dataQualityPercent: percent, dataQualityGrade: grade };
}

/** The kept factor rows a stage uses for a measure, each kept only once and in use order. */
export function rowsUsed(
  input: FootprintInput,
  rows: RowIndex,
  measure: MeasureId,
  stage: StageId,
): FactorRow[] {
  const ids: string[] = [];
  const add = (id: string): void => {
    if (!ids.includes(id)) ids.push(id);
  };
  if (stage === 'materials') input.lines.forEach((line) => add(line.materialId));
  if (stage === 'making') {
    input.lines.forEach((line) => {
      if (measure === 'water' && line.answeredWaterLitresPerKg) return;
      if (line.tier1Country) add(line.tier1Country);
    });
  }
  if (stage === 'transport') input.legs.forEach((leg) => add(leg.mode));
  if (stage === 'use') add('wash');
  if (stage === 'endOfLife') add('disposal');
  return ids.map((id) => rows.get(id)).filter((row): row is FactorRow => row !== undefined);
}

const RECYCLED_STEP = new Decimal('0.006');

export interface ScenarioChanges {
  recycled: Map<string, number>;
  materialSwaps: Map<string, string>;
  factorySwaps: Map<string, CountryId>;
  legModes: Map<number, ModeId>;
}

export interface ScenarioLine extends FootprintLine {
  lineId: string;
}

/**
 * A scenario, worked out from the rows kept with the result alone, never
 * touching it.
 */
export function workOutScenario(
  lines: ScenarioLine[],
  legs: FootprintLeg[],
  washes: number,
  rows: RowIndex,
  changes: ScenarioChanges,
): MeasureFigure[] {
  const changedLines = lines.map((line) => {
    const swap = changes.materialSwaps.get(line.lineId);
    const factory = changes.factorySwaps.get(line.lineId);
    const changed: ScenarioLine = { ...line };
    if (swap !== undefined) {
      changed.materialId = swap;
      changed.answeredEnergyMjPerKg = null;
      changed.answeredWaterLitresPerKg = null;
    }
    if (factory !== undefined) {
      changed.tier1Country = factory;
      changed.answeredEnergyMjPerKg = null;
    }
    return changed;
  });
  const changedLegs = legs.map((leg, index) => {
    const mode = changes.legModes.get(index);
    return mode === undefined ? leg : { ...leg, mode };
  });
  const input: FootprintInput = { lines: changedLines, legs: changedLegs, washes };

  return MEASURES.map((measure) => {
    const values = stageValues(input, rows, measure);
    const recycledSaving = sum(
      changedLines.map((line) => {
        const percent = changes.recycled.get(line.lineId);
        if (percent === undefined || percent === 0) return ZERO;
        const figure = massKg(line.massGrams).times(factor(rows, line.materialId, measure));
        return figure.times(RECYCLED_STEP.times(percent));
      }),
    );
    values.materials = values.materials.minus(recycledSaving);
    const total = sum(STAGES.map((stage) => values[stage]));
    const stages: StageFigure[] = STAGES.map((stage) => ({
      stage,
      value: values[stage].toFixed(),
      shown: shownFigure(values[stage]),
      share: sharePercent(values[stage], total),
    }));
    let hotspot: StageId = 'materials';
    for (const stage of STAGES) {
      if (values[stage].greaterThan(values[hotspot])) hotspot = stage;
    }
    return {
      measure,
      unit: MEASURE_UNITS[measure],
      total: total.toFixed(),
      totalShown: shownWithUnit(total, MEASURE_UNITS[measure]),
      hotspot,
      stages,
    };
  });
}

/** Try one garment, worked out with no library call. */
export const ESTIMATE_GARMENTS: Record<string, string> = {
  tshirt: '0.25',
  shirt: '0.30',
  jeans: '0.80',
  coat: '1.20',
};

export const ESTIMATE_FIBRES: Record<string, string> = {
  'organic-cotton': '3.10',
  cotton: '4.15',
  polyester: '3.24',
  wool: '14.6',
};

export const ESTIMATE_COUNTRIES: Record<string, string> = {
  PT: '0.92',
  TR: '1.35',
  VN: '2.10',
  EG: '1.74',
};

export function estimateClimate(garment: string, fibre: string, country: string): Decimal {
  return dec(ESTIMATE_GARMENTS[garment] as string).times(
    dec(ESTIMATE_FIBRES[fibre] as string).plus(dec(ESTIMATE_COUNTRIES[country] as string)),
  );
}
