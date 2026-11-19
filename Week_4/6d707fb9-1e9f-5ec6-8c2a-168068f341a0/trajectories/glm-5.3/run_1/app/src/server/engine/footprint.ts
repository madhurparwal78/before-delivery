import { add, cmp, divRound, mul, sub, sum } from "./decimal.js";
import { MEASURE_FIELD, MEASURE_IDS, MEASURE_UNITS, STAGE_IDS } from "./domain.js";
import type { MeasureId, StageId } from "./domain.js";
import { percentOf, shownFigure, shownTotal } from "./display.js";

/** A kept factor row exactly as the library printed it. */
export interface FactorRow {
  id: string;
  kind: "material" | "grid" | "mode" | "use" | "endOfLife";
  makingMjPerKg?: string;
  climate: string;
  water: string;
  fossil: string;
  land: string;
  toxicity: string;
  microfibres: string;
}

function fieldValue(row: FactorRow, measure: MeasureId): string {
  return (row as unknown as Record<string, string>)[MEASURE_FIELD[measure]];
}

function rowById(rows: FactorRow[], id: string): FactorRow | null {
  return rows.find((r) => r.id === id) ?? null;
}

function massKgOf(grams: string): string {
  return divRound(grams, "1000", 10);
}

function gradeOf(percent: number): string {
  if (percent >= 80) return "A";
  if (percent >= 50) return "B";
  return "C";
}

/** Data quality: share of mass on lines with supplier-given facts, half up to a whole percent. */
export function dataQualityOf(
  lines: readonly { massGrams: string; hasAnsweredFacts: boolean }[],
): { dataQualityPercent: number; dataQualityGrade: string } {
  if (lines.length === 0) return { dataQualityPercent: 0, dataQualityGrade: "C" };
  const totalMass = sum(lines.map((l) => l.massGrams));
  const answeredMass = sum(lines.filter((l) => l.hasAnsweredFacts).map((l) => l.massGrams));
  const percent = Number(divRound(mul(answeredMass, "100"), totalMass, 0));
  return { dataQualityPercent: percent, dataQualityGrade: gradeOf(percent) };
}

export interface LineInput {
  materialId: string;
  massGrams: string;
  tier1Country: string | null;
  answeredEnergyMjPerKg: string | null;
  answeredWaterLitresPerKg: string | null;
  answeredFibreOrigin: string | null;
}

export interface LegInput {
  mode: string;
  km: string;
}

export interface FootprintStyle {
  washes: number;
}

export interface StageFigure {
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

/**
 * The footprint sum in exact decimals: the single place a published sum is worked out.
 * Materials = Σ massKg × material m. Making = Σ massKg × makingMj × the tier 1 country's
 * grid m (supplier-given MJ when answered), with a supplier's water answer replacing only
 * Making's Water. Transport = Σ over legs of (totalMassKg ÷ 1000 × km) × mode m. Use =
 * washes × wash m. End of life = totalMassKg × disposal m. The total is the sum of the five.
 */
export function workOutFootprint(
  rows: FactorRow[],
  lines: LineInput[],
  legs: LegInput[],
  style: FootprintStyle,
): { measures: MeasureFigure[]; dataQualityPercent: number; dataQualityGrade: string } {
  if (lines.length === 0) throw new Error("no lines");
  for (const line of lines) {
    if (!line.tier1Country) throw new Error("no tier 1 country");
  }
  const totalMassKg = massKgOf(sum(lines.map((l) => l.massGrams)));
  const wash = rowById(rows, "wash");
  const disposal = rowById(rows, "disposal");
  if (!wash || !disposal) throw new Error("missing use or endOfLife rows");

  const measures: MeasureFigure[] = MEASURE_IDS.map((measure) => {
    const acc = new Map<StageId, string>(STAGE_IDS.map((s) => [s, "0"]));
    for (const line of lines) {
      const material = rowById(rows, line.materialId);
      const grid = rowById(rows, line.tier1Country!);
      if (!material) throw new Error(`no material row for ${line.materialId}`);
      if (!grid) throw new Error(`no grid row for ${line.tier1Country}`);
      const massKg = massKgOf(line.massGrams);
      acc.set("materials", add(acc.get("materials")!, mul(massKg, fieldValue(material, measure))));
      const makingMj = line.answeredEnergyMjPerKg ?? material.makingMjPerKg ?? "0";
      let makingVal = mul(mul(massKg, makingMj), fieldValue(grid, measure));
      if (measure === "water" && line.answeredWaterLitresPerKg !== null) {
        makingVal = mul(massKg, line.answeredWaterLitresPerKg);
      }
      acc.set("making", add(acc.get("making")!, makingVal));
      acc.set("use", add(acc.get("use")!, mul(String(style.washes), fieldValue(wash, measure))));
      acc.set("endOfLife", add(acc.get("endOfLife")!, mul(totalMassKg, fieldValue(disposal, measure))));
    }
    for (const leg of legs) {
      const mode = rowById(rows, leg.mode);
      if (!mode) throw new Error(`no mode row for ${leg.mode}`);
      const moved = mul(massKgOf(totalMassKg), leg.km);
      acc.set("transport", add(acc.get("transport")!, mul(moved, fieldValue(mode, measure))));
    }
    const total = STAGE_IDS.reduce((out, s) => add(out, acc.get(s)!), "0");
    const stages: StageFigure[] = STAGE_IDS.map((stage) => {
      const value = acc.get(stage)!;
      return { stage, value, shown: shownFigure(value), share: percentOf(value, total) };
    });
    let hotspot: StageId = "materials";
    let best = "-999";
    for (const stage of STAGE_IDS) {
      const share = stages.find((s) => s.stage === stage)!.share;
      if (cmp(share, best) > 0) {
        best = share;
        hotspot = stage;
      }
    }
    return {
      measure,
      unit: MEASURE_UNITS[measure],
      total,
      totalShown: shownTotal(total, MEASURE_UNITS[measure]),
      hotspot,
      stages,
    };
  });
  const quality = dataQualityOf(
    lines.map((l) => ({
      massGrams: l.massGrams,
      hasAnsweredFacts:
        l.answeredEnergyMjPerKg !== null || l.answeredWaterLitresPerKg !== null || l.answeredFibreOrigin !== null,
    })),
  );
  return { measures, ...quality };
}

export interface ScenarioChanges {
  recycled: { lineId: string; percent: number }[];
  materialSwaps: { lineId: string; materialId: string }[];
  factorySwaps: { lineId: string; country: string }[];
  legModes: { legIndex: number; mode: string }[];
}

/**
 * Scenarios use only the rows kept with the result. A recycled share of r multiplies that
 * line's Materials figures by (1 − 0.006 × r). A material swap uses the new material's row
 * and its makingMjPerKg, dropping that line's supplier-given making facts. A factory swap
 * uses the new country's grid row and the material's makingMjPerKg. A mode change uses the
 * new mode's row.
 */
export function workOutScenario(
  rows: FactorRow[],
  baselineLines: (LineInput & { id: string })[],
  legs: (LegInput & { id: string })[],
  style: FootprintStyle,
  changes: ScenarioChanges,
): { measures: MeasureFigure[] } {
  const recycledByLine = new Map(changes.recycled.map((c) => [c.lineId, c.percent]));
  const materialByLine = new Map(changes.materialSwaps.map((c) => [c.lineId, c.materialId]));
  const factoryByLine = new Map(changes.factorySwaps.map((c) => [c.lineId, c.country]));
  const modeByLeg = new Map(changes.legModes.map((c) => [c.legIndex, c.mode]));
  const lines: LineInput[] = baselineLines.map((l) => {
    const materialId = materialByLine.get(l.id) ?? l.materialId;
    const swapped = materialByLine.has(l.id);
    const country = factoryByLine.get(l.id) ?? l.tier1Country;
    const reworked = swapped || factoryByLine.has(l.id);
    return {
      materialId,
      massGrams: l.massGrams,
      tier1Country: country,
      answeredEnergyMjPerKg: reworked ? null : l.answeredEnergyMjPerKg,
      answeredWaterLitresPerKg: reworked ? null : l.answeredWaterLitresPerKg,
      answeredFibreOrigin: swapped ? null : l.answeredFibreOrigin,
    };
  });
  const legsChanged: LegInput[] = legs.map((leg, i) => ({
    mode: modeByLeg.get(i) ?? leg.mode,
    km: leg.km,
  }));
  const base = workOutFootprint(rows, lines, legsChanged, style);
  const measures = base.measures.map((m) => {
    let materialsVal = m.stages.find((s) => s.stage === "materials")!.value;
    for (const line of baselineLines) {
      const r = recycledByLine.get(line.id);
      if (r !== undefined && r > 0) {
        const factor = sub("1", mul("0.006", String(r)));
        const lineMaterial = rowById(rows, materialByLine.get(line.id) ?? line.materialId);
        if (!lineMaterial) throw new Error("scenario row missing");
        const perLine = mul(massKgOf(line.massGrams), fieldValue(lineMaterial, m.measure));
        materialsVal = add(materialsVal, mul(perLine, sub(factor, "1")));
      }
    }
    const stages = m.stages.map((s) =>
      s.stage === "materials"
        ? { ...s, value: materialsVal, shown: shownFigure(materialsVal) }
        : s,
    );
    const total = stages.reduce((acc, s) => add(acc, s.value), "0");
    const withShares = stages.map((s) => ({ ...s, share: percentOf(s.value, total) }));
    let hotspot: StageId = "materials";
    let best = "-999";
    for (const stage of STAGE_IDS) {
      const share = withShares.find((s) => s.stage === stage)!.share;
      if (cmp(share, best) > 0) {
        best = share;
        hotspot = stage;
      }
    }
    return { ...m, total, totalShown: shownTotal(total, m.unit), hotspot, stages: withShares };
  });
  return { measures };
}

/** Try one garment: garment kg × (fibre value + country value), with no library call. */
export function workOutEstimate(
  garmentKg: string,
  fibreValue: string,
  countryValue: string,
): { climate: string; shown: string } {
  const climate = mul(garmentKg, add(fibreValue, countryValue));
  return { climate, shown: shownTotal(climate, MEASURE_UNITS.climate) };
}
