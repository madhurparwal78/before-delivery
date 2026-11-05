// Billing dates from the anchor (DP-58) and the monthly invoice (DP-10).
import { billingDateFromAnchor } from "../tz.js";
import type { PoolClient } from "pg";
import { itemFor, priceListInForceOn, type PriceListRow } from "./priceLists.js";
import { invoiceTax } from "./payments.js";

export function upcomingBillingDates(anchor: string, fromDate: string, count = 4): string[] {
  // Billing date k is the anchor plus k calendar months, clamped to month end,
  // always computed from the anchor. next_billing_date is the first billing
  // date on or after today.
  const dates: string[] = [];
  let k = 1;
  while (dates.length < count) {
    const d = billingDateFromAnchor(anchor, k);
    if (d >= fromDate) dates.push(d);
    k++;
    if (k > 1200) break;
  }
  return dates;
}

export function nextBillingDate(anchor: string, today: string): string {
  return upcomingBillingDates(anchor, today, 1)[0];
}

export interface InvoiceLine {
  code: "base_rent" | "waiver" | "sales_tax";
  label: string;
  amount_cents: number;
}

export interface MonthlyInvoice {
  contract_id: string;
  price_list_id: string;
  billing_date: string | null;
  upcoming_billing_dates: string[];
  tax_rate_bp: number;
  lines: InvoiceLine[];
  total_cents: number;
}

export async function monthlyInvoice(
  client: PoolClient,
  params: {
    contractId: string;
    boundPriceList: PriceListRow;
    instrumentType: string;
    waiver: boolean;
    status: string;
    anchor: string | null;
    today: string;
  }
): Promise<MonthlyInvoice> {
  const item = itemFor(params.boundPriceList, params.instrumentType as never);
  let billingDate: string | null = null;
  let upcoming: string[] = [];
  let taxRate: number;
  if (params.status === "active" && params.anchor) {
    billingDate = nextBillingDate(params.anchor, params.today);
    upcoming = upcomingBillingDates(params.anchor, billingDate, 4);
    // Sales tax uses the tax rate in force on the billing date, which may be a
    // scheduled version.
    const onBillingDate = await priceListInForceOn(client, billingDate);
    taxRate = onBillingDate ? onBillingDate.tax_rate_bp : params.boundPriceList.tax_rate_bp;
  } else {
    taxRate = params.boundPriceList.tax_rate_bp;
    const inForceToday = await priceListInForceOn(client, params.today);
    taxRate = inForceToday ? inForceToday.tax_rate_bp : params.boundPriceList.tax_rate_bp;
  }
  const lines: InvoiceLine[] = [
    { code: "base_rent", label: "Monthly rent", amount_cents: item.base_rent_cents },
  ];
  if (params.waiver) {
    lines.push({ code: "waiver", label: "Maintenance and damage waiver", amount_cents: item.waiver_cents });
  }
  const tax = invoiceTax(item.base_rent_cents, params.waiver ? item.waiver_cents : 0, taxRate);
  lines.push({ code: "sales_tax", label: "Sales tax", amount_cents: tax });
  const total = lines.reduce((acc, line) => acc + line.amount_cents, 0);
  return {
    contract_id: params.contractId,
    price_list_id: params.boundPriceList.id,
    billing_date: billingDate,
    upcoming_billing_dates: upcoming,
    tax_rate_bp: taxRate,
    lines,
    total_cents: total,
  };
}
