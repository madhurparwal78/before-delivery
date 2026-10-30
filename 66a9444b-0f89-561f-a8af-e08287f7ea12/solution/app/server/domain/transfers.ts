// A buyer transfers a captured line once: the line gets a new holder and a new pass; the old pass stops
// scanning from that moment. No Kill Bill transaction is made.
import { transaction } from "../db/index.ts";
import { ApiError, FieldErrors, notFound, ok, route } from "../http.ts";
import { objectKeys, putObject, removeAll } from "../services/storage.ts";
import { newPassCode } from "./ids.ts";
import { mails } from "./mails.ts";
import { linesOf, lineView, moveLines, passFace, refusedMoves, visibleOrder } from "./orders.ts";
import { queueMail } from "./outbox.ts";
import { passPdf } from "../services/passPdf.ts";
import { asObject, email, text } from "./validate.ts";

route("POST", "/api/orders/:id/lines/:lineId/transfer", ["visitor", "group_booker"], async (ctx) => {
  const body = asObject(ctx.body);
  let stored: string | null = null;
  try {
    const line = await transaction(async (tx) => {
      const order = await visibleOrder(tx, ctx.user, ctx.params.id!, true);
      const current = (await linesOf(tx, [order.id])).find((l) => l.id === ctx.params.lineId);
      if (!current) throw notFound();
      if (refusedMoves([current], "transferred").length) {
        throw new ApiError(409, current.state === "transferred" ? "already_transferred" : "line_not_transferable");
      }
      const errors: Record<string, string> = {};
      const name = text(body.recipient_name, 1, 200);
      const address = email(body.recipient_email);
      if (!name) errors.recipient_name = "required";
      if (!address) errors.recipient_email = "invalid";
      if (Object.keys(errors).length) throw new FieldErrors(errors);
      const code = newPassCode();
      const face = await passFace(tx, { ...current, holder_name: name! }, code);
      const document = passPdf(face);
      stored = objectKeys.pass(order.ref, code);
      await putObject(stored, document, "application/pdf");
      await moveLines(tx, [current.id], "transferred");
      await tx.query("UPDATE lines SET holder_name = $2 WHERE id = $1", [current.id, name]);
      await tx.query("UPDATE passes SET status = 'transferred' WHERE line_id = $1 AND status = 'valid'", [current.id]);
      await tx.query("INSERT INTO passes (code, line_id, status, created_at) VALUES ($1, $2, 'valid', $3)", [code, current.id, new Date()]);
      await queueMail(tx, mails.transferSent(order.buyer_email, order.ref, current.title, name!));
      await queueMail(tx, mails.transferReceived(address!, face, { filename: `${code}.pdf`, content: document }));
      return (await linesOf(tx, [order.id])).find((l) => l.id === current.id)!;
    });
    return ok({ line: lineView(line), pass: { code: line.pass_code, status: "valid" } });
  } catch (error) {
    if (stored) await removeAll([stored]);
    throw error;
  }
});

