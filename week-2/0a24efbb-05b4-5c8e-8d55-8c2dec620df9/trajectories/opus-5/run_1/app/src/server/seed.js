import {
  addDays,
  businessInstant,
  businessToday,
  dayOfMonth,
  firstDayOfMonth,
  isBusinessDay,
  monthOf,
  truncateToSecond,
} from '../shared/businessTime.js';
import { CORRECTION_TYPES, EMPLOYER_NAME, TIME_ZONE } from '../shared/constants.js';
import { appendAuditEntry } from './audit.js';
import { writeApprovedAttendance } from './attendance.js';
import { config } from './config.js';
import { LOCKS, lock, transaction } from './db.js';

export const SEEDED_PEOPLE = [
  { id: 1, work_address: 'admin@example.com', name: 'Priya Sahni', role: 'admin', manager_id: null, active: true },
  { id: 2, work_address: 'manager@example.com', name: 'Dara Finch', role: 'manager', manager_id: 1, active: true },
  { id: 3, work_address: 'manager2@example.com', name: 'Omar Vance', role: 'manager', manager_id: 1, active: true },
  { id: 4, work_address: 'manager3@example.com', name: 'Lena Roth', role: 'manager', manager_id: 1, active: true },
  { id: 5, work_address: 'employee@example.com', name: 'Iris Calder', role: 'employee', manager_id: 2, active: true },
  { id: 6, work_address: 'employee2@example.com', name: 'Tomas Berg', role: 'employee', manager_id: 2, active: true },
  { id: 7, work_address: 'employee3@example.com', name: 'Nadia Kerr', role: 'employee', manager_id: 2, active: true },
  { id: 8, work_address: 'employee4@example.com', name: 'Felix Arno', role: 'employee', manager_id: 2, active: true },
  { id: 9, work_address: 'employee5@example.com', name: 'Suri Patel', role: 'employee', manager_id: 3, active: true },
  { id: 10, work_address: 'employee6@example.com', name: 'Jonas Vale', role: 'employee', manager_id: 3, active: true },
  { id: 11, work_address: 'employee7@example.com', name: 'Mira Okoye', role: 'employee', manager_id: 3, active: true },
  { id: 12, work_address: 'employee8@example.com', name: 'Ravi Setu', role: 'employee', manager_id: 3, active: true },
  { id: 13, work_address: 'employee9@example.com', name: 'Clara Mendt', role: 'employee', manager_id: 4, active: true },
  { id: 14, work_address: 'employee10@example.com', name: 'Bo Lindqvist', role: 'employee', manager_id: 4, active: true },
  { id: 15, work_address: 'employee11@example.com', name: 'Ayaan Qureshi', role: 'employee', manager_id: 4, active: true },
  { id: 16, work_address: 'employee12@example.com', name: 'Greta Solis', role: 'employee', manager_id: 4, active: false },
];

export function seededPhone(id) {
  return `07700 9001${String(id).padStart(2, '0')}`;
}

export function seededPrivateNote(id) {
  return `Emergency contact held on paper file KW-${String(id).padStart(4, '0')}.`;
}

const SEEDED_DAY_COUNT = 90;
const NO_SIGN_OUT_OFFSETS = [3, 7, 12];
const NO_SIGN_IN_OFFSETS = [18, 25, 31];
const NO_ROW_OFFSETS = [44, 60, 75];

const LEAVE_SEED = [
  { offset: 5, status: 'approved', kind: 'annual', people: [5, 9, 13] },
  { offset: 19, status: 'approved', kind: 'sickness', people: [5, 9, 13] },
  { offset: 9, status: 'pending', kind: 'sickness', people: [6, 10, 14] },
];

const REQUEST_SEED = [
  {
    id: 1,
    person_id: 5,
    offset: 7,
    correction_type: 'missed_out',
    state: 'pending',
    reason: 'Left through the loading bay after the late delivery and the reader did not register me.',
  },
  {
    id: 2,
    person_id: 7,
    offset: 3,
    correction_type: 'missed_out',
    state: 'pending',
    reason: 'The exit reader at the north gate was offline when I left after my shift.',
  },
  {
    id: 3,
    person_id: 9,
    offset: 44,
    correction_type: 'missed_in',
    state: 'pending',
    reason: 'Came in early for the stock count and the front door reader was not working.',
  },
  {
    id: 4,
    person_id: 11,
    offset: 12,
    correction_type: 'missed_out',
    state: 'approved',
    decided_by: 3,
    reason: 'Walked out with the fire drill group and never passed a reader on the way.',
  },
  {
    id: 5,
    person_id: 11,
    offset: 18,
    correction_type: 'missed_in',
    state: 'rejected',
    decided_by: 3,
    decision_note: 'The rota shows annual leave on that day.',
    reason: 'My badge was in my other jacket so a colleague let me in that morning.',
  },
  {
    id: 6,
    person_id: 8,
    offset: 25,
    correction_type: 'offsite',
    state: 'cancelled',
    reason: 'Spent the whole day at the supplier site checking the returned pallets.',
  },
  {
    id: 7,
    person_id: 13,
    capMonthDay: 1,
    correction_type: 'missed_in',
    state: 'approved',
    decided_by: 4,
    reason: 'The reader rejected my new badge on the first morning after it was replaced.',
  },
  {
    id: 8,
    person_id: 13,
    capMonthDay: 2,
    correction_type: 'missed_out',
    state: 'approved',
    decided_by: 4,
    reason: 'The replacement badge failed again on the way out at the end of the shift.',
  },
  {
    id: 9,
    person_id: 13,
    capMonthDay: 3,
    correction_type: 'whole_day',
    state: 'approved',
    decided_by: 4,
    reason: 'Worked the full day at the depot while the badge office reissued my card.',
  },
];

/** Chosen once, when seeding first runs, and never moved afterwards. */
export function chooseSeededOn(now = new Date()) {
  let day = isBusinessDay(config.employerSeededOn) ? config.employerSeededOn : businessToday(now);
  while (dayOfMonth(day) < 2 || dayOfMonth(day) > 29) day = addDays(day, -1);
  return day;
}

export function capMonthOf(seededOn) {
  return monthOf(addDays(seededOn, -29));
}

function punchTimes(personId) {
  return personId % 2 === 1 ? { in: '09:00', out: '18:00' } : { in: '10:00', out: '19:00' };
}

function requestDay(seed, seededOn) {
  if (seed.capMonthDay !== undefined) {
    return addDays(firstDayOfMonth(capMonthOf(seededOn)), seed.capMonthDay - 1);
  }
  return addDays(seededOn, -seed.offset);
}

async function seedEverything(client, seededOn) {
  await client.query('INSERT INTO employer (id, name, time_zone, seeded_on) VALUES (1, $1, $2, $3)', [
    EMPLOYER_NAME,
    TIME_ZONE,
    seededOn,
  ]);

  for (const person of SEEDED_PEOPLE) {
    await client.query(
      `INSERT INTO person (id, employer_id, name, work_address, role, manager_id, active, subject, phone, private_note)
       VALUES ($1, 1, $2, $3, $4, $5, $6, NULL, $7, $8)`,
      [
        person.id,
        person.name,
        person.work_address,
        person.role,
        person.manager_id,
        person.active,
        seededPhone(person.id),
        seededPrivateNote(person.id),
      ],
    );
  }

  const attendanceValues = [];
  for (const person of SEEDED_PEOPLE) {
    const punches = punchTimes(person.id);
    for (let offset = SEEDED_DAY_COUNT - 1; offset >= 0; offset -= 1) {
      if (NO_ROW_OFFSETS.includes(offset)) continue;
      const day = addDays(seededOn, -offset);
      const recordedIn = NO_SIGN_IN_OFFSETS.includes(offset) ? null : businessInstant(day, punches.in);
      const recordedOut = NO_SIGN_OUT_OFFSETS.includes(offset) ? null : businessInstant(day, punches.out);
      attendanceValues.push([person.id, day, recordedIn, recordedOut]);
    }
  }
  await insertAttendanceRows(client, attendanceValues);

  for (const group of LEAVE_SEED) {
    const day = addDays(seededOn, -group.offset);
    for (const personId of group.people) {
      await client.query('INSERT INTO leave_day (person_id, day, kind, status) VALUES ($1, $2, $3, $4)', [
        personId,
        day,
        group.kind,
        group.status,
      ]);
    }
  }

  const requests = [];
  for (const seed of REQUEST_SEED) {
    const day = requestDay(seed, seededOn);
    const raisedAt = truncateToSecond(businessInstant(day, '20:00'));
    const decided = seed.state === 'approved' || seed.state === 'rejected';
    const decidedAt = decided ? truncateToSecond(businessInstant(addDays(day, 1), '11:00')) : null;
    const row = {
      id: seed.id,
      person_id: seed.person_id,
      day,
      correction_type: seed.correction_type,
      claimed_in: '09:00',
      claimed_out: '18:00',
      reason: seed.reason,
      state: seed.state,
      raised_at: raisedAt,
      decided_by: decided ? seed.decided_by : null,
      decided_at: decidedAt,
      decision_note: seed.decision_note ?? null,
    };
    requests.push(row);
    await client.query(
      `INSERT INTO regularisation_request
        (id, person_id, day, correction_type, claimed_in, claimed_out, reason, state, raised_at, decided_by, decided_at, decision_note, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL)`,
      [
        row.id,
        row.person_id,
        row.day,
        row.correction_type,
        row.claimed_in,
        row.claimed_out,
        row.reason,
        row.state,
        row.raised_at,
        row.decided_by,
        row.decided_at,
        row.decision_note,
      ],
    );
  }
  await client.query("SELECT setval(pg_get_serial_sequence('regularisation_request', 'id'), $1)", [REQUEST_SEED.length]);

  for (const row of requests) {
    if (row.state === 'approved') await writeApprovedAttendance(client, row);
  }

  const policyCreatedAt = truncateToSecond(businessInstant(seededOn, '00:00'));
  await client.query(
    `INSERT INTO policy (version, employer_id, monthly_cap, lookback_days, enabled_types, require_note_on_approve, self_approval_allowed, created_by, created_at)
     VALUES (1, 1, 3, 30, $1, false, false, 1, $2)`,
    [CORRECTION_TYPES, policyCreatedAt],
  );

  for (const id of [4, 5, 7, 8, 9]) {
    const row = requests.find((candidate) => candidate.id === id);
    await appendAuditEntry(client, {
      request_id: row.id,
      actor_id: row.decided_by,
      actor_role: 'manager',
      verb: row.state === 'approved' ? 'approved' : 'rejected',
      subject_type: 'request',
      subject_id: row.id,
      occurred_at: row.decided_at,
      note: row.decision_note,
    });
  }
  await appendAuditEntry(client, {
    request_id: null,
    actor_id: 1,
    actor_role: 'admin',
    verb: 'policy_saved',
    subject_type: 'policy',
    subject_id: 1,
    occurred_at: policyCreatedAt,
    note: 'Version 1.',
  });
}

async function insertAttendanceRows(client, values) {
  const CHUNK = 200;
  for (let start = 0; start < values.length; start += CHUNK) {
    const chunk = values.slice(start, start + CHUNK);
    const placeholders = chunk
      .map((_, index) => `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4}, 'clock')`)
      .join(', ');
    await client.query(
      `INSERT INTO attendance_day (person_id, day, recorded_in, recorded_out, source) VALUES ${placeholders}`,
      chunk.flat(),
    );
  }
}

/**
 * Seeds the exact first state once, guarded across processes. A restart never
 * duplicates, alters or re-dates a seeded row.
 */
export async function ensureSeed() {
  return transaction(async (client) => {
    await lock(client, LOCKS.seed);
    const present = await client.query('SELECT seeded_on FROM employer WHERE id = 1');
    if (present.rows.length > 0) return present.rows[0].seeded_on;
    const seededOn = chooseSeededOn();
    await seedEverything(client, seededOn);
    return seededOn;
  });
}
