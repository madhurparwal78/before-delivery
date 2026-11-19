import type { PriceKey } from "./money.ts";

export interface MaterialRow {
  code: string;
  name: string;
  family: string;
  unit: "sqFt" | "metre";
  prices: Record<PriceKey, string>;
}

function row(code: string, name: string, family: string, unit: MaterialRow["unit"], eur: string, gbp: string, usd: string, jpy: string, aed: string): MaterialRow {
  return { code, name, family, unit, prices: { eur, gbp, usd, jpy, aed } };
}

/** The first twelve rows of the supplier's table: what every desk starts with. */
export const STARTING_MATERIALS: readonly MaterialRow[] = [
  row("VM-2041", "Tabacco", "Aniline", "sqFt", "13.70", "11.90", "14.80", "1990", "54.40"),
  row("VM-2042", "Ruggine", "Aniline", "sqFt", "15.20", "13.20", "16.40", "2210", "60.40"),
  row("VM-2043", "Inchiostro", "Aniline", "sqFt", "16.85", "14.60", "18.20", "2450", "66.90"),
  row("VM-2044", "Salvia", "Semi-aniline", "sqFt", "6.10", "5.30", "6.60", "885", "24.20"),
  row("VM-2045", "Avena", "Semi-aniline", "sqFt", "7.35", "6.40", "7.95", "1070", "29.20"),
  row("VM-2046", "Prugna", "Semi-aniline", "sqFt", "8.90", "7.70", "9.60", "1295", "35.30"),
  row("VM-2047", "Cuoio", "Pull-up", "sqFt", "11.25", "9.75", "12.15", "1635", "44.65"),
  row("VM-2048", "Noce", "Pull-up", "sqFt", "12.40", "10.75", "13.40", "1800", "49.25"),
  row("VM-2049", "Grafite", "Pull-up", "sqFt", "10.60", "9.20", "11.45", "1540", "42.10"),
  row("VM-3051", "Loden", "Wool", "metre", "64.00", "55.50", "69.10", "9300", "254.00"),
  row("VM-3052", "Feltro", "Wool", "metre", "58.50", "50.75", "63.20", "8500", "232.20"),
  row("VM-3053", "Bouclé", "Wool", "metre", "72.25", "62.65", "78.00", "10500", "286.80"),
];

/** The starting labour-rate row of every desk. */
export const STARTING_RATE = { takesEffectOn: "2020-01-01", eur: "85.00", gbp: "72.00", usd: "92.00", jpy: "13800", aed: "340.00" } as const;
