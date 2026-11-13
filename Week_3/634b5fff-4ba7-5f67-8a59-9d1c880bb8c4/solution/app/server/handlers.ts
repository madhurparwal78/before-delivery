import { pool } from "./db.js";
import { registerJob } from "./jobs.js";
import { sendMail } from "./mail.js";
import { buildMail, type Template } from "./notices.js";
import { publishAlert } from "./ntfy.js";
import { requireOrder } from "./orders.js";
import { statementPayload } from "./statements.js";
import { sendMessage } from "./svix.js";

/** The delivery side of queued jobs: each reaches its provider with a real call. */

registerJob("mail", async (payload) => {
  const order = await requireOrder(pool, String(payload.reference));
  await sendMail(await buildMail(payload.template as Template, order, Number(payload.refundOre ?? 0)));
});

registerJob("alert", async (payload) => {
  await publishAlert(String(payload.title), String(payload.message));
});

registerJob("webhook", async (payload) => {
  const found = await pool.query("SELECT * FROM refunds WHERE refund_id = $1", [payload.refundId]);
  const refund = found.rows[0] as {
    refund_id: string; reference: string; amount_ore: number; net_ore: number; vat_ore: number; charity_ore: number; maker_ore: number; settled_at: Date;
  };
  const order = await requireOrder(pool, refund.reference);
  const eventId = `evt_refund_${refund.refund_id}`;
  await sendMessage(eventId, "refund.settled", {
    eventId, reference: refund.reference, boxNumber: order.box_number, refundId: refund.refund_id, refundOre: refund.amount_ore,
    netOre: refund.net_ore, vatOre: refund.vat_ore, charityOre: refund.charity_ore, makerOre: refund.maker_ore, settledAt: refund.settled_at.toISOString(),
  });
});

registerJob("statement-hook", async (payload) => {
  const body = await statementPayload(String(payload.statementId));
  await sendMessage(String(body.eventId), "statement.issued", body);
});
