import Decimal from "decimal.js";
import { MEASURES, MEASURE_UNITS, STAGES, type MeasureId, type StageId } from "../shared/catalog";
import type { FactorRow, Measure, ScenarioChanges, ScenarioPreview } from "../shared/api";
import { display, exact, plain, shareOf } from "./figures";

/** One row of the factor library, kept with the result that read it. */
export interface LibraryRow {
  id: string;
  kind: string;
  makingMjPerKg?: string;
  climate: string;
  water: string;
  fossil: string;
  land: string;
  toxicity: string;
  microfibres: string;
}

export interface InputLine {
  id: string;
  materialId: string;
  massGrams: string;
  country: string;
  energyMjPerKg: string | null;
  waterLitresPerKg: string | null;
  answered: boolean;
}

export interface FootprintInputs {
  lines: InputLine[];
  legs: { mode: string; km: string }[];
  washes: number;
}

const ROW_KEY: Record<MeasureId, "climate" | "water" | "fossil" | "land" | "toxicity" | "microfibres"> = {
  climate: "climate",
  water: "water",
  fossilEnergy: "fossil",
  landUse: "land",
  freshwaterToxicity: "toxicity",
  microfibres: "microfibres",
};

function rowOf(rows: LibraryRow[], id: string): LibraryRow {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`no kept row ${id}`);
  return row;
}

function value(row: LibraryRow, measure: MeasureId): Decimal {
  return exact(row[ROW_KEY[measure]]);
}

function kilos(line: InputLine): Decimal {
  return exact(line.massGrams).div(1000);
}

type MaterialFactor = (line: InputLine) => Decimal;

function stageFigures(inputs: FootprintInputs, rows: LibraryRow[], measure: MeasureId, materialFactor: MaterialFactor): Record<StageId, Decimal> {
  const totalKg = inputs.lines.reduce((sum, line) => sum.plus(kilos(line)), exact(0));
  let materials = exact(0);
  let making = exact(0);
  for (const line of inputs.lines) {
    const kg = kilos(line);
    materials = materials.plus(kg.times(value(rowOf(rows, line.materialId), measure)).times(materialFactor(line)));
    if (measure === "water" && line.waterLitresPerKg !== null) {
      making = making.plus(kg.times(line.waterLitresPerKg));
    } else {
      const mj = line.energyMjPerKg ?? (rowOf(rows, line.materialId).makingMjPerKg as string);
      making = making.plus(kg.times(mj).times(value(rowOf(rows, line.country), measure)));
    }
  }
  const transport = inputs.legs.reduce(
    (sum, leg) => sum.plus(totalKg.div(1000).times(leg.km).times(value(rowOf(rows, leg.mode), measure))),
    exact(0),
  );
  return {
    materials,
    making,
    transport,
    use: exact(inputs.washes).times(value(rowOf(rows, "wash"), measure)),
    endOfLife: totalKg.times(value(rowOf(rows, "disposal"), measure)),
  };
}

function measureOf(measure: MeasureId, figures: Record<StageId, Decimal>): Measure {
  const total = STAGES.reduce((sum, stage) => sum.plus(figures[stage]), exact(0));
  const stages = STAGES.map((stage) => ({
    stage,
    value: plain(figures[stage]),
    shown: display(figures[stage]),
    share: shareOf(figures[stage], total),
  }));
  const hottest = stages.reduce((best, stage) => (exact(stage.share).greaterThan(best.share) ? stage : best));
  return {
    measure,
    unit: MEASURE_UNITS[measure],
    total: plain(total),
    totalShown: `${display(total)} ${MEASURE_UNITS[measure]}`,
    hotspot: hottest.stage,
    stages,
  };
}

const NO_RECYCLING: MaterialFactor = () => exact(1);

/** The footprint sum for the six measures, in exact decimals. */
export function workOut(inputs: FootprintInputs, rows: LibraryRow[]): Measure[] {
  return MEASURES.map((measure) => measureOf(measure, stageFigures(inputs, rows, measure, NO_RECYCLING)));
}

/** Data quality: the share of mass on lines with supplier-given facts. */
export function dataQuality(inputs: FootprintInputs): { percent: number; grade: string } {
  const total = inputs.lines.reduce((sum, line) => sum.plus(line.massGrams), exact(0));
  const given = inputs.lines.filter((line) => line.answered).reduce((sum, line) => sum.plus(line.massGrams), exact(0));
  const percent = total.isZero() ? 0 : given.div(total).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return { percent, grade: percent >= 80 ? "A" : percent >= 50 ? "B" : "C" };
}

/** The difference line: a true minus or explicit plus, then a whole percent of the baseline. */
function differenceShown(before: Decimal, after: Decimal, unit: string): string {
  const change = after.minus(before);
  if (change.isZero()) return "no change";
  const sign = change.isNegative() ? "−" : "+";
  const size = change.abs();
  const figure = `${sign}${display(size)} ${unit}`;
  if (before.isZero()) return figure;
  const percent = size.div(before.abs()).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed();
  return `${figure} (${sign}${percent}%)`;
}

/** A scenario: only the rows kept with the result, never touching it. */
export function scenarioOn(baseline: Measure[], inputs: FootprintInputs, rows: LibraryRow[], changes: ScenarioChanges): ScenarioPreview {
  const lines = inputs.lines.map((line) => {
    const swapped = changes.materialSwaps.find((swap) => swap.lineId === line.id);
    const moved = changes.factorySwaps.find((swap) => swap.lineId === line.id);
    return {
      ...line,
      materialId: swapped?.materialId ?? line.materialId,
      country: moved?.country ?? line.country,
      energyMjPerKg: swapped || moved ? null : line.energyMjPerKg,
      waterLitresPerKg: swapped || moved ? null : line.waterLitresPerKg,
    };
  });
  const legs = inputs.legs.map((leg, index) => ({
    ...leg,
    mode: changes.legModes.find((change) => change.legIndex === index)?.mode ?? leg.mode,
  }));
  const recycled: MaterialFactor = (line) => {
    const share = changes.recycled.find((change) => change.lineId === line.id);
    return share ? exact(1).minus(exact("0.006").times(share.percent)) : exact(1);
  };
  const measures = MEASURES.map((measure) => measureOf(measure, stageFigures({ ...inputs, lines, legs }, rows, measure, recycled)));
  const differences = measures.map((entry) => {
    const before = baseline.find((candidate) => candidate.measure === entry.measure) as Measure;
    return { measure: entry.measure, shown: differenceShown(exact(before.total), exact(entry.total), entry.unit) };
  });
  return { measures, differences };
}

const PER: Record<string, string> = { material: "per kg", endOfLife: "per kg", grid: "per MJ", mode: "per tonne-km", use: "per wash" };

/** The kept rows one stage of one measure used. */
export function factorsOf(inputs: FootprintInputs, rows: LibraryRow[], measure: MeasureId, stage: StageId): FactorRow[] {
  let ids: string[];
  switch (stage) {
    case "materials":
      ids = inputs.lines.map((line) => line.materialId);
      break;
    case "making":
      ids = inputs.lines.filter((line) => !(measure === "water" && line.waterLitresPerKg !== null)).map((line) => line.country);
      break;
    case "transport":
      ids = inputs.legs.map((leg) => leg.mode);
      break;
    case "use":
      ids = ["wash"];
      break;
    case "endOfLife":
      ids = ["disposal"];
      break;
  }
  return [...new Set(ids)].map((id) => {
    const row = rowOf(rows, id);
    return { id, kind: row.kind, value: row[ROW_KEY[measure]], unit: `${MEASURE_UNITS[measure]} ${PER[row.kind]}` };
  });
}

/** Edition 2027.1's table, kept with the seed's results: the app holds it nowhere else. */
export const SEED_ROWS_2027_1: LibraryRow[] = (
  [
    ["organic-cotton", "material", "14.8", "4.02", "2840", "36.5", "0.0412", "318", "52"],
    ["cotton", "material", "14.8", "5.91", "6120", "48.2", "0.0386", "742", "52"],
    ["recycled-cotton", "material", "11.2", "1.87", "410", "21.4", "0.0041", "96", "61"],
    ["linen", "material", "13.5", "2.64", "1180", "29.7", "0.0295", "204", "38"],
    ["wool", "material", "17.6", "18.4", "3120", "44.9", "0.214", "512", "44"],
    ["recycled-wool", "material", "12.3", "3.12", "640", "24.1", "0.0063", "118", "47"],
    ["polyester", "material", "21.4", "3.24", "58", "71.6", "0.0009", "86", "410"],
    ["recycled-polyester", "material", "19.8", "1.95", "41", "39.3", "0.0005", "64", "430"],
    ["viscose", "material", "24.3", "4.77", "1420", "58.8", "0.0172", "377", "29"],
    ["lyocell", "material", "19.1", "2.83", "890", "41.2", "0.0154", "142", "24"],
    ["nylon", "material", "26.7", "7.31", "96", "96.4", "0.0011", "131", "385"],
    ["elastane", "material", "31.2", "12.6", "210", "142", "0.0018", "268", "96"],
    ["PT", "grid", null, "0.0412", "0.118", "0.74", "0.000041", "0.021", "0"],
    ["TR", "grid", null, "0.124", "0.215", "1.62", "0.000085", "0.043", "0"],
    ["VN", "grid", null, "0.158", "0.264", "1.93", "0.000102", "0.057", "0"],
    ["EG", "grid", null, "0.131", "0.302", "1.81", "0.000076", "0.049", "0"],
    ["IN", "grid", null, "0.196", "0.341", "2.24", "0.000118", "0.072", "0"],
    ["BD", "grid", null, "0.172", "0.288", "2.07", "0.000109", "0.064", "0"],
    ["sea", "mode", null, "0.0107", "0.0042", "0.148", "0.000012", "0.0088", "0"],
    ["road", "mode", null, "0.105", "0.038", "1.48", "0.00021", "0.092", "0"],
    ["rail", "mode", null, "0.0281", "0.0113", "0.392", "0.000064", "0.021", "0"],
    ["air", "mode", null, "0.602", "0.176", "8.41", "0.00097", "0.33", "0"],
    ["wash", "use", null, "0.0213", "14.2", "0.31", "0.000012", "0.0064", "3.8"],
    ["disposal", "endOfLife", null, "0.0512", "0.84", "0.19", "0.000034", "1.27", "1.6"],
  ] as const
).map(([id, kind, making, climate, water, fossil, land, toxicity, microfibres]) => ({
  id,
  kind,
  ...(making ? { makingMjPerKg: making } : {}),
  climate,
  water,
  fossil,
  land,
  toxicity,
  microfibres,
}));

export const SEED_ROWS_2026_2: LibraryRow[] = SEED_ROWS_2027_1.map((row) =>
  row.id === "organic-cotton" ? { ...row, climate: "3.96" } : row.id === "TR" ? { ...row, climate: "0.131" } : row,
);
