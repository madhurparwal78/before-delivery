// Money actions: payments, reversals, buyout and size exchange.
// Every action runs inside one transaction, one contract at a time: the
// remaining balance is checked before any Kill Bill charge, Kill Bill
// transactions are adopted by their external key, and the idempotency row
// commits with the action so in-flight copies wait and replay.
import type { ApiRequest, JsonResponseBody } from "../http/server.js";
import type { RouteRegistrar } from "./routes.js";
import { loadContract, familyContact, isoSecond } from "./routes.js";
import { boundPriceList, ensureSubscriptionCancelled } from "./contracts.js";
import { ApiError } from "../errors.js";
import { serializeContract } from "../serialize.js";
import { appendHistory, equityOf, nextLedgerSeq, sweepExpiredContracts } from "../domain/contractState.js";
import { itemFor, priceListInForceOn } from "../domain/priceLists.js";
import { splitPayment } from "../domain/payments.js";
import { quoteForMonth } from "../domain/quotes.js";
import { formatMoney, formatTaxPercent } from "../domain/money.js";
import { instrumentLabel, SIZES_BY_TYPE, SIZE_ORDER, type InstrumentType, type Size } from "../../shared/domain.js";
import { lockContract, requireUser, storeToday } from "./helpers.js";
import { IdempotencyStore, validateIdempotencyKey } from "../idempotency.js";
import { KillBillError, KillBillUnavailable } from "../services/killbill.js";
import { billOfSaleKey } from "../services/storage.js";
import { billOfSalePdf } from "../services/pdfgen.js";
import { formatStoreDateTime } from "./format.js";
import { nextDeliveryDay } from "../domain/delivery.js";
import { randomToken } from "../auth.js";
import type { PoolClient } from "pg";

const idempotency = new IdempotencyStore();

type Outcome = { ok: true; status: number; body: unknown; emails?: EmailTask[]; cleanup?: () => Promise<void> } | { ok: false; error: ApiError; cleanup?: () => Promise<void> };

interface EmailTask {
  id: string;
  to: string;
  subject: string;
  text: string;
}

function header(req: ApiRequest, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  if (value === undefined) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

// The generic money-action runner. The action runs inside one transaction;
// 4xx answers are stored like successes, 503 answers roll the whole thing
// back and clean up anything already written to storage.
async function runAction(
  reg: RouteRegistrar,
  req: ApiRequest,
  endpoint: string,
  idemKey: string | null,
  bodyText: string,
  action: (client: PoolClient, key: string | null) => Promise<Outcome>
): Promise<JsonResponseBody> {
  const keyCheck = validateIdempotencyKey(idemKey);
  return await reg.db.withTransaction(async (client) => {
    await lockContract(client, req.params.id);
    await sweepExpiredContracts(client, reg.clock.now());
    if (keyCheck.ok) {
      const replay = await idempotency.begin(
        client,
        { endpoint, contractId: req.params.id, key: idemKey!, body: bodyText },
        `idem-${randomToken(10)}`
      );
      if (replay) {
        return { status: replay.status, body: replay.body };
      }
    }
    let outcome: Outcome;
    try {
      outcome = await action(client, keyCheck.ok ? idemKey : null);
    } catch (e) {
      if (e instanceof KillBillError || e instanceof KillBillUnavailable) {
        throw ApiError.unavailable("billing");
      }
      throw e;
    }
    if (outcome.ok) {
      if (outcome.cleanup) await outcome.cleanup();
      if (idemKey) {
        await idempotency.complete(client, endpoint, req.params.id, idemKey, outcome.status, outcome.body);
      }
      const emails = outcome.emails ?? [];
      const response = { status: outcome.status, body: outcome.body };
      queueEmails(reg, emails);
      return response;
    }
    if (outcome.error.status >= 500) {
      if (outcome.cleanup) await outcome.cleanup();
      throw outcome.error;
    }
    if (idemKey) {
      await idempotency.complete(client, endpoint, req.params.id, idemKey, outcome.error.status, outcome.error.body());
    }
    return outcome.error;
  });
}

function queueEmails(reg: RouteRegistrar, emails: EmailTask[]): void {
  for (const email of emails) {
    reg.mailer.queueEmail(email.id, email);
  }
}

function origin(reg: RouteRegistrar): string {
  return reg.config.publicUrl ?? `http://localhost:${reg.config.port}`;
}

export function registerMoneyRoutes(reg: RouteRegistrar): void {
  reg.add("POST", "/api/contracts/{id}/payments", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner"]);
    const idemKey = header(req, "Idempotency-Key");
    const amount = (req.body as { amount_cents?: unknown } | null)?.amount_cents;
    const bodyText = JSON.stringify({ amount_cents: amount ?? null });
    return runAction(reg, req, "payments", idemKey, bodyText, async (client, key) => {
      const contract = await loadContract(client, req.params.id);
      if (!contract) return err(ApiError.notFound("That contract does not exist."));
      const keyErr = keyIdempotencyError(key);
      if (keyErr) return err(keyErr);
      if (contract.status !== "active") {
        return err(ApiError.conflict("invalid_transition", "This contract can't take payments now."));
      }
      if (amount === null || amount === undefined || !Number.isInteger(amount) || (amount as number) < 1 || (amount as number) > 1_000_000) {
        return err(ApiError.validation({ amount_cents: "Enter an amount above $0.00." }));
      }
      const amountCents = amount as number;
      const today = storeToday(reg.clock);
      const list = await boundPriceList(client, contract, today);
      const item = itemFor(list, contract.instrument_type as never);
      const inForce = await priceListInForceOn(client, today);
      const taxRateBp = inForce ? inForce.tax_rate_bp : 0;
      const split = splitPayment({
        amount: amountCents,
        baseRent: item.base_rent_cents,
        waiver: contract.waiver ? item.waiver_cents : 0,
        taxRateBp,
      });
      const equity = await equityOf(client, contract.id as string);
      const remaining = item.purchase_price_cents - equity;
      if (split.base > remaining) {
        return err(ApiError.validation({ amount_cents: "exceeds_remaining" }));
      }
      const willPayOff = split.base === remaining;
      let billCleanup: (() => Promise<void>) | undefined;
      if (willPayOff) {
        // Storage steps run before any Kill Bill call.
        try {
          await reg.storage.reachable();
          const contact = await familyContact(client, contract.family_id as string);
          const student = await client.query<{ name: string }>("SELECT name FROM students WHERE id = $1", [contract.student_id]);
          const pdf = await billOfSalePdf({
            contractId: contract.id as string,
            parentName: contact?.parent_name ?? "",
            studentName: student.rows[0]?.name ?? "",
            instrumentLabel: instrumentLabel(contract.instrument_type as never, contract.size as never),
            serial: contract.serial as string,
            amountPaidText: formatMoney(amountCents),
            closeTimeText: formatStoreDateTime(reg.clock.now()),
          });
          await reg.storage.put(billOfSaleKey(contract.id as string), pdf, "application/pdf");
          billCleanup = async () => {
            await reg.storage.delete([billOfSaleKey(contract.id as string)]).catch(() => undefined);
          };
        } catch {
          return err(ApiError.unavailable("storage"));
        }
      }
      // The Kill Bill charge, after the adoption look-up.
      let killbillPaymentId: string;
      try {
        const contact = await familyContact(client, contract.family_id as string);
        const account = await reg.killbill.ensureAccount(
          contract.id as string,
          contact?.parent_name ?? "Bellroll family",
          contact?.email ?? "rentals@keelandbell.example"
        );
        const txnKey = `${contract.id}-pay-${key}`;
        const adopted = await reg.killbill.findSuccessfulTransaction(account.accountId, txnKey);
        if (adopted !== null && adopted.amountCents !== amountCents) {
          return err(
            ApiError.conflict("idempotency_conflict", "Billing already holds a different charge for this payment. Nothing was recorded."),
            billCleanup
          );
        }
        if (adopted === null) {
          killbillPaymentId = await reg.killbill.createPurchase(account.accountId, amountCents, txnKey);
        } else {
          killbillPaymentId = adopted.paymentId;
        }
        if (willPayOff) {
          await ensureSubscriptionCancelled(reg, contract);
        }
      } catch (e) {
        if (e instanceof KillBillUnavailable) {
          return err(ApiError.unavailable("billing"), billCleanup);
        }
        throw e;
      }
      // The payment and ledger entry, written only after the charge.
      const now = reg.clock.now();
      const paymentId = `P-${randomToken(8)}`;
      await client.query(
        `INSERT INTO payments (id, contract_id, amount_cents, base_rent_cents, waiver_cents, tax_cents, killbill_payment_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [paymentId, contract.id, amountCents, split.base, split.waiver, split.tax, killbillPaymentId, now]
      );
      const seq = await nextLedgerSeq(client, contract.id as string);
      await client.query(
        `INSERT INTO ledger_entries (id, contract_id, kind, amount_cents, transfer_id, payment_id, reversed, created_at, seq)
         VALUES ($1,$2,'payment',$3,NULL,$4,false,$5,$6)`,
        [`le-${paymentId}`, contract.id, split.base, paymentId, now, seq]
      );
      if (willPayOff) {
        await client.query(
          "UPDATE contracts SET status = 'paid_off', closed_at = $2, bill_of_sale_stored = true, subscription_state = 'cancelled' WHERE id = $1",
          [contract.id, now]
        );
        await client.query("UPDATE instruments SET status = 'sold' WHERE current_contract_id = $1", [contract.id]);
        await appendHistory(client, contract.id as string, "active", "paid_off", now, "owner", user.name);
      }
      const fresh = (await loadContract(client, contract.id as string))!;
      const newEquity = await equityOf(client, contract.id as string);
      const contractBody = await serializeContract(client, fresh, storeToday(reg.clock), newEquity);
      const paymentBody = {
        id: paymentId,
        amount_cents: amountCents,
        base_rent_cents: split.base,
        waiver_cents: split.waiver,
        tax_cents: split.tax,
        killbill_payment_id: killbillPaymentId,
        created_at: isoSecond(now),
      };
      const contact = await familyContact(client, contract.family_id as string);
      const emails: EmailTask[] = [
        {
          id: `receipt-${paymentId}`,
          to: contact?.email ?? "",
          subject: `Payment received — ${contract.id}`,
          text:
            `We received your payment of ${formatMoney(amountCents)} on contract ${contract.id}.\n\n` +
            `Rent toward ownership: ${formatMoney(split.base)}\n` +
            `${contract.waiver ? `Maintenance and damage waiver: ${formatMoney(split.waiver)}\n` : ""}` +
            `Sales tax (${formatTaxPercent(taxRateBp)}): ${formatMoney(split.tax)}\n\n` +
            `New equity: ${formatMoney(newEquity)}\n\n` +
            `Your contract: ${origin(reg)}/contracts/${contract.id}?month=${contractBody.contract_month}\n\n` +
            `Keel & Bell Music`,
        },
      ];
      if (willPayOff) {
        const student = await client.query<{ name: string }>("SELECT name FROM students WHERE id = $1", [contract.student_id]);
        const list2 = await boundPriceList(client, fresh, storeToday(reg.clock));
        const item2 = itemFor(list2, fresh.instrument_type as never);
        emails.push({
          id: `ownership-${contract.id}`,
          to: contact?.email ?? "",
          subject: `You own it — ${instrumentLabel(fresh.instrument_type as never, fresh.size as never)} ${fresh.serial}`,
          text:
            `${student.rows[0]?.name} now owns ${fresh.serial} (${instrumentLabel(fresh.instrument_type as never, fresh.size as never)}).\n\n` +
            `Purchase price: ${formatMoney(item2.purchase_price_cents)}\n` +
            `Paid at close: ${formatMoney(amountCents)}\n\n` +
            `Your bill of sale: ${origin(reg)}/api/contracts/${contract.id}/bill-of-sale.pdf\n\n` +
            `Keel & Bell Music`,
        });
      }
      return { ok: true, status: 201, body: { payment: paymentBody, contract: contractBody }, emails };
    });
  });

  reg.add("POST", "/api/contracts/{id}/payments/{payment_id}/reversal", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner"]);
    void user;
    const idemKey = header(req, "Idempotency-Key");
    const reason = (req.body as { reason?: unknown } | null)?.reason;
    const bodyText = JSON.stringify({ reason: reason ?? null, payment_id: req.params.payment_id });
    return runAction(reg, req, "reversals", idemKey, bodyText, async (client, key) => {
      const contract = await loadContract(client, req.params.id);
      if (!contract) return err(ApiError.notFound("That contract does not exist."));
      const paymentRows = await client.query<Record<string, unknown>>(
        "SELECT * FROM payments WHERE id = $1 AND contract_id = $2",
        [req.params.payment_id, contract.id]
      );
      if (paymentRows.rows.length === 0) {
        return err(ApiError.notFound("That payment does not exist."));
      }
      const payment = paymentRows.rows[0];
      if (contract.status !== "active") {
        return err(ApiError.conflict("invalid_transition", "Payments can only be reversed on an active contract."));
      }
      const keyErr = keyIdempotencyError(key);
      if (keyErr) return err(keyErr);
      const alreadyReversed = await client.query(
        "SELECT id FROM reversals WHERE payment_id = $1",
        [req.params.payment_id]
      );
      if (alreadyReversed.rows.length > 0) {
        return err(ApiError.conflict("payment_reversed", `Payment ${req.params.payment_id} was already reversed.`));
      }
      if (reason !== "returned_check" && reason !== "chargeback" && reason !== "entered_in_error") {
        return err(ApiError.validation({ reason: "Choose a reason." }));
      }
      const amountCents = Number(payment.amount_cents);
      // One Kill Bill REFUND on the original payment for its full amount.
      let killbillRefundId: string;
      try {
        const account = await reg.killbill.accountByExternalKey(contract.id as string);
        if (!account) throw new KillBillUnavailable();
        const txnKey = `${contract.id}-reversal-${req.params.payment_id}`;
        const adopted = await reg.killbill.findSuccessfulTransaction(account.accountId, txnKey);
        if (adopted !== null && adopted.amountCents !== amountCents) {
          return err(ApiError.conflict("idempotency_conflict", "Billing already holds a different refund for this reversal. Nothing was reversed."));
        }
        if (adopted === null) {
          killbillRefundId = await reg.killbill.createRefund(
            payment.killbill_payment_id as string,
            amountCents,
            txnKey
          );
        } else {
          killbillRefundId = adopted.paymentId;
        }
      } catch (e) {
        if (e instanceof KillBillUnavailable) {
          return err(ApiError.unavailable("billing"));
        }
        throw e;
      }
      const now = reg.clock.now();
      const reversalId = `R-${randomToken(8)}`;
      const basePart = Number(payment.base_rent_cents);
      await client.query(
        `INSERT INTO reversals (id, payment_id, contract_id, reason, amount_cents, base_rent_cents, waiver_cents, tax_cents, killbill_refund_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          reversalId,
          req.params.payment_id,
          contract.id,
          reason,
          amountCents,
          basePart,
          Number(payment.waiver_cents),
          Number(payment.tax_cents),
          killbillRefundId,
          now,
        ]
      );
      const seq = await nextLedgerSeq(client, contract.id as string);
      await client.query(
        `INSERT INTO ledger_entries (id, contract_id, kind, amount_cents, transfer_id, payment_id, reversed, created_at, seq)
         VALUES ($1,$2,'reversal',$3,NULL,$4,NULL,$5,$6)`,
        [`le-${reversalId}`, contract.id, -basePart, req.params.payment_id, now, seq]
      );
      const fresh = (await loadContract(client, contract.id as string))!;
      const newEquity = await equityOf(client, contract.id as string);
      const contractBody = await serializeContract(client, fresh, storeToday(reg.clock), newEquity);
      const contact = await familyContact(client, contract.family_id as string);
      const reasonWords: Record<string, string> = {
        returned_check: "Returned check",
        chargeback: "Chargeback",
        entered_in_error: "Entered in error",
      };
      const reversalBody = {
        id: reversalId,
        payment_id: req.params.payment_id,
        reason,
        amount_cents: amountCents,
        base_rent_cents: basePart,
        waiver_cents: Number(payment.waiver_cents),
        tax_cents: Number(payment.tax_cents),
        killbill_refund_id: killbillRefundId,
        created_at: isoSecond(now),
      };
      return {
        ok: true,
        status: 201,
        body: { reversal: reversalBody, contract: contractBody },
        emails: [
          {
            id: `reversal-${reversalId}`,
            to: contact?.email ?? "",
            subject: `Payment reversed — ${contract.id}`,
            text:
              `Your payment ${req.params.payment_id} on contract ${contract.id} was reversed.\n\n` +
              `Reason: ${reasonWords[reason!]}\n` +
              `Amount refunded: ${formatMoney(amountCents)}\n` +
              `Rent toward ownership removed: ${formatMoney(basePart)}\n` +
              `Waiver part: ${formatMoney(Number(payment.waiver_cents))}\n` +
              `Tax part: ${formatMoney(Number(payment.tax_cents))}\n\n` +
              `New equity: ${formatMoney(newEquity)}\n\n` +
              `Your contract: ${origin(reg)}/contracts/${contract.id}\n\n` +
              `Keel & Bell Music`,
          },
        ],
      };
    });
  });

  reg.add("POST", "/api/contracts/{id}/buyout", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner", "parent"]);
    const idemKey = header(req, "Idempotency-Key");
    const expected = (req.body as { expected_payoff_cents?: unknown } | null)?.expected_payoff_cents;
    const bodyText = JSON.stringify({ expected_payoff_cents: expected ?? null });
    return runAction(reg, req, "buyout", idemKey, bodyText, async (client, key) => {
      const contract = await loadContract(client, req.params.id);
      if (!contract) return err(ApiError.notFound("That contract does not exist."));
      if (user.role === "parent" && contract.family_id !== user.family_id) {
        return err(ApiError.notFound("That contract does not exist."));
      }
      if (contract.status !== "active") {
        return err(ApiError.conflict("invalid_transition", "This contract can't be bought out now."));
      }
      const keyErr = keyIdempotencyError(key);
      if (keyErr) return err(keyErr);
      if (expected === null || expected === undefined || !Number.isInteger(expected)) {
        return err(ApiError.validation({ expected_payoff_cents: "Enter the payoff figure shown." }));
      }
      const today = storeToday(reg.clock);
      const list = await boundPriceList(client, contract, today);
      const item = itemFor(list, contract.instrument_type as never);
      const inForce = await priceListInForceOn(client, today);
      const taxRateBp = inForce ? inForce.tax_rate_bp : 0;
      const equity = await equityOf(client, contract.id as string);
      const contractMonth = Math.floor(equity / (item.base_rent_cents || 1));
      const quote = quoteForMonth(
        {
          contractId: contract.id as string,
          equity,
          contractMonth,
          item,
          tiers: list.tiers,
          taxRateBp,
          today,
        },
        contractMonth
      );
      if ((expected as number) !== quote.payoff_cents) {
        return err(
          ApiError.conflict("quote_changed", "The payoff is now different. Review and confirm again.", { quote })
        );
      }
      // All or nothing: storage first, then the charge, then the commit.
      const contact = await familyContact(client, contract.family_id as string);
      const student = await client.query<{ name: string }>("SELECT name FROM students WHERE id = $1", [contract.student_id]);
      let billCleanup: (() => Promise<void>) | undefined;
      try {
        await reg.storage.reachable();
        const pdf = await billOfSalePdf({
          contractId: contract.id as string,
          parentName: contact?.parent_name ?? "",
          studentName: student.rows[0]?.name ?? "",
          instrumentLabel: instrumentLabel(contract.instrument_type as never, contract.size as never),
          serial: contract.serial as string,
          amountPaidText: formatMoney(quote.total_cents),
          closeTimeText: formatStoreDateTime(reg.clock.now()),
        });
        await reg.storage.put(billOfSaleKey(contract.id as string), pdf, "application/pdf");
        billCleanup = async () => {
          await reg.storage.delete([billOfSaleKey(contract.id as string)]).catch(() => undefined);
        };
      } catch {
        return err(ApiError.unavailable("storage"));
      }
      let killbillPaymentId: string;
      try {
        const account = await reg.killbill.ensureAccount(
          contract.id as string,
          contact?.parent_name ?? "Bellroll family",
          contact?.email ?? "rentals@keelandbell.example"
        );
        const txnKey = `${contract.id}-buyout`;
        const adopted = await reg.killbill.findSuccessfulTransaction(account.accountId, txnKey);
        if (adopted !== null && adopted.amountCents !== quote.total_cents) {
          return err(ApiError.conflict("idempotency_conflict", "Billing already holds a different charge for this buyout. Nothing was changed."), billCleanup);
        }
        if (adopted === null) {
          killbillPaymentId = await reg.killbill.createPurchase(account.accountId, quote.total_cents, txnKey);
        } else {
          killbillPaymentId = adopted.paymentId;
        }
        await ensureSubscriptionCancelled(reg, contract);
      } catch (e) {
        if (e instanceof KillBillUnavailable) {
          return err(ApiError.unavailable("billing"), billCleanup);
        }
        throw e;
      }
      const now = reg.clock.now();
      const seq = await nextLedgerSeq(client, contract.id as string);
      await client.query(
        `INSERT INTO ledger_entries (id, contract_id, kind, amount_cents, transfer_id, payment_id, reversed, created_at, seq)
         VALUES ($1,$2,'buyout',$3,NULL,NULL,NULL,$4,$5)`,
        [`le-buyout-${contract.id}`, contract.id, quote.remaining_cents, now, seq]
      );
      await client.query(
        "UPDATE contracts SET status = 'paid_off', closed_at = $2, bill_of_sale_stored = true, subscription_state = 'cancelled' WHERE id = $1",
        [contract.id, now]
      );
      await client.query("UPDATE instruments SET status = 'sold' WHERE current_contract_id = $1", [contract.id]);
      await appendHistory(client, contract.id as string, "active", "paid_off", now, user.role === "owner" ? "owner" : "parent", user.name);
      const fresh = (await loadContract(client, contract.id as string))!;
      const newEquity = await equityOf(client, contract.id as string);
      const contractBody = await serializeContract(client, fresh, storeToday(reg.clock), newEquity);
      const emails: EmailTask[] = [
        {
          id: `ownership-${contract.id}`,
          to: contact?.email ?? "",
          subject: `You own it — ${instrumentLabel(fresh.instrument_type as never, fresh.size as never)} ${fresh.serial}`,
          text:
            `${student.rows[0]?.name} now owns ${fresh.serial} (${instrumentLabel(fresh.instrument_type as never, fresh.size as never)}).\n\n` +
            `Purchase price: ${formatMoney(item.purchase_price_cents)}\n` +
            `Paid at close: ${formatMoney(quote.total_cents)}\n\n` +
            `Your bill of sale: ${origin(reg)}/api/contracts/${contract.id}/bill-of-sale.pdf\n\n` +
            `Keel & Bell Music`,
        },
      ];
      return {
        ok: true,
        status: 200,
        body: {
          contract: contractBody,
          buyout: {
            payoff_cents: quote.payoff_cents,
            discount_cents: quote.discount_cents,
            remaining_cents: quote.remaining_cents,
            tax_cents: quote.tax_cents,
            total_cents: quote.total_cents,
            tier: quote.tier,
            killbill_payment_id: killbillPaymentId,
          },
        },
        emails,
      };
    });
  });

  reg.add("POST", "/api/contracts/{id}/exchange", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner"]);
    const idemKey = header(req, "Idempotency-Key");
    const size = (req.body as { size?: unknown } | null)?.size;
    const bodyText = JSON.stringify({ size: size ?? null });
    return runAction(reg, req, "exchange", idemKey, bodyText, async (client, key) => {
      const contract = await loadContract(client, req.params.id);
      if (!contract) return err(ApiError.notFound("That contract does not exist."));
      if (contract.status !== "active") {
        return err(ApiError.conflict("invalid_transition", "This contract can't be exchanged now."));
      }
      if (contract.instrument_type !== "violin" && contract.instrument_type !== "cello") {
        return err(ApiError.conflict("not_exchangeable", "Only violins and cellos can be exchanged for a larger size."));
      }
      const keyErr = keyIdempotencyError(key);
      if (keyErr) return err(keyErr);
      const type = contract.instrument_type as InstrumentType;
      const validSizes = SIZES_BY_TYPE[type];
      if (typeof size !== "string" || !validSizes.includes(size as Size) || SIZE_ORDER[size as Size] <= SIZE_ORDER[contract.size as Size]) {
        return err(ApiError.validation({ size: "Choose a larger size of the same instrument." }));
      }
      // The new unit is chosen as for reservations.
      const unit = await claimAvailableInstrument(client, type, size as Size);
      if (!unit) {
        const alternatives = await availableAlternatives(client, type);
        return err(
          ApiError.conflict("unavailable", "No longer available", { alternatives })
        );
      }
      // Storage: copy the old signed PDF to the successor's key.
      const oldKey = `contracts/${contract.id}/agreement-signed.pdf`;
      const numericIdRows = await client.query<{ nextval: string }>("SELECT nextval('contract_id_seq') AS nextval");
      const newNumericId = Number(numericIdRows.rows[0].nextval);
      const successorId = `C-${newNumericId}`;
      const newKey = `contracts/${successorId}/agreement-signed.pdf`;
      let agreementBytes: Uint8Array;
      try {
        await reg.storage.reachable();
        const exists = await reg.storage.exists(oldKey);
        if (exists) {
          agreementBytes = await reg.storage.get(oldKey);
        } else {
          // A seeded contract's PDF is generated on its first exchange.
          const { buildAgreementPdf } = await import("./contracts.js");
          agreementBytes = await buildAgreementPdf(reg, contract);
        }
        await reg.storage.put(newKey, agreementBytes, "application/pdf");
      } catch {
        await releaseInstrument(client, unit.id);
        return err(ApiError.unavailable("storage"));
      }
      const agreementCleanup = async () => {
        await reg.storage.delete([newKey]).catch(() => undefined);
        await releaseInstrumentOutside(reg, client, unit.id).catch(() => undefined);
      };
      // Kill Bill: cancel the old subscription, then the successor's account
      // and subscription.
      try {
        await ensureSubscriptionCancelled(reg, contract);
      } catch (e) {
        if (e instanceof KillBillUnavailable) {
          return err(ApiError.unavailable("billing"), agreementCleanup);
        }
        throw e;
      }
      const contact = await familyContact(client, contract.family_id as string);
      try {
        const account = await reg.killbill.ensureAccount(
          successorId,
          contact?.parent_name ?? "Bellroll family",
          contact?.email ?? "rentals@keelandbell.example"
        );
        await reg.killbill.ensureSubscription(account.accountId, `${successorId}-rental`);
      } catch (e) {
        if (e instanceof KillBillUnavailable) {
          return err(ApiError.unavailable("billing"), agreementCleanup);
        }
        throw e;
      }
      // One step: the old contract closes, the successor opens, the transfer
      // pair conserves total equity.
      const now = reg.clock.now();
      const schoolRow = await client.query<Record<string, unknown>>("SELECT * FROM schools WHERE id = $1", [contract.school_id]);
      const school = {
        id: schoolRow.rows[0].id as string,
        name: schoolRow.rows[0].name as string,
        delivery_weekday: schoolRow.rows[0].delivery_weekday as string,
      };
      const delivery = nextDeliveryDay(school, reg.clock.now());
      const transferId = `T-${randomToken(10)}`;
      const equity = await equityOf(client, contract.id as string);
      await client.query(
        `INSERT INTO contracts (id, numeric_id, student_id, family_id, school_id, instrument_id, waiver, status,
          price_list_id, delivery_date, hold_expires_at, signed_at, activated_at, billing_anchor_date,
          agreement_stored, subscription_state, predecessor_id, created_at, created_seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,NULL,$10,$11,$12,true,'active',$13,$14,$15)`,
        [
          successorId,
          newNumericId,
          contract.student_id,
          contract.family_id,
          contract.school_id,
          unit.id,
          contract.waiver,
          contract.price_list_id,
          delivery.date,
          contract.signed_at,
          contract.activated_at,
          contract.billing_anchor_date,
          contract.id,
          now,
          newNumericId,
        ]
      );
      const oldSeq = await nextLedgerSeq(client, contract.id as string);
      const newSeq = await nextLedgerSeq(client, successorId);
      await client.query(
        `INSERT INTO ledger_entries (id, contract_id, kind, amount_cents, transfer_id, payment_id, reversed, created_at, seq)
         VALUES ($1,$2,'exchange_out',$3,$4,NULL,NULL,$5,$6)`,
        [`le-xout-${transferId}`, contract.id, -equity, transferId, now, oldSeq]
      );
      await client.query(
        `INSERT INTO ledger_entries (id, contract_id, kind, amount_cents, transfer_id, payment_id, reversed, created_at, seq)
         VALUES ($1,$2,'exchange_in',$3,$4,NULL,NULL,$5,$6)`,
        [`le-xin-${transferId}`, successorId, equity, transferId, now, newSeq]
      );
      await client.query(
        "UPDATE contracts SET status = 'exchanged', closed_at = $2, successor_id = $3, subscription_state = 'cancelled' WHERE id = $1",
        [contract.id, now, successorId]
      );
      await client.query("UPDATE instruments SET status = 'available', current_contract_id = NULL WHERE id = $1", [contract.instrument_id]);
      await client.query("UPDATE instruments SET status = 'on_contract', current_contract_id = $1 WHERE id = $2", [successorId, unit.id]);
      await appendHistory(client, contract.id as string, "active", "exchanged", now, "owner", user.name);
      await appendHistory(client, successorId, null, "active", now, "owner", user.name);
      const oldContract = (await loadContract(client, contract.id as string))!;
      const newContract = (await loadContract(client, successorId))!;
      const oldEquity = await equityOf(client, contract.id as string);
      const newEquity = await equityOf(client, successorId);
      return {
        ok: true,
        status: 201,
        body: {
          old_contract: await serializeContract(client, oldContract, storeToday(reg.clock), oldEquity),
          new_contract: await serializeContract(client, newContract, storeToday(reg.clock), newEquity),
          transfer_id: transferId,
        },
      };
    });
  });
}

function err(error: ApiError, cleanup?: () => Promise<void>): Outcome {
  return { ok: false, error, cleanup };
}

function keyIdempotencyError(key: string | null): ApiError | null {
  const check = validateIdempotencyKey(key);
  if (!check.ok) return ApiError.validation({ idempotency_key: check.message! });
  return null;
}

// Atomically claims the available instrument of the type and size whose
// serial sorts first. Exactly one winner for the last unit.
async function claimAvailableInstrument(
  client: PoolClient,
  type: InstrumentType,
  size: Size
): Promise<{ id: string; serial: string } | null> {
  const rows = await client.query<{ id: string; serial: string }>(
    `UPDATE instruments SET status = 'on_contract'
      WHERE id IN (
        SELECT id FROM instruments
         WHERE instrument_type = $1 AND size = $2 AND status = 'available'
         ORDER BY serial ASC
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, serial`,
    [type, size]
  );
  return rows.rows.length > 0 ? rows.rows[0] : null;
}

async function releaseInstrument(client: PoolClient, instrumentId: string): Promise<void> {
  await client.query(
    "UPDATE instruments SET status = 'available' WHERE id = $1 AND status = 'on_contract'",
    [instrumentId]
  );
}

async function releaseInstrumentOutside(reg: RouteRegistrar, _client: PoolClient, instrumentId: string): Promise<void> {
  await reg.db.withTransaction(async (client) => {
    await releaseInstrument(client, instrumentId);
  });
}

async function availableAlternatives(
  client: PoolClient,
  type: InstrumentType
): Promise<{ instrument_type: string; size: string; available: number }[]> {
  const rows = await client.query<Record<string, unknown>>(
    "SELECT size, COUNT(*) AS n FROM instruments WHERE instrument_type = $1 AND status = 'available' GROUP BY size",
    [type]
  );
  const counts = new Map<string, number>();
  for (const row of rows.rows) counts.set(row.size as string, Number(row.n));
  return SIZES_BY_TYPE[type]
    .filter((size) => (counts.get(size) ?? 0) > 0)
    .map((size) => ({ instrument_type: type, size, available: counts.get(size)! }));
}
