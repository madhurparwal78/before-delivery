"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordShort = recordShort;
exports.shortSummary = shortSummary;
const db_1 = require("../db");
const errors_1 = require("../errors");
const club_1 = require("./club");
const mail_1 = require("./mail");
/**
 * The single place that decides short-unit selection: the remaining-units
 * check and the short it allows share one write transaction.
 */
function recordShort(c, productId, units) {
    const nowSec = Math.floor(Date.now() / 1000);
    const result = (0, db_1.tx)(() => {
        const cyc = (0, club_1.cycle)(c.id);
        if (cyc.status !== "received" && cyc.status !== "breakdown")
            throw errors_1.errors.wrongCycleState();
        const ln = (0, club_1.line)(c.id, productId);
        if (!ln)
            throw errors_1.errors.notFound();
        if (ln.status !== "sealed" && ln.status !== "taken_up")
            throw errors_1.errors.lineNotSealed();
        const p = (0, club_1.product)(productId);
        const alreadyShort = (0, db_1.one)("SELECT COUNT(*) AS n FROM short_units WHERE cycle_id = ? AND product_id = ?", c.id, productId).n;
        const delivered = p.pack;
        const remaining = delivered - alreadyShort;
        if (units < 1 || units > remaining) {
            throw errors_1.errors.validation({ units: `Enter 1 to ${remaining} units.` });
        }
        // Latest pledges first: highest-numbered units not already short.
        const owners = (0, club_1.unitOwners)(c.id, productId);
        const shortUnitRows = (0, db_1.all)("SELECT unit_index FROM short_units WHERE cycle_id = ? AND product_id = ?", c.id, productId);
        const takenIdx = new Set(shortUnitRows.map((r) => r.unit_index));
        const candidates = owners
            .map((o) => o.unitIndex)
            .filter((idx) => !takenIdx.has(idx))
            .sort((a, b) => b - a);
        const chosen = candidates.slice(0, units);
        const ins = (0, db_1.run)("INSERT INTO shorts (cycle_id, product_id, units, recorded_at) VALUES (?, ?, ?, ?)", c.id, productId, units, nowSec);
        const shortId = Number(ins.lastInsertRowid);
        const byPledger = new Map();
        for (const idx of chosen) {
            const owner = owners.find((o) => o.unitIndex === idx);
            (0, db_1.run)("INSERT INTO short_units (cycle_id, product_id, unit_index, household_code, short_id) VALUES (?, ?, ?, ?, ?)", c.id, productId, idx, owner.householdCode, shortId);
            const credit = (0, club_1.unitShare)(p.price_cents, p.pack, idx);
            const agg = byPledger.get(owner.householdCode) ?? { units: 0, credit: 0 };
            agg.units += 1;
            agg.credit += credit;
            byPledger.set(owner.householdCode, agg);
        }
        (0, club_1.bumpVersion)(c.id, productId);
        return { shortId, byPledger };
    });
    const affected = [];
    for (const [pledger, agg] of result.byPledger) {
        if (pledger === "club")
            continue;
        affected.push({ pledger, short_units: agg.units, credit_cents: agg.credit });
    }
    (0, mail_1.queueShortNotices)(c, productId, result.shortId, affected);
    return { shortId: result.shortId, affected };
}
/** A household's short units on a case, and their credit sum. */
function shortSummary(cycleId, productId, householdCode) {
    const rows = (0, db_1.all)("SELECT unit_index FROM short_units WHERE cycle_id = ? AND product_id = ? AND household_code = ?", cycleId, productId, householdCode);
    const p = (0, club_1.product)(productId);
    let credit = 0;
    for (const r of rows)
        credit += (0, club_1.unitShare)(p.price_cents, p.pack, r.unit_index);
    return { units: rows.length, creditCents: credit };
}
