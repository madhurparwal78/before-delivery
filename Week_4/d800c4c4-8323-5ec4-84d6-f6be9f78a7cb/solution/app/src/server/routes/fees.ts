import type pg from "pg";
import { one, pool, rows, transaction } from "../db.js";
import { loadCalendar } from "../domain/calendar.js";
import { ApiError, conflict, COORDINATOR, MEMBER, notFound, route, type Ctx, type Reply } from "../http/pipeline.js";
import { pathId, text } from "../http/values.js";
import { creditFeeInvoice, payFeeInvoice } from "../providers/killbill.js";
import { ProviderDown } from "../providers/status.js";
import { getPhotoObject } from "../providers/storage.js";
import { loadFees, loadPhotos } from "../views.js";
import { BILLING_DOWN, withBilling } from "./members.js";

interface FeeRecord {
  id: number;
  loan_id: number;
  member_id: number;
}

/** A fee the caller may see: staff see every fee, a member only their own. */
async function findFee(ctx: Ctx): Promise<FeeRecord> {
  const id = pathId(ctx.params.id);
  const fee = id === null ? undefined : await one<FeeRecord>(pool, `SELECT id, loan_id, member_id FROM fees WHERE id = $1`, [id]);
  if (!fee || (ctx.caller!.role === "member" && fee.member_id !== ctx.caller!.id)) throw notFound();
  return fee;
}

interface LockedFee {
  id: number;
  status: "raised" | "settled" | "waived-by-coordinator";
  waiver_status: string | null;
  killbill_invoice_id: string;
  killbill_account_id: string;
}

/** Locks the fee and refuses a settled or waived one, in the published conflict order. */
async function lockRaisedFee(client: pg.PoolClient, id: number): Promise<LockedFee> {
  const [fee] = await rows<LockedFee>(
    client,
    `SELECT f.id, f.status, f.waiver_status, f.killbill_invoice_id, m.killbill_account_id
     FROM fees f JOIN memberships m ON m.user_id = f.member_id WHERE f.id = $1 FOR UPDATE OF f`,
    [id],
  );
  if (fee!.status === "settled") throw conflict("This fee is already settled.");
  if (fee!.status === "waived-by-coordinator") throw conflict("This fee has been waived.");
  return fee!;
}

async function feeReply(id: number, status: number): Promise<Reply> {
  const calendar = await loadCalendar(pool);
  return { status, body: { fee: (await loadFees(pool, { ids: [id] }, calendar))[0] } };
}

export const feeRoutes = [
  route({
    method: "GET",
    path: "/api/fees",
    access: "signed-in",
    body: "none",
    handle: async (ctx): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      const filter = ctx.caller!.role === "member" ? { memberId: ctx.caller!.id } : { status: ctx.query.get("status") ?? undefined };
      return { status: 200, body: { fees: await loadFees(pool, filter, calendar) } };
    },
  }),
  route({
    method: "GET",
    path: "/api/fees/:id",
    access: "signed-in",
    body: "none",
    find: findFee,
    handle: async (_ctx, found): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      const [fee] = await loadFees(pool, { ids: [found.id] }, calendar);
      const photos = (await loadPhotos(pool, [found.loan_id], calendar)).get(found.loan_id) ?? [];
      return { status: 200, body: { fee, photos } };
    },
  }),
  route({
    method: "POST",
    path: "/api/fees/:id/pay",
    access: "signed-in",
    roles: MEMBER,
    body: "json",
    find: findFee,
    handle: async (_ctx, found): Promise<Reply> => {
      await transaction(async (client) => {
        const fee = await lockRaisedFee(client, found.id);
        await withBilling(BILLING_DOWN, () => payFeeInvoice(fee.killbill_account_id, fee.killbill_invoice_id, `pegworth-fee-${fee.id}`));
        await client.query(`UPDATE fees SET status = 'settled' WHERE id = $1`, [fee.id]);
      });
      return feeReply(found.id, 200);
    },
  }),
  route({
    method: "POST",
    path: "/api/fees/:id/waiver-request",
    access: "signed-in",
    roles: MEMBER,
    body: "json",
    find: findFee,
    validate: (ctx) => {
      const reason = text(ctx.json?.reason) ?? "";
      return reason.trim().length >= 1 && reason.length <= 500 ? null : { reason: "Give a reason of up to 500 characters." };
    },
    handle: async (ctx, found): Promise<Reply> => {
      await transaction(async (client) => {
        const fee = await lockRaisedFee(client, found.id);
        if (fee.waiver_status === "requested") throw conflict("A waiver request is already waiting.");
        await client.query(
          `UPDATE fees SET waiver_status = 'requested', waiver_reason = $2, waiver_requested_at = now(), waiver_decided_at = NULL WHERE id = $1`,
          [fee.id, ctx.json!.reason],
        );
      });
      return feeReply(found.id, 201);
    },
  }),
  route({
    method: "POST",
    path: "/api/fees/:id/waiver-decision",
    access: "signed-in",
    roles: COORDINATOR,
    body: "json",
    find: findFee,
    validate: (ctx) => (ctx.json?.decision === "approve" || ctx.json?.decision === "decline" ? null : { decision: "Choose approve or decline." }),
    handle: async (ctx, found): Promise<Reply> => {
      await transaction(async (client) => {
        const fee = await lockRaisedFee(client, found.id);
        if (fee.waiver_status !== "requested") throw conflict("There is no waiver request to decide.");
        if (ctx.json!.decision === "decline") {
          await client.query(`UPDATE fees SET waiver_status = 'declined', waiver_decided_at = now() WHERE id = $1`, [fee.id]);
          return;
        }
        await withBilling("Billing is down. The waiver was not posted; try again when it is back.", () =>
          creditFeeInvoice(fee.killbill_account_id, fee.killbill_invoice_id, `Waiver for fee ${fee.id}`),
        );
        await client.query(
          `UPDATE fees SET status = 'waived-by-coordinator', waiver_status = 'approved', waiver_decided_at = now() WHERE id = $1`,
          [fee.id],
        );
      });
      return feeReply(found.id, 200);
    },
  }),
  route({
    method: "GET",
    path: "/api/photos/:id",
    access: "signed-in",
    body: "none",
    find: async (ctx) => {
      const id = pathId(ctx.params.id);
      const photo =
        id === null
          ? undefined
          : await one<{ object_key: string; content_type: string; member_id: number }>(
              pool,
              `SELECT p.object_key, p.content_type, l.member_id FROM photos p JOIN loans l ON l.id = p.loan_id WHERE p.id = $1`,
              [id],
            );
      if (!photo || (ctx.caller!.role === "member" && photo.member_id !== ctx.caller!.id)) throw notFound();
      return photo;
    },
    handle: async (_ctx, photo): Promise<Reply> => {
      try {
        const data = await getPhotoObject(photo.object_key);
        return { status: 200, bytes: { data, contentType: photo.content_type }, headers: { "Cache-Control": "private, no-store" } };
      } catch (error) {
        if (error instanceof ProviderDown) throw new ApiError(503, "Photo storage is down. Photos will show again when it is back.");
        throw error;
      }
    },
  }),
];
