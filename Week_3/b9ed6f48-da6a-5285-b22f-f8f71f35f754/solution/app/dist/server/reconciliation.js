// Monthly reconciliation per currency (brief: Business rules › Reconciliation): the ledger's net
// against Kill Bill's successful purchases minus refunds on this deployment's own accounts.
import { pool, rows } from "./db.js";
import { allPayments } from "./killbill.js";
import { lisbonMonthRange } from "../shared/lisbon.js";
import { CURRENCIES, majorToMinor } from "../shared/money.js";
export async function reconcile(month) {
    const [start, end] = lisbonMonthRange(month);
    const from = new Date(start);
    const to = new Date(end);
    const ledger = await rows(pool, `SELECT currency, SUM(net)::bigint AS net FROM (
       SELECT currency, amount_minor AS net FROM orders WHERE settled_at >= $1 AND settled_at < $2
       UNION ALL
       SELECT o.currency, -r.amount_minor FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.at >= $1 AND r.at < $2
     ) moves GROUP BY currency`, [from, to]);
    const accounts = new Set((await rows(pool, "SELECT account_id FROM killbill_accounts")).map((r) => r.account_id));
    const killbill = new Map(CURRENCIES.map((c) => [c, 0]));
    for (const payment of await allPayments()) {
        if (!accounts.has(payment.accountId))
            continue;
        for (const t of payment.transactions) {
            const at = Date.parse(t.effectiveDate);
            if (t.status !== "SUCCESS" || at < start || at >= end)
                continue;
            const currency = t.currency ?? payment.currency;
            const minor = majorToMinor(t.amount, currency);
            if (t.transactionType === "PURCHASE")
                killbill.set(currency, (killbill.get(currency) ?? 0) + minor);
            if (t.transactionType === "REFUND")
                killbill.set(currency, (killbill.get(currency) ?? 0) - minor);
        }
    }
    return {
        month,
        currencies: CURRENCIES.map((currency) => {
            const ledgerNet = ledger.find((r) => r.currency === currency)?.net ?? 0;
            const killbillNet = killbill.get(currency) ?? 0;
            return { currency, ledger_net_minor: ledgerNet, killbill_net_minor: killbillNet, difference_minor: ledgerNet - killbillNet, matched: ledgerNet === killbillNet };
        }),
    };
}
