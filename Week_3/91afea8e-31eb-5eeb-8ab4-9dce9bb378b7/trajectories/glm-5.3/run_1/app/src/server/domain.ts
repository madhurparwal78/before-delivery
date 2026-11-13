import { divRound, pct, roundHalfUp, taxSplit, allocate } from "./money.js";
import { addDays, istDateString } from "./time.js";

export interface PincodeRow {
  pincode: string; city: string | null; state: string | null;
  serviceable: boolean; cod_available: boolean; remote: boolean;
}

export interface SellerRow {
  seller_id: string; name: string; pickup_city: string; pickup_state: string;
  dispatch_days: number; rating: number; cod_allowed: boolean;
  ship_states: string[]; ship_all_states: boolean;
}

export interface ListingRow {
  listing_id: string; product_id: string; seller_id: string;
  price_paise: number; cost_price_paise: number; stock: number;
  status: string; cod_allowed: boolean; no_cost_emi: boolean;
  deal_price_paise: number | null; deal_ends_at: string | null;
}

export interface ProductRow {
  product_id: string; title: string; brand: string; category: string;
  rating: number; description: string; specs: Record<string, unknown>;
}

export const FREE_DELIVERY_THRESHOLD_Paise = 49900;
export const STANDARD_FEE_Paise = 4000;
export const ONE_DAY_FEE_Paise = 9900;
export const GIFT_WRAP_Paise = 3000;
export const COD_FEE_Paise = 2500;
export const EMI_MIN_Paise = 300000;
export const EMI_MONTHLY_RATE = 0.0125;

/** The price that applies now: deal price while the server clock is strictly before ends_at. */
export function unitPricePaise(listing: { price_paise: number; deal_price_paise: number | null; deal_ends_at: string | null }, now: Date): number {
  if (listing.deal_price_paise !== null && listing.deal_ends_at !== null) {
    if (now.getTime() < new Date(listing.deal_ends_at).getTime()) return listing.deal_price_paise;
  }
  return listing.price_paise;
}

/** Does this seller deliver to this pincode? */
export function deliversTo(seller: SellerRow, pin: PincodeRow | null): boolean {
  if (!pin || !pin.serviceable) return false;
  if (seller.ship_all_states) return true;
  return seller.ship_states.includes(pin.state!);
}

export function isOneDayLane(seller: SellerRow, pin: PincodeRow | null): boolean {
  return !!pin && pin.serviceable && pin.city === seller.pickup_city;
}

/** Standard promise: today (IST) + dispatch days + lane days (+2 remote). */
export function promiseDate(seller: SellerRow, pin: PincodeRow | null, oneDay: boolean): string {
  const today = istDateString();
  if (oneDay) return addDays(today, 1);
  let laneDays = 4;
  if (pin && pin.serviceable) {
    if (pin.city === seller.pickup_city) laneDays = 1;
    else if (pin.state === seller.pickup_state) laneDays = 2;
  }
  if (pin?.remote) laneDays += 2;
  return addDays(today, seller.dispatch_days + laneDays);
}

export function standardFeePaise(subtotalPaise: number): number {
  return subtotalPaise >= FREE_DELIVERY_THRESHOLD_Paise ? 0 : STANDARD_FEE_Paise;
}

export function deliveryFeePaise(subtotalPaise: number, speed: string, oneDayAvailable: boolean): number {
  if (speed === "one_day" && oneDayAvailable) return ONE_DAY_FEE_Paise;
  return standardFeePaise(subtotalPaise);
}

/** One coupon per cart; discount on the selected subtotal. */
export function couponDiscountPaise(coupon: { kind: string; value: number; min_subtotal_paise: number; max_discount_paise: number | null; expires_at: string | null; active: boolean } | null, subtotalPaise: number, now: Date): number {
  if (!coupon || !coupon.active) return 0;
  if (coupon.expires_at !== null && now.getTime() >= new Date(coupon.expires_at).getTime()) return 0;
  if (subtotalPaise < coupon.min_subtotal_paise) return 0;
  if (coupon.kind === "flat") return Math.min(coupon.value, subtotalPaise);
  const discount = Math.floor((subtotalPaise * coupon.value) / 100);
  return Math.min(discount, coupon.max_discount_paise ?? Number.MAX_SAFE_INTEGER);
}

/** Card EMI instalment: P r (1+r)^n / ((1+r)^n - 1), rounded half-up. */
export function emiPlan(principalPaise: number, tenureMonths: number): { instalmentPaise: number; totalInterestPaise: number; totalPayablePaise: number } {
  const r = EMI_MONTHLY_RATE;
  const factor = Math.pow(1 + r, tenureMonths);
  const instalment = roundHalfUp((principalPaise * r * factor) / (factor - 1));
  const totalPayable = instalment * tenureMonths;
  return { instalmentPaise: instalment, totalInterestPaise: totalPayable - principalPaise, totalPayablePaise: totalPayable };
}

/** No-cost tenures give the standard plan's total interest back as an upfront discount. */
export function emiPlans(listingNoCost: boolean, amountPaise: number): Array<{
  tenure_months: number; no_cost: boolean; upfront_discount_paise: number;
  principal_paise: number; instalment_paise: number; total_interest_paise: number; total_payable_paise: number;
}> {
  const plans = [3, 6, 9, 12].map((tenure) => {
    const standard = emiPlan(amountPaise, tenure);
    return {
      tenure_months: tenure, no_cost: false, upfront_discount_paise: 0,
      principal_paise: amountPaise, instalment_paise: standard.instalmentPaise,
      total_interest_paise: standard.totalInterestPaise, total_payable_paise: standard.totalPayablePaise,
    };
  });
  if (listingNoCost) {
    for (const plan of plans) {
      if (plan.tenure_months !== 3 && plan.tenure_months !== 6) continue;
      plan.no_cost = true;
      plan.upfront_discount_paise = plan.total_interest_paise;
      const principal = amountPaise - plan.upfront_discount_paise;
      const recomputed = emiPlan(principal, plan.tenure_months);
      plan.principal_paise = principal;
      plan.instalment_paise = recomputed.instalmentPaise;
      plan.total_interest_paise = recomputed.totalInterestPaise;
      plan.total_payable_paise = recomputed.totalPayablePaise;
    }
  }
  return plans;
}

/** Landed price: price + the parcel's standard delivery fee for a single unit. */
export function landedPaise(pricePaise: number, deliveryFeePaise: number): number {
  return pricePaise + deliveryFeePaise;
}

export function compareOffers(a: { landed_paise: number; promise_date: string | null; seller_rating: number; listing_id: string; in_stock: boolean }, b: { landed_paise: number; promise_date: string | null; seller_rating: number; listing_id: string; in_stock: boolean }): number {
  if (a.in_stock !== b.in_stock) return a.in_stock ? -1 : 1;
  if (a.landed_paise !== b.landed_paise) return a.landed_paise - b.landed_paise;
  const pa = a.promise_date ?? "9999-99-99";
  const pb = b.promise_date ?? "9999-99-99";
  if (pa !== pb) return pa < pb ? -1 : 1;
  if (a.seller_rating !== b.seller_rating) return b.seller_rating - a.seller_rating;
  return a.listing_id < b.listing_id ? -1 : a.listing_id > b.listing_id ? 1 : 0;
}

/** Settlement line arithmetic, each item rounded once. */
export function settlementLine(grossPaise: number, commissionPercent: number, gstRate: number, emiSubventionPaise: number): {
  gross: number; taxable: number; commission: number; commissionGst: number; tcs: number; tds: number; net: number;
} {
  const gross = grossPaise;
  const taxable = divRound((gross * 100), (100 + gstRate));
  const commission = pct(gross, commissionPercent);
  const commissionGst = pct(commission, 18);
  const tcs = pct(taxable, 0.5);
  const tds = pct(gross, 0.1);
  const net = gross - commission - commissionGst - tcs - tds - emiSubventionPaise;
  return { gross, taxable, commission, commissionGst, tcs, tds, net };
}

/** Prorated refund of k of q units; the last units take the exact remainder. */
export function proratedRefund(lineTotalPaise: number, k: number, q: number, alreadyRefundedPaise: number): number {
  const remaining = lineTotalPaise - alreadyRefundedPaise;
  if (k >= q - (alreadyRefundedPaise > 0 ? 1 : 0)) {
    // when this refund covers the last unrefunded units, return the remainder
  }
  if (k === q) return remaining;
  if (alreadyRefundedPaise + divRound((lineTotalPaise * k), q) >= lineTotalPaise) return remaining;
  if (alreadyRefundedPaise === 0 && k === q) return lineTotalPaise;
  const share = divRound((lineTotalPaise * k), q);
  return Math.min(share, remaining);
}

export { taxSplit, allocate, divRound, pct, roundHalfUp };
