import { ApiError } from "../errors.js";
import { json, parseJsonBody, route, requireRenter, type RouteContext } from "../router.js";
import { one, rows, withOwnTx } from "../db.js";
import { balances, recordMovement } from "../ledger.js";
import { queueNotification, emailSubjects } from "../notify.js";
import { bodyHash } from "../multipart.js";
import {
  createPurchasePayment,
  ensureAccount,
  ensurePaymentMethod,
  findPaymentByExternalKey,
  refundPayment,
} from "../killbill.js";

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

type PurchaseResponse = {
  purchase: {
    id: string;
    pack_id: string;
    pack_name: string;
    hours: number;
    amount_usd: string;
    killbill_payment_id: string;
    created_at: string;
  };
  balance_minutes: number;
};

const responseOf = (
  purchaseRow: {
    id: string;
    pack_id: string;
    pack_name: string;
    hours: number;
    amount_usd: string;
    killbill_payment_id: string;
    created_at: Date;
  },
  balanceMinutes: number,
): PurchaseResponse => ({
  purchase: {
    id: purchaseRow.id,
    pack_id: purchaseRow.pack_id,
    pack_name: purchaseRow.pack_name,
    hours: purchaseRow.hours,
    amount_usd: purchaseRow.amount_usd,
    killbill_payment_id: purchaseRow.killbill_payment_id,
    created_at: purchaseRow.created_at.toISOString(),
  },
  balance_minutes: balanceMinutes,
});

const keyRow = (renterId: string, key: string) =>
  withOwnTx(async (tx) =>
    one<{ state: string; body_hash: string; response: unknown }>(
      tx,
      "select state, body_hash, response from purchase_keys where renter_id = $1 and key = $2",
      [renterId, key],
    ),
  );

const deleteKeyCommitted = (renterId: string, key: string): Promise<void> =>
  withOwnTx(async (tx) => {
    await tx.query("delete from purchase_keys where renter_id = $1 and key = $2", [renterId, key]);
  });

route("POST", "/api/purchases", "renter", async (ctx: RouteContext) => {
  const { renterId } = requireRenter(ctx);
  const idempotencyKey = text(ctx.req.headers["idempotency-key"]);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(idempotencyKey)) {
    throw ApiError.validationError({
      idempotency_key: "Send an Idempotency-Key of 1 to 64 letters, digits, hyphens or underscores.",
    });
  }
  const body = parseJsonBody<{ pack_id?: unknown }>(ctx);
  const packId = text(body.pack_id);
  const pack = packId
    ? await one<{ id: string; name: string; hours: number; amount_usd: string }>(
        ctx.db,
        "select id, name, hours, amount_usd::text as amount_usd from packs where id = $1",
        [packId],
      )
    : null;
  if (!pack) throw ApiError.validationError({ pack_id: "Choose an hour pack." });
  const renter = await one<{ status: string; business_name: string; email: string }>(
    ctx.db,
    "select status, business_name, email from renters where id = $1",
    [renterId],
  );
  if (!renter) throw ApiError.notFound();
  if (renter.status === "applied" || renter.status === "documents_review" || renter.status === "offboarded") {
    throw ApiError.renterNotActive();
  }

  const hash = bodyHash(packId);

  // A completed key replays its stored response exactly; the same key with a
  // different body conflicts (DP-07). An in-flight key is waited for briefly.
  const existing = await keyRow(renterId, idempotencyKey);
  if (existing) {
    if (existing.state === "in_progress") {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const again = await keyRow(renterId, idempotencyKey);
      if (again && again.state === "done") {
        if (existing.body_hash !== hash) throw ApiError.idempotencyConflict();
        return json(again.response as PurchaseResponse, 200);
      }
      throw ApiError.paymentFailed();
    }
    if (existing.body_hash !== hash) throw ApiError.idempotencyConflict();
    return json(existing.response as PurchaseResponse, 200);
  }

  const claimed = await withOwnTx(async (tx) =>
    rows<{ renter_id: string; key: string }>(
      tx,
      `insert into purchase_keys (renter_id, key, body_hash, request_lock, state)
       values ($1, $2, $3, $4, 'in_progress')
       on conflict (renter_id, key) do nothing returning renter_id, key`,
      [renterId, idempotencyKey, hash, `${renterId}:${idempotencyKey}`],
    ),
  );
  if (claimed.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const again = await keyRow(renterId, idempotencyKey);
    if (again && again.state === "done") {
      if (again.body_hash !== hash) throw ApiError.idempotencyConflict();
      return json(again.response as PurchaseResponse, 200);
    }
    throw ApiError.paymentFailed();
  }

  const externalKey = `renter-${renterId}`;
  const paymentKey = `purchase-${renterId}-${idempotencyKey}`;
  const transactionKey = `${paymentKey}-tx`;

  // All-or-nothing (DP-08): the Kill Bill payment is recorded first, keyed so a
  // retry finds it, then the purchase, ledger and receipt are saved together.
  const account = await ensureAccount(externalKey, renter.business_name, renter.email);
  if (account.kind === "unavailable") {
    await deleteKeyCommitted(renterId, idempotencyKey);
    throw ApiError.billingUnavailable();
  }
  const method = await ensurePaymentMethod(account.value);
  if (method.kind === "unavailable") {
    await deleteKeyCommitted(renterId, idempotencyKey);
    throw ApiError.billingUnavailable();
  }
  const prior = await findPaymentByExternalKey(paymentKey);
  if (prior.kind === "unavailable") {
    await deleteKeyCommitted(renterId, idempotencyKey);
    throw ApiError.billingUnavailable();
  }
  let paymentId = prior.value?.paymentId ?? null;
  if (!paymentId) {
    const payment = await createPurchasePayment(
      account.value.accountId,
      method.value.paymentMethodId,
      Number(pack.amount_usd),
      paymentKey,
      transactionKey,
    );
    if (payment.kind === "unavailable") {
      await deleteKeyCommitted(renterId, idempotencyKey);
      throw ApiError.billingUnavailable();
    }
    if (payment.value.status !== "SUCCESS") {
      await deleteKeyCommitted(renterId, idempotencyKey);
      throw ApiError.paymentFailed();
    }
    paymentId = payment.value.paymentId;
  }

  let response: PurchaseResponse;
  try {
    response = await withOwnTx(async (tx) => {
      const purchaseRows = await rows<{ id: string; created_at: Date }>(
        tx,
        `insert into purchases (renter_id, pack_id, idempotency_key, killbill_payment_id, balance_after)
         values ($1, $2, $3, $4, 0) returning id, created_at`,
        [renterId, packId, idempotencyKey, paymentId],
      );
      const purchaseId = purchaseRows[0]!.id;
      await recordMovement(tx, renterId, "pack_purchase", pack.hours * 60, { purchaseId });
      const balance = await balances(tx, renterId);
      await tx.query("update purchases set balance_after = $1 where id = $2", [balance.balanceMinutes, purchaseId]);
      await queueNotification(
        tx,
        "receipt",
        renter.email,
        emailSubjects.receipt(pack.name),
        `Amount: $${pack.amount_usd}\nHours: ${pack.hours}.00\nKill Bill payment: ${paymentId}\nNew balance: ${(balance.balanceMinutes / 60).toFixed(2)} hours`,
      );
      const built = responseOf(
        {
          id: purchaseId,
          pack_id: pack.id,
          pack_name: pack.name,
          hours: pack.hours,
          amount_usd: pack.amount_usd,
          killbill_payment_id: paymentId!,
          created_at: purchaseRows[0]!.created_at,
        },
        balance.balanceMinutes,
      );
      await tx.query("update purchase_keys set state = 'done', response = $1 where renter_id = $2 and key = $3", [
        JSON.stringify(built),
        renterId,
        idempotencyKey,
      ]);
      return built;
    });
  } catch (err) {
    // The save failed after billing accepted: refund before answering.
    await refundPayment(paymentId!);
    await deleteKeyCommitted(renterId, idempotencyKey);
    throw err;
  }

  return json(response, 201);
});
