/** The cart quote: one computation that the cart, the checkout and every total come from. */

import { one, query, type Tx } from './db.js';
import { codEligibility } from './domain/cod.js';
import { emiUpfrontDiscount } from './domain/emi.js';
import {
  allocate,
  COD_FEE_PAISE,
  deliveryFee,
  GIFT_WRAP_FEE_PAISE,
  taxSplit,
} from './domain/money.js';
import { deliveryPromise, type PincodeRecord } from './domain/promise.js';
import { accountBalance, activeDeal, effectivePrice, getListings, sellerOf } from './repo.js';
import type { ListingRecord } from './repo.js';
import { getPincode } from './repo.js';
import type { CartLine, CartQuote, DeliverySpeed, PaymentMethod } from '../shared/types.js';

export type CartRow = {
  line_id: string;
  listing_id: string;
  quantity: number;
  selected: boolean;
  gift_wrap: boolean;
  gift_message: string;
  state: 'cart' | 'saved';
  created_seq: number;
};

export type CartStateRow = {
  address_id: string | null;
  pincode: string | null;
  payment_method: PaymentMethod | null;
  use_balance: boolean;
  emi_tenure_months: number | null;
  coupon_code: string | null;
};

export type CouponRow = {
  code: string;
  percent: number | null;
  max_discount_paise: number | null;
  flat_paise: number | null;
  min_subtotal_paise: number;
  expires_at: string | null;
};

export async function cartRows(accountId: string, runner?: Tx): Promise<CartRow[]> {
  const run = runner === undefined ? query : runner.query;
  return run<CartRow>(
    `SELECT line_id, listing_id, quantity, selected, gift_wrap, gift_message, state, created_seq
       FROM cart_lines WHERE account_id = $1 ORDER BY created_seq`,
    [accountId],
  );
}

export async function cartStateRow(accountId: string): Promise<CartStateRow> {
  const row = await one<CartStateRow>(
    `SELECT address_id, pincode, payment_method, use_balance, emi_tenure_months, coupon_code
       FROM cart_state WHERE account_id = $1`,
    [accountId],
  );
  if (row !== null) return row;
  await query(`INSERT INTO cart_state (account_id) VALUES ($1) ON CONFLICT DO NOTHING`, [accountId]);
  return {
    address_id: null,
    pincode: null,
    payment_method: null,
    use_balance: false,
    emi_tenure_months: null,
    coupon_code: null,
  };
}

export async function couponByCode(code: string): Promise<CouponRow | null> {
  return one<CouponRow>(
    `SELECT code, percent, max_discount_paise, flat_paise, min_subtotal_paise, expires_at::text
       FROM coupons WHERE upper(code) = upper($1)`,
    [code],
  );
}

/** The discount a coupon gives on a selected subtotal, or null when it does not apply. */
export function couponDiscount(
  coupon: CouponRow,
  selectedSubtotalPaise: number,
  now: Date,
): number | null {
  if (coupon.expires_at !== null && new Date(coupon.expires_at).getTime() <= now.getTime()) {
    return null;
  }
  if (selectedSubtotalPaise < coupon.min_subtotal_paise) return null;
  if (coupon.flat_paise !== null) {
    return Math.min(coupon.flat_paise, selectedSubtotalPaise);
  }
  if (coupon.percent !== null) {
    const raw = Math.floor((selectedSubtotalPaise * coupon.percent) / 100);
    const capped = coupon.max_discount_paise === null ? raw : Math.min(raw, coupon.max_discount_paise);
    return Math.min(capped, selectedSubtotalPaise);
  }
  return null;
}

async function destinationFor(state: CartStateRow): Promise<PincodeRecord | null> {
  if (state.address_id !== null) {
    const address = await one<{ pincode: string }>(`SELECT pincode FROM addresses WHERE id = $1`, [
      state.address_id,
    ]);
    if (address !== null) return getPincode(address.pincode);
  }
  return getPincode(state.pincode);
}

async function openCodOrders(accountId: string): Promise<number> {
  const row = await one<{ count: number }>(
    `SELECT count(DISTINCT o.id)::int AS count
       FROM orders o
       JOIN payments pay ON pay.order_id = o.id AND pay.method = 'cod'
       JOIN shipments sh ON sh.order_id = o.id
      WHERE o.account_id = $1 AND sh.state IN ('placed','packed','shipped')`,
    [accountId],
  );
  return row === null ? 0 : row.count;
}

export type QuoteContext = {
  rows: CartRow[];
  listings: Map<string, ListingRecord>;
  destination: PincodeRecord | null;
  state: CartStateRow;
  coupon: CouponRow | null;
  speeds: Map<string, DeliverySpeed>;
  balancePaise: number;
  openCodOrders: number;
  now: Date;
};

export async function quoteContext(accountId: string, now = new Date()): Promise<QuoteContext> {
  const rows = await cartRows(accountId);
  const state = await cartStateRow(accountId);
  const listings = new Map<string, ListingRecord>();
  for (const listing of await getListings(rows.map((row) => row.listing_id))) {
    listings.set(listing.listing_id, listing);
  }
  const speedRows = await query<{ seller_id: string; speed: DeliverySpeed }>(
    `SELECT seller_id, speed FROM cart_speeds WHERE account_id = $1`,
    [accountId],
  );
  return {
    rows,
    listings,
    destination: await destinationFor(state),
    state,
    coupon: state.coupon_code === null ? null : await couponByCode(state.coupon_code),
    speeds: new Map(speedRows.map((row) => [row.seller_id, row.speed])),
    balancePaise: await accountBalance(accountId),
    openCodOrders: await openCodOrders(accountId),
    now,
  };
}

export type QuoteBreakdown = {
  quote: CartQuote;
  perLine: Map<
    string,
    {
      listing: ListingRecord;
      quantity: number;
      unitPrice: number;
      subtotal: number;
      couponShare: number;
      lineTotal: number;
      emiSubvention: number;
      giftWrap: boolean;
      giftMessage: string;
    }
  >;
  perParcel: Map<
    string,
    { lineIds: string[]; speed: DeliverySpeed; deliveryFee: number; codFee: number; promiseDate: string | null; giftWrap: number }
  >;
};

export function computeQuote(context: QuoteContext): QuoteBreakdown {
  const { now, destination, state } = context;
  const cartLines = context.rows.filter((row) => row.state === 'cart');
  const savedLines = context.rows.filter((row) => row.state === 'saved');

  const priced = cartLines.flatMap((row) => {
    const listing = context.listings.get(row.listing_id);
    if (listing === undefined) return [];
    const unitPrice = effectivePrice(listing, now);
    return [
      {
        row,
        listing,
        unitPrice,
        subtotal: unitPrice * row.quantity,
      },
    ];
  });

  const selected = priced.filter((line) => line.row.selected);
  const selectedSubtotal = selected.reduce((sum, line) => sum + line.subtotal, 0);

  let couponCode: string | null = null;
  let discount = 0;
  if (context.coupon !== null) {
    const applied = couponDiscount(context.coupon, selectedSubtotal, now);
    if (applied !== null) {
      couponCode = context.coupon.code;
      discount = applied;
    }
  }

  const shares = allocate(
    discount,
    selected.map((line) => line.subtotal),
  );
  const couponShares = new Map<string, number>();
  selected.forEach((line, index) => couponShares.set(line.row.line_id, shares[index]));

  const intraState =
    destination !== null && destination.serviceable
      ? (sellerState: string) => sellerState === destination.state
      : () => false;

  const lines: CartLine[] = priced.map((line) => {
    const couponShare = couponShares.get(line.row.line_id) ?? 0;
    const lineTotal = line.subtotal - couponShare;
    const split = taxSplit(lineTotal, line.listing.gst_rate, intraState(line.listing.pickup_state));
    return {
      line_id: line.row.line_id,
      listing_id: line.listing.listing_id,
      product_id: line.listing.product_id,
      title: line.listing.title,
      seller_id: line.listing.seller_id,
      quantity: line.row.quantity,
      unit_price_paise: line.unitPrice,
      deal: activeDeal(line.listing, now),
      selected: line.row.selected,
      gift_wrap: line.row.gift_wrap,
      gift_message: line.row.gift_message,
      line_subtotal_paise: line.subtotal,
      coupon_share_paise: couponShare,
      line_total_paise: lineTotal,
      gst_rate: line.listing.gst_rate,
      ...split,
      in_stock: line.listing.status === 'live' && line.listing.stock >= line.row.quantity,
    };
  });

  const parcelOrder: string[] = [];
  const parcelLines = new Map<string, typeof selected>();
  for (const line of selected) {
    const sellerId = line.listing.seller_id;
    if (!parcelLines.has(sellerId)) {
      parcelLines.set(sellerId, []);
      parcelOrder.push(sellerId);
    }
    parcelLines.get(sellerId)?.push(line);
  }

  const method = state.payment_method;
  const codSelected = method === 'cod';
  const perParcel: QuoteBreakdown['perParcel'] = new Map();
  const parcels = parcelOrder.map((sellerId) => {
    const group = parcelLines.get(sellerId) ?? [];
    const listing = group[0].listing;
    const seller = sellerOf(listing);
    const speed = context.speeds.get(sellerId) ?? 'standard';
    const promise = deliveryPromise(seller, destination, speed === 'one_day', now);
    const parcelSubtotal = group.reduce((sum, line) => sum + line.subtotal, 0);
    const oneDay = speed === 'one_day' && promise.one_day_available;
    const fee = deliveryFee(parcelSubtotal, oneDay);
    const giftWrap =
      group.filter((line) => line.row.gift_wrap).length * GIFT_WRAP_FEE_PAISE;
    perParcel.set(sellerId, {
      lineIds: group.map((line) => line.row.line_id),
      speed,
      deliveryFee: fee,
      codFee: codSelected ? COD_FEE_PAISE : 0,
      promiseDate: promise.promise_date,
      giftWrap,
    });
    return {
      seller_id: sellerId,
      seller_name: listing.seller_name,
      line_ids: group.map((line) => line.row.line_id),
      speed,
      one_day_available: promise.one_day_available,
      serviceable: promise.promise_date !== null,
      promise_date: promise.promise_date,
      delivery_fee_paise: fee,
      cod_fee_paise: codSelected ? COD_FEE_PAISE : 0,
    };
  });

  const giftWrapTotal =
    selected.filter((line) => line.row.gift_wrap).length * GIFT_WRAP_FEE_PAISE;
  const deliveryTotal = parcels.reduce((sum, parcel) => sum + parcel.delivery_fee_paise, 0);
  const codFeeTotal = parcels.reduce((sum, parcel) => sum + parcel.cod_fee_paise, 0);
  const lineTotals = selected.reduce(
    (sum, line) => sum + line.subtotal - (couponShares.get(line.row.line_id) ?? 0),
    0,
  );

  const noCostAllowed =
    selected.length > 0 && selected.every((line) => line.listing.no_cost_emi);
  const beforeEmi = lineTotals + giftWrapTotal + deliveryTotal + codFeeTotal;
  const emiDiscount =
    method === 'emi' && state.emi_tenure_months !== null
      ? emiUpfrontDiscount(beforeEmi, state.emi_tenure_months, noCostAllowed)
      : 0;
  const payable = beforeEmi - emiDiscount;

  const useBalance = state.use_balance && method !== 'emi';
  const balanceApplied = useBalance ? Math.min(context.balancePaise, payable) : 0;
  const due = payable - balanceApplied;

  const codPayable = codSelected
    ? payable
    : lineTotals + giftWrapTotal + deliveryTotal + COD_FEE_PAISE * parcels.length;
  const codBalanceApplied = useBalance ? Math.min(context.balancePaise, codPayable) : 0;
  const cod = codEligibility({
    sellers: parcelOrder.map((sellerId) => {
      const listing = (parcelLines.get(sellerId) ?? [])[0].listing;
      return {
        display_name: listing.seller_name,
        cod_allowed: listing.seller_cod_allowed && listing.cod_allowed,
      };
    }),
    destination,
    openCodOrders: context.openCodOrders,
    cashPaise: codPayable - codBalanceApplied,
  });

  const emiShares = allocate(
    emiDiscount,
    selected.map((line) => line.subtotal),
  );
  const perLine: QuoteBreakdown['perLine'] = new Map();
  selected.forEach((line, index) => {
    perLine.set(line.row.line_id, {
      listing: line.listing,
      quantity: line.row.quantity,
      unitPrice: line.unitPrice,
      subtotal: line.subtotal,
      couponShare: couponShares.get(line.row.line_id) ?? 0,
      lineTotal: line.subtotal - (couponShares.get(line.row.line_id) ?? 0),
      emiSubvention: emiShares[index],
      giftWrap: line.row.gift_wrap,
      giftMessage: line.row.gift_message,
    });
  });

  const quote: CartQuote = {
    lines,
    saved_for_later: savedLines.flatMap((row) => {
      const listing = context.listings.get(row.listing_id);
      if (listing === undefined) return [];
      return [
        {
          line_id: row.line_id,
          listing_id: row.listing_id,
          title: listing.title,
          unit_price_paise: effectivePrice(listing, now),
          in_stock: listing.status === 'live' && listing.stock > 0,
        },
      ];
    }),
    parcels,
    destination: {
      address_id: state.address_id,
      pincode: destination === null ? state.pincode : destination.pincode,
      city: destination === null || destination.city === '' ? null : destination.city,
      state: destination === null || destination.state === '' ? null : destination.state,
    },
    coupon: couponCode === null ? null : { code: couponCode, discount_paise: discount },
    payment: {
      method,
      use_balance: state.use_balance,
      emi_tenure_months: state.emi_tenure_months,
    },
    subtotal_paise: selectedSubtotal,
    discount_paise: discount,
    gift_wrap_paise: giftWrapTotal,
    delivery_paise: deliveryTotal,
    cod_fee_paise: codFeeTotal,
    emi_discount_paise: emiDiscount,
    payable_paise: payable,
    balance_applied_paise: balanceApplied,
    due_paise: due,
    cod,
    server_time: now.toISOString(),
  };

  return { quote, perLine, perParcel };
}

export async function loadQuote(accountId: string, now = new Date()): Promise<QuoteBreakdown> {
  const context = await quoteContext(accountId, now);
  return computeQuote(context);
}
