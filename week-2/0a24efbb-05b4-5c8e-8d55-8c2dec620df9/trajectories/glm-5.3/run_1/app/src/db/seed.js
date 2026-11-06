import { addDays, claimedInstant, businessDay, monthOf, firstDayOfMonth, parseDay, formatTimestamp,  } from '../domain/time.js';
import { entryHash, GENESIS_HASH } from '../domain/audit.js';
 '../server/config.js';

export const PEOPLE = [
  { id: 1, work_address: 'admin@example.com', name: 'Priya Sahni', role: 'admin', manager: null, active: true },
  { id: 2, work_address: 'manager@example.com', name: 'Dara Finch', role: 'manager', manager: 1, active: true },
  { id: 3, work_address: 'manager2@example.com', name: 'Omar Vance', role: 'manager', manager: 1, active: true },
  { id: 4, work_address: 'manager3@example.com', name: 'Lena Roth', role: 'manager', manager: 1, active: true },
  { id: 5, work_address: 'employee@example.com', name: 'Iris Calder', role: 'employee', manager: 2, active: true },
  { id: 6, work_address: 'employee2@example.com', name: 'Tomas Berg', role: 'employee', manager: 2, active: true },
  { id: 7, work_address: 'employee3@example.com', name: 'Nadia Kerr', role: 'employee', manager: 2, active: true },
  { id: 8, work_address: 'employee4@example.com', name: 'Felix Arno', role: 'employee', manager: 2, active: true },
  { id: 9, work_address: 'employee5@example.com', name: 'Suri Patel', role: 'employee', manager: 3, active: true },
  { id: 10, work_address: 'employee6@example.com', name: 'Jonas Vale', role: 'employee', manager: 3, active: true },
  { id: 11, work_address: 'employee7@example.com', name: 'Mira Okoye', role: 'employee', manager: 3, active: true },
  { id: 12, work_address: 'employee8@example.com', name: 'Ravi Setu', role: 'employee', manager: 3, active: true },
  { id: 13, work_address: 'employee9@example.com', name: 'Clara Mendt', role: 'employee', manager: 4, active: true },
  { id: 14, work_address: 'employee10@example.com', name: 'Bo Lindqvist', role: 'employee', manager: 4, active: true },
  { id: 15, work_address: 'employee11@example.com', name: 'Ayaan Qureshi', role: 'employee', manager: 4, active: true },
  { id: 16, work_address: 'employee12@example.com', name: 'Greta Solis', role: 'employee', manager: 4, active: false },
];

export const TYPE_CODES = ['missed_in', 'missed_out', 'offsite', 'whole_day', 'night_shift'];

export const TYPE_LABELS = {
  missed_in: 'Sign in was not recorded',
  missed_out: 'Sign out was not recorded',
  offsite: 'Worked away from the workplace',
  whole_day: 'Whole day worked but not recorded',
  night_shift: 'Night shift recorded against the wrong day',
};

const NO_SIGN_OUT_OFFSETS = [3, 7, 12];
const NO_SIGN_IN_OFFSETS = [18, 25, 31];
const NO_ROW_OFFSETS = [44, 60, 75];

const personById = new Map(PEOPLE.map((p) => [p.id, p]));

export function phoneFor(id) {
  return `07700 9001${String(id).padStart(2, '0')}`;
}

export function privateNoteFor(id) {
  return `Emergency contact held on paper file KW-${String(id).padStart(4, '0')}.`;
}

/** The employer's seeded_on, chosen once on first seeding. */
export function chooseSeededOn(nowDate) {
  let day;
  const env = process.env.EMPLOYER_SEEDED_ON;
  if (env && parseDay(env)) {
    day = env;
  } else {
    day = businessDay(nowDate);
  }
  // If it falls on the 1st, 30th or 31st, move back to the nearest earlier
  // date whose day of the month is 2 to 29.
  while (true) {
    const d = Number(day.slice(8, 10));
    if (d >= 2 && d <= 29) break;
    day = addDays(day, -1);
  }
  return day;
}

function personName(id) {
  return personById.get(id).name;
}

/** 20:00 local London on the given business day. */
function at2000(day) {
  return claimedInstant(day, '20:00');
}
function at1100(day) {
  return claimedInstant(day, '11:00');
}
function at0000(day) {
  // 00:00 on the London calendar day
  return claimedInstant(day, '00:00');
}

export async function seedIfEmpty(client, nowDate) {
  // Guard across processes with postgres advisory lock.
  await client.query('SELECT pg_advisory_lock(740812, 1)');
  try {
    const existing = await client.query('SELECT id FROM employer LIMIT 1');
    if (existing.rowCount > 0) return false;

    const seededOn = chooseSeededOn(nowDate);

    try {
      await client.query('BEGIN');

      await client.query(
        'INSERT INTO employer (id, name, time_zone, seeded_on) VALUES (1, $1, $2, $3)',
        ['Kestrel Works', 'Europe/London', seededOn]
      );

    for (const p of PEOPLE) {
      await client.query(
        `INSERT INTO person (id, employer_id, name, work_address, role, manager_id, active, subject, phone, private_note)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [p.id, p.name, p.work_address, p.role, p.manager, p.active,
          null, phoneFor(p.id), privateNoteFor(p.id)]
      );
    }

    // attendance: offsets 0..89, odd ids 09:00-18:00, even ids 10:00-19:00,
    // with the deliberate gaps; approved regularisations are applied afterwards.
    const attendanceRows = [];
    for (const p of PEOPLE) {
      const signIn = p.id % 2 === 1 ? '09:00' : '10:00';
      const signOut = p.id % 2 === 1 ? '18:00' : '19:00';
      for (let offset = 0; offset <= 89; offset++) {
        if (NO_ROW_OFFSETS.includes(offset)) continue;
        const day = addDays(seededOn, -offset);
        const inTime = NO_SIGN_IN_OFFSETS.includes(offset) ? null : new Date(claimedInstant(day, signIn));
        const outTime = NO_SIGN_OUT_OFFSETS.includes(offset) ? null : new Date(claimedInstant(day, signOut));
        attendanceRows.push([p.id, day, inTime, outTime, 'clock']);
      }
    }

    // requests 1..9 (needed before applying approvals)
    const capMonthFirstOffset = Number(seededOn.slice(8, 10)); // last day of cap month is this many days before seeded_on
    const capMonthLastDay = addDays(seededOn, -capMonthFirstOffset);
    const capMonth = monthOf(capMonthLastDay);

    const requestSpecs = [
      { id: 1, person: 5, offset: 7, type: 'missed_out', claimed: ['09:00', '18:00'], state: 'pending' },
      { id: 2, person: 7, offset: 3, type: 'missed_out', claimed: ['09:00', '18:00'], state: 'pending' },
      { id: 3, person: 9, offset: 44, type: 'missed_in', claimed: ['09:00', '18:00'], state: 'pending' },
      { id: 4, person: 11, offset: 12, type: 'missed_out', claimed: ['09:00', '18:00'], state: 'approved', decider: 3 },
      { id: 5, person: 11, offset: 18, type: 'missed_in', claimed: ['09:00', '18:00'], state: 'rejected', decider: 3, note: 'The rota shows annual leave on that day.' },
      { id: 6, person: 8, offset: 25, type: 'offsite', claimed: ['09:00', '18:00'], state: 'cancelled' },
      { id: 7, person: 13, capDay: 1, type: 'missed_in', claimed: ['09:00', '18:00'], state: 'approved', decider: 4 },
      { id: 8, person: 13, capDay: 2, type: 'missed_out', claimed: ['09:00', '18:00'], state: 'approved', decider: 4 },
      { id: 9, person: 13, capDay: 3, type: 'whole_day', claimed: ['09:00', '18:00'], state: 'approved', decider: 4 },
    ];

    const REASONS = [
      'Left through the loading bay after the late delivery and the reader did not register me.',
      'The exit reader at the north gate was offline when I left after my shift.',
      'Came in early for the stock count and the front door reader was not working.',
      'Walked out with the fire drill group and never passed a reader on the way.',
      'My badge was in my other jacket so a colleague let me in that morning.',
      'Spent the whole day at the supplier site checking the returned pallets.',
      'The reader rejected my new badge on the first morning after it was replaced.',
      'The replacement badge failed again on the way out at the end of the shift.',
      'Worked the full day at the depot while the badge office reissued my card.',
    ];

    for (const spec of requestSpecs) {
      const day = spec.offset !== undefined
        ? addDays(seededOn, -spec.offset)
        : addDays(firstDayOfMonth(capMonth), spec.capDay - 1);
      const raisedAt = at2000(day);
      const decidedAt = spec.decider ? at1100(addDays(day, 1)) : null;
      await client.query(
        `INSERT INTO regularisation_request (id, person_id, day, correction_type, claimed_in, claimed_out, reason, state, raised_at, decided_by, decided_at, decision_note)
         OVERRIDING SYSTEM VALUE
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [spec.id, spec.person, day, spec.type, spec.claimed[0], spec.claimed[1], REASONS[spec.id - 1],
          spec.state, new Date(raisedAt),
          spec.decider ?? null, decidedAt ? new Date(decidedAt) : null, spec.note ?? null]
      );
    }
    // Live requests continue after the seeded ones.
    await client.query(
      `SELECT setval(pg_get_serial_sequence('regularisation_request', 'id'),
         (SELECT COALESCE(MAX(id), 1) FROM regularisation_request))`
    );

    // leave: nine rows
    const leaveSpec = [
      { offset: 5, status: 'approved', kind: 'annual', people: [5, 9, 13] },
      { offset: 19, status: 'approved', kind: 'sickness', people: [5, 9, 13] },
      { offset: 9, status: 'pending', kind: 'sickness', people: [6, 10, 14] },
    ];
    for (const l of leaveSpec) {
      const day = addDays(seededOn, -l.offset);
      for (const pid of l.people) {
        await client.query(
          'INSERT INTO leave_day (person_id, day, kind, status) VALUES ($1,$2,$3,$4)',
          [pid, day, l.kind, l.status]
        );
      }
    }

    // policy version 1
    const policyCreatedAt = at0000(addDays(seededOn, -1));
    await client.query(
      `INSERT INTO policy (version, employer_id, monthly_cap, lookback_days, enabled_types, require_note_on_approve, self_approval_allowed, created_by, created_at)
       VALUES (1, 1, 3, 30, $1, false, false, 1, $2)`,
      [TYPE_CODES, new Date(policyCreatedAt)]
    );

    // audit trail: six entries chained from genesis
    const auditSpecs = [
      { seq: 1, requestId: 4, actor: 3, verb: 'approved', subjectType: 'request', subjectId: 4 },
      { seq: 2, requestId: 5, actor: 3, verb: 'rejected', subjectType: 'request', subjectId: 5,
        note: 'The rota shows annual leave on that day.' },
      { seq: 3, requestId: 7, actor: 4, verb: 'approved', subjectType: 'request', subjectId: 7 },
      { seq: 4, requestId: 8, actor: 4, verb: 'approved', subjectType: 'request', subjectId: 8 },
      { seq: 5, requestId: 9, actor: 4, verb: 'approved', subjectType: 'request', subjectId: 9 },
      { seq: 6, requestId: null, actor: 1, verb: 'policy_saved', subjectType: 'policy', subjectId: 1,
        note: 'Version 1.' },
    ];

    let prevHash = GENESIS_HASH;
    for (const a of auditSpecs) {
      let occurredAt;
      if (a.subjectType === 'policy') {
        occurredAt = policyCreatedAt;
      } else {
        const req = requestSpecs.find((r) => r.id === a.requestId);
        const day = req.offset !== undefined
          ? addDays(seededOn, -req.offset)
          : addDays(firstDayOfMonth(capMonth), req.capDay - 1);
        occurredAt = at1100(addDays(day, 1));
      }
      const actor = personById.get(a.actor);
      const entry = {
        seq: a.seq,
        at: formatTimestamp(new Date(occurredAt)),
        actor_id: actor.id,
        action: a.verb,
        subject_type: a.subjectType,
        subject_id: a.subjectId,
        detail: a.note ?? null,
        prev_hash: prevHash,
      };
      const hash = entryHash(entry);
      await client.query(
        `INSERT INTO audit_event (seq, request_id, actor_id, actor_role, verb, subject_type, subject_id, occurred_at, note, prev_hash, entry_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [a.seq, a.requestId, a.actor, actor.role, a.verb, a.subjectType, a.subjectId,
          new Date(occurredAt), a.note ?? null, prevHash, hash]
      );
      prevHash = hash;
    }

    // apply the four approved regularisations to attendance, exactly as a live
    // approval would: 09:00-18:00, source regularisation, row created if missing.
    for (const spec of requestSpecs.filter((r) => r.state === 'approved')) {
      const day = spec.offset !== undefined
        ? addDays(seededOn, -spec.offset)
        : addDays(firstDayOfMonth(capMonth), spec.capDay - 1);
      const recIn = claimedInstant(day, spec.claimed[0]);
      const recOut = claimedInstant(day, spec.claimed[1]);
      const idx = attendanceRows.findIndex((r) => r[0] === spec.person && r[1] === day);
      if (idx >= 0) {
        attendanceRows[idx][2] = new Date(recIn);
        attendanceRows[idx][3] = new Date(recOut);
        attendanceRows[idx][4] = 'regularisation';
      } else {
        attendanceRows.push([spec.person, day, new Date(recIn), new Date(recOut), 'regularisation']);
      }
    }

    for (const row of attendanceRows) {
      await client.query(
        'INSERT INTO attendance_day (person_id, day, recorded_in, recorded_out, source) VALUES ($1,$2,$3,$4,$5)',
        row
      );
    }

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(740812, 1)').catch(() => {});
  }
}
