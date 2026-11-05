"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.creditOf = creditOf;
exports.heldCents = heldCents;
exports.movementsOf = movementsOf;
exports.writeMovement = writeMovement;
const db_1 = require("../db");
const club_1 = require("./club");
/** The single place that decides spendable credit. */
function creditOf(code) {
    const bal = (0, db_1.one)("SELECT COALESCE(SUM(l.amount_cents), 0) AS b FROM legs l WHERE l.account = ?", `household:${code}`);
    const balance = bal?.b ?? 0;
    const holds = heldCents(code, Math.floor(Date.now() / 1000));
    return { balance_cents: balance, held_cents: holds, spendable_cents: balance - holds };
}
/** Sum of the household's pledge holds on cycles that are not closed. */
function heldCents(code, nowSec) {
    const rows = (0, db_1.all)(`SELECT p.cycle_id, p.product_id, p.household_code, p.units, pr.price_cents, pr.pack,
            c.status AS cycle_status, l.status AS line_status
     FROM pledges p
     JOIN products pr ON pr.id = p.product_id
     JOIN cycles c ON c.id = p.cycle_id
     LEFT JOIN lines l ON l.cycle_id = p.cycle_id AND l.product_id = p.product_id
     WHERE p.household_code = ?`, code);
    let total = 0;
    for (const r of rows) {
        if (r.cycle_status === "closed")
            continue;
        if (r.line_status === "dropped")
            continue;
        total += r.units * (0, club_1.unitHoldCents)(r.price_cents, r.pack);
    }
    return total;
}
function movementsOf(code, beforeId, limit) {
    const total = (0, db_1.one)("SELECT COUNT(*) AS n FROM movements WHERE household_code = ?", code)?.n ?? 0;
    let rows;
    if (beforeId === null) {
        rows = (0, db_1.all)("SELECT id, kind, cycle_id, memo, created_at FROM movements WHERE household_code = ? ORDER BY id DESC LIMIT ?", code, limit);
    }
    else {
        rows = (0, db_1.all)("SELECT id, kind, cycle_id, memo, created_at FROM movements WHERE household_code = ? AND id < ? ORDER BY id DESC LIMIT ?", code, beforeId, limit);
    }
    const ids = rows.map((r) => r.id);
    const legs = ids.length
        ? (0, db_1.all)(`SELECT movement_id, account, amount_cents FROM legs WHERE movement_id IN (${ids.map(() => "?").join(",")}) ORDER BY rowid`, ...ids)
        : [];
    const byMove = new Map();
    for (const l of legs) {
        const list = byMove.get(l.movement_id) ?? [];
        list.push({ account: l.account, amount_cents: l.amount_cents });
        byMove.set(l.movement_id, list);
    }
    const movements = rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        cycle_id: r.cycle_id,
        memo: r.memo,
        created_at: r.created_at,
        legs: byMove.get(r.id) ?? [],
    }));
    const nextBefore = movements.length === limit && movements.length < total ? movements[movements.length - 1].id : null;
    return { movements, nextBefore, total };
}
/** Writes one movement of two legs. Must be called inside a transaction. */
function writeMovement(householdCode, kind, cycleId, memo, createdAt, debitAccount, creditAccount, amountCents) {
    const m = (0, db_1.run)("INSERT INTO movements (household_code, kind, cycle_id, memo, created_at) VALUES (?, ?, ?, ?, ?)", householdCode, kind, cycleId, memo, createdAt);
    (0, db_1.run)("INSERT INTO legs (movement_id, account, amount_cents) VALUES (?, ?, ?)", m.lastInsertRowid, debitAccount, amountCents);
    (0, db_1.run)("INSERT INTO legs (movement_id, account, amount_cents) VALUES (?, ?, ?)", m.lastInsertRowid, creditAccount, -amountCents);
    return m.lastInsertRowid;
}
