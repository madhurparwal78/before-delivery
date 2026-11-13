import type { PoolClient } from "pg";
import { config } from "../config.js";
import { one, query, transaction } from "../db.js";
import { checkCardNumber, expiryValid, type CardNetwork } from "../domain/card.js";
import { EMI_TENURES, type EmiTenure } from "../domain/emi.js";
import { EMI_MINIMUM_PAISE, GIFT_WRAP_FEE_PAISE } from "../domain/fees.js";
import { allocate } from "../domain/money.js";
import { todayInIndia } from "../domain/promise.js";
import { initialPaymentState } from "../domain/state.js";
import { ApiError, FIELD, validationFailed } from "../errors.js";
import { publicId } from "../id.js";
import { Body, isRecord } from "../validate.js";
import { startNetbanking, startUpi } from "./gateway.js";
import { recordPurchase } from "./killbill.js";
import { tryStoreDocuments } from "./documents.js";
import { undoRecordedLegs } from "./ledger.js";
import { ProviderUnavailable } from "./provider.js";
import { buildQuote, emiAmount, quoteJson, type PaymentMethod, type Quote } from "./quote.js";
import { queueListing } from "./search.js";

interface CardInput {
  savedCardId: string | null;
  number: string;
  expiryMonth: number;
  expiryYear: number;
  cvv: string;
  name: string;
  save: boolean;
}

interface CheckoutInput {
  addressId: string;
  expectedPayablePaise: number;
  method: PaymentMethod | null;
  useBalance: boolean;
  vpa: string | null;
  bankCode: string | null;
  card: CardInput | null;
  emiTenure: EmiTenure | null;
}

const METHODS: readonly PaymentMethod[] = ["upi", "card", "netbanking", "emi", "cod"];
const VPA = /^[^@\s]{1,254}@[^@\s]{1,254}$/;

function parseCard(raw: unknown, body: Body): CardInput | null {
  if (!isRecord(raw)) {
    body.fail("card", FIELD.badCard);
    return null;
  }
  const card = body.child(raw, ["saved_card_id", "cvv", "number", "expiry_month", "expiry_year", "name", "save"]);
  const savedCardId = card.text("saved_card_id", { label: "Saved card", max: 60, optional: true });
  const cvv = card.text("cvv", { label: "CVV", max: 4 });
  if (cvv !== undefined && !/^\d{3}$/.test(cvv)) card.fail("cvv", FIELD.badCvv);
  if (savedCardId !== undefined) return { savedCardId, number: "", expiryMonth: 0, expiryYear: 0, cvv: cvv ?? "", name: "", save: false };
  const number = card.text("number", { label: "Card number", max: 30 });
  const expiryMonth = card.int("expiry_month", { min: 1, max: 12, message: FIELD.badExpiry });
  const expiryYear = card.int("expiry_year", { min: 2000, max: 2200, message: FIELD.badExpiry });
  const name = card.text("name", { label: "Name on card", min: 1, max: 60 });
  const save = card.bool("save", true);
  return { savedCardId: null, number: number ?? "", expiryMonth: expiryMonth ?? 0, expiryYear: expiryYear ?? 0, cvv: cvv ?? "", name: name ?? "", save: save ?? false };
}

export function parseCheckout(raw: Record<string, unknown>): CheckoutInput {
  const body = new Body(raw, ["address_id", "expected_payable_paise", "payment"]);
  const addressId = body.text("address_id", { label: "Address", max: 40, optional: true });
  if (addressId === undefined) body.fail("address_id", FIELD.badAddress);
  const expected = body.int("expected_payable_paise", { min: 0, max: 10_000_000_000, message: FIELD.needsWholeNumber });
  const paymentRaw = body.nested("payment");
  let method: PaymentMethod | null = null;
  let useBalance = false;
  let vpa: string | null = null;
  let bankCode: string | null = null;
  let card: CardInput | null = null;
  let emiTenure: EmiTenure | null = null;
  if (!isRecord(paymentRaw)) body.fail("method", FIELD.noMethod);
  else {
    const payment = body.child(paymentRaw, ["method", "use_balance", "upi", "card", "netbanking", "emi"]);
    const methodRaw = payment.nested("method");
    if (methodRaw === null) method = null;
    else if ((METHODS as readonly unknown[]).includes(methodRaw)) method = methodRaw as PaymentMethod;
    else payment.fail("method", FIELD.badChoice);
    useBalance = payment.bool("use_balance") ?? false;
    const upi = payment.nested("upi");
    const netbanking = payment.nested("netbanking");
    const emi = payment.nested("emi");
    const cardRaw = payment.nested("card");
    if (method === "upi") {
      const vpaRaw = isRecord(upi) ? body.child(upi, ["vpa"]).text("vpa", { label: "UPI ID", min: 2, max: 256 }) : undefined;
      if (vpaRaw === undefined || !VPA.test(vpaRaw)) body.fail("vpa", FIELD.badUpi);
      else vpa = vpaRaw;
    }
    if (method === "netbanking") {
      const bank = isRecord(netbanking) ? body.child(netbanking, ["bank_code"]).text("bank_code", { label: "Bank", max: 10 }) : undefined;
      if (bank === undefined) body.fail("bank_code", FIELD.badBank);
      else bankCode = bank;
    }
    if (method === "card") card = parseCard(cardRaw, body);
    if (method === "emi") {
      if (!isRecord(emi)) body.fail("emi", FIELD.emiNeedsCard);
      else {
        const child = body.child(emi, ["tenure_months", "card"]);
        const tenure = child.int("tenure_months", { min: 3, max: 12, message: FIELD.badTenure });
        if (tenure !== undefined && !(EMI_TENURES as readonly number[]).includes(tenure)) body.fail("tenure_months", FIELD.badTenure);
        else emiTenure = (tenure as EmiTenure | undefined) ?? null;
        card = parseCard(emi.card, body);
      }
    }
  }
  body.done();
  return { addressId: addressId as string, expectedPayablePaise: expected as number, method, useBalance, vpa, bankCode, card, emiTenure };
}

interface Resolved {
  network: CardNetwork;
  last4: string;
  save: { number: string } | null;
  expiryMonth: number;
  expiryYear: number;
  name: string;
}

/** The card as the order will record it: a saved card needs its CVV again, a new one must pass the number and expiry checks. */
async function resolveCard(accountId: string, card: CardInput, nowMs: number): Promise<Resolved> {
  if (card.savedCardId !== null) {
    const saved = await one<{ network: CardNetwork; last4: string; expiry_month: number; expiry_year: number; name: string }>(
      "SELECT * FROM cards WHERE id = $1 AND account_id = $2",
      [card.savedCardId, accountId],
    );
    if (!saved) throw validationFailed({ saved_card_id: FIELD.badSavedCard });
    return { network: saved.network, last4: saved.last4, save: null, expiryMonth: saved.expiry_month, expiryYear: saved.expiry_year, name: saved.name };
  }
  const verdict = checkCardNumber(card.number);
  if (!verdict.ok) throw validationFailed({ number: verdict.reason === "network" ? FIELD.cardNetwork : FIELD.badCard });
  if (!expiryValid(card.expiryMonth, card.expiryYear, todayInIndia(nowMs))) throw validationFailed({ expiry_month: FIELD.badExpiry });
  return { network: verdict.network, last4: verdict.last4, save: card.save ? { number: card.number } : null, expiryMonth: card.expiryMonth, expiryYear: card.expiryYear, name: card.name };
}

function checkAgainstQuote(quote: Quote, input: CheckoutInput): void {
  if (quote.lines.every((line) => !line.selected)) throw validationFailed({ lines: FIELD.emptyCart });
  const pincode = quote.destination.pincode as string;
  for (const parcel of quote.parcels) {
    if (parcel.serviceable === false) {
      const destination = quote.destination.resolved;
      throw validationFailed({ address_id: destination?.serviceable ? FIELD.sellerNoPincode(parcel.seller.name, pincode) : FIELD.noPincode(pincode) });
    }
  }
  if (quote.payablePaise !== input.expectedPayablePaise) {
    throw new ApiError(409, "price_changed", {}, { quote: quoteJson(quote) });
  }
  if (quote.duePaise > 0 && input.method === null) throw validationFailed({ method: FIELD.noMethod });
  if (input.method === "emi") {
    if (input.useBalance) throw validationFailed({ use_balance: FIELD.emiNoBalance });
    if (emiAmount(quote) < EMI_MINIMUM_PAISE) throw validationFailed({ method: FIELD.emiMinimum });
  }
  if (input.method === "cod" && quote.duePaise > 0 && !quote.cod.eligible) throw validationFailed({ method: quote.cod.message as string });
}

interface PlacedLeg {
  id: string;
  shipmentId: string | null;
  method: string;
  amountPaise: number;
  status: "confirmed" | "awaiting_customer" | "pending";
  key: string;
  recorded: boolean;
  last4: string | null;
  network: string | null;
}

function claimFailure(listingIds: string[]): ApiError {
  return new ApiError(409, "sold_out", {}, { listing_ids: listingIds });
}

async function claimStock(client: PoolClient, quote: Quote, nowMs: number): Promise<void> {
  const failed: string[] = [];
  const lines = [...quote.lines.filter((line) => line.selected)].sort((a, b) => a.listing.id.localeCompare(b.listing.id));
  for (const line of lines) {
    const claimed = await client.query("UPDATE listings SET stock = stock - $2 WHERE id = $1 AND status = 'live' AND stock >= $2 RETURNING id", [line.listing.id, line.quantity]);
    if (claimed.rowCount === 0) failed.push(line.listing.id);
    else await queueListing(line.listing.id, nowMs, client);
  }
  if (failed.length > 0) throw claimFailure(failed);
}

async function holdBalance(client: PoolClient, accountId: string, amountPaise: number, quote: Quote): Promise<void> {
  if (amountPaise === 0) return;
  const held = await client.query("UPDATE accounts SET balance_paise = balance_paise - $2 WHERE id = $1 AND balance_paise >= $2 RETURNING id", [accountId, amountPaise]);
  if (held.rowCount === 0) throw new ApiError(409, "price_changed", {}, { quote: quoteJson(quote) });
}

interface PlacedOrder {
  orderId: string;
  body: Record<string, unknown>;
}

/** The order of a checkout: validate, re-price, claim stock, hold the balance, record confirmed legs, start UPI or net banking, commit. */
export async function placeOrder(accountId: string, input: CheckoutInput, nowMs: number): Promise<PlacedOrder> {
  const address = await one<{ id: string; name: string; line1: string; line2: string; city: string; state: string; pincode: string; phone: string }>(
    "SELECT id, name, line1, line2, city, state, pincode, phone FROM addresses WHERE id = $1 AND account_id = $2",
    [input.addressId, accountId],
  );
  if (!address) throw validationFailed({ address_id: FIELD.badAddress });
  const card = input.card ? await resolveCard(accountId, input.card, nowMs) : null;
  if (input.bankCode !== null && !(await one("SELECT 1 FROM banks WHERE code = $1", [input.bankCode]))) throw validationFailed({ bank_code: FIELD.badBank });
  const payment = { method: input.method, useBalance: input.useBalance, emiTenureMonths: input.emiTenure };
  const quote = await buildQuote(accountId, nowMs, { addressId: address.id, payment });
  checkAgainstQuote(quote, input);
  const selected = quote.lines.filter((line) => line.selected);
  const method = quote.duePaise === 0 ? null : input.method;

  const orderId = publicId("CH");
  const paymentId = publicId("PAY");
  const recorded: { key: string; amountPaise: number }[] = [];
  const parcelPayables = quote.parcels.map(
    (parcel) =>
      parcel.lines.reduce((sum, line) => sum + line.lineTotalPaise, 0) +
      parcel.lines.filter((line) => line.giftWrap).length * GIFT_WRAP_FEE_PAISE +
      parcel.deliveryFeePaise +
      parcel.codFeePaise -
      parcel.lines.reduce((sum, line) => sum + line.emiSharePaise, 0),
  );
  const balanceShares = allocate(quote.balanceAppliedPaise, parcelPayables);
  const shipmentIds = quote.parcels.map(() => publicId("SH"));

  try {
    return await transaction(async (client) => {
      await claimStock(client, quote, nowMs);
      await holdBalance(client, accountId, quote.balanceAppliedPaise, quote);
      const legs: PlacedLeg[] = [];
      const addLeg = (leg: Omit<PlacedLeg, "id" | "recorded"> & { recorded?: boolean }): void => {
        legs.push({ id: publicId("LG"), recorded: false, ...leg });
      };
      const recordNow = async (key: string, amountPaise: number): Promise<void> => {
        try {
          await recordPurchase(accountId, key, amountPaise);
        } catch (error) {
          if (error instanceof ProviderUnavailable) throw new ApiError(503, "payments_unavailable");
          throw error;
        }
        recorded.push({ key, amountPaise });
      };
      if (quote.balanceAppliedPaise > 0) {
        const key = `${orderId}-balance`;
        await recordNow(key, quote.balanceAppliedPaise);
        addLeg({ shipmentId: null, method: "balance", amountPaise: quote.balanceAppliedPaise, status: "confirmed", key, recorded: true, last4: null, network: null });
      }
      if (method === "card" || method === "emi") {
        const key = `${orderId}-${method}`;
        await recordNow(key, quote.duePaise);
        addLeg({ shipmentId: null, method, amountPaise: quote.duePaise, status: "confirmed", key, recorded: true, last4: card?.last4 ?? null, network: card?.network ?? null });
      }
      if (method === "upi" || method === "netbanking") {
        try {
          if (method === "upi") await startUpi(paymentId, input.vpa as string, quote.duePaise, config.seconds.upiExpiry);
          else await startNetbanking(paymentId, input.bankCode as string, quote.duePaise);
        } catch (error) {
          if (error instanceof ProviderUnavailable) throw new ApiError(503, method === "upi" ? "upi_unavailable" : "netbanking_unavailable");
          throw error;
        }
        addLeg({ shipmentId: null, method, amountPaise: quote.duePaise, status: "awaiting_customer", key: `${orderId}-${method}`, last4: null, network: null });
      }
      if (method === "cod") {
        quote.parcels.forEach((_, index) => {
          const cash = (parcelPayables[index] as number) - (balanceShares[index] as number);
          if (cash > 0) {
            const shipmentId = shipmentIds[index] as string;
            addLeg({ shipmentId, method: "cod", amountPaise: cash, status: "pending", key: `${orderId}-cod-${shipmentId}`, last4: null, network: null });
          }
        });
      }

      const paymentState = initialPaymentState(method);
      const awaiting = paymentState === "awaiting_customer";
      const expiresAt = awaiting ? nowMs + config.seconds.upiExpiry * 1000 : null;
      await client.query(
        "INSERT INTO orders (id, account_id, address, payable_paise, placed_at, payment_id, emi_tenure_months) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [orderId, accountId, JSON.stringify(address), quote.payablePaise, nowMs, paymentId, input.emiTenure],
      );
      await client.query("INSERT INTO payments (id, order_id, method, status, initiated_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)", [
        paymentId, orderId, method, paymentState, nowMs, expiresAt,
      ]);
      for (const leg of legs) {
        await client.query(
          `INSERT INTO payment_legs (id, payment_id, order_id, shipment_id, method, amount_paise, status, kb_key, kb_recorded, card_last4, card_network)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [leg.id, paymentId, orderId, leg.shipmentId, leg.method, leg.amountPaise, leg.status, leg.key, leg.recorded, leg.last4, leg.network],
        );
      }
      for (const [index, parcel] of quote.parcels.entries()) {
        const shipmentId = shipmentIds[index] as string;
        await client.query(
          `INSERT INTO shipments (id, order_id, seller_id, state, promise_date, speed, delivery_fee_paise, cod_fee_paise, gift_wrap_paise, emi_discount_paise, balance_share_paise)
           VALUES ($1, $2, $3, 'placed', $4, $5, $6, $7, $8, $9, $10)`,
          [
            shipmentId, orderId, parcel.seller.id, parcel.promiseDate, parcel.speed, parcel.deliveryFeePaise, parcel.codFeePaise,
            parcel.lines.filter((line) => line.giftWrap).length * GIFT_WRAP_FEE_PAISE, parcel.lines.reduce((sum, line) => sum + line.emiSharePaise, 0),
            balanceShares[index] as number,
          ],
        );
        await client.query("INSERT INTO shipment_events (shipment_id, state, at) VALUES ($1, 'placed', $2)", [shipmentId, nowMs]);
        for (const line of parcel.lines) {
          await client.query(
            `INSERT INTO shipment_lines (id, shipment_id, listing_id, title, category, quantity, unit_price_paise, coupon_share_paise, line_total_paise, gst_rate,
                taxable_value_paise, cgst_paise, sgst_paise, igst_paise, commission_percent, emi_share_paise, gift_wrap, gift_message)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
            [
              publicId("SL"), shipmentId, line.listing.id, line.product.title, line.category, line.quantity, line.unitPricePaise, line.couponSharePaise,
              line.lineTotalPaise, line.gstRate, line.tax.taxableValuePaise, line.tax.cgstPaise, line.tax.sgstPaise, line.tax.igstPaise,
              line.commissionPercent, line.emiSharePaise, line.giftWrap, line.giftMessage,
            ],
          );
        }
      }
      if (card?.save) {
        await client.query(
          "INSERT INTO cards (id, account_id, network, last4, expiry_month, expiry_year, name) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [publicId("card").toLowerCase(), accountId, card.network, card.last4, card.expiryMonth, card.expiryYear, card.name],
        );
      }
      await client.query("DELETE FROM cart_lines WHERE account_id = $1 AND id = ANY($2)", [accountId, selected.map((line) => line.lineId)]);
      await client.query("UPDATE carts SET coupon_code = NULL, payment_method = NULL, use_balance = false, emi_tenure_months = NULL WHERE account_id = $1", [accountId]);

      const totals = new Map<string, { amount: number; status: string }>();
      for (const leg of legs) totals.set(leg.method, { amount: (totals.get(leg.method)?.amount ?? 0) + leg.amountPaise, status: leg.status });
      return {
        orderId,
        body: {
          order_id: orderId,
          status: awaiting ? "awaiting_payment" : "placed",
          payable_paise: quote.payablePaise,
          shipments: quote.parcels.map((parcel, index) => ({
            shipment_id: shipmentIds[index],
            seller_id: parcel.seller.id,
            seller_name: parcel.seller.name,
            state: "placed",
            promise_date: parcel.promiseDate,
          })),
          payment: {
            payment_id: paymentId,
            status: paymentState,
            expires_at: expiresAt === null ? null : new Date(expiresAt).toISOString(),
            legs: [...totals].map(([legMethod, total]) => ({ method: legMethod, amount_paise: total.amount, status: total.status })),
          },
          confirmation_url: `/orders/${orderId}/placed`,
        },
      };
    });
  } catch (error) {
    await undoRecordedLegs(recorded);
    throw error;
  }
}

/** Documents of a freshly placed order are written right away when payment is confirmed or cash on delivery. */
export async function storeOrderDocuments(orderId: string): Promise<void> {
  for (const shipment of await query<{ id: string }>("SELECT id FROM shipments WHERE order_id = $1", [orderId])) await tryStoreDocuments(shipment.id);
}
