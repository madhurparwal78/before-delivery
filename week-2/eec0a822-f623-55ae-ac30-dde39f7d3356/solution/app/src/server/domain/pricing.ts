// Charter pricing and the one published rounding (brief: Charter pricing).
import { one, type Db } from "../db";
import { notFound } from "../http";
import { decimalFraction, roundHalfUp } from "../../shared/money";
import type { Base } from "../../shared/zones";
import { seasonOf } from "./weeks";
import { seasonRate, type YachtRow } from "./yachts";

export const CURRENCIES = ["EUR", "GBP", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

const VAT_PCT: Record<Base, number> = { split: 13, lavrio: 12 };
const ALLOWANCE_PCT = 30;

export interface Line {
  kind: "charter_fee" | "provisioning_allowance" | "vat";
  label: string;
  eurMinor: number;
  amountMinor: number;
}

export interface Quote {
  currency: Currency;
  exchangeTableId: string;
  rate: string;
  lines: Line[];
  totalEurMinor: number;
  totalMinor: number;
}

interface ExchangeTableRow {
  id: string;
  effective_date: string;
  gbp: string;
  usd: string;
}

/** The exchange table in force on a Split date. */
export async function tableInForce(db: Db, workspace: string, splitDate: string): Promise<ExchangeTableRow> {
  const table = await one<ExchangeTableRow>(
    db,
    "SELECT * FROM exchange_tables WHERE workspace_slug = $1 AND effective_date <= $2 ORDER BY effective_date DESC LIMIT 1",
    [workspace, splitDate],
  );
  if (!table) throw notFound();
  return table;
}

export function priceCharter(yacht: YachtRow, weekStart: string, currency: Currency, table: ExchangeTableRow): Quote {
  const rate = currency === "EUR" ? "1" : currency === "GBP" ? table.gbp : table.usd;
  const [rateNum, rateDen] = decimalFraction(rate);
  const fee = BigInt(seasonRate(yacht, seasonOf(weekStart)));
  const vat = VAT_PCT[yacht.base];
  const eur: [Line["kind"], string, bigint][] = [
    ["charter_fee", "Charter fee", fee],
    ["provisioning_allowance", `Provisioning allowance (${ALLOWANCE_PCT}%)`, roundHalfUp(fee * BigInt(ALLOWANCE_PCT), 100n)],
    ["vat", `VAT ${vat}% on charter fee`, roundHalfUp(fee * BigInt(vat), 100n)],
  ];
  const lines = eur.map(([kind, label, eurMinor]) => ({
    kind,
    label,
    eurMinor: Number(eurMinor),
    amountMinor: Number(roundHalfUp(eurMinor * rateNum, rateDen)),
  }));
  return {
    currency,
    exchangeTableId: table.id,
    rate,
    lines,
    totalEurMinor: lines.reduce((sum, l) => sum + l.eurMinor, 0),
    totalMinor: lines.reduce((sum, l) => sum + l.amountMinor, 0),
  };
}
