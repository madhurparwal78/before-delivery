"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inPickupWindow = inPickupWindow;
exports.bagsOf = bagsOf;
exports.bagOf = bagOf;
exports.setBagItem = setBagItem;
exports.addFlag = addFlag;
exports.flagsOf = flagsOf;
const db_1 = require("../db");
const errors_1 = require("../errors");
const shorts_1 = require("./shorts");
const club_1 = require("./club");
/** The single place that decides the pickup window. */
function inPickupWindow(c, nowSec) {
    if (c.pickup_start_at === null || c.pickup_end_at === null)
        return false;
    return nowSec >= c.pickup_start_at - 12 * 3600 && nowSec <= c.pickup_end_at;
}
function bagsOf(c) {
    const products = (0, club_1.cycleProducts)(c.id);
    const households = (0, db_1.all)(`SELECT DISTINCT h.code, h.name FROM pledges pl
     JOIN households h ON h.code = pl.household_code
     WHERE pl.cycle_id = ? AND pl.household_code != 'club'
     ORDER BY h.code`, c.id);
    const bags = [];
    for (const hh of households) {
        const items = [];
        for (const p of products) {
            const pledged = (0, db_1.one)("SELECT units AS n FROM pledges WHERE cycle_id = ? AND product_id = ? AND household_code = ?", c.id, p.id, hh.code)?.n;
            if (!pledged)
                continue;
            const line = (0, db_1.one)("SELECT status FROM lines WHERE cycle_id = ? AND product_id = ?", c.id, p.id);
            if (line.status === "dropped")
                continue;
            const short = (0, shorts_1.shortSummary)(c.id, p.id, hh.code).units;
            const units = pledged - short;
            if (units <= 0)
                continue;
            const item = (0, db_1.one)("SELECT packed, flagged_units FROM bag_items WHERE cycle_id = ? AND household_code = ? AND product_id = ?", c.id, hh.code, p.id);
            items.push({
                product_id: p.id,
                case_name: p.case_name,
                units,
                packed: item?.packed === 1,
                flagged_units: item?.flagged_units ?? 0,
            });
        }
        if (items.length === 0)
            continue;
        bags.push({
            household_code: hh.code,
            household_name: hh.name,
            packed: items.every((i) => i.packed),
            items,
        });
    }
    return bags;
}
function bagOf(c, householdCode) {
    return bagsOf(c).find((b) => b.household_code === householdCode);
}
/** Toggles one bag item; the window and state are decided in one transaction. */
function setBagItem(c, householdCode, productId, packed, nowSec) {
    return (0, db_1.tx)(() => {
        const cyc = (0, db_1.one)("SELECT * FROM cycles WHERE id = ?", c.id);
        if (cyc.status !== "breakdown")
            throw errors_1.errors.wrongCycleState();
        if (!inPickupWindow(cyc, nowSec))
            throw errors_1.errors.outsidePickupWindow();
        const p = (0, club_1.product)(productId);
        if (!p)
            throw errors_1.errors.notFound();
        const existing = (0, db_1.one)("SELECT packed FROM bag_items WHERE cycle_id = ? AND household_code = ? AND product_id = ?", c.id, householdCode, productId);
        if (existing) {
            (0, db_1.run)("UPDATE bag_items SET packed = ? WHERE cycle_id = ? AND household_code = ? AND product_id = ?", packed ? 1 : 0, c.id, householdCode, productId);
        }
        else {
            (0, db_1.run)("INSERT INTO bag_items (cycle_id, household_code, product_id, packed, flagged_units) VALUES (?, ?, ?, ?, 0)", c.id, householdCode, productId, packed ? 1 : 0);
        }
        return bagOf(cyc, householdCode);
    });
}
function addFlag(c, householdCode, productId, units, nowSec) {
    return (0, db_1.tx)(() => {
        const cyc = (0, db_1.one)("SELECT * FROM cycles WHERE id = ?", c.id);
        if (cyc.status !== "breakdown")
            throw errors_1.errors.wrongCycleState();
        if (!inPickupWindow(cyc, nowSec))
            throw errors_1.errors.outsidePickupWindow();
        const bag = bagOf(cyc, householdCode);
        if (!bag)
            throw errors_1.errors.notFound();
        const item = bag.items.find((i) => i.product_id === productId);
        if (!item)
            throw errors_1.errors.notFound();
        if (units < 1 || units > item.units) {
            throw errors_1.errors.validation({ units: `Enter 1 to ${item.units} units.` });
        }
        const f = (0, db_1.run)("INSERT INTO flags (cycle_id, household_code, product_id, units, created_at) VALUES (?, ?, ?, ?, ?)", c.id, householdCode, productId, units, nowSec);
        (0, db_1.run)("UPDATE bag_items SET flagged_units = flagged_units + ? WHERE cycle_id = ? AND household_code = ? AND product_id = ?", units, c.id, householdCode, productId);
        return { id: Number(f.lastInsertRowid), household_code: householdCode, product_id: productId, units, created_at: nowSec };
    });
}
function flagsOf(cycleId) {
    return (0, db_1.all)("SELECT id, household_code, product_id, units, created_at FROM flags WHERE cycle_id = ? ORDER BY id", cycleId);
}
