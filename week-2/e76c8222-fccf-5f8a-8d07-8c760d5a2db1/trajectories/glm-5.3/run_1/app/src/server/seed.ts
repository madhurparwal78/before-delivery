import crypto from 'node:crypto';
import { pool, withTransaction, type Queryable } from './db.js';
import { applySchema } from './schema.js';
import { putObject } from './services/s3.js';
import { buildTextPdf } from './services/pdf.js';
import { dateKeyInAgencyTz, MS_PER_MINUTE, agencyWallClockToInstant } from './time.js';
import { SETTING_CREDENTIALS, type CredentialType, type Setting } from './types.js';

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

export function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

const PASSCODE = 'weave-demo-2026';

export async function migrateAndSeed(): Promise<void> {
  await withTransaction(async (client) => {
    await applySchema(client);
    const seeded = await client.query<{ seeded: boolean }>(
      'SELECT (value->>\'seeded\')::boolean AS seeded FROM app_kv WHERE key = $1', ['seed_state'],
    );
    if (seeded.rows.length > 0 && seeded.rows[0]?.seeded) return;
    await seed(client);
    await client.query(
      'INSERT INTO app_kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['seed_state', JSON.stringify({ seeded: true, at: new Date().toISOString() })],
    );
  });
}

async function seed(client: Queryable): Promise<void> {
  const T = seedClock();
  const D = dateKeyInAgencyTz(T);

  const orgs: Array<[string, string]> = [
    ['birchmere-clinic', 'Birchmere Community Clinic'],
    ['kestrel-court', 'Kestrel County Circuit Court'],
    ['larchfield-schools', 'Larchfield School District'],
  ];
  for (const [id, name] of orgs) {
    await client.query('INSERT INTO orgs (id, name) VALUES ($1, $2)', [id, name]);
  }

  type UserSeed = { id: string; email: string; name: string; role: string; org_id: string | null };
  const users: UserSeed[] = [
    { id: 'u_rowan', email: 'rowan@fernhollow.test', name: 'Rowan Ilsley', role: 'coordinator', org_id: null },
    { id: 'u_priya', email: 'priya@fernhollow.test', name: 'Priya Castellanos', role: 'coordinator', org_id: null },
    { id: 'u_marguerite', email: 'marguerite@fernhollow.test', name: 'Marguerite Osei', role: 'billing', org_id: null },
    { id: 'u_joel', email: 'joel@birchmere.test', name: 'Joel Haverty', role: 'requester', org_id: 'birchmere-clinic' },
    { id: 'u_anita', email: 'anita@kestrelcourt.test', name: 'Anita Ruiz', role: 'requester', org_id: 'kestrel-court' },
    { id: 'u_tomasz', email: 'tomasz@larchfield.test', name: 'Tomasz Wren', role: 'requester', org_id: 'larchfield-schools' },
    { id: 'u_bea', email: 'bea@consumers.test', name: 'Bea Lindqvist', role: 'consumer', org_id: null },
    { id: 'u_marcus', email: 'marcus@consumers.test', name: 'Marcus Tull', role: 'consumer', org_id: null },
    { id: 'u_dana', email: 'dana@interpreters.test', name: 'Dana Okafor', role: 'interpreter', org_id: null },
    { id: 'u_theo', email: 'theo@interpreters.test', name: 'Theo Marchetti', role: 'interpreter', org_id: null },
    { id: 'u_imani', email: 'imani@interpreters.test', name: 'Imani Brooks', role: 'interpreter', org_id: null },
    { id: 'u_lior', email: 'lior@interpreters.test', name: 'Lior Feld', role: 'interpreter', org_id: null },
    { id: 'u_sam', email: 'sam@interpreters.test', name: 'Sam Whitlock', role: 'interpreter', org_id: null },
    { id: 'u_callum', email: 'callum@interpreters.test', name: 'Callum Reyes', role: 'interpreter', org_id: null },
    { id: 'u_noor', email: 'noor@interpreters.test', name: 'Noor Haddad', role: 'interpreter', org_id: null },
  ];
  for (const u of users) {
    await client.query(
      'INSERT INTO users (id, email, name, role, org_id, passcode_hash) VALUES ($1,$2,$3,$4,$5,$6)',
      [u.id, u.email, u.name, u.role, u.org_id, passcodeHash(PASSCODE)],
    );
  }

  const consumers: Array<[string, string, string]> = [
    ['c_bea', 'u_bea', 'Bea Lindqvist'],
    ['c_marcus', 'u_marcus', 'Marcus Tull'],
  ];
  for (const [id, userId, name] of consumers) {
    await client.query('INSERT INTO consumers (id, user_id, name) VALUES ($1,$2,$3)', [id, userId, name]);
  }

  const interpreters: Array<[string, string, string, string]> = [
    ['i_dana', 'u_dana', 'Dana Okafor', 'dana@interpreters.test'],
    ['i_theo', 'u_theo', 'Theo Marchetti', 'theo@interpreters.test'],
    ['i_imani', 'u_imani', 'Imani Brooks', 'imani@interpreters.test'],
    ['i_lior', 'u_lior', 'Lior Feld', 'lior@interpreters.test'],
    ['i_sam', 'u_sam', 'Sam Whitlock', 'sam@interpreters.test'],
    ['i_callum', 'u_callum', 'Callum Reyes', 'callum@interpreters.test'],
    ['i_noor', 'u_noor', 'Noor Haddad', 'noor@interpreters.test'],
  ];
  for (const [id, userId, name] of interpreters) {
    await client.query('INSERT INTO interpreters (id, user_id, name) VALUES ($1,$2,$3)', [id, userId, name]);
  }

  type CredSeed = { interpreter: string; type: CredentialType; number: string; dayOffset: number };
  const creds: CredSeed[] = [
    { interpreter: 'i_dana', type: 'NIC', number: 'N-40211', dayOffset: 400 },
    { interpreter: 'i_dana', type: 'SC:L', number: 'L-1187', dayOffset: 400 },
    { interpreter: 'i_theo', type: 'NIC', number: 'N-38870', dayOffset: 600 },
    { interpreter: 'i_theo', type: 'SC:L', number: 'L-1203', dayOffset: 600 },
    { interpreter: 'i_imani', type: 'CDI', number: 'C-5521', dayOffset: 700 },
    { interpreter: 'i_lior', type: 'EIPA-4.0', number: 'E-7730', dayOffset: 300 },
    { interpreter: 'i_sam', type: 'NIC', number: 'N-41902', dayOffset: 20 },
    { interpreter: 'i_callum', type: 'NIC', number: 'N-39954', dayOffset: 500 },
    { interpreter: 'i_callum', type: 'SC:L', number: 'L-1150', dayOffset: -2 },
    { interpreter: 'i_noor', type: 'NIC', number: 'N-42617', dayOffset: 900 },
  ];
  for (const c of creds) {
    const credId = newId('cred');
    const expiresOn = addDaysToKey(D, c.dayOffset);
    const key = `credentials/${c.interpreter}/${credId}/scan.pdf`;
    await putObject(key, buildTextPdf([['Credential type', c.type], ['Number', c.number], ['Expiry', expiresOn]]), 'application/pdf');
    await client.query(
      'INSERT INTO credentials (id, interpreter_id, type, number, expires_on, scan_key, scan_filename, warning_sent_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)',
      [credId, c.interpreter, c.type, c.number, expiresOn, key, 'scan.pdf'],
    );
  }

  await client.query(
    "INSERT INTO consumer_preferences (consumer_id, interpreter_id, kind) VALUES ('c_bea','i_dana','preferred'), ('c_bea','i_noor','blocked')",
  );

  for (const setting of Object.keys(SETTING_CREDENTIALS) as Setting[]) {
    const rate = setting === 'medical' ? 8000 : setting === 'legal' ? 10500 : setting === 'education' ? 7000 : 7500;
    await client.query('INSERT INTO rates (setting, hourly_rate_cents) VALUES ($1,$2)', [setting, rate]);
  }

  type SeatSeed = { interpreter: string | null; holder: string | null };
  const openSeat = (): SeatSeed => ({ interpreter: null, holder: null });
  type ReqSeed = {
    ref: string; org: string; setting: Setting; title: string; location: string;
    startH: number; lenH: number; consumer: string; loggedAfter: boolean;
    seats: SeatSeed[];
    timesheet?: { startH: number; endH: number; signature: string; billedHours: string };
  };
  const reqs: ReqSeed[] = [
    { ref: 'FA-1001', org: 'birchmere-clinic', setting: 'medical', title: 'Cardiology follow-up', location: '14 Alder Row, Suite 2', startH: 26, lenH: 1, consumer: 'c_bea', loggedAfter: false, seats: [openSeat()] },
    { ref: 'FA-1002', org: 'kestrel-court', setting: 'legal', title: 'Arraignment, Courtroom 3B', location: 'Kestrel County Courthouse', startH: 30, lenH: 1.5, consumer: 'c_marcus', loggedAfter: false, seats: [openSeat(), openSeat()] },
    { ref: 'FA-1003', org: 'larchfield-schools', setting: 'education', title: 'IEP annual review', location: 'Larchfield Middle, Room 112', startH: 44, lenH: 3, consumer: 'c_marcus', loggedAfter: false, seats: [{ interpreter: 'i_lior', holder: 'u_rowan' }, openSeat()] },
    { ref: 'FA-1004', org: 'birchmere-clinic', setting: 'community', title: 'Diabetes support group', location: 'Birchmere Library hall', startH: 52, lenH: 1.5, consumer: 'c_bea', loggedAfter: false, seats: [{ interpreter: 'i_dana', holder: 'u_rowan' }] },
    {
      ref: 'FA-1005', org: 'birchmere-clinic', setting: 'medical', title: 'Emergency department visit', location: 'Birchmere Community Clinic, ED',
      startH: -24, lenH: 1, consumer: 'c_bea', loggedAfter: true,
      seats: [{ interpreter: 'i_sam', holder: 'u_rowan' }],
      timesheet: { startH: -24, endH: -22 - 40 / 60, signature: 'Sam Whitlock', billedHours: '2.00' },
    },
    { ref: 'FA-1006', org: 'kestrel-court', setting: 'legal', title: 'Bench trial, day one', location: 'Kestrel County Courthouse', startH: 120, lenH: 3, consumer: 'c_marcus', loggedAfter: false, seats: [openSeat(), openSeat()] },
  ];

  for (const r of reqs) {
    const reqId = newId('req');
    const startMs = T.getTime() + r.startH * 60 * MS_PER_MINUTE;
    const endMs = startMs + r.lenH * 60 * MS_PER_MINUTE;
    const durationMin = r.lenH * 60;
    const seatsTotal = r.seats.length;
    let status: string;
    let accepted = 0;
    for (const s of r.seats) if (s.interpreter) accepted++;
    if (r.timesheet) status = 'completed';
    else if (accepted === 0) status = 'submitted';
    else if (accepted === seatsTotal) status = 'staffed';
    else status = 'partially_staffed';
    await client.query(
      `INSERT INTO requests (id, ref, org_id, title, setting, location, start_at, end_at, consumer_id, notes, logged_after, status, seats_total, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'',$10,$11,$12,now(),now())`,
      [reqId, r.ref, r.org, r.title, r.setting, r.location, new Date(startMs), new Date(endMs), r.consumer, r.loggedAfter, status, seatsTotal],
    );
    for (let i = 0; i < r.seats.length; i++) {
      const s = r.seats[i]!;
      const seatId = newId('seat');
      const seatStatus = s.interpreter ? 'accepted' : 'open';
      await client.query(
        'INSERT INTO seats (id, request_id, position, status, interpreter_id, held_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [seatId, reqId, i + 1, seatStatus, s.interpreter, s.holder],
      );
      if (s.interpreter) {
        const offerId = newId('off');
        const sentAt = new Date(startMs - 20 * 60 * MS_PER_MINUTE);
        const expiresAt = new Date(offerExpiryForSeed(sentAt.getTime(), startMs, r.loggedAfter));
        await client.query(
          `INSERT INTO offers (id, seat_id, interpreter_id, coordinator_user_id, status, token, sent_at, expires_at, email_state)
           VALUES ($1,$2,$3,$4,'accepted',$5,$6,$7,'sent')`,
          [offerId, seatId, s.interpreter, s.holder, newToken(), sentAt, expiresAt],
        );
      }
      if (r.timesheet && i === 0) {
        const tsStart = new Date(T.getTime() + r.timesheet.startH * 60 * MS_PER_MINUTE);
        const tsEnd = new Date(T.getTime() + r.timesheet.endH * 60 * MS_PER_MINUTE);
        await client.query(
          `INSERT INTO timesheets (id, seat_id, interpreter_id, request_id, actual_start, actual_end, signature_name, billed_hours, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted',now())`,
          [newId('ts'), seatId, s.interpreter!, reqId, tsStart, tsEnd, r.timesheet.signature, r.timesheet.billedHours],
        );
      }
    }
    if (r.ref === 'FA-1003') {
      const fileId = newId('file');
      const key = `prep/larchfield-schools/${reqId}/${fileId}/fa-1003-agenda.pdf`;
      const bytes = buildTextPdf([['Agenda', 'FA-1003 - Larchfield Middle, Room 112'], ['Item', 'IEP annual review']]);
      await putObject(key, bytes, 'application/pdf');
      await client.query(
        'INSERT INTO prep_files (id, request_id, filename, content_type, size_bytes, storage_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,now())',
        [fileId, reqId, 'fa-1003-agenda.pdf', 'application/pdf', bytes.length, key],
      );
    }
  }
}

function offerExpiryForSeed(pinMs: number, requestStartMs: number, loggedAfter: boolean): number {
  if (loggedAfter) return pinMs + 12 * 60 * MS_PER_MINUTE;
  return Math.min(pinMs + 12 * 60 * MS_PER_MINUTE, requestStartMs - 2 * 60 * MS_PER_MINUTE);
}

function seedClock(): Date {
  // T is the start of the current hour in agency time.
  const now = new Date();
  const key = dateKeyInAgencyTz(now);
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', hour12: false,
  }).format(now);
  return agencyWallClockToInstant(`${key}T${hour === '24' ? '00' : hour}:00`) ?? now;
}

function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const ms = Date.UTC(y!, m! - 1, d!) + days * 86_400_000;
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function passcodeHash(passcode: string): string {
  return crypto.createHash('sha256').update(passcode).digest('hex');
}


