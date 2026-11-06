import { randomUUID } from "node:crypto";
import { dbReady, query, tx, rows } from "./db.js";
import { chargeRenewal, completeRenewal, confirmChange, confirmRefund, runDunningStep } from "./domain/billing.js";
import { releaseExpiredHolds } from "./domain/crate.js";
import { stockChanged } from "./domain/stock.js";
import { changeCutoff, derive } from "./domain/subscriptions.js";
import { upcomingRenewal } from "./emails.js";
import { isUp } from "./health.js";
import { accountInvoices, invoice, killBillNow, subscription } from "./killbill.js";
import { sendOutbox } from "./mail.js";
// Scheduled work. Every piece is claimed in Postgres before it runs, so processes sharing the
// database run each piece once; a process whose own probe sees a needed service down leaves the
// work to a process that can reach it.
const PROCESS_ID = randomUUID();
async function claimed(sql) {
    return tx((client) => rows(client, sql));
}
async function confirmChanges() {
    const due = await claimed(`UPDATE change_requests SET claimed_until = now() + interval '20 seconds'
     WHERE id IN (SELECT id FROM change_requests WHERE status = 'pending_provider'
                  AND (claimed_until IS NULL OR claimed_until < now()) LIMIT 20 FOR UPDATE SKIP LOCKED)
     RETURNING *`);
    for (const change of due) {
        await confirmChange(change).catch(() => query("UPDATE change_requests SET claimed_until = NULL WHERE id = $1", [change.id]));
    }
}
async function confirmRefunds() {
    const due = await claimed(`UPDATE refunds SET claimed_until = now() + interval '20 seconds'
     WHERE id IN (SELECT id FROM refunds WHERE status = 'pending_provider'
                  AND (claimed_until IS NULL OR claimed_until < now()) LIMIT 20 FOR UPDATE SKIP LOCKED)
     RETURNING *`);
    for (const refund of due) {
        await confirmRefund(refund).catch(() => query("UPDATE refunds SET claimed_until = NULL WHERE id = $1", [refund.id]));
    }
}
/** Claims the earliest due dunning step whose earlier steps have all run. */
async function runDunning() {
    for (;;) {
        const [step] = await claimed(`UPDATE dunning_steps SET claimed_until = now() + interval '30 seconds'
       WHERE (dunning_id, day) = (
         SELECT s.dunning_id, s.day FROM dunning_steps s JOIN dunning d ON d.id = s.dunning_id
         WHERE d.status = 'open' AND s.done_at IS NULL AND NOT s.dropped AND s.due_at <= now()
           AND (s.claimed_until IS NULL OR s.claimed_until < now())
           AND NOT EXISTS (SELECT 1 FROM dunning_steps e WHERE e.dunning_id = s.dunning_id AND e.day < s.day
                           AND e.done_at IS NULL AND NOT e.dropped)
         ORDER BY s.due_at LIMIT 1 FOR UPDATE OF s SKIP LOCKED)
       RETURNING dunning_id, day`);
        if (!step)
            return;
        try {
            await runDunningStep(step.dunning_id, step.day);
        }
        catch {
            await query("UPDATE dunning_steps SET claimed_until = NULL WHERE dunning_id = $1 AND day = $2", [step.dunning_id, step.day]);
            return;
        }
    }
}
/** Renewal orders Kill Bill has been paid for but whose PDFs could not be stored yet. */
async function retryRenewalDocuments() {
    const due = await claimed(`UPDATE orders SET claimed_until = now() + interval '10 seconds'
     WHERE number IN (SELECT number FROM orders WHERE kind = 'renewal' AND status = 'pending_payment'
                      AND kb_payment_id IS NOT NULL AND (claimed_until IS NULL OR claimed_until < now())
                      LIMIT 10 FOR UPDATE SKIP LOCKED)
     RETURNING number`);
    for (const { number } of due)
        await completeRenewal(number).catch(() => undefined);
}
/** One process at a time polls Kill Bill for renewal invoices and upcoming-renewal notices. */
async function holdLease(name) {
    const [lease] = await query(`INSERT INTO leases (name, holder, until) VALUES ($1, $2, now() + interval '15 seconds')
     ON CONFLICT (name) DO UPDATE SET holder = $2, until = now() + interval '15 seconds'
     WHERE leases.until < now() OR leases.holder = $2
     RETURNING holder`, [name, PROCESS_ID]);
    return lease !== undefined;
}
async function pollSubscriptions() {
    if (!(await holdLease("subscription-poller")))
        return;
    const subs = await query("SELECT * FROM subscriptions WHERE NOT ended ORDER BY created_at");
    const seen = new Set((await query("SELECT invoice_id FROM renewals")).map((r) => r.invoice_id));
    const invoicesByAccount = new Map();
    const kbNow = await killBillNow();
    for (const sub of subs) {
        try {
            let listed = invoicesByAccount.get(sub.account_id);
            if (!listed) {
                listed = await accountInvoices(sub.account_id);
                invoicesByAccount.set(sub.account_id, listed);
            }
            for (const candidate of listed) {
                if (seen.has(candidate.invoiceId) || candidate.status === "VOID")
                    continue;
                const full = await invoice(candidate.invoiceId);
                const owner = full.items.find((i) => i.itemType === "RECURRING" && i.amount > 0)?.subscriptionId;
                if (owner !== sub.id)
                    continue;
                const [claim] = await query(`INSERT INTO renewals (invoice_id, subscription_id, status, claimed_until) VALUES ($1, $2, 'claimed', now() + interval '60 seconds')
           ON CONFLICT (invoice_id) DO NOTHING RETURNING invoice_id`, [full.invoiceId, sub.id]);
                seen.add(full.invoiceId);
                if (claim)
                    await chargeRenewal(sub, full);
            }
            await noticeUpcoming(sub, kbNow);
        }
        catch {
            // Kill Bill hiccup for this subscription: the next poll retries.
        }
    }
}
/** Once per cycle, after the cycle's change cutoff passes, one upcoming-renewal email. */
async function noticeUpcoming(sub, kbNow) {
    const kb = await subscription(sub.id);
    if (kb.state === "CANCELLED" || kb.state === "EXPIRED") {
        await query("UPDATE subscriptions SET ended = true WHERE id = $1", [sub.id]);
        return;
    }
    if (!kb.chargedThroughDate || kbNow < changeCutoff(kb.chargedThroughDate.slice(0, 10)))
        return;
    const [sent] = await query("SELECT 1 FROM upcoming_notices WHERE subscription_id = $1 AND renewal_date = $2", [
        sub.id,
        kb.chargedThroughDate.slice(0, 10),
    ]);
    if (sent)
        return;
    const d = await derive(sub);
    if (d.state !== "active")
        return;
    if (d.skip?.date === d.nextRenewalDate || d.pause?.from === d.nextRenewalDate)
        return;
    await tx(async (client) => {
        const [fresh] = await rows(client, "INSERT INTO upcoming_notices (subscription_id, renewal_date) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING renewal_date", [sub.id, d.nextRenewalDate]);
        if (fresh)
            await upcomingRenewal(client, sub.email, sub.customer_name, d.nextRenewalDate, `/account/subscriptions/${sub.id}`);
    });
}
/** Runs `work` every `ms`, one run at a time, while Postgres and the needed services are up. */
function every(ms, needs, work) {
    let running = false;
    setInterval(() => {
        if (running || !dbReady() || !isUp("postgres") || !needs.every(isUp))
            return;
        running = true;
        work()
            .catch(() => undefined)
            .finally(() => {
            running = false;
        });
    }, ms);
}
export function startWorkers() {
    every(500, [], releaseExpiredHolds);
    every(2000, ["mailpit"], sendOutbox);
    every(1000, ["killbill"], confirmChanges);
    every(1000, ["killbill"], confirmRefunds);
    every(1000, ["killbill"], runDunning);
    every(3000, ["killbill"], pollSubscriptions);
    every(10_000, ["minio"], retryRenewalDocuments);
    every(30_000, [], async () => stockChanged(["guava-lime", "yuzu-ginger", "passionfruit-basil", "cacao-orange"]));
}
