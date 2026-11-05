// API body builders for contracts and price lists. Unset values are null.
import type { PoolClient } from "pg";
import type { ContractStatus, Tier } from "../shared/domain.js";
import { instrumentLabel } from "../shared/domain.js";
import { toTier, priceListById, priceListInForceOn, type PriceItemRow, type PriceListRow } from "./domain/priceLists.js";
import { historyFor, equityOf as _equityOf } from "./domain/contractState.js";
import { nextBillingDate } from "./domain/billing.js";


export interface ContractTerms {
  price_list_id: string | null;
  bound: boolean;
  base_rent_cents: number;
  waiver_cents: number;
  purchase_price_cents: number;
  tax_rate_bp: number;
  term_months: number;
  tiers: Tier[];
}

// Every surface of a signed contract uses the terms it was signed under,
// while sales tax follows the rate in force today.
export async function termsForContract(
  client: PoolClient,
  contract: Record<string, unknown>,
  today: string
): Promise<ContractTerms> {
  const bound = Boolean(contract.price_list_id);
  const list: PriceListRow | null = bound
    ? await priceListById(client, contract.price_list_id as string)
    : await priceListInForceOn(client, today);
  const inForce = await priceListInForceOn(client, today);
  const item = (list?.items as PriceItemRow[] | undefined)?.find(
    (i) => i.instrument_type === contract.instrument_type
  );
  return {
    price_list_id: list?.id ?? null,
    bound,
    base_rent_cents: item?.base_rent_cents ?? 0,
    waiver_cents: item?.waiver_cents ?? 0,
    purchase_price_cents: item?.purchase_price_cents ?? 0,
    tax_rate_bp: inForce?.tax_rate_bp ?? 0,
    term_months: item ? Math.ceil(item.purchase_price_cents / item.base_rent_cents) : 0,
    tiers: ((list?.tiers as never[] | undefined) ?? []).map((t) => toTier(t as never)),
  };
}

export async function serializeContract(
  client: PoolClient,
  contract: Record<string, unknown>,
  today: string,
  equity: number
): Promise<Record<string, unknown>> {
  const terms = await termsForContract(client, contract, today);
  const status = contract.status as ContractStatus;
  const studentRows = await client.query<Record<string, unknown>>(
    "SELECT id, name, grade FROM students WHERE id = $1",
    [contract.student_id]
  );
  const schoolRows = await client.query<Record<string, unknown>>(
    "SELECT id, name FROM schools WHERE id = $1",
    [contract.school_id]
  );
  const signLinkRows = await client.query<Record<string, unknown>>(
    `SELECT * FROM signing_links WHERE contract_id = $1
      AND status IN ('live','used','revoked','expired')
      ORDER BY created_at DESC LIMIT 1`,
    [contract.id]
  );
  let signingLink: Record<string, unknown> = { status: "none", expires_at: null };
  if (signLinkRows.rows.length > 0) {
    const link = signLinkRows.rows[0];
    signingLink = {
      status: link.status,
      expires_at: ts(link.expires_at),
    };
  }
  const anchor = (contract.billing_anchor_date as string | null) ?? null;
  const nextBilling = status === "active" && anchor ? nextBillingDate(anchor, today) : null;
  const history = await historyFor(client, contract.id as string);
  const baseRent = terms.base_rent_cents || 1;
  const contractMonth = Math.floor(equity / baseRent);
  return {
    id: contract.id,
    status,
    student: studentRows.rows.length
      ? {
          id: studentRows.rows[0].id as string,
          name: studentRows.rows[0].name as string,
          grade: Number(studentRows.rows[0].grade),
        }
      : null,
    school: schoolRows.rows.length
      ? { id: schoolRows.rows[0].id as string, name: schoolRows.rows[0].name as string }
      : null,
    family_id: contract.family_id,
    instrument: {
      serial: contract.serial,
      instrument_type: contract.instrument_type,
      size: contract.size,
      model: contract.model,
      label: instrumentLabel(contract.instrument_type as never, contract.size as never),
    },
    waiver: Boolean(contract.waiver),
    terms,
    equity_cents: equity,
    contract_month: contractMonth,
    delivery_date: contract.delivery_date,
    hold_expires_at: ts(contract.hold_expires_at),
    signing_link: signingLink,
    agreement_stored: Boolean(contract.agreement_stored),
    bill_of_sale_stored: Boolean(contract.bill_of_sale_stored),
    subscription_state: (contract.subscription_state as string | null) ?? null,
    signed_at: ts(contract.signed_at),
    activated_at: ts(contract.activated_at),
    closed_at: ts(contract.closed_at),
    billing_anchor_date: anchor,
    next_billing_date: nextBilling,
    predecessor_id: (contract.predecessor_id as string | null) ?? null,
    successor_id: (contract.successor_id as string | null) ?? null,
    history,
  };
}

export interface PriceListBody {
  id: string;
  effective_date: string;
  created_at: string;
  withdrawn_at: string | null;
  tax_rate_bp: number;
  items: PriceItemRow[];
  tiers: Tier[];
}

export function serializePriceList(list: PriceListRow): PriceListBody {
  return {
    id: list.id,
    effective_date: list.effective_date,
    created_at: list.created_at.toISOString().replace(/\.\d{3}Z$/, "Z"),
    withdrawn_at: list.withdrawn_at ? list.withdrawn_at.toISOString().replace(/\.\d{3}Z$/, "Z") : null,
    tax_rate_bp: list.tax_rate_bp,
    items: list.items,
    tiers: list.tiers.map((t) => toTier(t)),
  };
}

function ts(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(value as string);
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
