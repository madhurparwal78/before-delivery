import { q } from "./db.js";
import { decParse } from "./decimal.js";

/** The supplier's catalogue rows as printed in the brief. */
export type SeedMaterial = { code: string; name: string; family: string; unit: string; prices: Record<string, string> };

export const STARTING_MATERIALS: SeedMaterial[] = [
  { code: "VM-2041", name: "Tabacco", family: "Aniline", unit: "sqFt", prices: { eur: "13.70", gbp: "11.90", usd: "14.80", jpy: "1990", aed: "54.40" } },
  { code: "VM-2042", name: "Ruggine", family: "Aniline", unit: "sqFt", prices: { eur: "15.20", gbp: "13.20", usd: "16.40", jpy: "2210", aed: "60.40" } },
  { code: "VM-2043", name: "Inchiostro", family: "Aniline", unit: "sqFt", prices: { eur: "16.85", gbp: "14.60", usd: "18.20", jpy: "2450", aed: "66.90" } },
  { code: "VM-2044", name: "Salvia", family: "Semi-aniline", unit: "sqFt", prices: { eur: "6.10", gbp: "5.30", usd: "6.60", jpy: "885", aed: "24.20" } },
  { code: "VM-2045", name: "Avena", family: "Semi-aniline", unit: "sqFt", prices: { eur: "7.35", gbp: "6.40", usd: "7.95", jpy: "1070", aed: "29.20" } },
  { code: "VM-2046", name: "Prugna", family: "Semi-aniline", unit: "sqFt", prices: { eur: "8.90", gbp: "7.70", usd: "9.60", jpy: "1295", aed: "35.30" } },
  { code: "VM-2047", name: "Cuoio", family: "Pull-up", unit: "sqFt", prices: { eur: "11.25", gbp: "9.75", usd: "12.15", jpy: "1635", aed: "44.65" } },
  { code: "VM-2048", name: "Noce", family: "Pull-up", unit: "sqFt", prices: { eur: "12.40", gbp: "10.75", usd: "13.40", jpy: "1800", aed: "49.25" } },
  { code: "VM-2049", name: "Grafite", family: "Pull-up", unit: "sqFt", prices: { eur: "10.60", gbp: "9.20", usd: "11.45", jpy: "1540", aed: "42.10" } },
  { code: "VM-3051", name: "Loden", family: "Wool", unit: "metre", prices: { eur: "64.00", gbp: "55.50", usd: "69.10", jpy: "9300", aed: "254.00" } },
  { code: "VM-3052", name: "Feltro", family: "Wool", unit: "metre", prices: { eur: "58.50", gbp: "50.75", usd: "63.20", jpy: "8500", aed: "232.20" } },
  { code: "VM-3053", name: "Bouclé", family: "Wool", unit: "metre", prices: { eur: "72.25", gbp: "62.65", usd: "78.00", jpy: "10500", aed: "286.80" } },
];

/** Give a desk the first twelve materials and the starting labour-rate row. */
export async function seedMaterials(deskId: string): Promise<void> {
  let pos = 0;
  for (const m of STARTING_MATERIALS) {
    const id = `mat-${deskId}-${m.code}`;
    await q(
      "INSERT INTO materials (id, desk_id, code, name, family, unit, prices, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (desk_id, code) DO NOTHING",
      [id, deskId, m.code, m.name, m.family, m.unit, JSON.stringify(m.prices), pos++]
    );
  }
}
export async function seedRates(deskId: string): Promise<void> {
  const id = `rate-${deskId}-start`;
  await q(
    "INSERT INTO rates (id, desk_id, takes_effect_on, eur, gbp, usd, jpy, aed) VALUES ($1,$2,'2020-01-01',$3,$4,$5,$6,$7) ON CONFLICT (desk_id, takes_effect_on) DO NOTHING",
    [id, deskId, "85.00", "72.00", "92.00", "13800", "340.00"]
  );
}
export const validatePrices = (p: Record<string, string>) =>
  Object.values(p).every((v) => decParse(v) !== null);
