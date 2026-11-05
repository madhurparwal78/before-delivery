"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.putPledge = putPledge;
exports.withdrawPledge = withdrawPledge;
exports.lineShares = lineShares;
const db_1 = require("../db");
const errors_1 = require("../errors");
const club_1 = require("./club");
const club_2 = require("./club");
/**
 * The single place a pledge is decided and written: cutoff, pack and credit
 * checks and the pledge itself share one write transaction.
 */
function putPledge(c, productId, householdCode, units, nowSec) {
    const p = (0, club_1.product)(productId);
    if (!p)
        throw errors_1.errors.notFound();
    (0, db_1.tx)(() => {
        const cyc = (0, club_1.cycle)(c.id);
        const ln = (0, club_1.line)(c.id, productId);
        if (!ln)
            throw errors_1.errors.notFound();
        if (!(0, club_1.acceptingPledges)(cyc, nowSec))
            throw errors_1.errors.cutoffPassed();
        const existing = (0, db_1.all)("SELECT * FROM pledges WHERE cycle_id = ? AND product_id = ? AND household_code = ?", c.id, productId, householdCode)[0];
        const others = (0, db_1.all)("SELECT * FROM pledges WHERE cycle_id = ? AND product_id = ? AND household_code != ? ORDER BY id", c.id, productId, householdCode);
        const pledgedByOthers = others.reduce((n, r) => n + r.units, 0);
        const current = existing?.units ?? 0;
        const totalAfter = pledgedByOthers + units;
        if (totalAfter > p.pack) {
            throw errors_1.errors.notEnoughUnits(p.pack - pledgedByOthers);
        }
        // Credit: the new hold for this pledge replaces its old one.
        const holdCents = units * (0, club_1.unitHoldCents)(p.price_cents, p.pack);
        const balance = (0, db_1.one)("SELECT COALESCE(SUM(l.amount_cents), 0) AS b FROM legs l WHERE l.account = ?", `household:${householdCode}`).b;
        const holdRows = (0, db_1.all)(`SELECT pl.units, pr.price_cents, pr.pack FROM pledges pl
       JOIN products pr ON pr.id = pl.product_id
       JOIN cycles cy ON cy.id = pl.cycle_id
       LEFT JOIN lines l ON l.cycle_id = pl.cycle_id AND l.product_id = pl.product_id
       WHERE pl.household_code = ? AND cy.status != 'closed' AND (l.status IS NULL OR l.status != 'dropped')
         AND NOT (pl.cycle_id = ? AND pl.product_id = ?)`, householdCode, c.id, productId);
        const holdsOther = holdRows.reduce((n, r) => n + r.units * (0, club_1.unitHoldCents)(r.price_cents, r.pack), 0);
        if (balance - (holdsOther + holdCents) < 0) {
            throw errors_1.errors.insufficientCredit();
        }
        const delta = units - current;
        if (existing) {
            (0, db_1.run)("UPDATE pledges SET units = ? WHERE id = ?", units, existing.id);
        }
        else {
            (0, db_1.run)("INSERT INTO pledges (cycle_id, product_id, household_code, units, created_at) VALUES (?, ?, ?, ?, ?)", c.id, productId, householdCode, units, nowSec);
        }
        (0, db_1.run)("INSERT INTO pledge_events (cycle_id, product_id, household_code, delta_units, accepted_at) VALUES (?, ?, ?, ?, ?)", c.id, productId, householdCode, delta, nowSec);
        (0, club_1.bumpVersion)(c.id, productId);
        const newStatus = totalAfter === p.pack ? "sealed" : "filling";
        (0, db_1.run)("UPDATE lines SET status = ? WHERE cycle_id = ? AND product_id = ?", newStatus, c.id, productId);
    });
}
function withdrawPledge(c, productId, householdCode, nowSec) {
    const p = (0, club_1.product)(productId);
    if (!p)
        throw errors_1.errors.notFound();
    (0, db_1.tx)(() => {
        const cyc = (0, club_1.cycle)(c.id);
        const ln = (0, club_1.line)(c.id, productId);
        if (!ln)
            throw errors_1.errors.notFound();
        const existing = (0, db_1.all)("SELECT * FROM pledges WHERE cycle_id = ? AND product_id = ? AND household_code = ?", c.id, productId, householdCode)[0];
        if (!existing)
            throw errors_1.errors.notFound();
        if (!(0, club_1.acceptingPledges)(cyc, nowSec))
            throw errors_1.errors.cutoffPassed();
        (0, db_1.run)("DELETE FROM pledges WHERE id = ?", existing.id);
        (0, db_1.run)("INSERT INTO pledge_events (cycle_id, product_id, household_code, delta_units, accepted_at) VALUES (?, ?, ?, ?, ?)", c.id, productId, householdCode, -existing.units, nowSec);
        (0, club_1.bumpVersion)(c.id, productId);
        (0, db_1.run)("UPDATE lines SET status = 'filling' WHERE cycle_id = ? AND product_id = ? AND status != 'dropped' AND status != 'taken_up'", c.id, productId);
    });
}
/** Shares of a sealed or taken-up case, in pledge order. */
function lineShares(c, productId) {
    const p = (0, club_1.product)(productId);
    const pledges = (0, club_2.pledgesOfLine)(c.id, productId);
    const base = Math.floor(p.price_cents / p.pack);
    const remainder = p.price_cents - base * p.pack;
    const shares = [];
    let index = 1;
    for (const pl of pledges) {
        let sum = 0;
        for (let i = 0; i < pl.units; i++) {
            sum += base + (index <= remainder ? 1 : 0);
            index += 1;
        }
        shares.push({
            pledger: pl.household_code,
            units: pl.units,
            first_unit: index - pl.units,
            share_cents: sum,
        });
    }
    return { price_cents: p.price_cents, pack: p.pack, unit_base_cents: base, remainder_cents: remainder, shares };
}
