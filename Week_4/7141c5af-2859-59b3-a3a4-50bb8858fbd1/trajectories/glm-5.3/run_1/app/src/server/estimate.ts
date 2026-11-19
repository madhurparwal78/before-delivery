import { apiMessages } from "./copy.js";
import {
  ceilDiv, decCmp, decFromInt, decFromMinor, decMul, decParse, decToMinorHalfUp, decToString,
  milestoneSplit, printMinor, quarterMetresUp, type Currency,
} from "./decimal.js";
import { townCurrency, townTaxPercent, type Town } from "./time.js";

export type LotSpec = { lot: string; hides?: number; averageSqFt?: string; metres?: string };
export type RateRow = { takesEffectOn: string; eur: string; gbp: string; usd: string; jpy: string; aed: string };

export type EstimateInput = {
  materialCode: string | null;
  lot: string | null;
  patternAreaSqFt: string | null;
  metres: string | null;
  labourHours: string;
};

export type EstimateResult = {
  currency: Currency;
  materialCode: string | null;
  lot: string | null;
  patternAreaSqFt: string | null;
  hides: number | null;
  metres: string | null;
  labourHours: string;
  labourRateMinor: number;
  materialMinor: number;
  labourMinor: number;
  subtotalMinor: number;
  taxPercent: number;
  taxMinor: number;
  totalMinor: number;
  milestones: { percent: number; amountMinor: number }[];
  display: { material: string; labour: string; labourRate: string; subtotal: string; tax: string; total: string; milestones: string[] };
};



export const validateLabourHours = (raw: string): string | null => {
  const d = decParse(raw);
  if (d === null) return apiMessages.notANumber;
  if (decCmp(d, decFromInt(0)) <= 0) return apiMessages.numberRange;
  const quarter = decMul(d, decFromInt(4));
  if (quarter.v % 10n ** 8n !== 0n) return apiMessages.quarterHours;
  return null;
};

/** Decide hides from pattern area, waste and the lot's average: pattern area × 1.15 / average, rounded up. */
export function hidesFor(patternArea: string, averageSqFt: string): number {
  const area = decParse(patternArea)!;
  const waste = decMul(area, decParse("1.15")!);
  return Number(ceilDiv(waste, decParse(averageSqFt)!).v / 10n ** 8n);
}

export function computeEstimate(
  input: EstimateInput,
  town: Town,
  rate: RateRow,
  material: { name: string; unit: string; prices: Record<string, string> } | null,
  lots: LotSpec[]
): EstimateResult | { error: string } {
  const currency = townCurrency[town];
  const taxPercent = townTaxPercent[town];
  const hours = decParse(input.labourHours);
  if (hours === null) return { error: apiMessages.notANumber };
  const quarter = decMul(hours, decFromInt(4));
  if (quarter.v % 10n ** 8n !== 0n) return { error: apiMessages.quarterHours };

  const rateValue = decParse(rate[currency.toLowerCase() as "eur"] ?? "0")!;
  const priceKey = currency.toLowerCase() as "eur" | "gbp" | "usd" | "jpy" | "aed";
  const labourLine = decMul(hours, rateValue);

  let materialLine = decParse("0")!;
  let materialCode: string | null = null;
  let lot: string | null = null;
  let patternArea: string | null = null;
  let hides: number | null = null;
  let metres: string | null = null;

  if (input.materialCode === null || input.materialCode === undefined || input.materialCode === "") {
    if (input.patternAreaSqFt || input.metres) return { error: apiMessages.notANumber };
  } else if (!material) {
    return { error: apiMessages.notANumber };
  } else {
    materialCode = input.materialCode;
    lot = input.lot ?? null;
    if (!lot) return { error: apiMessages.fieldRequired };
    const chosen = lots.find((l) => l.lot === lot);
    if (!chosen) return { error: apiMessages.notANumber };
    if (material.unit === "sqFt") {
      if (!chosen.averageSqFt) return { error: apiMessages.notANumber };
      if (input.patternAreaSqFt === null || input.patternAreaSqFt === undefined || input.patternAreaSqFt === "") return { error: apiMessages.fieldRequired };
      const area = decParse(input.patternAreaSqFt);
      if (area === null) return { error: apiMessages.notANumber };
      if (decCmp(area, decFromInt(0)) <= 0) return { error: apiMessages.numberRange };
      patternArea = input.patternAreaSqFt;
      hides = hidesFor(input.patternAreaSqFt, chosen.averageSqFt);
      const largestLeather = Math.max(...lots.map((l) => l.hides ?? 0));
      if (hides > largestLeather) {
        return { error: apiMessages.lotTooSmallLeather.replace("<n>", String(hides)).replace("<name>", material?.name ?? "").replace("<m>", String(largestLeather)) };
      }
      if (hides > (chosen.hides ?? 0)) {
        return { error: apiMessages.chosenLotTooSmall.replace("<lot>", chosen.lot).replace("<m>", `${chosen.hides ?? 0} hide${chosen.hides === 1 ? "" : "s"}`) };
      }
      const sqftTotal = decMul(decFromInt(hides), decParse(chosen.averageSqFt)!);
      const price = decParse(material.prices[priceKey]!)!;
      materialLine = decMul(sqftTotal, price);
    } else {
      if (input.metres === null || input.metres === undefined || input.metres === "") return { error: apiMessages.fieldRequired };
      const m = decParse(input.metres);
      if (m === null) return { error: apiMessages.notANumber };
      if (decCmp(m, decFromInt(0)) <= 0) return { error: apiMessages.numberRange };
      const q = quarterMetresUp(m);
      metres = decToString(q, 2);
      const largestFabric = lots.reduce((acc, l) => (l.metres !== undefined && decCmp(decParse(l.metres)!, acc) > 0 ? decParse(l.metres)! : acc), decParse("0")!);
      if (chosen.metres === undefined || decCmp(q, largestFabric) > 0) {
        return { error: apiMessages.lotTooSmallFabric.replace("<n>", decToString(q, 2)).replace("<name>", material?.name ?? "").replace("<m>", decToString(largestFabric, 2)) };
      }
      if (decCmp(q, decParse(chosen.metres)!) > 0) {
        return { error: apiMessages.chosenLotTooSmall.replace("<lot>", chosen.lot).replace("<m>", `${chosen.metres} m`) };
      }
      const price = decParse(material.prices[priceKey]!)!;
      materialLine = decMul(q, price);
    }
  }

  const materialMinor = decToMinorHalfUp(materialLine, currency);
  const labourMinor = decToMinorHalfUp(labourLine, currency);
  const subtotalMinor = materialMinor + labourMinor;
  const taxExact = decMul(decFromMinor(subtotalMinor, currency), decParse((taxPercent / 100).toFixed(2))!);
  const taxMinor = decToMinorHalfUp(taxExact, currency);
  const totalMinor = subtotalMinor + taxMinor;
  const milestones = milestoneSplit(totalMinor, currency);
  const print = (m: number) => printMinor(m, currency);
  return {
    currency, materialCode, lot, patternAreaSqFt: patternArea, hides, metres,
    labourHours: input.labourHours, labourRateMinor: decToMinorHalfUp(rateValue, currency),
    materialMinor, labourMinor, subtotalMinor, taxPercent, taxMinor, totalMinor, milestones,
    display: {
      material: print(materialMinor),
      labour: print(labourMinor),
      labourRate: print(decToMinorHalfUp(rateValue, currency)),
      subtotal: print(subtotalMinor),
      tax: print(taxMinor),
      total: print(totalMinor),
      milestones: milestones.map((m) => print(m.amountMinor)),
    },
  };
}
