/**
 * Seat-engine checks against a real PostgreSQL: the published promotion
 * example, the conflict rules, idempotency and the seat event log.
 */

import { createPool } from '../src/server/db/pool.js';
import { installSchemaAndSeed } from '../src/server/db/seed.js';
import {
  reserve,
  cancel,
  joinWaitlist,
  claim,
  release,
  leaveWaitlist,
  setCapacity,
} from '../src/server/booking.js';
import { getSession, readSeats } from '../src/server/seats.js';

const url = process.env.DATABASE_URL ?? '';
const pool = createPool(url);

let fails = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(
    ok ? 'ok  ' : 'FAIL',
    label,
    '=>',
    JSON.stringify(got),
    ok ? '' : 'want ' + JSON.stringify(want),
  );
}

async function accountId(email: string): Promise<number> {
  const res = await pool.query('SELECT id FROM accounts WHERE email = $1', [email]);
  return Number(res.rows[0]!.id);
}

async function addAccount(email: string): Promise<number> {
  await pool.query(
    `INSERT INTO accounts (name, email, password_hash, role) VALUES ($1, $2, 'x', 'attendee')
     ON CONFLICT (email) DO NOTHING`,
    [email, email],
  );
  return accountId(email);
}

async function seatsOf(
  sessionId: string,
): Promise<{ capacity: number; reserved: number; held: number; left: number }> {
  const client = await pool.connect();
  try {
    const session = await getSession(client, sessionId);
    return (await readSeats(client, session!))!;
  } finally {
    client.release();
  }
}

const buildResponse = (r: {
  reservationId: number;
  sessionId: string;
  seats: unknown;
}): { status: number; body: string } => ({
  status: 201,
  body: JSON.stringify({
    reservation: { id: r.reservationId, session_id: r.sessionId },
    seats: r.seats,
  }),
});

async function expectRefusal(
  label: string,
  run: () => Promise<unknown>,
  code: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await run();
    check(label, 'no error', code);
  } catch (err) {
    const e = err as { code: string; extra?: Record<string, unknown> };
    check(label, e.code, code);
    if (extra) check(label + ' extra', e.extra, extra);
  }
}

async function main(): Promise<void> {
  await installSchemaAndSeed(pool);
  const a = await accountId('attendee@example.com');
  const b = await accountId('attendee2@example.com');
  const quinn = await accountId('attendee3@example.com');
  const deps = { pool, holdSeconds: 900, idempotencyKeyTtlSeconds: 86400 };

  check(
    'clone at start',
    await seatsOf('d1-clone-your-writing-voice'),
    { capacity: 2, reserved: 1, held: 0, left: 1 },
  );

  // The published promotion example.
  check(
    'B reserves last seat',
    (await reserve(deps, 'd1-clone-your-writing-voice', b, null, 'v2', buildResponse)).status,
    201,
  );
  check(
    'clone full',
    await seatsOf('d1-clone-your-writing-voice'),
    { capacity: 2, reserved: 2, held: 0, left: 0 },
  );

  check('A position', (await joinWaitlist(deps, 'd1-clone-your-writing-voice', a)).position, 1);
  await reserve(deps, 'd1-hottest-takes', a, null, 'v2', buildResponse);

  const d = await addAccount('late@example.com');
  check('D position', (await joinWaitlist(deps, 'd1-clone-your-writing-voice', d)).position, 2);

  await cancel(deps, 'd1-clone-your-writing-voice', quinn);
  check(
    'after Quinn cancels',
    await seatsOf('d1-clone-your-writing-voice'),
    { capacity: 2, reserved: 1, held: 1, left: 0 },
  );
  const posA = await pool.query(
    `SELECT ROW_NUMBER() OVER (ORDER BY created_at, id)::int AS pos
       FROM waitlist_entries WHERE session_id = 'd1-clone-your-writing-voice' AND account_id = $1`,
    [a],
  );
  check('A still at 1', posA.rows[0]?.pos, 1);

  const cap = await setCapacity(deps, 'd1-clone-your-writing-voice', 3);
  check('capacity raised', cap.seats, { capacity: 3, reserved: 1, held: 1, left: 1 });

  await cancel(deps, 'd1-hottest-takes', a);
  check(
    'A holds after cancelling overlap',
    await seatsOf('d1-clone-your-writing-voice'),
    { capacity: 3, reserved: 1, held: 2, left: 0 },
  );
  const waiting = await pool.query(
    'SELECT COUNT(*)::int AS n FROM waitlist_entries WHERE session_id = $1 AND account_id = $2',
    ['d1-clone-your-writing-voice', a],
  );
  check('A off waitlist', waiting.rows[0]!.n, 0);

  const claimed = await claim(deps, 'd1-clone-your-writing-voice', a);
  check('A claimed', claimed.reservationId > 0, true);
  check(
    'after claim',
    await seatsOf('d1-clone-your-writing-voice'),
    { capacity: 3, reserved: 2, held: 1, left: 0 },
  );

  check(
    'touching allowed',
    (await reserve(deps, 'd1-zero-to-funded', a, null, 'v2', buildResponse)).status,
    201,
  );
  await cancel(deps, 'd1-zero-to-funded', a);

  await expectRefusal(
    'overlap refused',
    () => reserve(deps, 'd1-hottest-takes', a, null, 'v2', buildResponse),
    'time_conflict',
    { conflicts_with: 'd1-clone-your-writing-voice' },
  );

  const key = 'test-key-1';
  const first = await reserve(deps, 'd1-zero-to-funded', b, key, 'v2', buildResponse);
  const replayed = await reserve(deps, 'd1-zero-to-funded', b, key, 'v2', buildResponse);
  check('replay byte-identical', replayed.body, first.body);
  check('replay status', replayed.status, 201);
  await expectRefusal(
    'key reused on another session',
    () => reserve(deps, 'd2-music-app', b, key, 'v2', buildResponse),
    'idempotency_key_reused',
  );
  await cancel(deps, 'd1-zero-to-funded', b);
  check(
    'replay after cancel',
    (await reserve(deps, 'd1-zero-to-funded', b, key, 'v2', buildResponse)).body,
    first.body,
  );

  check(
    'D claims by reserving',
    (await reserve(deps, 'd1-clone-your-writing-voice', d, null, 'v2', buildResponse)).status,
    201,
  );
  await expectRefusal(
    'already reserved',
    () => reserve(deps, 'd1-clone-your-writing-voice', a, null, 'v2', buildResponse),
    'already_reserved',
  );

  const e = await addAccount('late2@example.com');
  const f = await addAccount('late3@example.com');
  await expectRefusal(
    'full refused',
    () => reserve(deps, 'd1-clone-your-writing-voice', e, null, 'v2', buildResponse),
    'session_full',
  );
  await expectRefusal(
    'full refused again',
    () => reserve(deps, 'd1-clone-your-writing-voice', f, null, 'v2', buildResponse),
    'session_full',
  );

  await expectRefusal('seats available', () => joinWaitlist(deps, 'd2-music-app', f), 'seats_available');
  await expectRefusal('not waitlisted', () => leaveWaitlist(deps, 'd2-music-app', f), 'not_waitlisted');
  await expectRefusal('no reservation', () => cancel(deps, 'd2-music-app', f), 'no_reservation');
  await expectRefusal('no hold', () => claim(deps, 'd2-music-app', f), 'no_hold');
  await expectRefusal(
    'below reserved',
    () => setCapacity(deps, 'd1-clone-your-writing-voice', 2),
    'below_reserved',
    { reserved: 3 },
  );

  // Releasing a hold with nobody waiting leaves the seat open.
  await expectRefusal('release without hold', () => release(deps, 'd1-clone-your-writing-voice', f), 'no_hold');

  const events = await pool.query(
    `SELECT kind::text AS kind FROM seat_events WHERE session_id = 'd1-clone-your-writing-voice' ORDER BY id`,
  );
  check(
    'seat events',
    events.rows.map((r) => r.kind),
    ['promoted', 'promoted', 'claimed', 'claimed'],
  );

  console.log(fails === 0 ? 'ALL OK' : `${fails} FAILURES`);
}

main()
  .catch((err) => {
    console.error('ERROR', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
