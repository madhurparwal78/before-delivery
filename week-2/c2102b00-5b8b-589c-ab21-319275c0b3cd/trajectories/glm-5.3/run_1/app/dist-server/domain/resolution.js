"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLine = resolveLine;
const db_1 = require("../db");
const errors_1 = require("../errors");
const club_1 = require("./club");
/** The single place that decides an unfilled case's one resolution. */
function resolveLine(c, productId, action) {
    (0, db_1.tx)(() => {
        const cyc = (0, club_1.cycle)(c.id);
        const nowSec = Math.floor(Date.now() / 1000);
        const effStatus = cyc.status === "open" && cyc.cutoff_at !== null && nowSec >= cyc.cutoff_at ? "sealing" : cyc.status;
        if (effStatus !== "sealing")
            throw errors_1.errors.wrongCycleState();
        const ln = (0, club_1.line)(c.id, productId);
        if (!ln)
            throw errors_1.errors.notFound();
        if (ln.status === "sealed")
            throw errors_1.errors.lineAlreadyFull();
        if (ln.status === "dropped" || ln.status === "taken_up") {
            throw errors_1.errors.lineAlreadyResolved(ln.status);
        }
        const p = (0, club_1.product)(productId);
        if (action === "drop") {
            (0, db_1.run)("UPDATE lines SET status = 'dropped' WHERE cycle_id = ? AND product_id = ?", c.id, productId);
        }
        else {
            const pledgedRows = (0, db_1.all)("SELECT units FROM pledges WHERE cycle_id = ? AND product_id = ?", c.id, productId);
            const pledged = pledgedRows.reduce((n, r) => n + r.units, 0);
            const remaining = p.pack - pledged;
            (0, db_1.run)("INSERT INTO pledges (cycle_id, product_id, household_code, units, created_at) VALUES (?, ?, 'club', ?, ?)", c.id, productId, remaining, Math.floor(Date.now() / 1000));
            (0, db_1.run)("UPDATE lines SET status = 'taken_up' WHERE cycle_id = ? AND product_id = ?", c.id, productId);
        }
        (0, club_1.bumpVersion)(c.id, productId);
    });
}
