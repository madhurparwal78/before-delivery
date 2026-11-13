/** Cart routes. Every reply is the server's quote. */

import { one, query } from '../db.js';
import { emiAmountAllowed, emiPlans, EMI_TENURES } from '../domain/emi.js';
import { newId, PINCODE_PATTERN } from '../domain/identity.js';
import { ApiError, notFound, validationFailed } from '../http/errors.js';
import { json, route, type Ctx, type Reply } from '../http/router.js';
import { Validator } from '../http/validate.js';
import { getListing } from '../repo.js';
import { cartRows, couponByCode, couponDiscount, loadQuote } from '../quote.js';
import { FIELD, type MergeOutcome } from '../../shared/messages.js';
import type { PaymentMethod } from '../../shared/types.js';

const MAX_CART_LINES = 10;
const MAX_SAVED_LINES = 50;
const MAX_UNITS_PER_LINE = 10;

async function quoteReply(accountId: string, status = 200): Promise<Reply> {
  const { quote } = await loadQuote(accountId);
  return json(quote, status);
}

function accountOf(ctx: Ctx): string {
  return ctx.account?.accountId ?? '';
}

async function lineOrNotFound(ctx: Ctx, state?: 'cart' | 'saved'): Promise<{
  line_id: string;
  listing_id: string;
  quantity: number;
  state: 'cart' | 'saved';
}> {
  const row = await one<{
    line_id: string;
    listing_id: string;
    quantity: number;
    state: 'cart' | 'saved';
  }>(
    `SELECT line_id, listing_id, quantity, state FROM cart_lines
      WHERE line_id = $1 AND account_id = $2`,
    [ctx.params.lineId, accountOf(ctx)],
  );
  if (row === null) throw notFound();
  if (state !== undefined && row.state !== state) throw notFound();
  return row;
}

async function addToCart(
  accountId: string,
  listingId: string,
  quantity: number,
): Promise<void> {
  const listing = await getListing(listingId);
  if (listing === null) throw notFound();
  if (listing.status !== 'live' || listing.stock <= 0) throw new ApiError(409, 'sold_out');
  const rows = await cartRows(accountId);
  const existing = rows.find((row) => row.listing_id === listingId && row.state === 'cart');
  const wanted = (existing?.quantity ?? 0) + quantity;
  if (wanted > MAX_UNITS_PER_LINE) throw validationFailed({ quantity: FIELD.quantityOverTen });
  if (wanted > listing.stock) throw validationFailed({ quantity: FIELD.quantityOverStock });
  if (existing === undefined) {
    const cartCount = rows.filter((row) => row.state === 'cart').length;
    if (cartCount >= MAX_CART_LINES) throw validationFailed({ lines: FIELD.cartLineLimit });
    await query(
      `INSERT INTO cart_lines (line_id, account_id, listing_id, quantity) VALUES ($1, $2, $3, $4)`,
      [newId('CL-'), accountId, listingId, quantity],
    );
    return;
  }
  await query(`UPDATE cart_lines SET quantity = $2 WHERE line_id = $1`, [existing.line_id, wanted]);
}

export function registerCartRoutes(): void {
  route('GET', '/api/cart', 'shopper', async (ctx) => quoteReply(accountOf(ctx)));

  route('POST', '/api/cart/lines', 'shopper', async (ctx) => {
    const validator = new Validator(ctx.body, ['listing_id', 'quantity']);
    const listingId = typeof ctx.body.listing_id === 'string' ? ctx.body.listing_id : '';
    const quantity = validator.integer('quantity', {
      min: 1,
      max: MAX_UNITS_PER_LINE,
      message: FIELD.quantityOverTen,
    });
    validator.done();
    await addToCart(accountOf(ctx), listingId, quantity);
    return quoteReply(accountOf(ctx), 201);
  });

  route('PATCH', '/api/cart/lines/:lineId', 'shopper', async (ctx) => {
    const line = await lineOrNotFound(ctx, 'cart');
    const validator = new Validator(ctx.body, [
      'quantity',
      'selected',
      'gift_wrap',
      'gift_message',
    ]);
    const listing = await getListing(line.listing_id);
    if (validator.has('quantity')) {
      const quantity = validator.integer('quantity', {
        min: 1,
        max: MAX_UNITS_PER_LINE,
        message: FIELD.quantityOverTen,
      });
      if (!validator.failed && listing !== null && quantity > listing.stock) {
        validator.fail('quantity', FIELD.quantityOverStock);
      }
      if (!validator.failed) {
        await query(`UPDATE cart_lines SET quantity = $2 WHERE line_id = $1`, [line.line_id, quantity]);
      }
    }
    if (validator.has('selected')) {
      const selected = validator.boolean('selected', true);
      if (!validator.failed) {
        await query(`UPDATE cart_lines SET selected = $2 WHERE line_id = $1`, [line.line_id, selected]);
      }
    }
    if (validator.has('gift_wrap')) {
      const giftWrap = validator.boolean('gift_wrap', false);
      if (!validator.failed) {
        await query(`UPDATE cart_lines SET gift_wrap = $2 WHERE line_id = $1`, [line.line_id, giftWrap]);
      }
    }
    if (validator.has('gift_message')) {
      const message = validator.text('gift_message', {
        label: 'Gift message',
        min: 0,
        max: 240,
      });
      if (!validator.failed) {
        await query(`UPDATE cart_lines SET gift_message = $2 WHERE line_id = $1`, [
          line.line_id,
          message,
        ]);
      }
    }
    validator.done();
    return quoteReply(accountOf(ctx));
  });

  route('DELETE', '/api/cart/lines/:lineId', 'shopper', async (ctx) => {
    const line = await lineOrNotFound(ctx);
    await query(`DELETE FROM cart_lines WHERE line_id = $1`, [line.line_id]);
    return quoteReply(accountOf(ctx));
  });

  route('POST', '/api/cart/lines/:lineId/save-for-later', 'shopper', async (ctx) => {
    const line = await lineOrNotFound(ctx, 'cart');
    const saved = await cartRows(accountOf(ctx));
    if (saved.filter((row) => row.state === 'saved').length >= MAX_SAVED_LINES) {
      throw validationFailed({ lines: FIELD.cartLineLimit });
    }
    await query(`UPDATE cart_lines SET state = 'saved' WHERE line_id = $1`, [line.line_id]);
    return quoteReply(accountOf(ctx));
  });

  route('POST', '/api/cart/saved/:lineId/move-to-cart', 'shopper', async (ctx) => {
    const line = await lineOrNotFound(ctx, 'saved');
    const rows = await cartRows(accountOf(ctx));
    const existing = rows.find(
      (row) => row.listing_id === line.listing_id && row.state === 'cart',
    );
    if (existing === undefined && rows.filter((row) => row.state === 'cart').length >= MAX_CART_LINES) {
      throw validationFailed({ lines: FIELD.cartLineLimit });
    }
    if (existing !== undefined) {
      const wanted = Math.min(existing.quantity + line.quantity, MAX_UNITS_PER_LINE);
      await query(`UPDATE cart_lines SET quantity = $2 WHERE line_id = $1`, [existing.line_id, wanted]);
      await query(`DELETE FROM cart_lines WHERE line_id = $1`, [line.line_id]);
    } else {
      await query(`UPDATE cart_lines SET state = 'cart' WHERE line_id = $1`, [line.line_id]);
    }
    return quoteReply(accountOf(ctx));
  });

  route('POST', '/api/cart/lines/:lineId/move-to-wishlist', 'shopper', async (ctx) => {
    const line = await lineOrNotFound(ctx);
    const listing = await getListing(line.listing_id);
    if (listing === null) throw notFound();
    const already = await one<{ item_id: string }>(
      `SELECT item_id FROM wishlist_items WHERE account_id = $1 AND listing_id = $2`,
      [accountOf(ctx), line.listing_id],
    );
    if (already === null) {
      await query(
        `INSERT INTO wishlist_items (item_id, account_id, product_id, listing_id)
         VALUES ($1, $2, $3, $4)`,
        [newId('WL-'), accountOf(ctx), listing.product_id, listing.listing_id],
      );
    }
    await query(`DELETE FROM cart_lines WHERE line_id = $1`, [line.line_id]);
    return quoteReply(accountOf(ctx));
  });

  route('PUT', '/api/cart/destination', 'shopper', async (ctx) => {
    const validator = new Validator(ctx.body, ['address_id', 'pincode']);
    const accountId = accountOf(ctx);
    if (validator.has('address_id')) {
      const addressId = typeof ctx.body.address_id === 'string' ? ctx.body.address_id : '';
      const address = await one<{ pincode: string }>(
        `SELECT pincode FROM addresses WHERE id = $1 AND account_id = $2`,
        [addressId, accountId],
      );
      if (address === null) throw notFound();
      validator.done();
      await query(
        `UPDATE cart_state SET address_id = $2, pincode = $3 WHERE account_id = $1`,
        [accountId, addressId, address.pincode],
      );
      return quoteReply(accountId);
    }
    const pincode = typeof ctx.body.pincode === 'string' ? ctx.body.pincode.trim() : '';
    if (!PINCODE_PATTERN.test(pincode)) validator.fail('pincode', FIELD.badPincode);
    validator.done();
    await query(`UPDATE cart_state SET address_id = NULL, pincode = $2 WHERE account_id = $1`, [
      accountId,
      pincode,
    ]);
    return quoteReply(accountId);
  });

  route('PUT', '/api/cart/delivery-speed', 'shopper', async (ctx) => {
    const validator = new Validator(ctx.body, ['seller_id', 'speed']);
    const sellerId = typeof ctx.body.seller_id === 'string' ? ctx.body.seller_id : '';
    const speed = ctx.body.speed;
    if (speed !== 'standard' && speed !== 'one_day') {
      validator.fail('speed', FIELD.oneDayUnavailable);
    }
    validator.done();
    const accountId = accountOf(ctx);
    const { quote } = await loadQuote(accountId);
    const parcel = quote.parcels.find((entry) => entry.seller_id === sellerId);
    if (parcel === undefined) throw notFound();
    if (speed === 'one_day' && !parcel.one_day_available) {
      throw validationFailed({ speed: FIELD.oneDayUnavailable });
    }
    await query(
      `INSERT INTO cart_speeds (account_id, seller_id, speed) VALUES ($1, $2, $3)
       ON CONFLICT (account_id, seller_id) DO UPDATE SET speed = $3`,
      [accountId, sellerId, speed],
    );
    return quoteReply(accountId);
  });

  route(
    'POST',
    '/api/cart/coupon',
    'shopper',
    async (ctx) => {
      const validator = new Validator(ctx.body, ['code']);
      const code = typeof ctx.body.code === 'string' ? ctx.body.code.trim() : '';
      if (code === '') validator.fail('code', FIELD.badCoupon);
      validator.done();
      const accountId = accountOf(ctx);
      const coupon = await couponByCode(code);
      const { quote } = await loadQuote(accountId);
      if (coupon === null || couponDiscount(coupon, quote.subtotal_paise, new Date()) === null) {
        throw validationFailed({ code: FIELD.badCoupon });
      }
      await query(`UPDATE cart_state SET coupon_code = $2 WHERE account_id = $1`, [
        accountId,
        coupon.code,
      ]);
      return quoteReply(accountId);
    },
    { rate: 'coupon' },
  );

  route('DELETE', '/api/cart/coupon', 'shopper', async (ctx) => {
    const accountId = accountOf(ctx);
    await query(`UPDATE cart_state SET coupon_code = NULL WHERE account_id = $1`, [accountId]);
    return quoteReply(accountId);
  });

  route('PUT', '/api/cart/payment', 'shopper', async (ctx) => {
    const validator = new Validator(ctx.body, ['method', 'use_balance', 'emi_tenure_months']);
    const methodRaw = ctx.body.method;
    const methods: PaymentMethod[] = ['upi', 'card', 'netbanking', 'emi', 'cod'];
    const method =
      methodRaw === null || methodRaw === undefined
        ? null
        : methods.includes(methodRaw as PaymentMethod)
          ? (methodRaw as PaymentMethod)
          : undefined;
    if (method === undefined) validator.fail('method', FIELD.unsettable);
    const useBalance = validator.boolean('use_balance', false);
    const tenureRaw = ctx.body.emi_tenure_months;
    const tenure =
      tenureRaw === null || tenureRaw === undefined
        ? null
        : EMI_TENURES.includes(tenureRaw as 3 | 6 | 9 | 12)
          ? (tenureRaw as number)
          : undefined;
    if (tenure === undefined) validator.fail('emi_tenure_months', FIELD.unsettable);
    validator.done();

    const accountId = accountOf(ctx);
    const { quote } = await loadQuote(accountId);
    if (method === 'cod' && !quote.cod.eligible) {
      throw validationFailed({ method: quote.cod.message ?? '' });
    }
    if (method === 'emi') {
      const amount = quote.payable_paise + quote.emi_discount_paise;
      if (!emiAmountAllowed(amount)) throw validationFailed({ method: FIELD.emiTooSmall });
    }
    await query(
      `UPDATE cart_state SET payment_method = $2, use_balance = $3, emi_tenure_months = $4
        WHERE account_id = $1`,
      [accountId, method, method === 'emi' ? false : useBalance, method === 'emi' ? tenure ?? 3 : tenure],
    );
    return quoteReply(accountId);
  });

  route('GET', '/api/cart/emi-plans', 'shopper', async (ctx) => {
    const accountId = accountOf(ctx);
    const { quote, perLine } = await loadQuote(accountId);
    const amount = quote.payable_paise + quote.emi_discount_paise;
    if (!emiAmountAllowed(amount)) throw validationFailed({ amount: FIELD.emiTooSmall });
    const noCost =
      perLine.size > 0 && [...perLine.values()].every((line) => line.listing.no_cost_emi);
    return json(emiPlans(amount, noCost));
  });

  route('POST', '/api/cart/merge', 'shopper', async (ctx) => {
    const validator = new Validator(ctx.body, ['lines']);
    const raw = ctx.body.lines;
    if (!Array.isArray(raw) || raw.length > 20) {
      validator.fail('lines', FIELD.cartLineLimit);
    }
    validator.done();
    const accountId = accountOf(ctx);
    const results: { listing_id: string; title: string; outcome: MergeOutcome; quantity: number }[] = [];
    for (const entry of raw as { listing_id?: unknown; quantity?: unknown }[]) {
      const listingId = typeof entry.listing_id === 'string' ? entry.listing_id : '';
      const quantity =
        typeof entry.quantity === 'number' && Number.isInteger(entry.quantity) && entry.quantity > 0
          ? entry.quantity
          : 1;
      const listing = await getListing(listingId);
      if (listing === null) continue;
      if (listing.status !== 'live' || listing.stock <= 0) {
        results.push({
          listing_id: listingId,
          title: listing.title,
          outcome: 'unavailable',
          quantity: 0,
        });
        continue;
      }
      const rows = await cartRows(accountId);
      const existing = rows.find((row) => row.listing_id === listingId && row.state === 'cart');
      if (existing !== undefined) {
        const wanted = Math.min(
          existing.quantity + quantity,
          MAX_UNITS_PER_LINE,
          Math.max(listing.stock, 1),
        );
        await query(`UPDATE cart_lines SET quantity = $2 WHERE line_id = $1`, [
          existing.line_id,
          wanted,
        ]);
        results.push({
          listing_id: listingId,
          title: listing.title,
          outcome: existing.quantity + quantity > MAX_UNITS_PER_LINE ? 'capped' : 'combined',
          quantity: wanted,
        });
        continue;
      }
      const cartCount = rows.filter((row) => row.state === 'cart').length;
      const capped = Math.min(quantity, MAX_UNITS_PER_LINE, listing.stock);
      if (cartCount >= MAX_CART_LINES) {
        await query(
          `INSERT INTO cart_lines (line_id, account_id, listing_id, quantity, state)
           VALUES ($1, $2, $3, $4, 'saved')`,
          [newId('CL-'), accountId, listingId, capped],
        );
        results.push({
          listing_id: listingId,
          title: listing.title,
          outcome: 'saved_for_later',
          quantity: capped,
        });
        continue;
      }
      await query(
        `INSERT INTO cart_lines (line_id, account_id, listing_id, quantity) VALUES ($1, $2, $3, $4)`,
        [newId('CL-'), accountId, listingId, capped],
      );
      results.push({
        listing_id: listingId,
        title: listing.title,
        outcome: quantity > MAX_UNITS_PER_LINE ? 'capped' : 'added',
        quantity: capped,
      });
    }
    const { quote } = await loadQuote(accountId);
    return json({ results, cart: quote });
  });
}
