"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueShortNotices = queueShortNotices;
exports.queueReceipt = queueReceipt;
const db_1 = require("../db");
const db_2 = require("../db");
const money_1 = require("../money");
/** Queues the short-shipment notice for each affected household at once. */
function queueShortNotices(c, productId, shortId, affected) {
    const caseName = (0, db_1.one)("SELECT case_name FROM products WHERE id = ?", productId).case_name;
    (0, db_1.tx)(() => {
        for (const a of affected) {
            const hh = (0, db_1.one)("SELECT * FROM households WHERE code = ?", a.pledger);
            if (!hh)
                continue;
            const pledged = (0, db_1.one)("SELECT units AS n FROM pledges WHERE cycle_id = ? AND product_id = ? AND household_code = ?", c.id, productId, a.pledger);
            (0, db_1.run)(`INSERT INTO emails (cycle_id, kind, household_code, to_email, subject, body, message_id, status, failed_attempts, endpoint, created_at)
         VALUES (?, 'short', ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`, c.id, a.pledger, hh.email, `Short shipment: ${caseName}`, `${c.name}: ${a.short_units} of your ${pledged?.n ?? a.short_units} units of ${caseName} did not arrive. You will not be charged for them.`, `short-${shortId}-${a.pledger}@tare-and-tally.example`, db_2.config.mailEndpoint, Math.floor(Date.now() / 1000));
        }
    });
}
/** Queues one pickup receipt per pledging household at close. */
function queueReceipt(c, householdCode, lines, netCents, balanceCents) {
    const hh = (0, db_1.one)("SELECT * FROM households WHERE code = ?", householdCode);
    if (!hh)
        return;
    const bodyLines = [`Pickup receipt for ${hh.name}, ${c.name}`];
    for (const l of lines) {
        let line = `${l.caseName}: ${l.units} units, ${(0, money_1.centsToMoney)(l.shareCents)}`;
        if (l.shortUnits > 0) {
            line += `, short ${l.shortUnits} units, credit ${(0, money_1.centsToMoney)(l.shortCreditCents)}`;
        }
        bodyLines.push(line);
    }
    bodyLines.push(`Charged this cycle: ${(0, money_1.centsToMoney)(netCents)}`);
    bodyLines.push(`New balance: ${(0, money_1.centsToMoney)(balanceCents)}`);
    (0, db_1.run)(`INSERT INTO emails (cycle_id, kind, household_code, to_email, subject, body, message_id, status, failed_attempts, endpoint, created_at)
     VALUES (?, 'receipt', ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`, c.id, householdCode, hh.email, `Pickup receipt: ${c.name}`, bodyLines.join("\n"), `receipt-${c.id}-${householdCode}@tare-and-tally.example`, db_2.config.mailEndpoint, Math.floor(Date.now() / 1000));
}
