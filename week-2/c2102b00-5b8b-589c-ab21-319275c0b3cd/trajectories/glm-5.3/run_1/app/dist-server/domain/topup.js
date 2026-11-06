"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmTopup = confirmTopup;
exports.topupsOf = topupsOf;
const db_1 = require("../db");
const errors_1 = require("../errors");
const money_1 = require("../money");
const db_2 = require("../db");
const ledger_1 = require("./ledger");
const killbill_1 = require("../providers/killbill");
/** Confirms a top-up with Kill Bill and writes its single ledger movement. */
async function confirmTopup(householdCode, idempotencyKey, amountCents) {
    const hh = (0, db_1.one)("SELECT * FROM households WHERE code = ?", householdCode);
    const externalKey = `topup-${householdCode}-${idempotencyKey}`;
    const accountKey = `${db_2.config.kbKeyPrefix}-${householdCode}`;
    let accountId = await (0, killbill_1.findAccount)(accountKey);
    if (accountId === null) {
        accountId = await (0, killbill_1.createAccount)(accountKey, hh.name, hh.email);
    }
    await (0, killbill_1.ensurePaymentMethod)(accountId);
    const payment = await (0, killbill_1.findPaymentByExternalKey)(externalKey);
    if (payment !== null) {
        const txn = payment.transactions?.find((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS");
        const paidCents = txn ? (0, money_1.dollarsNumberToCents)(txn.amount) : null;
        if (txn && paidCents !== null && paidCents === amountCents) {
            return finalizeTopup(householdCode, idempotencyKey, amountCents);
        }
        if (txn && paidCents !== null && paidCents !== amountCents) {
            throw errors_1.errors.idempotencyKeyReused();
        }
        if (txn && paidCents === null)
            throw errors_1.errors.paymentsPaused();
    }
    await (0, killbill_1.createPurchase)(accountId, (0, money_1.centsToDollarsString)(amountCents), externalKey);
    return finalizeTopup(householdCode, idempotencyKey, amountCents);
}
function finalizeTopup(householdCode, idempotencyKey, amountCents) {
    const nowSec = Math.floor(Date.now() / 1000);
    return (0, db_1.tx)(() => {
        const already = (0, db_1.one)("SELECT * FROM topups WHERE household_code = ? AND idempotency_key = ?", householdCode, idempotencyKey);
        if (already) {
            return {
                topup: { id: already.id, amount_cents: already.amount_cents, status: "confirmed", created_at: already.created_at },
                credit: (0, ledger_1.creditOf)(householdCode),
            };
        }
        const t = (0, db_1.run)("INSERT INTO topups (household_code, amount_cents, idempotency_key, created_at) VALUES (?, ?, ?, ?)", householdCode, amountCents, idempotencyKey, nowSec);
        (0, ledger_1.writeMovement)(householdCode, "top_up", null, "Top-up", nowSec, `household:${householdCode}`, "clearing:killbill", amountCents);
        return {
            topup: { id: Number(t.lastInsertRowid), amount_cents: amountCents, status: "confirmed", created_at: nowSec },
            credit: (0, ledger_1.creditOf)(householdCode),
        };
    });
}
function topupsOf(householdCode) {
    return (0, db_1.all)("SELECT id, amount_cents, 'confirmed' AS status, created_at FROM topups WHERE household_code = ? ORDER BY id DESC", householdCode);
}
