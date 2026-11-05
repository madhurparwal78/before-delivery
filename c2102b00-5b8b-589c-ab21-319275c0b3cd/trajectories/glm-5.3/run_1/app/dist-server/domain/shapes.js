"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLine = buildLine;
exports.buildCycle = buildCycle;
exports.cycleSummary = cycleSummary;
const db_1 = require("../db");
const club_1 = require("./club");
const ledger_1 = require("./ledger");
const time_1 = require("../time");
function buildLine(c, ln, product, viewer) {
    const pledges = (0, db_1.all)("SELECT * FROM pledges WHERE cycle_id = ? AND product_id = ? ORDER BY id", c.id, ln.product_id);
    const pledged = pledges.reduce((n, p) => n + p.units, 0);
    const shorts = (0, db_1.one)("SELECT COUNT(*) AS n FROM short_units WHERE cycle_id = ? AND product_id = ?", c.id, ln.product_id)?.n ?? 0;
    const myUnits = pledges.find((p) => p.household_code === viewer.householdCode)?.units ?? 0;
    const owners = (0, club_1.unitOwners)(c.id, ln.product_id);
    const cells = [];
    for (let i = 1; i <= product.pack; i++) {
        const owner = owners.find((o) => o.unitIndex === i);
        if (!owner)
            cells.push("empty");
        else if (owner.householdCode === viewer.householdCode)
            cells.push("mine");
        else
            cells.push("taken");
    }
    return {
        product_id: ln.product_id,
        case_name: product.case_name,
        pack: product.pack,
        unit: product.unit,
        price_cents: product.price_cents,
        version: ln.version,
        pledged_units: pledged,
        units_to_go: product.pack - pledged,
        status: ln.status,
        short_units: shorts,
        my_units: viewer.role === "member" ? myUnits : null,
        cells,
    };
}
function buildCycle(c, viewer) {
    const tz = (0, club_1.clubTimeZone)();
    const nowSec = Math.floor(Date.now() / 1000);
    const products = (0, db_1.all)(`SELECT p.*, l.status AS status, l.version AS version FROM cycle_products cp
     JOIN products p ON p.id = cp.product_id
     JOIN lines l ON l.cycle_id = cp.cycle_id AND l.product_id = cp.product_id
     WHERE cp.cycle_id = ? ORDER BY cp.sort_order, p.sort_order`, c.id);
    const lines = products.map((p) => buildLine(c, { cycle_id: c.id, product_id: p.id, version: p.version, status: p.status }, p, viewer));
    return {
        id: c.id,
        name: c.name,
        status: (0, club_1.effectiveStatus)(c, nowSec),
        revision: c.revision,
        cutoff_at: (0, time_1.instantToIso)(c.cutoff_at),
        cutoff_display: c.cutoff_at === null ? null : (0, time_1.cutoffDisplay)(c.cutoff_at, tz),
        pickup_start_at: (0, time_1.instantToIso)(c.pickup_start_at),
        pickup_end_at: (0, time_1.instantToIso)(c.pickup_end_at),
        pickup_display: c.pickup_start_at === null || c.pickup_end_at === null
            ? null
            : (0, time_1.pickupDisplay)(c.pickup_start_at, c.pickup_end_at, tz),
        accepting_pledges: (0, club_1.acceptingPledges)(c, nowSec),
        credit: viewer.role === "member" && viewer.householdCode ? (0, ledger_1.creditOf)(viewer.householdCode) : null,
        lines,
    };
}
function cycleSummary(c) {
    const tz = (0, club_1.clubTimeZone)();
    const nowSec = Math.floor(Date.now() / 1000);
    return {
        id: c.id,
        name: c.name,
        status: (0, club_1.effectiveStatus)(c, nowSec),
        cutoff_display: c.cutoff_at === null ? null : (0, time_1.cutoffDisplay)(c.cutoff_at, tz),
    };
}
