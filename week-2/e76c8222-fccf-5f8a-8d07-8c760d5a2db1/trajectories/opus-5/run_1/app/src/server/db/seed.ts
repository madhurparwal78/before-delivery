import { randomBytes, randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { CredentialType, Role, Setting } from '../../shared/types';
import {
  addDaysToAgencyDate,
  agencyDateOf,
  floorToAgencyHour,
} from '../../shared/time';
import { applySeatPlan } from '../domain/requests';
import { billedQuarters, durationMinutesOf } from '../domain/rules';
import { renderPdf } from '../services/pdf';
import { credentialScanKey, prepObjectKey, putObject } from '../services/storage';
import { pool, queryOne, withTransaction } from './pool';

interface SeedOrg {
  id: string;
  name: string;
}

const ORGS: SeedOrg[] = [
  { id: 'birchmere-clinic', name: 'Birchmere Community Clinic' },
  { id: 'kestrel-court', name: 'Kestrel County Circuit Court' },
  { id: 'larchfield-schools', name: 'Larchfield School District' },
];

interface SeedUser {
  name: string;
  email: string;
  role: Role;
  orgId: string | null;
}

const USERS: SeedUser[] = [
  { name: 'Rowan Ilsley', email: 'rowan@fernhollow.test', role: 'coordinator', orgId: null },
  { name: 'Priya Castellanos', email: 'priya@fernhollow.test', role: 'coordinator', orgId: null },
  { name: 'Marguerite Osei', email: 'marguerite@fernhollow.test', role: 'billing', orgId: null },
  { name: 'Joel Haverty', email: 'joel@birchmere.test', role: 'requester', orgId: 'birchmere-clinic' },
  { name: 'Anita Ruiz', email: 'anita@kestrelcourt.test', role: 'requester', orgId: 'kestrel-court' },
  { name: 'Tomasz Wren', email: 'tomasz@larchfield.test', role: 'requester', orgId: 'larchfield-schools' },
  { name: 'Bea Lindqvist', email: 'bea@consumers.test', role: 'consumer', orgId: null },
  { name: 'Marcus Tull', email: 'marcus@consumers.test', role: 'consumer', orgId: null },
  { name: 'Dana Okafor', email: 'dana@interpreters.test', role: 'interpreter', orgId: null },
  { name: 'Theo Marchetti', email: 'theo@interpreters.test', role: 'interpreter', orgId: null },
  { name: 'Imani Brooks', email: 'imani@interpreters.test', role: 'interpreter', orgId: null },
  { name: 'Lior Feld', email: 'lior@interpreters.test', role: 'interpreter', orgId: null },
  { name: 'Sam Whitlock', email: 'sam@interpreters.test', role: 'interpreter', orgId: null },
  { name: 'Callum Reyes', email: 'callum@interpreters.test', role: 'interpreter', orgId: null },
  { name: 'Noor Haddad', email: 'noor@interpreters.test', role: 'interpreter', orgId: null },
];

interface SeedCredential {
  email: string;
  type: CredentialType;
  number: string;
  dayOffset: number;
}

const CREDENTIALS: SeedCredential[] = [
  { email: 'dana@interpreters.test', type: 'NIC', number: 'N-40211', dayOffset: 400 },
  { email: 'dana@interpreters.test', type: 'SC:L', number: 'L-1187', dayOffset: 400 },
  { email: 'theo@interpreters.test', type: 'NIC', number: 'N-38870', dayOffset: 600 },
  { email: 'theo@interpreters.test', type: 'SC:L', number: 'L-1203', dayOffset: 600 },
  { email: 'imani@interpreters.test', type: 'CDI', number: 'C-5521', dayOffset: 700 },
  { email: 'lior@interpreters.test', type: 'EIPA-4.0', number: 'E-7730', dayOffset: 300 },
  { email: 'sam@interpreters.test', type: 'NIC', number: 'N-41902', dayOffset: 20 },
  { email: 'callum@interpreters.test', type: 'NIC', number: 'N-39954', dayOffset: 500 },
  { email: 'callum@interpreters.test', type: 'SC:L', number: 'L-1150', dayOffset: -2 },
  { email: 'noor@interpreters.test', type: 'NIC', number: 'N-42617', dayOffset: 900 },
];

const RATES: Record<Setting, number> = {
  medical: 8000,
  legal: 10500,
  education: 7000,
  community: 7500,
};

interface SeedRequest {
  ref: string;
  orgId: string;
  setting: Setting;
  title: string;
  location: string;
  startMinutes: number;
  endMinutes: number;
  consumerEmail: string;
  status: string;
  loggedAfter: boolean;
  acceptances: { position: number; email: string }[];
}

const HOUR = 60;

const REQUESTS: SeedRequest[] = [
  {
    ref: 'FA-1001',
    orgId: 'birchmere-clinic',
    setting: 'medical',
    title: 'Cardiology follow-up',
    location: '14 Alder Row, Suite 2',
    startMinutes: 26 * HOUR,
    endMinutes: 27 * HOUR,
    consumerEmail: 'bea@consumers.test',
    status: 'submitted',
    loggedAfter: false,
    acceptances: [],
  },
  {
    ref: 'FA-1002',
    orgId: 'kestrel-court',
    setting: 'legal',
    title: 'Arraignment, Courtroom 3B',
    location: 'Kestrel County Courthouse',
    startMinutes: 30 * HOUR,
    endMinutes: 31 * HOUR + 30,
    consumerEmail: 'marcus@consumers.test',
    status: 'submitted',
    loggedAfter: false,
    acceptances: [],
  },
  {
    ref: 'FA-1003',
    orgId: 'larchfield-schools',
    setting: 'education',
    title: 'IEP annual review',
    location: 'Larchfield Middle, Room 112',
    startMinutes: 44 * HOUR,
    endMinutes: 47 * HOUR,
    consumerEmail: 'marcus@consumers.test',
    status: 'partially_staffed',
    loggedAfter: false,
    acceptances: [{ position: 1, email: 'lior@interpreters.test' }],
  },
  {
    ref: 'FA-1004',
    orgId: 'birchmere-clinic',
    setting: 'community',
    title: 'Diabetes support group',
    location: 'Birchmere Library hall',
    startMinutes: 52 * HOUR,
    endMinutes: 53 * HOUR + 30,
    consumerEmail: 'bea@consumers.test',
    status: 'staffed',
    loggedAfter: false,
    acceptances: [{ position: 1, email: 'dana@interpreters.test' }],
  },
  {
    ref: 'FA-1005',
    orgId: 'birchmere-clinic',
    setting: 'medical',
    title: 'Emergency department visit',
    location: 'Birchmere Community Clinic, ED',
    startMinutes: -24 * HOUR,
    endMinutes: -23 * HOUR,
    consumerEmail: 'bea@consumers.test',
    status: 'completed',
    loggedAfter: true,
    acceptances: [{ position: 1, email: 'sam@interpreters.test' }],
  },
  {
    ref: 'FA-1006',
    orgId: 'kestrel-court',
    setting: 'legal',
    title: 'Bench trial, day one',
    location: 'Kestrel County Courthouse',
    startMinutes: 120 * HOUR,
    endMinutes: 123 * HOUR,
    consumerEmail: 'marcus@consumers.test',
    status: 'submitted',
    loggedAfter: false,
    acceptances: [],
  },
];

function requesterEmailOf(orgId: string): string {
  const requester = USERS.find((user) => user.role === 'requester' && user.orgId === orgId);
  if (!requester) throw new Error(`no seeded requester for ${orgId}`);
  return requester.email;
}

const scanFilename = (type: CredentialType, number: string): string =>
  `${type}-${number}`.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf';

async function storeObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  try {
    await putObject(key, bytes, contentType);
  } catch (error) {
    console.error(`seed could not store ${key}`, error);
  }
}

interface PendingObject {
  key: string;
  bytes: Buffer;
  contentType: string;
}

async function insertSeed(client: PoolClient, now: Date): Promise<PendingObject[]> {
  const seedTime = floorToAgencyHour(now);
  const seedDay = agencyDateOf(seedTime);
  const objects: PendingObject[] = [];

  await client.query(`insert into app_meta (key, value) values ('seed_time', $1::jsonb)`, [
    JSON.stringify({ at: seedTime.toISOString() }),
  ]);

  for (const org of ORGS) {
    await client.query('insert into orgs (id, name) values ($1, $2)', [org.id, org.name]);
  }
  for (const [setting, cents] of Object.entries(RATES)) {
    await client.query('insert into rates (setting, cents) values ($1, $2)', [setting, cents]);
  }

  const userIds = new Map<string, string>();
  for (const user of USERS) {
    const id = randomUUID();
    userIds.set(user.email, id);
    await client.query(
      'insert into users (id, name, email, role, org_id) values ($1, $2, $3, $4, $5)',
      [id, user.name, user.email, user.role, user.orgId],
    );
  }
  const userId = (email: string): string => {
    const id = userIds.get(email);
    if (!id) throw new Error(`seed user missing: ${email}`);
    return id;
  };

  await client.query(
    `insert into consumer_preferences (consumer_id, interpreter_id, kind) values ($1, $2, 'preferred')`,
    [userId('bea@consumers.test'), userId('dana@interpreters.test')],
  );
  await client.query(
    `insert into consumer_preferences (consumer_id, interpreter_id, kind) values ($1, $2, 'blocked')`,
    [userId('bea@consumers.test'), userId('noor@interpreters.test')],
  );

  for (const credential of CREDENTIALS) {
    const id = randomUUID();
    const interpreterId = userId(credential.email);
    const expiresOn = addDaysToAgencyDate(seedDay, credential.dayOffset);
    const filename = scanFilename(credential.type, credential.number);
    const key = credentialScanKey(interpreterId, id, filename);
    objects.push({
      key,
      contentType: 'application/pdf',
      bytes: renderPdf([
        `Fernhollow Access credential scan`,
        `Type: ${credential.type}`,
        `Number: ${credential.number}`,
        `Expires on: ${expiresOn}`,
      ]),
    });
    await client.query(
      `insert into credentials
         (id, interpreter_id, type, number, expires_on, scan_key, scan_filename, scan_content_type)
       values ($1, $2, $3, $4, $5, $6, $7, 'application/pdf')`,
      [id, interpreterId, credential.type, credential.number, expiresOn, key, filename],
    );
  }

  const rowan = userId('rowan@fernhollow.test');
  for (const request of REQUESTS) {
    const id = randomUUID();
    const startAt = new Date(seedTime.getTime() + request.startMinutes * 60000);
    const endAt = new Date(seedTime.getTime() + request.endMinutes * 60000);
    await client.query(`select setval('request_ref_seq', $1, true)`, [
      Number(request.ref.slice(3)),
    ]);
    await client.query(
      `insert into requests
         (id, ref, org_id, title, setting, location, start_at, end_at, consumer_id, notes,
          status, logged_after, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '', $10, $11, $12)`,
      [
        id,
        request.ref,
        request.orgId,
        request.title,
        request.setting,
        request.location,
        startAt,
        endAt,
        userId(request.consumerEmail),
        request.status,
        request.loggedAfter,
        userId(requesterEmailOf(request.orgId)),
      ],
    );
    await applySeatPlan(client, id, request.setting, durationMinutesOf(startAt, endAt));

    for (const acceptance of request.acceptances) {
      const seat = await queryOne<{ id: string }>(
        client,
        'select id from seats where request_id = $1 and position = $2',
        [id, acceptance.position],
      );
      if (!seat) throw new Error(`seed seat missing for ${request.ref}`);
      await client.query(
        `insert into offers
           (seat_id, request_id, interpreter_id, held_by, token, status, sent_at, expires_at, answered_at)
         values ($1, $2, $3, $4, $5, 'accepted', $6, $7, $6)`,
        [
          seat.id,
          id,
          userId(acceptance.email),
          rowan,
          randomBytes(32).toString('base64url'),
          new Date(seedTime.getTime() - 2 * 3600000),
          new Date(startAt.getTime() - 2 * 3600000),
        ],
      );
      await client.query(`update seats set status = 'accepted' where id = $1`, [seat.id]);
    }

    if (request.ref === 'FA-1003') {
      const fileId = randomUUID();
      const filename = 'fa-1003-agenda.pdf';
      const key = prepObjectKey(request.orgId, id, fileId, filename);
      const bytes = renderPdf([
        'IEP annual review agenda',
        'Larchfield Middle, Room 112',
        'Attendees: family, teachers, interpreters',
        'Items: progress review, goals, services, placement',
      ]);
      objects.push({ key, bytes, contentType: 'application/pdf' });
      await client.query(
        `insert into prep_files (id, request_id, org_id, filename, size, content_type, object_key)
         values ($1, $2, $3, $4, $5, 'application/pdf', $6)`,
        [fileId, id, request.orgId, filename, bytes.length, key],
      );
    }

    if (request.ref === 'FA-1005') {
      const seat = await queryOne<{ id: string }>(
        client,
        'select id from seats where request_id = $1 and position = 1',
        [id],
      );
      if (!seat) throw new Error('seed seat missing for FA-1005');
      const actualStart = new Date(seedTime.getTime() - 24 * 3600000);
      const actualEnd = new Date(seedTime.getTime() - (22 * 60 + 40) * 60000);
      await client.query(
        `insert into timesheets
           (seat_id, request_id, interpreter_id, actual_start, actual_end, signature_name,
            billed_quarters, status, submitted_at)
         values ($1, $2, $3, $4, $5, 'Sam Whitlock', $6, 'submitted', $7)`,
        [
          seat.id,
          id,
          userId('sam@interpreters.test'),
          actualStart,
          actualEnd,
          billedQuarters(actualStart, actualEnd),
          new Date(seedTime.getTime() - 22 * 3600000),
        ],
      );
    }
  }

  return objects;
}

/** Seed data is inserted only into an empty database, once across serve instances. */
export async function seedIfEmpty(now: Date): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', ['seatweaver:seed']);
    const existing = await client.query<{ count: string }>('select count(*) as count from users');
    if (Number(existing.rows[0]?.count ?? '0') > 0) return false;
    const objects = await withTransaction((tx) => insertSeed(tx, now));
    for (const object of objects) {
      await storeObject(object.key, object.bytes, object.contentType);
    }
    return true;
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1))', ['seatweaver:seed']);
    client.release();
  }
}
