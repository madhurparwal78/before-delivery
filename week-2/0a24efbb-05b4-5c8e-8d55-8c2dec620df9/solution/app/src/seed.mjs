import { appendAudit } from "./audit.mjs";
import { config } from "./config.mjs";
import { CORRECTION_TYPES } from "./rules.mjs";
import { TIME_ZONE, addDays, businessToday, instantOf, isRealDay } from "./time.mjs";

// Benchmark fixture data from the brief's Seed data; every person and the employer are invented.
export const SEED_PASSWORD = "deku-demo-pw-2026";

export const PEOPLE = [
  [1, "admin@example.com", "Priya Sahni", "admin", null, true],
  [2, "manager@example.com", "Dara Finch", "manager", 1, true],
  [3, "manager2@example.com", "Omar Vance", "manager", 1, true],
  [4, "manager3@example.com", "Lena Roth", "manager", 1, true],
  [5, "employee@example.com", "Iris Calder", "employee", 2, true],
  [6, "employee2@example.com", "Tomas Berg", "employee", 2, true],
  [7, "employee3@example.com", "Nadia Kerr", "employee", 2, true],
  [8, "employee4@example.com", "Felix Arno", "employee", 2, true],
  [9, "employee5@example.com", "Suri Patel", "employee", 3, true],
  [10, "employee6@example.com", "Jonas Vale", "employee", 3, true],
  [11, "employee7@example.com", "Mira Okoye", "employee", 3, true],
  [12, "employee8@example.com", "Ravi Setu", "employee", 3, true],
  [13, "employee9@example.com", "Clara Mendt", "employee", 4, true],
  [14, "employee10@example.com", "Bo Lindqvist", "employee", 4, true],
  [15, "employee11@example.com", "Ayaan Qureshi", "employee", 4, true],
  [16, "employee12@example.com", "Greta Solis", "employee", 4, false],
].map(([id, workAddress, name, role, managerId, active]) => ({
  id, workAddress, name, role, managerId, active,
  phone: `07700 9001${String(id).padStart(2, "0")}`,
  privateNote: `Emergency contact held on paper file KW-${String(id).padStart(4, "0")}.`,
}));

const SEEDED_DAYS = 90;
const NO_OUT = [3, 7, 12];
const NO_IN = [18, 25, 31];
const NO_ROW = [44, 60, 75];
const CAP_MONTH_OFFSET = 29;

const LEAVE = [
  [5, "approved", "annual", [5, 9, 13]],
  [19, "approved", "sickness", [5, 9, 13]],
  [9, "pending", "sickness", [6, 10, 14]],
];

// [raiser, day (offset or day of the cap month), type, state, decider, note, reason]
const REQUESTS = [
  [5, 7, "missed_out", "pending", null, null,
    "Left through the loading bay after the late delivery and the reader did not register me."],
  [7, 3, "missed_out", "pending", null, null,
    "The exit reader at the north gate was offline when I left after my shift."],
  [9, 44, "missed_in", "pending", null, null,
    "Came in early for the stock count and the front door reader was not working."],
  [11, 12, "missed_out", "approved", 3, null,
    "Walked out with the fire drill group and never passed a reader on the way."],
  [11, 18, "missed_in", "rejected", 3, "The rota shows annual leave on that day.",
    "My badge was in my other jacket so a colleague let me in that morning."],
  [8, 25, "offsite", "cancelled", null, null,
    "Spent the whole day at the supplier site checking the returned pallets."],
  [13, "cap1", "missed_in", "approved", 4, null,
    "The reader rejected my new badge on the first morning after it was replaced."],
  [13, "cap2", "missed_out", "approved", 4, null,
    "The replacement badge failed again on the way out at the end of the shift."],
  [13, "cap3", "whole_day", "approved", 4, null,
    "Worked the full day at the depot while the badge office reissued my card."],
];

/** The seeding date: the configured or London date, moved back off the 1st, 30th and 31st. */
export function chooseSeededOn(requested = config.employerSeededOn) {
  let day = isRealDay(requested) ? requested : businessToday();
  while (Number(day.slice(8)) < 2 || Number(day.slice(8)) > 29) day = addDays(day, -1);
  return day;
}

/** Seed the exact first state once, in one transaction, on the client holding the boot lock. */
export async function seed(client) {
  if ((await client.query("SELECT 1 FROM employer WHERE id = 1")).rowCount) return;
  const seededOn = chooseSeededOn();
  const at = (offset) => addDays(seededOn, -offset);
  const capFirst = `${at(CAP_MONTH_OFFSET).slice(0, 7)}-01`;
  const dayOf = (key) => (typeof key === "number" ? at(key) : addDays(capFirst, Number(key.slice(-1)) - 1));
  const instant = (day, clock) => new Date(instantOf(day, clock));
  const q = (text, params) => client.query(text, params);

  await q("BEGIN");
  try {
    await q("INSERT INTO employer (id, name, time_zone, seeded_on) VALUES (1, 'Kestrel Works', $1, $2)",
      [TIME_ZONE, seededOn]);
    for (const p of PEOPLE) {
      await q(`INSERT INTO person (id, employer_id, name, work_address, role, manager_id, active, phone, private_note)
               VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8)`,
      [p.id, p.name, p.workAddress, p.role, p.managerId, p.active, p.phone, p.privateNote]);
    }

    const attendance = [];
    for (const p of PEOPLE) {
      const [start, end] = p.id % 2 ? ["09:00", "18:00"] : ["10:00", "19:00"];
      for (let k = 0; k < SEEDED_DAYS; k += 1) {
        if (NO_ROW.includes(k)) continue;
        const day = at(k);
        attendance.push([p.id, day, NO_IN.includes(k) ? null : instant(day, start),
          NO_OUT.includes(k) ? null : instant(day, end)]);
      }
    }
    await q(`INSERT INTO attendance_day (person_id, day, recorded_in, recorded_out, source)
             SELECT * , 'clock' FROM unnest($1::int[], $2::date[], $3::timestamptz[], $4::timestamptz[])`,
      [0, 1, 2, 3].map((i) => attendance.map((row) => row[i])));

    for (const [offset, status, kind, ids] of LEAVE) {
      for (const id of ids) {
        await q("INSERT INTO leave_day (person_id, day, kind, status) VALUES ($1, $2, $3, $4)",
          [id, at(offset), kind, status]);
      }
    }

    const audit = [];
    for (const [index, [raiser, key, type, state, decider, note, reason]] of REQUESTS.entries()) {
      const id = index + 1;
      const day = dayOf(key);
      const decidedAt = decider ? instant(addDays(day, 1), "11:00") : null;
      await q(`INSERT INTO regularisation_request (id, person_id, day, correction_type, claimed_in, claimed_out,
                 reason, state, raised_at, decided_by, decided_at, decision_note)
               VALUES ($1, $2, $3, $4, '09:00', '18:00', $5, $6, $7, $8, $9, $10)`,
        [id, raiser, day, type, reason, state, instant(day, "20:00"), decider, decidedAt, note]);
      if (state === "approved") {
        await q(`INSERT INTO attendance_day (person_id, day, recorded_in, recorded_out, source)
                 VALUES ($1, $2, $3, $4, 'regularisation')
                 ON CONFLICT (person_id, day) DO UPDATE
                   SET recorded_in = EXCLUDED.recorded_in, recorded_out = EXCLUDED.recorded_out, source = 'regularisation'`,
          [raiser, day, instant(day, "09:00"), instant(day, "18:00")]);
      }
      if (decider) audit.push([id, decider, state, decidedAt, note]);
    }
    await q("SELECT setval(pg_get_serial_sequence('regularisation_request', 'id'), $1)", [REQUESTS.length]);

    const policyAt = instant(seededOn, "00:00");
    await q(`INSERT INTO policy (version, employer_id, monthly_cap, lookback_days, enabled_types,
               require_note_on_approve, self_approval_allowed, created_by, created_at)
             VALUES (1, 1, 3, 30, $1, false, false, 1, $2)`, [CORRECTION_TYPES, policyAt]);

    for (const [requestId, actorId, verb, occurredAt, note] of audit) {
      await appendAudit(client, {
        requestId, actorId, actorRole: "manager", verb, subjectType: "request", subjectId: requestId, note, occurredAt,
      });
    }
    await appendAudit(client, {
      actorId: 1, actorRole: "admin", verb: "policy_saved", subjectType: "policy", subjectId: 1, note: "Version 1.",
      occurredAt: policyAt,
    });
    await q("COMMIT");
  } catch (error) {
    await q("ROLLBACK").catch(() => {});
    throw error;
  }
}
