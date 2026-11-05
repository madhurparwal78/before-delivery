"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pledgesByDay = pledgesByDay;
const db_1 = require("../db");
const time_1 = require("../time");
const club_1 = require("./club");
/** Pledges counted on the club-local calendar date they were accepted. */
function pledgesByDay(cycleId) {
    const tz = (0, club_1.clubTimeZone)();
    const events = (0, db_1.all)("SELECT delta_units, accepted_at FROM pledge_events WHERE cycle_id = ? ORDER BY accepted_at", cycleId);
    const byDate = new Map();
    for (const e of events) {
        const date = (0, time_1.calendarDate)(e.accepted_at, tz);
        const row = byDate.get(date) ?? { date, units_pledged: 0, units_withdrawn: 0 };
        if (e.delta_units > 0)
            row.units_pledged += e.delta_units;
        else
            row.units_withdrawn += -e.delta_units;
        byDate.set(date, row);
    }
    const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return { time_zone: tz, days };
}
