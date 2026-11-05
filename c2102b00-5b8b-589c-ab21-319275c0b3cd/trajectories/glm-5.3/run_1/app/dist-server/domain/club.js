"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clubTimeZone = clubTimeZone;
exports.clubInfo = clubInfo;
exports.household = household;
exports.householdByEmail = householdByEmail;
exports.product = product;
exports.catalogue = catalogue;
exports.cycle = cycle;
exports.line = line;
exports.cycleProducts = cycleProducts;
exports.pledgesOfLine = pledgesOfLine;
exports.nextCycleId = nextCycleId;
exports.effectiveStatus = effectiveStatus;
exports.acceptingPledges = acceptingPledges;
exports.bumpVersion = bumpVersion;
exports.unitOwners = unitOwners;
exports.unitShares = unitShares;
exports.unitShare = unitShare;
exports.unitHoldCents = unitHoldCents;
const db_1 = require("../db");
function clubTimeZone() {
    const row = (0, db_1.one)("SELECT time_zone FROM club WHERE id = 1");
    return row?.time_zone ?? "UTC";
}
function clubInfo() {
    const row = (0, db_1.one)("SELECT * FROM club WHERE id = 1");
    return row;
}
function household(code) {
    return (0, db_1.one)("SELECT * FROM households WHERE code = ?", code);
}
function householdByEmail(email) {
    return (0, db_1.one)("SELECT * FROM households WHERE email = ?", email);
}
function product(id) {
    return (0, db_1.one)("SELECT * FROM products WHERE id = ?", id);
}
function catalogue() {
    return (0, db_1.all)("SELECT * FROM products ORDER BY sort_order, id");
}
function cycle(id) {
    return (0, db_1.one)("SELECT * FROM cycles WHERE id = ?", id);
}
function line(cycleId, productId) {
    return (0, db_1.one)("SELECT * FROM lines WHERE cycle_id = ? AND product_id = ?", cycleId, productId);
}
function cycleProducts(cycleId) {
    return (0, db_1.all)(`SELECT p.* FROM cycle_products cp JOIN products p ON p.id = cp.product_id
     WHERE cp.cycle_id = ? ORDER BY cp.sort_order, p.sort_order`, cycleId);
}
function pledgesOfLine(cycleId, productId) {
    return (0, db_1.all)("SELECT * FROM pledges WHERE cycle_id = ? AND product_id = ? ORDER BY id", cycleId, productId);
}
function nextCycleId() {
    const rows = (0, db_1.all)("SELECT id FROM cycles");
    let max = 44;
    for (const r of rows) {
        const m = /^cy-(\d+)$/.exec(r.id);
        if (m)
            max = Math.max(max, parseInt(m[1], 10));
    }
    return `cy-${max + 1}`;
}
/** The single place that decides a cycle's effective status and acceptance. */
function effectiveStatus(c, nowSec) {
    if (c.status === "open" && c.cutoff_at !== null && nowSec >= c.cutoff_at)
        return "sealing";
    return c.status;
}
function acceptingPledges(c, nowSec) {
    return c.status === "open" && c.cutoff_at !== null && nowSec < c.cutoff_at;
}
function bumpVersion(cycleId, productId) {
    (0, db_1.run)("UPDATE lines SET version = version + 1 WHERE cycle_id = ? AND product_id = ?", cycleId, productId);
}
/** Units 1..pack in pledge order, with the pledger that holds each. */
function unitOwners(cycleId, productId) {
    const rows = pledgesOfLine(cycleId, productId);
    const out = [];
    let index = 1;
    for (const p of rows) {
        for (let i = 0; i < p.units; i++) {
            out.push({ unitIndex: index++, householdCode: p.household_code });
        }
    }
    return out;
}
/** The single place that decides unit shares, including the leftover-cent rule. */
function unitShares(priceCents, pack) {
    const base = Math.floor(priceCents / pack);
    const remainder = priceCents - base * pack;
    return { base, remainder };
}
/** Share of one unit, 1-based in pledge order. */
function unitShare(priceCents, pack, unitIndex) {
    const { base, remainder } = unitShares(priceCents, pack);
    return base + (unitIndex <= remainder ? 1 : 0);
}
/** Per-unit hold amount: price divided by pack, rounded up to a whole cent. */
function unitHoldCents(priceCents, pack) {
    return Math.ceil(priceCents / pack);
}
