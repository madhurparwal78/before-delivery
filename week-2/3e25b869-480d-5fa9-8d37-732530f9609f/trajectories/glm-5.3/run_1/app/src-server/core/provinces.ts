// Canadian provinces and their tax sets. Single source of truth for the province table.
import { RATES, type TaxSpec } from "./money.js";

export type ProvinceCode =
  | "AB" | "BC" | "MB" | "NB" | "NL" | "NS" | "NT" | "NU" | "ON" | "PE" | "QC" | "SK" | "YT";

export interface ProvinceInfo {
  code: ProvinceCode;
  en: string;
  fr: string;
  taxes: readonly TaxSpec[];
}

const GST: TaxSpec = { code: "GST", rateHundredThousandths: RATES.GST, rateLabel: "5%" };
const QST: TaxSpec = { code: "QST", rateHundredThousandths: RATES.QST, rateLabel: "9.975%" };
const HST13: TaxSpec = { code: "HST", rateHundredThousandths: RATES.HST13, rateLabel: "13%" };
const HST14: TaxSpec = { code: "HST", rateHundredThousandths: RATES.HST14, rateLabel: "14%" };
const HST15: TaxSpec = { code: "HST", rateHundredThousandths: RATES.HST15, rateLabel: "15%" };

export const PROVINCES: readonly ProvinceInfo[] = [
  { code: "AB", en: "Alberta", fr: "Alberta", taxes: [GST] },
  { code: "BC", en: "British Columbia", fr: "Colombie-Britannique", taxes: [GST] },
  { code: "MB", en: "Manitoba", fr: "Manitoba", taxes: [GST] },
  { code: "NB", en: "New Brunswick", fr: "Nouveau-Brunswick", taxes: [HST15] },
  { code: "NL", en: "Newfoundland and Labrador", fr: "Terre-Neuve-et-Labrador", taxes: [HST15] },
  { code: "NS", en: "Nova Scotia", fr: "Nouvelle-Écosse", taxes: [HST14] },
  { code: "NT", en: "Northwest Territories", fr: "Territoires du Nord-Ouest", taxes: [GST] },
  { code: "NU", en: "Nunavut", fr: "Nunavut", taxes: [GST] },
  { code: "ON", en: "Ontario", fr: "Ontario", taxes: [HST13] },
  { code: "PE", en: "Prince Edward Island", fr: "Île-du-Prince-Édouard", taxes: [HST15] },
  { code: "QC", en: "Québec", fr: "Québec", taxes: [GST, QST] },
  { code: "SK", en: "Saskatchewan", fr: "Saskatchewan", taxes: [GST] },
  { code: "YT", en: "Yukon", fr: "Yukon", taxes: [GST] }
];

export function findProvince(code: string): ProvinceInfo | undefined {
  return PROVINCES.find((p) => p.code === code);
}

