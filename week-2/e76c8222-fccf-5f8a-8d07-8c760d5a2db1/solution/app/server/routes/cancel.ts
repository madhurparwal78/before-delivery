// Cancellation: the quote, and the cancel that charges a late fee exactly once.
import type { RequestStatus } from "../../shared/domain.js";
import { audit } from "../audit.js";
import { cancellationChargeKey, cancellationChargeTerms, cancellationDescription, chargeAccount, earlierCharge, postNewCharge } from "../billing.js";
import { pool, transaction } from "../db.js";
import { assertCancellable, cancellationQuote, derivedStatus, openOfferSql, quoteJson, type QuoteFigures } from "../domain/rules.js";
import { cancelledMail, jobOf } from "../emails.js";
import { ApiError, invalid } from "../errors.js";
import { json, route } from "../http.js";
import { idempotent } from "../idempotency.js";
import { deadlineFromNow } from "../killbill.js";
import { formatCents, parseMoney } from "../money.js";
import { enqueue, kickOutbox } from "../outbox.js";
import { observe } from "../sweep.js";
import { refOf, requestView } from "../views.js";
import { acceptedSeats, idParam, rateOf, text, visibleRequest } from "./common.js";

route("GET", "/api/requests/:id/cancellation-quote", ["requester", "coordinator"], async (ctx) => {
  await observe();
  const row = await visibleRequest(pool, ctx.user, idParam(ctx, "id"));
  const now = new Date();
  const status = derivedStatus(row.status, row.end_at, now);
  assertCancellable(status, row.start_at, now);
  const seated = (await acceptedSeats(pool, row.id)).length;
  const figures = cancellationQuote({ status, start: row.start_at, end: row.end_at }, seated, await rateOf(pool, row.setting), now);
  return json(200, { quote: quoteJson(figures) });
});

route("POST", "/api/requests/:id/cancel", ["requester", "coordinator"], async (ctx) => {
  const id = idParam(ctx, "id");
  await visibleRequest(pool, ctx.user, id);
  return idempotent(ctx, "request.cancel", id, async () => {
    const expected = parseMoney(text(ctx.body.expected_fee) ?? "");
    if (expected === null) throw invalid({ expected_fee: "Send the quoted fee as dollars with two decimals." });
    await observe();
    let notifiedSeated = false;
    const quote = await transaction(async (client) => {
      const row = await visibleRequest(client, ctx.user, id, true);
      const now = new Date();
      const status = derivedStatus(row.status, row.end_at, now);
      assertCancellable(status, row.start_at, now);
      const seated = await acceptedSeats(client, row.id);
      const fresh = cancellationQuote({ status, start: row.start_at, end: row.end_at }, seated.length, await rateOf(client, row.setting), now);
      const key = cancellationChargeKey(row.id);
      const deadline = deadlineFromNow();
      const earlier = await earlierCharge(row.org_id, key, deadline);
      let figures: QuoteFigures = fresh;
      if (earlier) {
        const terms = cancellationChargeTerms(earlier);
        figures = {
          ...fresh,
          late: true,
          seated: terms.seated,
          chargeHundredths: terms.chargeHundredths,
          rateCents: terms.rateCents,
          feeCents: terms.feeCents,
          feePerInterpreterCents: Math.trunc(terms.feeCents / Math.max(1, terms.seated)),
        };
      }
      if (figures.feeCents !== expected) throw new ApiError("fee_changed", { quote: quoteJson(figures) }, `The charge is now $${formatCents(figures.feeCents)}.`);
      if (figures.feeCents > 0 && !earlier) {
        const account = await chargeAccount(row.org_id, deadline);
        await postNewCharge(
          account,
          key,
          figures.feeCents,
          cancellationDescription(key, refOf(row.ref_no), figures.seated, figures.chargeHundredths, figures.rateCents),
        );
      }
      const next: RequestStatus = figures.late ? "cancelled_late" : "cancelled_on_time";
      const stored = quoteJson(figures);
      await client.query("UPDATE requests SET status = $2, cancellation_fee_cents = $3, cancellation_quote = $4 WHERE id = $1", [
        row.id,
        next,
        figures.feeCents,
        JSON.stringify(stored),
      ]);
      const reason = text(ctx.body.reason) ?? "";
      await audit(client, {
        actorId: ctx.user.id,
        action: "request.cancelled",
        entity: "request",
        entityId: row.id,
        requestId: row.id,
        from: status,
        to: next,
        detail: { fee: stored.fee, reason },
      });
      const withdrawn = await client.query<{ id: string; interpreter_id: string }>(
        `UPDATE offers o SET status = 'withdrawn' FROM seats s
         WHERE s.id = o.seat_id AND s.request_id = $1 AND ${openOfferSql()}
         RETURNING o.id, o.interpreter_id`,
        [row.id],
      );
      for (const offer of withdrawn.rows) {
        await audit(client, {
          actorId: ctx.user.id,
          action: "offer.withdrawn",
          entity: "offer",
          entityId: offer.id,
          requestId: row.id,
          from: "active",
          to: "withdrawn",
          detail: { interpreter_id: offer.interpreter_id },
        });
      }
      for (const seat of seated) {
        await enqueue(client, cancelledMail(seat.email, jobOf(row), figures.late, stored.fee_per_interpreter));
        notifiedSeated = true;
      }
      return stored;
    });
    if (notifiedSeated) kickOutbox();
    return json(200, { request: await requestView(pool, id), quote });
  });
});
