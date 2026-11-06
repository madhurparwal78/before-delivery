// Server-owned data written into the page shell (rule tables stay on the server; the browser only displays).
export interface TaxRate {
  name: string;
  rate_pcm: number;
}

export interface Country {
  code: string;
  name: string;
  package_shipping_cents: number;
  accessory_shipping_cents: number;
  free_accessory_shipping_from_cents: number | null;
  packed_battery_fee_cents: number;
  standalone_battery_fee_cents: number;
  /** null for Canada, where the postal code picks the province's components. */
  taxes: TaxRate[] | null;
  warehouse: "San Juan" | "Madrid";
  transit_business_days: number;
}

interface Boot {
  countries: Country[];
  provinces: { letters: string; name: string; taxes: TaxRate[] }[];
  /** RegExp source, matched ignoring case. */
  canadianPostalPattern: string;
  cartLimits: { buildLine: number; builds: number; accessoryLine: number };
  /** The server's price delta of every component on each board package (board SKU → component SKU → cents). */
  optionDeltas: Record<string, Record<string, number>>;
  /** The lowest-priced package of each board, by board name. */
  lineupFrom: Record<string, string>;
  quiz: { text: string; options: { key: string; label: string }[] }[];
  callback: { zones: string[]; topics: string[] };
  protection: Record<"2" | "3", number>;
  tradeInBrands: string[];
}

export const boot: Boot = JSON.parse(document.getElementById("boot")?.textContent ?? "{}") as Boot;
