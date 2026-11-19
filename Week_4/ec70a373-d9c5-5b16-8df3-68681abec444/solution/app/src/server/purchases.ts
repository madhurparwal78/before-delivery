// Pack purchases: the Kill Bill charge first, then the lot, the ledger credit and the receipt together.
import { randomUUID } from "node:crypto";
import { pool, theRow, tx } from "./db.ts";
import { type AuthedCtx, type Reply } from "./router.ts";
import { Fields, idempotencyKey } from "./validate.ts";
import { ownMemberId, packFor } from "./scope.ts";
import { availableQuarters, balances, homeDate, lockMember, writeMovement } from "./ledger.ts";
import { claimKey, completeKey, withKey } from "./idempotency.ts";
import { chargePack, refundPack } from "./killbill.ts";
import { enqueueMail } from "./outbox.ts";
import { receiptMail } from "./emails.ts";
import { isoInstant, addDays } from "../shared/time.ts";
import { settle } from "./bookings.ts";
import { LOT_VALID_DAYS, quartersToHours } from "../shared/rules.ts";

// POST /api/pack-purchases
export async function buyPack(ctx: AuthedCtx): Promise<Reply> {
  const user = ctx.user;
  const memberId = ownMemberId(user);
  const fields = new Fields(ctx.body, ["pack_id"]);
  const key = idempotencyKey(ctx.req.headers["idempotency-key"], fields);
  const packId = fields.id("pack_id");
  const pack = packId === undefined ? null : await packFor(pool, user, packId);
  if (key === undefined) return fields.reject();
  const claim = await claimKey(user.id, key, JSON.stringify(["POST /api/pack-purchases", pack?.id ?? null]));
  return withKey(claim, async (claimed) => {
    if (!pack) return fields.reject();
    fields.raise();
    const member = await theRow<{ business_name: string }>(pool, "SELECT business_name FROM members WHERE id = $1", [memberId]);
    const purchaseId = randomUUID();
    const paymentId = await chargePack({ id: memberId, businessName: member.business_name, email: user.email }, purchaseId, pack.price_cents);
    try {
      const at = await settle(memberId);
      return await tx(async (db) => {
        await lockMember(db, memberId, at);
        const validThrough = addDays(await homeDate(db, memberId, at), LOT_VALID_DAYS);
        await db.query(
          `INSERT INTO purchases (id, member_id, pack_id, pack_name, quarters, price_cents, valid_through, killbill_payment_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [purchaseId, memberId, pack.id, pack.name, pack.quarters, pack.price_cents, validThrough, paymentId, new Date(at)],
        );
        const lotId = randomUUID();
        await db.query("INSERT INTO lots (id, member_id, purchase_id, pack_name, valid_through) VALUES ($1, $2, $3, $4, $5)", [
          lotId,
          memberId,
          purchaseId,
          pack.name,
          validThrough,
        ]);
        await writeMovement(db, {
          memberId,
          kind: "pack_purchase",
          quarters: pack.quarters,
          actor: { userId: user.id, name: user.name, role: "member" },
          at,
          purchaseId,
          lots: [{ lotId, quarters: pack.quarters }],
        });
        const after = await balances(db, memberId, at);
        await enqueueMail(
          db,
          receiptMail(user.email, {
            packName: pack.name,
            quarters: pack.quarters,
            priceCents: pack.price_cents,
            purchaseId,
            validThrough,
            availableAfter: await availableQuarters(db, memberId),
          }),
        );
        return completeKey(db, claimed, 201, {
          purchase: {
            id: purchaseId,
            pack_id: pack.id,
            pack_name: pack.name,
            hours: quartersToHours(pack.quarters),
            price_cents: pack.price_cents,
            valid_through: validThrough,
            killbill_payment_id: paymentId,
            created_at: isoInstant(at),
          },
          balances: after,
        });
      }, { retry: false });
    } catch (error) {
      await refundPack(paymentId, pack.price_cents);
      throw error;
    }
  });
}
