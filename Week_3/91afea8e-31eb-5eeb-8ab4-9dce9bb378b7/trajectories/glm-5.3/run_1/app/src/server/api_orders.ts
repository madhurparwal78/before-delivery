import { Router, type Ctx } from "./http.js";
import { ApiError, copy, forbidden, notFound, signedOut, validationFailed, invalidTransition } from "./errors.js";
import { config } from "./config.js";
import * as auth from "./auth.js";
import { one, query, withTransaction, type PoolClient } from "./db.js";
import { buildQuote, loadCartSettings } from "./quote.js";
import { amount } from "./format.js";
import { id, sha256, canonicalJson, luhn, cardNetwork, verifyPassword } from "./crypto.js";
import { addDays, futureIso, istDateString } from "./time.js";
import { taxSplit, allocate, divRound } from "./money.js";
import { unitPricePaise, settlementLine, proratedRefund, GIFT_WRAP_Paise, COD_FEE_Paise } from "./domain.js";
import { ensureKbAccount, kbRecordPurchase, kbRecordRefund, kbGetPaymentByKey } from "./killbill.js";
import { startUpiCollect, upiStatus, startNetBanking, netBankingStatus } from "./providers.js";
import { readBody, requireAccount, requireFields, str, codePoints, pinRow, bankList, offersForProduct } from "./api_catalog.js";
import { countOpenCod } from "./api_cart.js";
import { buildInvoicePdf, buildLabelPdf } from "./documents.js";
import { putObject, getObject } from "./storage.js";

const router = new Router();
export default router;

// ---------- checkout ----------

interface CheckoutBody {
  address_id?: string;
  expected_payable_paise?: number;
  payment?: {
    method?: string | null;
    use_balance?: boolean;
    upi?: { vpa?: string };
    card?: { saved_card_id?: string; cvv?: string; number?: string; expiry_month?: number; expiry_year?: number; name?: string; save?: boolean };
    netbanking?: { bank_code?: string };
    emi?: { tenure_months?: number; card?: Record<string, unknown> };
  };
}

router.add("POST", "/api/checkout", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const idemKey = ctx.req.headers["idempotency-key"];
  if (typeof idemKey !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(idemKey)) {
    throw new ApiError(428, "idempotency_key_required", copy.idempotencyKeyRequired);
  }
  const body = (await readBody(ctx)) as unknown as CheckoutBody;
  const allowed = new Set(["address_id", "expected_payable_paise", "payment"]);
  const extras = Object.keys(body as Record<string, unknown>).filter((k) => !allowed.has(k));
  if (extras.length > 0) {
    const fields: Record<string, string> = {};
    for (const k of extras) fields[k] = copy.field.cantSet;
    throw validationFailed(fields);
  }
  const requestHash = sha256(canonicalJson(body));
  const accountId = ctx.account!.id;

  const existing = await one<{ request_hash: string; status: number; response_body: unknown; state: string }>(
    "SELECT * FROM idempotency_keys WHERE idem_key = $1 AND account_id = $2", [idemKey, accountId],
  );
  if (existing && existing.state === "done") {
    if (existing.request_hash !== requestHash) {
      throw new ApiError(409, "idempotency_key_reused", copy.idempotencyKeyReused);
    }
    ctx.res.setHeader("Idempotent-Replayed", "true");
    ctx.res.statusCode = existing.status;
    return existing.response_body;
  }
  if (existing && existing.state === "running") {
    // wait for the in-flight request, then return the same result
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const row = await one<{ state: string; status: number; response_body: unknown; request_hash: string }>(
        "SELECT * FROM idempotency_keys WHERE idem_key = $1 AND account_id = $2", [idemKey, accountId],
      );
      if (row && row.state === "done") {
        if (row.request_hash !== requestHash) throw new ApiError(409, "idempotency_key_reused", copy.idempotencyKeyReused);
        ctx.res.setHeader("Idempotent-Replayed", "true");
        ctx.res.statusCode = row.status;
        return row.response_body;
      }
    }
    throw new ApiError(503, "payments_unavailable", copy.paymentsUnavailable);
  }
  await query(
    `INSERT INTO idempotency_keys (idem_key, account_id, request_hash, status, response_body, state, expires_at)
     VALUES ($1,$2,$3,0,'{}'::jsonb,'running', now() + ($4 || ' seconds')::interval)
     ON CONFLICT (idem_key, account_id) DO NOTHING`,
    [idemKey, accountId, requestHash, String(config.timing.idempotencyTtlSeconds)],
  );

  const finish = async (status: number, responseBody: unknown): Promise<unknown> => {
    await query(
      `UPDATE idempotency_keys SET status = $3, response_body = $4, state = 'done' WHERE idem_key = $1 AND account_id = $2`,
      [idemKey, accountId, status, JSON.stringify(responseBody)],
    );
    ctx.res.statusCode = status;
    return responseBody;
  };

  // 1. validate the body
  const settings = await loadCartSettings(accountId);
  const address = body.address_id
    ? await one<{ address_id: string; label: string; name: string; line1: string; line2: string; city: string; state: string; pincode: string; phone: string }>(
        "SELECT * FROM addresses WHERE address_id = $1 AND account_id = $2", [body.address_id, accountId],
      )
    : null;
  if (!address) throw validationFailed({ address_id: "Choose one of your addresses." });

  // 2. re-price
  const quote = await buildQuote(accountId, new Date());
  const selected = quote.lines.filter((l) => l.selected && l.in_stock);
  if (selected.length === 0) throw validationFailed({ cart: copy.emptyCart });
  if (quote.payable_paise !== Number(body.expected_payable_paise)) {
    throw new ApiError(409, "price_changed", copy.priceChanged, { extra: { quote } });
  }

  const payment = body.payment ?? { method: null, use_balance: false };
  const method = payment.method ?? null;
  const useBalance = payment.use_balance === true;
  const payable = quote.payable_paise;
  const balanceAvailable = (await one<{ b: string }>(
    "SELECT balance_paise - balance_hold_paise AS b FROM shoppers WHERE account_id = $1", [accountId]))!;
  const balanceApplied = useBalance ? Math.min(Number(balanceAvailable.b), payable) : 0;
  const due = payable - balanceApplied;

  if (method === "emi" && due < 300000) throw validationFailed({ method: copy.field.emiTooSmall });
  if (method === null && balanceApplied < payable) {
    throw validationFailed({ method: "Choose a payment method." });
  }
  if (useBalance && method === "emi") throw validationFailed({ method: "EMI cannot be combined with balance." });
  if (method === "cod") {
    const problem = await codRefusal(accountId, quote, settings.destination.pincode, due);
    if (problem) throw validationFailed({ method: problem.message ?? "" });
  }

  // 3. claim stock (conditional decrement, never below zero)
  const claims: Array<{ listing_id: string; quantity: number }> = [];
  const failedListings: string[] = [];
  await withTransaction(async (client) => {
    for (const line of selected) {
      const res = await client.query(
        "UPDATE listings SET stock = stock - $2 WHERE listing_id = $1 AND stock >= $2 RETURNING stock",
        [line.listing_id, line.quantity],
      );
      if (res.rows.length === 0) failedListings.push(line.listing_id);
      else claims.push({ listing_id: line.listing_id, quantity: line.quantity });
    }
  });
  if (failedListings.length > 0) {
    await releaseClaims(claims);
    const err = new ApiError(409, "sold_out", copy.soldOutCheckout);
    (err as unknown as { extra: Record<string, unknown> }).extra = { listing_ids: failedListings };
    await finish(409, err.body());
    throw err;
  }

  // 4. hold the balance
  if (balanceApplied > 0) {
    const res = await query(
      "UPDATE shoppers SET balance_hold_paise = balance_hold_paise + $2 WHERE account_id = $1 AND balance_paise - balance_hold_paise >= $2 RETURNING account_id",
      [accountId, balanceApplied],
    );
    if (res.length === 0) {
      await releaseClaims(claims);
      throw validationFailed({ payment: "Not enough balance." });
    }
  }

  // 5. record in Kill Bill every leg that confirms at once
  const orderId = id("CH");
  const kbAccount = await ensureKbAccount(accountId, ctx.account!.name);
  const legs: Array<{ method: string; amount: number; kbTxnKey: string; status: string; kbPaymentId: string | null; shipmentId: string | null }> = [];
  const undoLegs: Array<{ kbPaymentId: string | null; amount: number; kbTxnKey: string }> = [];

  const failure = async (code: string, message: string): Promise<never> => {
    for (const leg of undoLegs) {
      if (leg.kbPaymentId) await kbRecordRefund(leg.kbPaymentId, leg.amount, `${leg.kbTxnKey}-undo`);
    }
    await query("UPDATE shoppers SET balance_hold_paise = greatest(balance_hold_paise - $2, 0) WHERE account_id = $1", [accountId, balanceApplied]);
    await releaseClaims(claims);
    const err = new ApiError(503, code, message);
    await finish(503, err.body());
    throw err;
  };

  if (balanceApplied > 0 && kbAccount) {
    const leg = { method: "balance", amount: balanceApplied, kbTxnKey: `${orderId}-balance`, status: "pending", kbPaymentId: null as string | null, shipmentId: null as string | null };
    const recorded = await kbRecordPurchase(kbAccount, balanceApplied, `${orderId}-balance`, `${orderId}-balance`);
    if (!recorded.ok) await failure("payments_unavailable", copy.paymentsUnavailable);
    leg.kbPaymentId = recorded.paymentId;
    leg.status = "confirmed";
    legs.push(leg);
    undoLegs.push({ kbPaymentId: recorded.paymentId, amount: balanceApplied, kbTxnKey: `${orderId}-balance` });
  } else if (balanceApplied > 0 && !kbAccount) {
    await failure("payments_unavailable", copy.paymentsUnavailable);
  }

  let awaitingProvider: "upi" | "netbanking" | null = null;
  let expiresAt: Date | null = null;
  let cardInfo: { network: string; last4: string; expiry_month: number; expiry_year: number; name: string } | null = null;

  if (method === "card" && due > 0) {
    const card = payment.card ?? {};
    if (card.saved_card_id) {
      const saved = await one<{ card_id: string; network: string; last4: string; expiry_month: number; expiry_year: number; name: string }>(
        "SELECT * FROM saved_cards WHERE card_id = $1 AND account_id = $2", [card.saved_card_id, accountId],
      );
      if (!saved || !/^\d{3}$/.test(card.cvv ?? "")) throw validationFailed({ card: "Enter the CVV." });
      cardInfo = { network: saved.network, last4: saved.last4, expiry_month: saved.expiry_month, expiry_year: saved.expiry_year, name: saved.name };
    } else {
      const number = str(card.number);
      const network = cardNetwork(number);
      if (!luhn(number) || !network) throw validationFailed({ card: copy.field.unknownNetwork });
      const expiryMonth = Number(card.expiry_month);
      const expiryYear = Number(card.expiry_year);
      const now = new Date();
      if (expiryYear < now.getFullYear() || (expiryYear === now.getFullYear() && expiryMonth < now.getMonth() + 1)) {
        throw validationFailed({ card: "That card has expired." });
      }
      if (!/^\d{3}$/.test(card.cvv ?? "")) throw validationFailed({ card: "Enter the CVV." });
      cardInfo = { network, last4: number.slice(-4), expiry_month: expiryMonth, expiry_year: expiryYear, name: str(card.name) };
      if (card.save === true) {
        await query(
          `INSERT INTO saved_cards (card_id, account_id, network, last4, expiry_month, expiry_year, name, created_seq)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (card_id) DO NOTHING`,
          [id("CARD"), accountId, network, number.slice(-4), expiryMonth, expiryYear, str(card.name), Date.now()],
        );
      }
    }
    if (kbAccount) {
      const leg = { method: "card", amount: due, kbTxnKey: `${orderId}-card`, status: "pending", kbPaymentId: null as string | null, shipmentId: null as string | null };
      const recorded = await kbRecordPurchase(kbAccount, due, `${orderId}-card`, `${orderId}-card`);
      if (!recorded.ok) await failure("payments_unavailable", copy.paymentsUnavailable);
      leg.kbPaymentId = recorded.paymentId;
      leg.status = "confirmed";
      legs.push(leg);
      undoLegs.push({ kbPaymentId: recorded.paymentId, amount: due, kbTxnKey: `${orderId}-card` });
    } else {
      await failure("payments_unavailable", copy.paymentsUnavailable);
    }
  } else if (method === "emi" && due > 0) {
    const tenure = Number(payment.emi?.tenure_months);
    if (![3, 6, 9, 12].includes(tenure)) throw validationFailed({ method: "Tenure is 3, 6, 9 or 12 months." });
    const card = payment.emi?.card ?? {};
    const number = str(card.number);
    const network = cardNetwork(number);
    if (!luhn(number) || !network) throw validationFailed({ card: copy.field.unknownNetwork });
    cardInfo = { network: network, last4: number.slice(-4), expiry_month: Number(card.expiry_month), expiry_year: Number(card.expiry_year), name: str(card.name) };
    if (kbAccount) {
      const leg = { method: "emi", amount: due, kbTxnKey: `${orderId}-emi`, status: "pending", kbPaymentId: null as string | null, shipmentId: null as string | null };
      const recorded = await kbRecordPurchase(kbAccount, due, `${orderId}-emi`, `${orderId}-emi`);
      if (!recorded.ok) await failure("payments_unavailable", copy.paymentsUnavailable);
      leg.kbPaymentId = recorded.paymentId;
      leg.status = "confirmed";
      legs.push(leg);
      undoLegs.push({ kbPaymentId: recorded.paymentId, amount: due, kbTxnKey: `${orderId}-emi` });
    } else {
      await failure("payments_unavailable", copy.paymentsUnavailable);
    }
  } else if (method === "upi" && due > 0) {
    const vpa = str(payment.upi?.vpa);
    if (!/^[^\s@]{2,256}@[^\s@]{2,}$/.test(vpa)) throw validationFailed({ upi: "Enter a UPI ID like name@bank." });
    const paymentId = id("PAY");
    expiresAt = new Date(Date.now() + config.timing.upiExpirySeconds * 1000);
    const status = await startUpiCollect(paymentId, vpa, due, config.timing.upiExpirySeconds);
    if (status === null) await failure("upi_unavailable", copy.upiUnavailable);
    if (status === "SUCCESS") {
      if (kbAccount) {
        const leg = { method: "upi", amount: due, kbTxnKey: `${orderId}-upi`, status: "pending", kbPaymentId: null as string | null, shipmentId: null as string | null };
        const recorded = await kbRecordPurchase(kbAccount, due, `${orderId}-upi`, `${orderId}-upi`);
        if (!recorded.ok) await failure("payments_unavailable", copy.paymentsUnavailable);
        leg.kbPaymentId = recorded.paymentId; leg.status = "confirmed";
        legs.push(leg);
      } else {
        await failure("payments_unavailable", copy.paymentsUnavailable);
      }
    } else {
      awaitingProvider = "upi";
    }
    if (awaitingProvider === "upi") {
      legs.push({ method: "upi", amount: due, kbTxnKey: `${orderId}-upi`, status: "awaiting_customer", kbPaymentId: null, shipmentId: null });
    }
  } else if (method === "netbanking" && due > 0) {
    const bankCode = str(payment.netbanking?.bank_code);
    if (!bankList().some((b) => b.code === bankCode)) throw validationFailed({ netbanking: "Choose a published bank." });
    const paymentId = id("PAY");
    expiresAt = new Date(Date.now() + config.timing.upiExpirySeconds * 1000);
    const status = await startNetBanking(paymentId, bankCode, due);
    if (status === null) await failure("netbanking_unavailable", copy.netbankingUnavailable);
    if (status === "SUCCESS") {
      if (kbAccount) {
        const leg = { method: "netbanking", amount: due, kbTxnKey: `${orderId}-netbanking`, status: "pending", kbPaymentId: null as string | null, shipmentId: null as string | null };
        const recorded = await kbRecordPurchase(kbAccount, due, `${orderId}-netbanking`, `${orderId}-netbanking`);
        if (!recorded.ok) await failure("payments_unavailable", copy.paymentsUnavailable);
        leg.kbPaymentId = recorded.paymentId; leg.status = "confirmed";
        legs.push(leg);
      } else {
        await failure("payments_unavailable", copy.paymentsUnavailable);
      }
    } else {
      awaitingProvider = "netbanking";
      legs.push({ method: "netbanking", amount: due, kbTxnKey: `${orderId}-netbanking`, status: "awaiting_customer", kbPaymentId: null, shipmentId: null });
    }
  } else if ((method === null || method === "cod") && due > 0 && method !== null) {
    // COD: no provider call at checkout
    legs.push({ method: "cod", amount: due, kbTxnKey: `${orderId}-cod`, status: "pending", kbPaymentId: null, shipmentId: null });
  } else if (method === null && due === 0) {
    // balance covers everything: no other leg
  } else if (due > 0 && method === null) {
    await releaseClaims(claims);
    const err = validationFailed({ method: "Choose a payment method." });
    await finish(422, err.body());
    throw err;
  }

  // 7. commit the order with one shipment per seller
  const sellerGroups = new Map<string, typeof selected>();
  for (const line of selected) {
    const group = sellerGroups.get(line.seller_id) ?? [];
    group.push(line);
    sellerGroups.set(line.seller_id, group);
  }
  const pinR = await pinRow(settings.destination.pincode);
  const sellerRows = await query<{ seller_id: string; name: string; pickup_city: string; pickup_state: string; dispatch_days: number; ship_states: string[]; ship_all_states: boolean }>("SELECT * FROM sellers");
  const sellerMap = new Map(sellerRows.map((s) => [s.seller_id, s]));

  const shipments: Array<{ shipment_id: string; seller_id: string; seller_name: string; state: string; promise_date: string }> = [];
  let created: { orderId: string; paymentId: string } | null = null;

  try {
    created = await withTransaction(async (client) => {
      const paymentId = id("PAY");
      await client.query(
        `INSERT INTO orders (order_id, account_id, address_id, address_snapshot, placed_at, status, payable_paise,
          subtotal_paise, discount_paise, gift_wrap_paise, delivery_paise, cod_fee_paise, emi_discount_paise,
          balance_applied_paise, due_paise, coupon_code, pincode, idem_key, created_seq)
         VALUES ($1,$2,$3,$4,now(),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [orderId, accountId, address.address_id, JSON.stringify(address), method === "cod" ? "placed" : (awaitingProvider ? "awaiting_payment" : "placed"),
         payable, quote.subtotal_paise, quote.discount_paise, quote.gift_wrap_paise, quote.delivery_paise,
         quote.cod_fee_paise, quote.emi_discount_paise, balanceApplied, due, quote.coupon?.code ?? null,
         address.pincode, idemKey, Date.now()],
      );
      await client.query(
        `INSERT INTO payments (payment_id, order_id, method, status, expires_at, initiated_at, use_balance, emi_tenure_months)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [paymentId, orderId, method ?? "balance", awaitingProvider ? "awaiting_customer" : "confirmed", expiresAt, expiresAt ? new Date() : null, useBalance, method === "emi" ? Number(payment.emi?.tenure_months) : null],
      );
      let shipSeq = 1;
      for (const [sellerId, lines] of sellerGroups) {
        const seller = sellerMap.get(sellerId)!;
        const parcel = quote.parcels.find((p) => p.seller_id === sellerId);
        const shipmentId = `SH-${orderId.slice(3)}-${shipSeq}`;
        const promise = parcel?.promise_date ?? addDays(istDateString(), 7);
        await client.query(
          `INSERT INTO shipments (shipment_id, order_id, seller_id, state, promise_date, speed, delivery_fee_paise,
             cod_fee_paise, gift_wrap_paise, created_seq)
           VALUES ($1,$2,$3,'placed',$4,$5,$6,$7,$8,$9)`,
          [shipmentId, orderId, sellerId, promise, parcel?.speed ?? "standard", parcel?.delivery_fee_paise ?? 0,
           method === "cod" ? COD_FEE_Paise : 0, lines.filter((l) => l.gift_wrap).length * GIFT_WRAP_Paise, Date.now() + shipSeq],
        );
        await client.query("INSERT INTO shipment_timeline (shipment_id, state, at) VALUES ($1,'placed',now())", [shipmentId]);
        for (const line of lines) {
          const intraState = pinR?.state ? seller.pickup_state === pinR.state : false;
          const split = taxSplit(line.line_total_paise, line.gst_rate, intraState);
          const category = await client.query("SELECT return_days FROM categories WHERE slug = (SELECT category FROM products WHERE product_id = $1)", [line.product_id]);
          const returnDays = category.rows[0]?.return_days ?? 0;
          await client.query(
            `INSERT INTO shipment_lines (line_id, shipment_id, listing_id, title, quantity, unit_price_paise,
              coupon_share_paise, line_total_paise, gst_rate, taxable_value_paise, cgst_paise, sgst_paise, igst_paise, returnable_until, created_seq)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [id("SL"), shipmentId, line.listing_id, line.title, line.quantity, line.unit_price_paise,
             line.coupon_share_paise, line.line_total_paise, line.gst_rate, split.taxableValuePaise,
             split.cgstPaise, split.sgstPaise, split.igstPaise,
             returnDays > 0 ? addDays(istDateString(), returnDays) : null, Date.now()],
          );
          if (line.gift_wrap && line.gift_message) {
            await client.query("INSERT INTO gift_messages (shipment_line_id, message) VALUES ($1,$2)", [id("SL"), line.gift_message]);
          }
        }
        shipments.push({ shipment_id: shipmentId, seller_id: sellerId, seller_name: seller.name, state: "placed", promise_date: promise });
        shipSeq++;
      }
      // legs
      for (const leg of legs) {
        await client.query(
          `INSERT INTO payment_legs (leg_id, payment_id, method, amount_paise, status, kb_payment_id, kb_txn_key, shipment_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)`,
          [id("PL"), paymentId, leg.method, leg.amount, leg.status, leg.kbPaymentId, leg.kbTxnKey],
        );
      }
      // checked-out lines leave the cart
      await client.query("DELETE FROM cart_lines WHERE account_id = $1 AND line_id = ANY($2::text[])", [accountId, selected.map((l) => l.line_id)]);
      // balance is spent
      if (balanceApplied > 0) {
        await client.query(
          "UPDATE shoppers SET balance_paise = balance_paise - $2, balance_hold_paise = greatest(balance_hold_paise - $2, 0) WHERE account_id = $1",
          [accountId, balanceApplied],
        );
      }
      return { orderId, paymentId };
    });
  } catch (e) {
    for (const leg of undoLegs) {
      if (leg.kbPaymentId) await kbRecordRefund(leg.kbPaymentId, leg.amount, `${leg.kbTxnKey}-undo`);
    }
    await releaseClaims(claims);
    await query("UPDATE shoppers SET balance_hold_paise = greatest(balance_hold_paise - $2, 0) WHERE account_id = $1", [accountId, balanceApplied]);
    throw e;
  }

  const responseBody = {
    order_id: created.orderId,
    status: awaitingProvider ? "awaiting_payment" : "placed",
    payable_paise: payable,
    shipments,
    payment: {
      payment_id: created.paymentId,
      status: awaitingProvider ? "awaiting_customer" : "confirmed",
      expires_at: expiresAt ? futureIso(expiresAt.getTime()) : null,
      legs: legs.map((l) => ({ method: l.method, amount_paise: l.amount, status: l.status })),
    },
    confirmation_url: `/orders/${created.orderId}/placed`,
  };
  return finish(201, responseBody);
});

async function releaseClaims(claims: Array<{ listing_id: string; quantity: number }>): Promise<void> {
  for (const claim of claims) {
    await query("UPDATE listings SET stock = stock + $2 WHERE listing_id = $1", [claim.listing_id, claim.quantity]);
  }
}

async function codRefusal(accountId: string, quote: Awaited<ReturnType<typeof buildQuote>>, pincode: string, cashPaise: number): Promise<{ reason: string; message: string } | null> {
  const pinR = await pinRow(pincode);
  const sellers = await query<{ seller_id: string; name: string; cod_allowed: boolean }>("SELECT seller_id, name, cod_allowed FROM sellers");
  const sellerMap = new Map(sellers.map((s) => [s.seller_id, s]));
  for (const line of quote.lines.filter((l) => l.selected && l.in_stock)) {
    const listing = await one<{ seller_id: string; cod_allowed: boolean }>("SELECT seller_id, cod_allowed FROM listings WHERE listing_id = $1", [line.listing_id]);
    const seller = sellerMap.get(listing?.seller_id ?? "");
    if (listing && (!listing.cod_allowed || !seller?.cod_allowed)) {
      return { reason: "cod_seller", message: copy.codSeller(seller?.name ?? "") };
    }
  }
  if (!pinR || !pinR.cod_available) return { reason: "cod_pincode", message: copy.codPincode(pincode) };
  const open = await countOpenCod(accountId);
  if (open >= 3) return { reason: "cod_open_orders", message: copy.codOpenOrders };
  if (cashPaise > 5000000) return { reason: "cod_over_cap", message: copy.codOverCap };
  return null;
}

// ---------- payments ----------

router.add("GET", "/api/payments/:payment_id", async (ctx) => {
  requireAccount(ctx);
  const payment = await one<{ payment_id: string; order_id: string; method: string; status: string; expires_at: string | null }>(
    "SELECT * FROM payments WHERE payment_id = $1", [ctx.params.payment_id],
  );
  if (!payment) throw notFound();
  const order = await one<{ account_id: string }>("SELECT account_id FROM orders WHERE order_id = $1", [payment.order_id]);
  if (!order || order.account_id !== ctx.account!.id) throw notFound();
  const legs = await query<{ method: string; amount_paise: string; status: string }>(
    "SELECT method, amount_paise, status FROM payment_legs WHERE payment_id = $1", [payment.payment_id]);
  return {
    payment_id: payment.payment_id, method: payment.method, status: payment.status,
    expires_at: payment.expires_at ? futureIso(new Date(payment.expires_at).getTime()) : null,
    legs: legs.map((l) => ({ method: l.method, amount_paise: Number(l.amount_paise), status: l.status })),
  };
});

// ---------- orders ----------

router.add("GET", "/api/orders", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const limit = Number(ctx.query.get("limit") ?? "24");
  if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw validationFailed({ limit: copy.field.badPageSize });
  const cursor = ctx.query.get("cursor");
  let where = "";
  const params: unknown[] = [ctx.account!.id];
  if (cursor) {
    const lastSeq = Number(Buffer.from(cursor, "base64url").toString("utf8")) || 0;
    where = ` AND created_seq < ${lastSeq}`;
    params.push(lastSeq);
  }
  const rows = await query<{ order_id: string; placed_at: string; payable_paise: string; created_seq: string }>(`
    SELECT order_id, placed_at, payable_paise, created_seq FROM orders
    WHERE account_id = $1${where ? " AND created_seq < $2" : ""}
    ORDER BY created_seq DESC LIMIT ${limit + 1}`, params);
  const page = rows.slice(0, limit);
  const shipmentCounts = page.length ? await query<{ order_id: string; n: string; states: string[] }>(`
    SELECT order_id, count(*) AS n, array_agg(state ORDER BY created_seq) AS states FROM shipments
    WHERE order_id = ANY($1::text[]) GROUP BY order_id`, [page.map((o) => o.order_id)]) : [];
  const countMap = new Map(shipmentCounts.map((c) => [c.order_id, c]));
  return {
    orders: page.map((o) => ({
      order_id: o.order_id, placed_at: o.placed_at, payable_paise: Number(o.payable_paise),
      shipment_count: Number(countMap.get(o.order_id)?.n ?? 0),
      shipment_states: countMap.get(o.order_id)?.states ?? [],
    })),
    next_cursor: rows.length > limit ? Buffer.from(String(page[page.length - 1].created_seq)).toString("base64url") : null,
  };
});

router.add("GET", "/api/orders/:order_id", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const order = await one<{ order_id: string; account_id: string; placed_at: string; address_id: string; address_snapshot: Record<string, unknown>; payable_paise: string }>(
    "SELECT * FROM orders WHERE order_id = $1", [ctx.params.order_id]);
  if (!order || order.account_id !== ctx.account!.id) throw notFound();
  const payment = await one<{ payment_id: string; method: string; status: string; expires_at: string | null }>(
    "SELECT * FROM payments WHERE order_id = $1", [order.order_id]);
  const shipments = await shipmentViewsForOrder(order.order_id);
  return {
    order_id: order.order_id, placed_at: order.placed_at,
    address: order.address_snapshot,
    payment: payment ? {
      payment_id: payment.payment_id, method: payment.method, status: payment.status,
      expires_at: payment.expires_at ? futureIso(new Date(payment.expires_at).getTime()) : null,
      legs: (await query<{ method: string; amount_paise: string; status: string }>(
        "SELECT method, amount_paise, status FROM payment_legs WHERE payment_id = $1", [payment.payment_id]))
        .map((l) => ({ method: l.method, amount_paise: Number(l.amount_paise), status: l.status })),
    } : null,
    shipments,
    payable_paise: Number(order.payable_paise),
  };
});

export async function shipmentViewsForOrder(orderId: string): Promise<unknown[]> {
  const shipments = await query<{ shipment_id: string; order_id: string; seller_id: string; state: string; promise_date: string; delivery_fee_paise: string; cod_fee_paise: string; gift_wrap_paise: string; invoice_status: string }>(
    "SELECT * FROM shipments WHERE order_id = $1 ORDER BY created_seq", [orderId]);
  const sellerRows = await query<{ seller_id: string; name: string }>("SELECT seller_id, name FROM sellers");
  const sellerNames = new Map(sellerRows.map((s) => [s.seller_id, s.name]));
  const views = [];
  for (const s of shipments) {
    const timeline = await query<{ state: string; at: string }>(
      "SELECT state, at FROM shipment_timeline WHERE shipment_id = $1 ORDER BY at", [s.shipment_id]);
    const lines = await query<{ line_id: string; title: string; quantity: number; unit_price_paise: string; coupon_share_paise: string; line_total_paise: string; gst_rate: number; taxable_value_paise: string; cgst_paise: string; sgst_paise: string; igst_paise: string; returnable_until: string | null }>(
      "SELECT * FROM shipment_lines WHERE shipment_id = $1 ORDER BY created_seq", [s.shipment_id]);
    const refunds = await query<{ line_id: string; state: string; amount_paise: string }>(`
      SELECT sl.line_id, r.state, r.amount_paise FROM refunds r
      JOIN shipment_lines sl ON sl.line_id = r.shipment_line_id
      WHERE sl.shipment_id = $1`, [s.shipment_id]);
    const lineViews = [];
    for (const line of lines) {
      const refunded = refunds.filter((r) => r.state === "confirmed" && r.line_id === line.line_id).reduce((a, r) => a + Number(r.amount_paise), 0);
      const pending = refunds.filter((r) => r.state !== "confirmed" && r.state !== "declined" && r.line_id === line.line_id).reduce((a, r) => a + Number(r.amount_paise), 0);
      lineViews.push({
        line_id: line.line_id, title: line.title, quantity: line.quantity,
        unit_price_paise: Number(line.unit_price_paise), coupon_share_paise: Number(line.coupon_share_paise),
        line_total_paise: Number(line.line_total_paise), gst_rate: line.gst_rate,
        taxable_value_paise: Number(line.taxable_value_paise), cgst_paise: Number(line.cgst_paise),
        sgst_paise: Number(line.sgst_paise), igst_paise: Number(line.igst_paise),
        returnable_until: dateOnly(line.returnable_until), refunded_paise: refunded, refund_pending_paise: pending,
      });
    }
    views.push({
      shipment_id: s.shipment_id, order_id: s.order_id, seller_name: sellerNames.get(s.seller_id) ?? "",
      state: s.state, promise_date: dateOnly(s.promise_date),
      timeline: timeline.map((t) => ({ state: t.state, at: t.at })),
      delivery_fee_paise: Number(s.delivery_fee_paise), cod_fee_paise: Number(s.cod_fee_paise),
      gift_wrap_paise: Number(s.gift_wrap_paise), invoice_status: s.invoice_status,
      lines: lineViews,
    });
  }
  return views;
}

router.add("GET", "/api/shipments/:shipment_id", async (ctx) => {
  requireAccount(ctx);
  const shipment = await one<{ shipment_id: string; order_id: string; seller_id: string }>(
    "SELECT shipment_id, order_id, seller_id FROM shipments WHERE shipment_id = $1", [ctx.params.shipment_id]);
  if (!shipment) throw notFound();
  const order = await one<{ account_id: string }>("SELECT account_id FROM orders WHERE order_id = $1", [shipment.order_id]);
  if (!order) throw notFound();
  const isOwner = order.account_id === ctx.account!.id;
  const isSeller = ctx.account!.role === "seller" && (await one<{ seller_id: string }>("SELECT seller_id FROM sellers WHERE seller_id = $1", [shipment.seller_id])) !== null;
  if (isOwner) {
    const views = await shipmentViewsForOrder(shipment.order_id);
    return views.find((v) => (v as { shipment_id: string }).shipment_id === shipment.shipment_id);
  }
  if (isSeller) {
    return sellerShipmentView(shipment.shipment_id);
  }
  throw notFound();
});

export async function sellerShipmentView(shipmentId: string): Promise<Record<string, unknown>> {
  const shipment = await one<{ shipment_id: string; order_id: string; seller_id: string; state: string; promise_date: string; delivery_fee_paise: string; cod_fee_paise: string; invoice_status: string; label_status: string }>(
    "SELECT * FROM shipments WHERE shipment_id = $1", [shipmentId]);
  if (!shipment) throw notFound();
  const order = await one<{ address_snapshot: Record<string, unknown>; account_id: string; payable_paise: string }>("SELECT * FROM orders WHERE order_id = $1", [shipment.order_id]);
  const payment = await one<{ method: string }>("SELECT method FROM payments WHERE order_id = $1", [shipment.order_id]);
  const lines = await query<{ line_id: string; listing_id: string; title: string; quantity: number; unit_price_paise: string }>(
    "SELECT * FROM shipment_lines WHERE shipment_id = $1 ORDER BY created_seq", [shipmentId]);
  const kbStatus = await shipmentPaymentStatus(shipment);
  const address = order!.address_snapshot as { name: string; city: string; pincode: string };
  return {
    shipment_id: shipment.shipment_id, order_id: shipment.order_id, state: shipment.state,
    promise_date: dateOnly(shipment.promise_date),
    ship_to: { name: address.name, city: address.city, pincode: address.pincode },
    payment_kind: payment?.method === "cod" ? "cod" : "prepaid",
    payment_status: kbStatus,
    invoice_status: shipment.invoice_status,
    label_status: shipment.label_status,
    lines: lines.map((l) => ({
      line_id: l.line_id, listing_id: l.listing_id, title: l.title, quantity: l.quantity,
      unit_price_paise: Number(l.unit_price_paise), gross_paise: Number(l.unit_price_paise) * l.quantity,
    })),
  };
}

/** A shipment's payment is paid only after every covering leg has a successful PURCHASE. */
async function shipmentPaymentStatus(shipment: { shipment_id: string; order_id: string }): Promise<string> {
  const legs = await query<{ method: string; status: string; kb_payment_id: string | null }>(
    "SELECT method, status, kb_payment_id FROM payment_legs WHERE payment_id = (SELECT payment_id FROM payments WHERE order_id = $1)",
    [shipment.order_id]);
  const cod = await one<{ method: string }>("SELECT method FROM payments WHERE order_id = $1", [shipment.order_id]);
  if (cod?.method === "cod") {
    const delivered = await one<{ state: string }>("SELECT state FROM shipments WHERE shipment_id = $1", [shipment.shipment_id]);
    return delivered?.state === "delivered" ? "paid" : "pending";
  }
  let sawPending = false;
  let sawRefund = false;
  for (const leg of legs) {
    if (leg.kb_payment_id) {
      const { kbRefundedAmount } = await import("./killbill.js");
      const refunded = await kbRefundedAmount(leg.kb_payment_id);
      if (refunded !== null && refunded > 0) sawRefund = true;
    }
    if (leg.status !== "confirmed") sawPending = true;
  }
  if (sawPending) return "pending";
  if (sawRefund) return "refunded";
  return "paid";
}

router.add("POST", "/api/shipments/:shipment_id/cancel", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const shipment = await one<{ shipment_id: string; order_id: string; state: string; delivery_fee_paise: string }>(
    "SELECT * FROM shipments WHERE shipment_id = $1", [ctx.params.shipment_id]);
  if (!shipment) throw notFound();
  const order = await one<{ account_id: string }>("SELECT account_id FROM orders WHERE order_id = $1", [shipment.order_id]);
  if (!order || order.account_id !== ctx.account!.id) throw notFound();
  if (shipment.state !== "placed" && shipment.state !== "packed") {
    throw invalidTransition(shipment.state, "cancelled");
  }
  await withTransaction(async (client) => {
    await client.query("UPDATE shipments SET state = 'cancelled' WHERE shipment_id = $1", [shipment.shipment_id]);
    await client.query("INSERT INTO shipment_timeline (shipment_id, state, at) VALUES ($1,'cancelled',now()) ON CONFLICT DO NOTHING", [shipment.shipment_id]);
    const lines = await client.query("SELECT listing_id, quantity FROM shipment_lines WHERE shipment_id = $1", [shipment.shipment_id]);
    for (const line of lines.rows as Array<{ listing_id: string; quantity: number }>) {
      await client.query("UPDATE listings SET stock = stock + $2 WHERE listing_id = $1", [line.listing_id, line.quantity]);
    }
  });
  const views = await shipmentViewsForOrder(shipment.order_id);
  return views.find((v) => (v as { shipment_id: string }).shipment_id === shipment.shipment_id);
});

router.add("GET", "/api/shipments/:shipment_id/invoice", async (ctx) => {
  requireAccount(ctx);
  const shipment = await one<{ shipment_id: string; order_id: string; seller_id: string }>(
    "SELECT * FROM shipments WHERE shipment_id = $1", [ctx.params.shipment_id]);
  if (!shipment) throw notFound();
  const order = await one<{ account_id: string }>("SELECT account_id FROM orders WHERE order_id = $1", [shipment.order_id]);
  const isOwner = order?.account_id === ctx.account!.id;
  const isSupport = ctx.account!.role === "support";
  const isSeller = ctx.account!.role === "seller" && (await one<{ seller_id: string }>("SELECT seller_id FROM sellers WHERE seller_id = $1", [shipment.seller_id])) !== null;
  if (!isOwner && !isSupport && !isSeller) throw notFound();
  const key = `invoices/${shipment.order_id}/${shipment.shipment_id}.pdf`;
  const doc = await one<{ object_key: string }>("SELECT object_key FROM documents WHERE object_key = $1", [key]);
  if (!doc) {
    const err = new ApiError(409, "document_pending", copy.documentPending);
    throw err;
  }
  const bytes = await getObject(key);
  if (!bytes) throw new ApiError(409, "document_pending", copy.documentPending);
  ctx.res.setHeader("Content-Type", "application/pdf");
  return bytes;
});

// ---------- returns ----------

router.add("POST", "/api/returns", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const body = await readBody(ctx);
  requireFields(body, ["shipment_line_id", "quantity", "reason"]);
  const lineId = str(body.shipment_line_id);
  const quantity = Number(body.quantity);
  const reason = str(body.reason);
  const fields: Record<string, string> = {};
  if (codePoints(reason) > 500) fields.reason = copy.field.maxLength("Reason", 500);
  if (!Number.isInteger(quantity) || quantity < 1) fields.quantity = "Return at least 1 unit.";
  if (Object.keys(fields).length) throw validationFailed(fields);
  const line = await one<{ line_id: string; shipment_id: string; quantity: number; line_total_paise: string; title: string }>(
    "SELECT * FROM shipment_lines WHERE line_id = $1", [lineId]);
  if (!line) throw notFound();
  const shipment = await one<{ shipment_id: string; order_id: string; state: string; delivered_on: string | null }>(
    "SELECT * FROM shipments WHERE shipment_id = $1", [line.shipment_id]);
  const order = await one<{ account_id: string }>("SELECT account_id FROM orders WHERE order_id = $1", [shipment!.order_id]);
  if (!order || order.account_id !== ctx.account!.id) throw notFound();
  if (shipment!.state !== "delivered") throw invalidTransition(shipment!.state, "return requested");
  const category = await one<{ return_days: number }>(`
    SELECT c.return_days FROM shipment_lines sl
    JOIN listings l ON l.listing_id = sl.listing_id
    JOIN products p ON p.product_id = l.product_id
    JOIN categories c ON c.slug = p.category WHERE sl.line_id = $1`, [lineId]);
  if ((category?.return_days ?? 0) === 0) throw new ApiError(409, "not_returnable", copy.notReturnable);
  const returnableUntil = await one<{ returnable_until: string | null }>("SELECT returnable_until FROM shipment_lines WHERE line_id = $1", [lineId]);
  if (!returnableUntil?.returnable_until || istDateString() > returnableUntil.returnable_until) {
    const { dateLabel } = await import("./format.js");
    throw new ApiError(409, "return_window_closed", copy.returnWindowClosed(dateOnly(returnableUntil?.returnable_until) ?? istDateString()));
  }
  const refunded = await query<{ state: string; quantity: number }>(
    "SELECT state, quantity FROM returns WHERE shipment_line_id = $1", [lineId]);
  const returnedUnits = refunded.filter((r) => r.state !== "declined").reduce((a, r) => a + r.quantity, 0);
  const remainingUnits = line.quantity - returnedUnits;
  if (quantity > remainingUnits) throw validationFailed({ quantity: `Only ${remainingUnits} units can still be refunded.` });
  const already = refunded.filter((r) => r.state === "confirmed").reduce((a, r) => a + 0, 0);
  const estimate = proratedRefund(Number(line.line_total_paise), quantity, line.quantity, already);
  const returnId = id("RET");
  await query(
    `INSERT INTO returns (return_id, shipment_line_id, shipment_id, order_id, account_id, state, quantity, reason, refund_estimate_paise)
     VALUES ($1,$2,$3,$4,$5,'requested',$6,$7,$8)`,
    [returnId, lineId, shipment!.shipment_id, shipment!.order_id, ctx.account!.id, quantity, reason, estimate],
  );
  ctx.res.statusCode = 201;
  return { return_id: returnId, state: "requested", quantity, refund_estimate_paise: estimate };
});

router.add("GET", "/api/returns/:return_id", async (ctx) => {
  requireAccount(ctx);
  const ret = await one<{ return_id: string; state: string; quantity: number; refund_estimate_paise: string; decline_reason: string; account_id: string; shipment_id: string }>(
    "SELECT * FROM returns WHERE return_id = $1", [ctx.params.return_id]);
  if (!ret) throw notFound();
  const shipment = await one<{ order_id: string }>("SELECT order_id FROM shipments WHERE shipment_id = $1", [ret.shipment_id]);
  const order = await one<{ account_id: string }>("SELECT account_id FROM orders WHERE order_id = $1", [shipment!.order_id]);
  const isOwner = order?.account_id === ctx.account!.id;
  const isSupport = ctx.account!.role === "support";
  if (!isOwner && !isSupport) throw notFound();
  const legs = await query<{ method: string; amount_paise: string; status: string }>(
    "SELECT method, amount_paise, status FROM refund_legs WHERE refund_id = $1", [ret.return_id]);
  const confirmed = legs.filter((l) => l.status === "confirmed").reduce((a, l) => a + Number(l.amount_paise), 0);
  return {
    return_id: ret.return_id, state: ret.state, quantity: ret.quantity,
    refund_paise: confirmed > 0 ? confirmed : Number(ret.refund_estimate_paise),
    refund_legs: legs.map((l) => ({ method: l.method, amount_paise: Number(l.amount_paise), status: l.status })),
    decline_reason: ret.decline_reason,
  };
});

/** Postgres date columns arrive as Date or string; the API publishes plain YYYY-MM-DD. */
export function dateOnly(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const d = new Date(value.getTime() + 5.5 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
