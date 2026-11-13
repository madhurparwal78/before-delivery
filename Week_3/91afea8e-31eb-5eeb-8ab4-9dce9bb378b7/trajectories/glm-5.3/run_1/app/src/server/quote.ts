import { one, query } from "./db.js";
import { allocate, taxSplit } from "./money.js";
import { unitPricePaise, deliversTo, isOneDayLane, promiseDate, deliveryFeePaise, couponDiscountPaise, COD_FEE_Paise, GIFT_WRAP_Paise } from "./domain.js";
import type { ListingRow, PincodeRow, SellerRow } from "./domain.js";
import { futureIso, istDateString } from "./time.js";
import { copy } from "./errors.js";

export interface QuoteLine {
  line_id: string; listing_id: string; product_id: string; title: string; seller_id: string;
  quantity: number; unit_price_paise: number; deal: { price_paise: number; ends_at: string } | null;
  selected: boolean; gift_wrap: boolean; gift_message: string;
  line_subtotal_paise: number; coupon_share_paise: number; line_total_paise: number;
  gst_rate: number; taxable_value_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number;
  in_stock: boolean;
}

export interface QuoteParcel {
  seller_id: string; seller_name: string; line_ids: string[]; speed: string;
  one_day_available: boolean; serviceable: boolean; promise_date: string | null;
  delivery_fee_paise: number; cod_fee_paise: number;
}

export interface Quote {
  lines: QuoteLine[];
  saved_for_later: Array<{ line_id: string; listing_id: string; title: string; unit_price_paise: number; in_stock: boolean }>;
  parcels: QuoteParcel[];
  destination: { address_id: string | null; pincode: string; city: string | null; state: string | null };
  coupon: { code: string; discount_paise: number } | null;
  payment: { method: string | null; use_balance: boolean; emi_tenure_months: number | null };
  subtotal_paise: number; discount_paise: number; gift_wrap_paise: number; delivery_paise: number;
  cod_fee_paise: number; emi_discount_paise: number; payable_paise: number;
  balance_applied_paise: number; due_paise: number;
  cod: { eligible: boolean; reason: string | null; message: string | null; cap_paise: number; cash_paise: number };
  server_time: string;
}

export interface CartStateRow {
  line_id: string; listing_id: string; product_id: string; title: string; seller_id: string;
  seller_name: string; quantity: number; selected: boolean; gift_wrap: boolean; gift_message: string;
  saved: boolean; created_seq: number;
  price_paise: number; deal_price_paise: number | null; deal_ends_at: string | null;
  stock: number; status: string; gst_rate: number; cod_allowed: boolean;
  seller_pickup_city: string; seller_pickup_state: string; seller_dispatch_days: number;
  seller_rating: number; seller_ship_states: string[]; seller_ship_all_states: boolean; seller_cod_allowed: boolean;
}

export async function loadCartRows(accountId: string): Promise<CartStateRow[]> {
  return query<CartStateRow>(`
    SELECT cl.line_id, cl.listing_id, p.product_id, p.title, l.seller_id, s.name AS seller_name,
           cl.quantity, cl.selected, cl.gift_wrap, cl.gift_message, cl.saved, cl.created_seq,
           l.price_paise, l.deal_price_paise, l.deal_ends_at, l.stock, l.status,
           c.gst_rate, l.cod_allowed,
           s.pickup_city AS seller_pickup_city, s.pickup_state AS seller_pickup_state,
           s.dispatch_days AS seller_dispatch_days, s.rating AS seller_rating,
           s.ship_states AS seller_ship_states, s.ship_all_states AS seller_ship_all_states,
           s.cod_allowed AS seller_cod_allowed
    FROM cart_lines cl
    JOIN listings l ON l.listing_id = cl.listing_id
    JOIN products p ON p.product_id = l.product_id
    JOIN categories c ON c.slug = p.category
    JOIN sellers s ON s.seller_id = l.seller_id
    WHERE cl.account_id = $1
    ORDER BY cl.created_seq`, [accountId]);
}

export interface CartSettings {
  destination: { address_id: string | null; pincode: string };
  coupon_code: string | null;
  method: string | null;
  use_balance: boolean;
  emi_tenure_months: number | null;
  speeds: Record<string, string>;
}

export async function loadCartSettings(accountId: string): Promise<CartSettings> {
  const row = await one<{ destination: { address_id: string | null; pincode: string }; coupon_code: string | null; method: string | null; use_balance: boolean; emi_tenure_months: number | null; speeds: Record<string, string> }>(
    "SELECT destination, coupon_code, method, use_balance, emi_tenure_months, speeds FROM cart_settings WHERE account_id = $1", [accountId],
  );
  if (!row) {
    return { destination: { address_id: null, pincode: "560034" }, coupon_code: null, method: null, use_balance: false, emi_tenure_months: null, speeds: {} };
  }
  const dest = row.destination;
  return {
    destination: { address_id: dest?.address_id ?? null, pincode: dest?.pincode ?? "560034" },
    coupon_code: row.coupon_code,
    method: row.method,
    use_balance: row.use_balance,
    emi_tenure_months: row.emi_tenure_months,
    speeds: row.speeds ?? {},
  };
}

export async function buildQuote(accountId: string, now: Date): Promise<Quote> {
  const rows = await loadCartRows(accountId);
  const settings = await loadCartSettings(accountId);
  const account = await one<{ balance_paise: string; balance_hold_paise: string }>(
    "SELECT balance_paise, balance_hold_paise FROM shoppers WHERE account_id = $1", [accountId],
  );
  const balance = Number(account?.balance_paise ?? 0) - Number(account?.balance_hold_paise ?? 0);
  const couponRow = settings.coupon_code
    ? await one<{ code: string; kind: string; value: string; min_subtotal_paise: string; max_discount_paise: string | null; expires_at: string | null; active: boolean }>(
        "SELECT * FROM coupons WHERE code = $1", [settings.coupon_code],
      )
    : null;
  const pin = await one<PincodeRow>("SELECT * FROM pincodes WHERE pincode = $1", [settings.destination.pincode]);
  const address = settings.destination.address_id
    ? await one<{ address_id: string }>("SELECT address_id FROM addresses WHERE address_id = $1 AND account_id = $2", [settings.destination.address_id, accountId])
    : null;

  const active = rows.filter((r) => !r.saved);
  const selected = active.filter((r) => r.selected && r.status === "live" && r.stock > 0);

  const lines: QuoteLine[] = [];
  for (const r of active) {
    const price = unitPricePaise(r, now);
    const inStock = r.status === "live" && r.stock >= r.quantity;
    lines.push({
      line_id: r.line_id, listing_id: r.listing_id, product_id: r.product_id, title: r.title,
      seller_id: r.seller_id, quantity: r.quantity, unit_price_paise: price,
      deal: r.deal_price_paise !== null && r.deal_ends_at && now.getTime() < new Date(r.deal_ends_at).getTime()
        ? { price_paise: r.deal_price_paise, ends_at: futureIso(new Date(r.deal_ends_at).getTime()) } : null,
      selected: r.selected, gift_wrap: r.gift_wrap, gift_message: r.gift_message,
      line_subtotal_paise: price * r.quantity, coupon_share_paise: 0, line_total_paise: price * r.quantity,
      gst_rate: r.gst_rate, taxable_value_paise: 0, cgst_paise: 0, sgst_paise: 0, igst_paise: 0,
      in_stock: r.status === "live" && r.stock > 0,
    });
  }

  const selectedLines = lines.filter((l) => l.selected && l.in_stock);
  const subtotal = selectedLines.reduce((a, l) => a + l.line_subtotal_paise, 0);
  const coupon = couponRow
    ? { code: couponRow.code, kind: couponRow.kind, value: Number(couponRow.value), min_subtotal_paise: Number(couponRow.min_subtotal_paise), max_discount_paise: couponRow.max_discount_paise ? Number(couponRow.max_discount_paise) : null, expires_at: couponRow.expires_at, active: couponRow.active }
    : null;
  const discount = couponDiscountPaise(coupon, subtotal, now);
  const shares = allocate(discount, selectedLines.map((l) => l.line_subtotal_paise));
  selectedLines.forEach((l, i) => {
    l.coupon_share_paise = shares[i];
    l.line_total_paise = l.line_subtotal_paise - shares[i];
  });

  // Parcels: one per seller of selected in-stock lines
  const sellerIds = [...new Set(selectedLines.map((l) => l.seller_id))];
  const parcels: QuoteParcel[] = [];
  const sellerRows = await query<SellerRow>("SELECT * FROM sellers");
  const sellerMap = new Map(sellerRows.map((s) => [s.seller_id, s]));
  for (const sid of sellerIds) {
    const seller = sellerMap.get(sid)!;
    const serviceable = deliversTo(seller, pin);
    const oneDay = isOneDayLane(seller, pin);
    const speed = settings.speeds[sid] === "one_day" && oneDay ? "one_day" : "standard";
    const parcelSubtotal = selectedLines.filter((l) => l.seller_id === sid).reduce((a, l) => a + l.line_subtotal_paise, 0);
    const fee = serviceable ? deliveryFeePaise(parcelSubtotal, speed, oneDay) : 0;
    parcels.push({
      seller_id: sid, seller_name: seller.name,
      line_ids: selectedLines.filter((l) => l.seller_id === sid).map((l) => l.line_id),
      speed, one_day_available: oneDay, serviceable,
      promise_date: serviceable ? promiseDate(seller, pin, speed === "one_day") : null,
      delivery_fee_paise: fee, cod_fee_paise: 0,
    });
  }

  const giftWrap = selectedLines.filter((l) => l.gift_wrap).reduce((a, l) => a + GIFT_WRAP_Paise, 0);
  const delivery = parcels.reduce((a, p) => a + p.delivery_fee_paise, 0);

  // Tax per line: intra-state when the seller state equals the delivery state
  for (const l of selectedLines) {
    const seller = sellerMap.get(l.seller_id)!;
    const intraState = pin?.state ? seller.pickup_state === pin.state : false;
    const split = taxSplit(l.line_total_paise, l.gst_rate, intraState);
    l.taxable_value_paise = split.taxableValuePaise;
    l.cgst_paise = split.cgstPaise;
    l.sgst_paise = split.sgstPaise;
    l.igst_paise = split.igstPaise;
  }

  const codFee = settings.method === "cod" ? parcels.length * COD_FEE_Paise : 0;
  parcels.forEach((p) => { p.cod_fee_paise = settings.method === "cod" ? COD_FEE_Paise : 0; });

  let emiDiscount = 0;
  if (settings.method === "emi" && settings.emi_tenure_months) {
    const noCost = [3, 6].includes(settings.emi_tenure_months) && selectedLines.length > 0
      && await allNoCost(selectedLines.map((l) => l.listing_id));
    if (noCost) {
      const { emiPlan } = await import("./domain.js");
      const standard = emiPlan(Math.max(subtotal - discount, 0), settings.emi_tenure_months);
      emiDiscount = standard.totalInterestPaise;
    }
  }

  const payable = Math.max(
    selectedLines.reduce((a, l) => a + l.line_total_paise, 0) + giftWrap + delivery + codFee - emiDiscount,
    0,
  );
  const balanceApplied = settings.use_balance ? Math.min(balance, payable) : 0;
  const due = payable - balanceApplied;

  const cod = codEligibility(accountId, settings, selectedLines, parcels, pin, payable - balanceApplied, rows);

  const savedRows = rows.filter((r) => r.saved);
  return {
    lines,
    saved_for_later: savedRows.map((r) => ({
      line_id: r.line_id, listing_id: r.listing_id, title: r.title,
      unit_price_paise: unitPricePaise(r, now), in_stock: r.status === "live" && r.stock > 0,
    })),
    parcels,
    destination: {
      address_id: address?.address_id ?? null, pincode: settings.destination.pincode,
      city: pin?.city ?? null, state: pin?.state ?? null,
    },
    coupon: discount > 0 ? { code: settings.coupon_code!, discount_paise: discount } : null,
    payment: { method: settings.method, use_balance: settings.use_balance, emi_tenure_months: settings.emi_tenure_months },
    subtotal_paise: subtotal,
    discount_paise: discount,
    gift_wrap_paise: giftWrap,
    delivery_paise: delivery,
    cod_fee_paise: codFee,
    emi_discount_paise: emiDiscount,
    payable_paise: payable,
    balance_applied_paise: balanceApplied,
    due_paise: due,
    cod,
    server_time: futureIso(now.getTime()),
  };
}

async function allNoCost(listingIds: string[]): Promise<boolean> {
  const rows = await query<{ ok: boolean }>(
    "SELECT bool_and(no_cost_emi) AS ok FROM listings WHERE listing_id = ANY($1::text[])", [listingIds],
  );
  return rows[0]?.ok === true;
}

/** COD refusal reasons in the published order. */
export function codEligibility(
  accountId: string,
  settings: CartSettings,
  selectedLines: QuoteLine[],
  parcels: QuoteParcel[],
  pin: PincodeRow | null,
  cashPaise: number,
  rows: CartStateRow[],
): Quote["cod"] {
  void rows;
  const cap = 5000000;
  if (selectedLines.length === 0) {
    return { eligible: false, reason: null, message: null, cap_paise: cap, cash_paise: 0 };
  }
  const codSellers = parcels.filter((p) => !p.serviceable);
  void codSellers;
  for (const p of parcels) {
    if (!p.serviceable) continue;
  }
  const disallowing = new Set<string>();
  for (const line of selectedLines) {
    const row = rows.find((r) => r.line_id === line.line_id);
    if (row && !row.seller_cod_allowed) disallowing.add(row.seller_id);
  }
  if (disallowing.size > 0) {
    const sellerName = parcels.find((p) => disallowing.has(p.seller_id))?.seller_name ?? "";
    return { eligible: false, reason: "cod_seller", message: copy.codSeller(sellerName), cap_paise: cap, cash_paise: cashPaise };
  }
  if (!pin || !pin.cod_available) {
    return { eligible: false, reason: "cod_pincode", message: copy.codPincode(settings.destination.pincode), cap_paise: cap, cash_paise: cashPaise };
  }
  return { eligible: true, reason: null, message: null, cap_paise: cap, cash_paise: cashPaise };
}

export async function countOpenCodOrders(accountId: string): Promise<number> {
  const rows = await query<{ n: string }>(`
    SELECT count(*) AS n FROM orders o
    JOIN payments pm ON pm.order_id = o.order_id
    WHERE o.account_id = $1 AND pm.method = 'cod'
      AND EXISTS (SELECT 1 FROM shipments sh WHERE sh.order_id = o.order_id AND sh.state IN ('placed','packed','shipped'))`,
    [accountId]);
  return Number(rows[0]?.n ?? 0);
}

export const _today = istDateString;
