import { randomUUID } from "node:crypto";
import { allow, CUSTOMER, signedIn } from "../context.js";
import { query } from "../db.js";
import { cardDeclined, recover } from "../domain/billing.js";
import { approves, requireCard } from "../domain/card.js";
import { changeJson, checkChange, derive, effectiveDate, subscriptionJson, subscriptionRow, } from "../domain/subscriptions.js";
import { ApiError, int, notFound, str, validation } from "../http.js";
import { paymentMethodFor } from "../killbill.js";
async function own(ctx) {
    const user = await signedIn(ctx);
    const row = await subscriptionRow(ctx.params[0], user.id);
    if (!row)
        throw notFound();
    allow(user, CUSTOMER);
    return row;
}
export async function listSubscriptions(ctx) {
    const user = await signedIn(ctx);
    allow(user, CUSTOMER);
    const owned = await query("SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
    const shown = [];
    for (const row of owned)
        shown.push(await subscriptionJson(row, await derive(row)));
    return { status: 200, body: { subscriptions: shown } };
}
export async function getSubscription(ctx) {
    const row = await own(ctx);
    return { status: 200, body: { subscription: await subscriptionJson(row, await derive(row)) } };
}
const KINDS = ["pause", "resume", "skip", "swap", "cancel"];
export async function requestChange(ctx) {
    const row = await own(ctx);
    const kind = str(ctx.body, "kind");
    const request = { kind: kind ?? "pause", cycles: int(ctx.body, "cycles"), plan: str(ctx.body, "plan") };
    const d = await derive(row);
    const [pending] = await query("SELECT id FROM change_requests WHERE subscription_id = $1 AND status = 'pending_provider'", [row.id]);
    if (!kind || !KINDS.includes(kind)) {
        if (pending)
            throw new ApiError(409, "change_pending", "A change is already waiting for confirmation.");
        throw validation({ kind: "Choose pause, resume, skip, swap or cancel." });
    }
    checkChange(request, d, pending !== undefined);
    const effective = effectiveDate(request, d);
    const id = randomUUID();
    const [change] = await query(`INSERT INTO change_requests (id, subscription_id, kind, cycles, plan, status, effective_date)
     VALUES ($1, $2, $3, $4, $5, 'pending_provider', $6) ON CONFLICT DO NOTHING RETURNING *`, [id, row.id, kind, request.cycles ?? null, request.plan ?? null, effective]);
    if (!change)
        throw new ApiError(409, "change_pending", "A change is already waiting for confirmation.");
    return { status: 202, body: { change: changeJson(change) } };
}
export async function getChange(ctx) {
    const row = await own(ctx);
    const [change] = await query("SELECT * FROM change_requests WHERE id::text = $1 AND subscription_id = $2", [
        ctx.params[1],
        row.id,
    ]);
    if (!change)
        throw notFound();
    return { status: 200, body: { change: changeJson(change) } };
}
export async function updateCard(ctx) {
    const row = await own(ctx);
    const d = await derive(row);
    if (d.state === "cancel_pending" || d.state === "cancelled") {
        throw new ApiError(409, "illegal_change", "That change isn't possible right now.");
    }
    const card = requireCard(ctx.body);
    if (!approves(card.behaviour, true))
        throw cardDeclined();
    const paymentMethodId = await paymentMethodFor(row.account_id);
    const [updated] = await query(`UPDATE subscriptions SET card_brand = $2, card_last4 = $3, card_exp_month = $4, card_exp_year = $5,
       card_behaviour = $6, payment_method_id = $7 WHERE id = $1 RETURNING *`, [row.id, card.brand, card.last4, card.expiryMonth, card.expiryYear, card.behaviour, paymentMethodId]);
    if (d.state === "past_due" && d.dunning)
        await recover(updated, d.dunning);
    return { status: 200, body: { subscription: await subscriptionJson(updated, await derive(updated)) } };
}
