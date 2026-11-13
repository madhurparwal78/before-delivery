import { pool, one, query, type Executor } from "../db.js";
import { codEligibility, type CodVerdict } from "../domain/cod.js";
import { couponDiscount, type Coupon } from "../domain/coupon.js";
import { emiPlan, NO_COST_TENURES, type EmiTenure } from "../domain/emi.js";
import {
  COD_CAP_PAISE,
  COD_FEE_PAISE,
  GIFT_WRAP_FEE_PAISE,
  parcelDeliveryFee,
  type DeliverySpeed,
} from "../domain/fees.js";
import { allocate } from "../domain/money.js";
import { oneDayAvailable, promiseDate, sellerDelivers, type Destination } from "../domain/promise.js";
import { splitTax, type TaxSplit } from "../domain/tax.js";
import {
  activeDeal,
  imageUrl,
  loadCategories,
  loadDestination,
  loadSellers,
  sellerLane,
  unitPrice,
  type ListingRow,
  type ProductRow,
  type SellerRow,
} from "./catalogue.js";

export type PaymentMethod = "upi" | "card" | "netbanking" | "emi" | "cod";

export interface PaymentChoice {
  method: PaymentMethod | null;
  useBalance: boolean;
  emiTenureMonths: EmiTenure | null;
}

interface CartRow {
  destination_address_id: string | null;
  destination_pincode: string | null;
  coupon_code: string | null;
  payment_method: PaymentMethod | null;
  use_balance: boolean;
  emi_tenure_months: EmiTenure | null;
}

interface LineRow {
  id: string;
  quantity: number;
  selected: boolean;
  gift_wrap: boolean;
  gift_message: string;
  saved: boolean;
  listing: ListingRow;
  product: ProductRow;
}

export interface QuoteLine {
  lineId: string;
  listing: ListingRow;
  product: ProductRow;
  seller: SellerRow;
  quantity: number;
  unitPricePaise: number;
  selected: boolean;
  giftWrap: boolean;
  giftMessage: string;
  subtotalPaise: number;
  couponSharePaise: number;
  lineTotalPaise: number;
  gstRate: number;
  commissionPercent: number;
  category: string;
  tax: TaxSplit;
  emiSharePaise: number;
  inStock: boolean;
}

export interface QuoteParcel {
  seller: SellerRow;
  lines: QuoteLine[];
  speed: DeliverySpeed;
  oneDayAvailable: boolean;
  serviceable: boolean | null;
  promiseDate: string | null;
  deliveryFeePaise: number;
  codFeePaise: number;
}

export interface Quote {
  lines: QuoteLine[];
  saved: LineRow[];
  parcels: QuoteParcel[];
  destination: { addressId: string | null; pincode: string | null; city: string | null; state: string | null; resolved: Destination | null };
  coupon: { code: string; discountPaise: number } | null;
  payment: PaymentChoice;
  subtotalPaise: number;
  discountPaise: number;
  giftWrapPaise: number;
  deliveryPaise: number;
  codFeePaise: number;
  emiDiscountPaise: number;
  payablePaise: number;
  balanceAppliedPaise: number;
  duePaise: number;
  cod: CodVerdict & { eligible: boolean; cashPaise: number };
  nowMs: number;
}

export async function ensureCart(accountId: string, executor: Executor = pool): Promise<CartRow> {
  await query("INSERT INTO carts (account_id) VALUES ($1) ON CONFLICT DO NOTHING", [accountId], executor);
  return (await one<CartRow & Record<string, unknown>>("SELECT * FROM carts WHERE account_id = $1", [accountId], executor)) as CartRow;
}

export async function loadCoupon(code: string): Promise<Coupon | null> {
  const row = await one<{ code: string; kind: "percent" | "flat"; value: number; cap_paise: number | null; min_subtotal_paise: number; expired: boolean }>(
    "SELECT * FROM coupons WHERE code = $1",
    [code.toUpperCase()],
  );
  return row ? { code: row.code, kind: row.kind, value: row.value, capPaise: row.cap_paise, minSubtotalPaise: row.min_subtotal_paise, expired: row.expired } : null;
}

async function resolveDestination(accountId: string, cart: CartRow, addressId: string | null) {
  const wanted = addressId ?? cart.destination_address_id;
  if (wanted) {
    const address = await one<{ id: string; pincode: string; city: string; state: string }>(
      "SELECT id, pincode, city, state FROM addresses WHERE id = $1 AND account_id = $2",
      [wanted, accountId],
    );
    if (address) {
      const known = await loadDestination(address.pincode);
      return { addressId: address.id, resolved: { ...known, city: known.city || address.city, state: known.state || address.state } };
    }
  }
  if (cart.destination_pincode) return { addressId: null, resolved: await loadDestination(cart.destination_pincode) };
  return { addressId: null, resolved: null };
}

async function openCodOrders(accountId: string): Promise<number> {
  const row = await one<{ open: number }>(
    `SELECT count(*)::int AS open FROM orders o JOIN payments p ON p.id = o.payment_id
      WHERE o.account_id = $1 AND p.method = 'cod'
        AND EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.state IN ('placed', 'packed', 'shipped'))`,
    [accountId],
  );
  return row?.open ?? 0;
}

interface QuoteOverrides {
  addressId?: string | null;
  payment?: PaymentChoice;
}

/** The server's quote: every rupee, unit, pincode and delivery date is decided here. */
export async function buildQuote(accountId: string, nowMs: number, overrides: QuoteOverrides = {}): Promise<Quote> {
  const cart = await ensureCart(accountId);
  const rows = await query<LineRow & Record<string, unknown>>(
    `SELECT cl.id, cl.quantity, cl.selected, cl.gift_wrap, cl.gift_message, cl.saved, to_jsonb(l) AS listing, to_jsonb(p) AS product
       FROM cart_lines cl JOIN listings l ON l.id = cl.listing_id JOIN products p ON p.id = l.product_id
      WHERE cl.account_id = $1 ORDER BY cl.seq`,
    [accountId],
  );
  const sellers = await loadSellers();
  const categories = await loadCategories();
  const speeds = new Map(
    (await query<{ seller_id: string; speed: DeliverySpeed }>("SELECT seller_id, speed FROM cart_speeds WHERE account_id = $1", [accountId])).map((row) => [row.seller_id, row.speed]),
  );
  const balanceRow = await one<{ balance_paise: number }>("SELECT balance_paise FROM accounts WHERE id = $1", [accountId]);
  const destination = await resolveDestination(accountId, cart, overrides.addressId ?? null);
  const payment: PaymentChoice = overrides.payment ?? { method: cart.payment_method, useBalance: cart.use_balance, emiTenureMonths: cart.emi_tenure_months };
  const inCart = rows.filter((row) => !row.saved);
  const selectedRows = inCart.filter((row) => row.selected);
  const subtotalOf = (row: LineRow): number => unitPrice(row.listing, nowMs) * row.quantity;
  const selectedSubtotal = selectedRows.reduce((sum, row) => sum + subtotalOf(row), 0);
  const coupon = cart.coupon_code ? await loadCoupon(cart.coupon_code) : null;
  const discount = coupon ? couponDiscount(coupon, selectedSubtotal) : null;
  const shares = allocate(discount ?? 0, selectedRows.map(subtotalOf));
  const shareOf = new Map(selectedRows.map((row, index) => [row.id, shares[index] ?? 0]));

  const lines: QuoteLine[] = inCart.map((row) => {
    const seller = sellers.get(row.listing.seller_id) as SellerRow;
    const category = categories.get(row.product.category);
    const subtotal = subtotalOf(row);
    const share = shareOf.get(row.id) ?? 0;
    const lineTotal = subtotal - share;
    const gstRate = category?.gst_rate ?? 0;
    return {
      lineId: row.id,
      listing: row.listing,
      product: row.product,
      seller,
      quantity: row.quantity,
      unitPricePaise: unitPrice(row.listing, nowMs),
      selected: row.selected,
      giftWrap: row.gift_wrap,
      giftMessage: row.gift_message,
      subtotalPaise: subtotal,
      couponSharePaise: share,
      lineTotalPaise: lineTotal,
      gstRate,
      commissionPercent: category?.commission_percent ?? 0,
      category: row.product.category,
      tax: splitTax(lineTotal, gstRate, destination.resolved !== null && destination.resolved.state === seller.pickup_state),
      emiSharePaise: 0,
      inStock: row.listing.status === "live" && row.listing.stock >= row.quantity,
    };
  });

  const selected = lines.filter((line) => line.selected);
  const sellerOrder = [...new Set(selected.map((line) => line.seller.id))];
  const parcels: QuoteParcel[] = sellerOrder.map((sellerId) => {
    const parcelLines = selected.filter((line) => line.seller.id === sellerId);
    const seller = parcelLines[0]?.seller as SellerRow;
    const lane = sellerLane(seller);
    const dest = destination.resolved;
    const available = dest ? oneDayAvailable(lane, dest) : false;
    const speed: DeliverySpeed = speeds.get(sellerId) === "one_day" && available ? "one_day" : "standard";
    return {
      seller,
      lines: parcelLines,
      speed,
      oneDayAvailable: available,
      serviceable: dest ? sellerDelivers(lane, dest) : null,
      promiseDate: dest ? promiseDate(nowMs, lane, dest, speed) : null,
      deliveryFeePaise: parcelDeliveryFee(parcelLines.reduce((sum, line) => sum + line.subtotalPaise, 0), speed),
      codFeePaise: payment.method === "cod" ? COD_FEE_PAISE : 0,
    };
  });

  const lineTotals = selected.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  const giftWrapPaise = selected.filter((line) => line.giftWrap).length * GIFT_WRAP_FEE_PAISE;
  const deliveryPaise = parcels.reduce((sum, parcel) => sum + parcel.deliveryFeePaise, 0);
  const codFeePaise = parcels.reduce((sum, parcel) => sum + parcel.codFeePaise, 0);
  const beforeEmi = lineTotals + giftWrapPaise + deliveryPaise;
  const noCostAllowed = selected.length > 0 && selected.every((line) => line.listing.no_cost_emi);
  const emiDiscountPaise =
    payment.method === "emi" && payment.emiTenureMonths !== null && noCostAllowed && NO_COST_TENURES.includes(payment.emiTenureMonths)
      ? emiPlan(beforeEmi, payment.emiTenureMonths, true).upfrontDiscountPaise
      : 0;
  const emiShares = allocate(emiDiscountPaise, selected.map((line) => line.lineTotalPaise));
  selected.forEach((line, index) => {
    line.emiSharePaise = emiShares[index] ?? 0;
  });
  const payablePaise = beforeEmi + codFeePaise - emiDiscountPaise;
  const balance = balanceRow?.balance_paise ?? 0;
  const balanceAppliedPaise = payment.useBalance && payment.method !== "emi" ? Math.min(balance, payablePaise) : 0;
  const codBase = beforeEmi + parcels.length * COD_FEE_PAISE;
  const cashPaise = codBase - (payment.useBalance ? Math.min(balance, codBase) : 0);
  const verdict = codEligibility({
    sellers: parcels.map((parcel) => ({
      name: parcel.seller.name,
      allowsCod: parcel.seller.cod && parcel.lines.every((line) => line.listing.cod_allowed),
    })),
    destination: destination.resolved ? { pincode: destination.resolved.pincode, codAvailable: destination.resolved.codAvailable } : null,
    openCodOrders: await openCodOrders(accountId),
    cashPaise,
  });

  const resolved = destination.resolved;
  return {
    lines,
    saved: rows.filter((row) => row.saved),
    parcels,
    destination: {
      addressId: destination.addressId,
      pincode: resolved?.pincode ?? null,
      city: resolved && resolved.city !== "" ? resolved.city : null,
      state: resolved && resolved.state !== "" ? resolved.state : null,
      resolved,
    },
    coupon: coupon && discount !== null ? { code: coupon.code, discountPaise: discount } : null,
    payment,
    subtotalPaise: selectedSubtotal,
    discountPaise: discount ?? 0,
    giftWrapPaise,
    deliveryPaise,
    codFeePaise,
    emiDiscountPaise,
    payablePaise,
    balanceAppliedPaise,
    duePaise: payablePaise - balanceAppliedPaise,
    cod: { ...verdict, eligible: verdict.reason === null, cashPaise },
    nowMs,
  };
}

/** The amount EMI is computed on: the payable before the EMI discount, with no cash on delivery fee. */
export function emiAmount(quote: Quote): number {
  return quote.payablePaise + quote.emiDiscountPaise - quote.codFeePaise;
}

export function quoteJson(quote: Quote): Record<string, unknown> {
  return {
    lines: quote.lines.map((line) => ({
      line_id: line.lineId,
      listing_id: line.listing.id,
      product_id: line.product.id,
      title: line.product.title,
      seller_id: line.seller.id,
      seller_name: line.seller.name,
      image_url: imageUrl(line.product.id, line.product.category),
      quantity: line.quantity,
      unit_price_paise: line.unitPricePaise,
      deal: activeDeal(line.listing, quote.nowMs),
      selected: line.selected,
      gift_wrap: line.giftWrap,
      gift_message: line.giftMessage,
      line_subtotal_paise: line.subtotalPaise,
      coupon_share_paise: line.couponSharePaise,
      line_total_paise: line.lineTotalPaise,
      gst_rate: line.gstRate,
      taxable_value_paise: line.tax.taxableValuePaise,
      cgst_paise: line.tax.cgstPaise,
      sgst_paise: line.tax.sgstPaise,
      igst_paise: line.tax.igstPaise,
      in_stock: line.inStock,
    })),
    saved_for_later: quote.saved.map((row) => ({
      line_id: row.id,
      listing_id: row.listing.id,
      product_id: row.product.id,
      title: row.product.title,
      image_url: imageUrl(row.product.id, row.product.category),
      quantity: row.quantity,
      unit_price_paise: unitPrice(row.listing, quote.nowMs),
      in_stock: row.listing.status === "live" && row.listing.stock >= row.quantity,
    })),
    parcels: quote.parcels.map((parcel) => ({
      seller_id: parcel.seller.id,
      seller_name: parcel.seller.name,
      line_ids: parcel.lines.map((line) => line.lineId),
      speed: parcel.speed,
      one_day_available: parcel.oneDayAvailable,
      serviceable: parcel.serviceable,
      promise_date: parcel.promiseDate,
      delivery_fee_paise: parcel.deliveryFeePaise,
      cod_fee_paise: parcel.codFeePaise,
    })),
    destination: {
      address_id: quote.destination.addressId,
      pincode: quote.destination.pincode,
      city: quote.destination.city,
      state: quote.destination.state,
    },
    coupon: quote.coupon ? { code: quote.coupon.code, discount_paise: quote.coupon.discountPaise } : null,
    payment: { method: quote.payment.method, use_balance: quote.payment.useBalance, emi_tenure_months: quote.payment.emiTenureMonths },
    subtotal_paise: quote.subtotalPaise,
    discount_paise: quote.discountPaise,
    gift_wrap_paise: quote.giftWrapPaise,
    delivery_paise: quote.deliveryPaise,
    cod_fee_paise: quote.codFeePaise,
    emi_discount_paise: quote.emiDiscountPaise,
    payable_paise: quote.payablePaise,
    balance_applied_paise: quote.balanceAppliedPaise,
    due_paise: quote.duePaise,
    cod: { eligible: quote.cod.eligible, reason: quote.cod.reason, message: quote.cod.message, cap_paise: COD_CAP_PAISE, cash_paise: quote.cod.cashPaise },
    server_time: new Date(quote.nowMs).toISOString(),
  };
}
