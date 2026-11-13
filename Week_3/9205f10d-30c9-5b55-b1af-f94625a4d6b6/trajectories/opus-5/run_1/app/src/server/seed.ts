import { transact, type Queryable } from './db.js';
import { hashPassword, newId } from './ids.js';
import { addDaysLocal, isoDate, resolveLocalForgiving, toLocal } from './domain/agency-time.js';
import type { CredentialType, RequestStatus, SeatLabel, Setting } from '../shared/types.js';

const SEED_PASSWORD = 'relay-demo-2026';
const FAR_EXPIRY = '2030-12-31';

interface OrganisationSeed {
  code: string;
  name: string;
  hourly_rate: string;
  scheduler: { display_name: string; email: string };
}

const ORGANISATIONS: OrganisationSeed[] = [
  {
    code: 'HPMC',
    name: 'Harbor Point Medical Center',
    hourly_rate: '97.50',
    scheduler: { display_name: 'Jordan Baptiste', email: 'sched@harborpoint.example' },
  },
  {
    code: 'LKSU',
    name: 'Lakemont State University',
    hourly_rate: '86.25',
    scheduler: { display_name: 'Avery Lindqvist', email: 'sched@lakemont.example' },
  },
  {
    code: 'ECCC',
    name: 'Ellery County Circuit Court',
    hourly_rate: '110.00',
    scheduler: { display_name: 'Sam Whitfield', email: 'sched@ellerycourt.example' },
  },
];

interface InterpreterSeed {
  display_name: string;
  full_name: string;
  email: string;
  phone: string;
  home_area: string;
  pay_rate: string;
  credentials: CredentialType[];
}

const INTERPRETERS: InterpreterSeed[] = [
  {
    display_name: 'Rosa D.',
    full_name: 'Rosa Delgado-Finch',
    email: 'rosa@interpreters.example',
    phone: '(555) 010-0141',
    home_area: 'North Halden',
    pay_rate: '58.00',
    credentials: ['NIC'],
  },
  {
    display_name: 'Theo M.',
    full_name: 'Theo Marchetti',
    email: 'theo@interpreters.example',
    phone: '(555) 010-0142',
    home_area: 'Marrow Bay',
    pay_rate: '55.00',
    credentials: ['NIC'],
  },
  {
    display_name: 'Kemi A.',
    full_name: 'Kemi Adeyemi',
    email: 'kemi@interpreters.example',
    phone: '(555) 010-0143',
    home_area: 'Ellery',
    pay_rate: '64.00',
    credentials: ['NIC', 'SC:L'],
  },
  {
    display_name: 'Wren C.',
    full_name: 'Wren Castellanos',
    email: 'wren@interpreters.example',
    phone: '(555) 010-0144',
    home_area: 'Marrow Bay',
    pay_rate: '50.00',
    credentials: ['EIPA'],
  },
  {
    display_name: 'Malik O.',
    full_name: 'Malik Osei',
    email: 'malik@interpreters.example',
    phone: '(555) 010-0145',
    home_area: 'Halden',
    pay_rate: '60.00',
    credentials: ['CDI'],
  },
  {
    display_name: 'Ines P.',
    full_name: 'Ines Park',
    email: 'ines@interpreters.example',
    phone: '(555) 010-0146',
    home_area: 'South Halden',
    pay_rate: '56.00',
    credentials: ['NIC'],
  },
];

interface RequestSeed {
  reference: string;
  organisation_code: string;
  setting: Setting;
  required_credential: CredentialType;
  day_offset: number;
  hour: number;
  minute: number;
  duration_minutes: number;
  team_size: number;
  rotation_minutes: number;
  city: string;
  location_address: string;
  consumer_name: string;
  notes: string;
  status: RequestStatus;
  actual_minutes: number | null;
  seats: { label: SeatLabel; interpreter_email: string | null }[];
}

const REQUESTS: RequestSeed[] = [
  {
    reference: 'CR-1001',
    organisation_code: 'HPMC',
    setting: 'medical',
    required_credential: 'NIC',
    day_offset: 3,
    hour: 9,
    minute: 0,
    duration_minutes: 120,
    team_size: 2,
    rotation_minutes: 20,
    city: 'Halden',
    location_address: '400 Harbor Point Way',
    consumer_name: 'Elena Brandt',
    notes: 'Cardiology follow-up; patient prefers interpreters to the left of the screen.',
    status: 'half-staffed',
    actual_minutes: null,
    seats: [
      { label: 'A', interpreter_email: 'rosa@interpreters.example' },
      { label: 'B', interpreter_email: null },
    ],
  },
  {
    reference: 'CR-1002',
    organisation_code: 'LKSU',
    setting: 'education',
    required_credential: 'EIPA',
    day_offset: 2,
    hour: 13,
    minute: 0,
    duration_minutes: 50,
    team_size: 1,
    rotation_minutes: 20,
    city: 'Marrow Bay',
    location_address: '12 Quarry Hall',
    consumer_name: 'Devon Achterberg',
    notes: 'BIOL 210 lab; vocabulary list sent to the coordinator.',
    status: 'submitted',
    actual_minutes: null,
    seats: [{ label: 'A', interpreter_email: null }],
  },
  {
    reference: 'CR-1003',
    organisation_code: 'ECCC',
    setting: 'legal',
    required_credential: 'SC:L',
    day_offset: 4,
    hour: 8,
    minute: 30,
    duration_minutes: 210,
    team_size: 2,
    rotation_minutes: 30,
    city: 'Ellery',
    location_address: '1 Courthouse Square, Courtroom 4B',
    consumer_name: 'Marisol Varga',
    notes: 'Arraignment; proceedings team only.',
    status: 'submitted',
    actual_minutes: null,
    seats: [
      { label: 'A', interpreter_email: null },
      { label: 'B', interpreter_email: null },
    ],
  },
  {
    reference: 'CR-1004',
    organisation_code: 'HPMC',
    setting: 'medical',
    required_credential: 'NIC',
    day_offset: 1,
    hour: 14,
    minute: 0,
    duration_minutes: 90,
    team_size: 2,
    rotation_minutes: 20,
    city: 'Halden',
    location_address: '400 Harbor Point Way',
    consumer_name: 'Graham Oduya',
    notes: 'Pre-surgical consult.',
    status: 'staffed',
    actual_minutes: null,
    seats: [
      { label: 'A', interpreter_email: 'theo@interpreters.example' },
      { label: 'B', interpreter_email: 'rosa@interpreters.example' },
    ],
  },
  {
    reference: 'CR-1005',
    organisation_code: 'HPMC',
    setting: 'medical',
    required_credential: 'NIC',
    day_offset: 10,
    hour: 10,
    minute: 0,
    duration_minutes: 60,
    team_size: 1,
    rotation_minutes: 20,
    city: 'Halden',
    location_address: '400 Harbor Point Way',
    consumer_name: 'Lena Petrakis',
    notes: '',
    status: 'draft',
    actual_minutes: null,
    seats: [],
  },
  {
    reference: 'CR-1006',
    organisation_code: 'LKSU',
    setting: 'education',
    required_credential: 'NIC',
    day_offset: -2,
    hour: 10,
    minute: 0,
    duration_minutes: 120,
    team_size: 2,
    rotation_minutes: 20,
    city: 'Marrow Bay',
    location_address: '3 Founders Hall',
    consumer_name: 'Priyanka Moss',
    notes: 'Thesis defence.',
    status: 'completed',
    actual_minutes: 127,
    seats: [
      { label: 'A', interpreter_email: 'rosa@interpreters.example' },
      { label: 'B', interpreter_email: 'theo@interpreters.example' },
    ],
  },
  {
    reference: 'CR-1007',
    organisation_code: 'ECCC',
    setting: 'legal',
    required_credential: 'SC:L',
    day_offset: -1,
    hour: 13,
    minute: 0,
    duration_minutes: 45,
    team_size: 1,
    rotation_minutes: 20,
    city: 'Ellery',
    location_address: '1 Courthouse Square, Courtroom 2A',
    consumer_name: 'Victor Halloran',
    notes: 'Status hearing.',
    status: 'completed',
    actual_minutes: 40,
    seats: [{ label: 'A', interpreter_email: 'kemi@interpreters.example' }],
  },
];

const COORDINATOR_NAME = 'Priya Velasco';

async function insertPerson(
  client: Queryable,
  person: {
    role: string;
    display_name: string;
    full_name: string;
    email: string;
    phone: string | null;
    home_area: string | null;
    pay_rate: string | null;
    organisation_id: string | null;
  },
): Promise<string> {
  const id = newId('per');
  await client.query(
    `INSERT INTO people (id, role, display_name, full_name, email, password_hash, phone, home_area, pay_rate, organisation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      person.role,
      person.display_name,
      person.full_name,
      person.email,
      hashPassword(SEED_PASSWORD),
      person.phone,
      person.home_area,
      person.pay_rate,
      person.organisation_id,
    ],
  );
  return id;
}

export async function seedOnce(): Promise<void> {
  await transact(async (client) => {
    const existing = await client.query<{ id: string }>(`SELECT id FROM agency LIMIT 1`);
    if (existing.rows.length > 0) return;

    await client.query(`INSERT INTO agency (id, name, time_zone) VALUES ($1, $2, $3)`, [
      newId('agn'),
      'Crosshand Interpreting Collective',
      'America/New_York',
    ]);

    const organisationIds = new Map<string, string>();
    for (const organisation of ORGANISATIONS) {
      const id = newId('org');
      organisationIds.set(organisation.code, id);
      await client.query(
        `INSERT INTO organisations (id, code, name, hourly_rate) VALUES ($1, $2, $3, $4)`,
        [id, organisation.code, organisation.name, organisation.hourly_rate],
      );
      await insertPerson(client, {
        role: 'client_scheduler',
        display_name: organisation.scheduler.display_name,
        full_name: organisation.scheduler.display_name,
        email: organisation.scheduler.email,
        phone: null,
        home_area: null,
        pay_rate: null,
        organisation_id: id,
      });
    }

    await insertPerson(client, {
      role: 'coordinator',
      display_name: COORDINATOR_NAME,
      full_name: COORDINATOR_NAME,
      email: 'coord@crosshand.example',
      phone: null,
      home_area: null,
      pay_rate: null,
      organisation_id: null,
    });
    await insertPerson(client, {
      role: 'billing_admin',
      display_name: 'Morgan Reyes-Hall',
      full_name: 'Morgan Reyes-Hall',
      email: 'billing@crosshand.example',
      phone: null,
      home_area: null,
      pay_rate: null,
      organisation_id: null,
    });

    const today = toLocal(new Date());
    const yesterday = isoDate(addDaysLocal(today, -1));
    const interpreterIds = new Map<string, string>();
    for (const interpreter of INTERPRETERS) {
      const id = await insertPerson(client, {
        role: 'interpreter',
        display_name: interpreter.display_name,
        full_name: interpreter.full_name,
        email: interpreter.email,
        phone: interpreter.phone,
        home_area: interpreter.home_area,
        pay_rate: interpreter.pay_rate,
        organisation_id: null,
      });
      interpreterIds.set(interpreter.email, id);
      for (const credentialType of interpreter.credentials) {
        await client.query(
          `INSERT INTO credentials (id, interpreter_id, credential_type, verified, expires_on)
           VALUES ($1, $2, $3, true, $4)`,
          [newId('cred'), id, credentialType, FAR_EXPIRY],
        );
      }
    }

    const malikId = interpreterIds.get('malik@interpreters.example') as string;
    await client.query(
      `INSERT INTO credentials (id, interpreter_id, credential_type, verified, expires_on)
       VALUES ($1, $2, 'EIPA', true, $3)`,
      [newId('cred'), malikId, yesterday],
    );

    for (const seed of REQUESTS) {
      const startsAt = resolveLocalForgiving({
        ...addDaysLocal(today, seed.day_offset),
        hour: seed.hour,
        minute: seed.minute,
      });
      const requestId = newId('req');
      await client.query(
        `INSERT INTO requests (id, reference, organisation_id, setting, required_credential, starts_at,
            duration_minutes, city, location_address, consumer_name, notes, status, team_size,
            rotation_minutes, actual_minutes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          requestId,
          seed.reference,
          organisationIds.get(seed.organisation_code) as string,
          seed.setting,
          seed.required_credential,
          startsAt,
          seed.duration_minutes,
          seed.city,
          seed.location_address,
          seed.consumer_name,
          seed.notes,
          seed.status,
          seed.team_size,
          seed.rotation_minutes,
          seed.actual_minutes,
        ],
      );
      const schedulerName =
        ORGANISATIONS.find((organisation) => organisation.code === seed.organisation_code)?.scheduler
          .display_name ?? COORDINATOR_NAME;
      await client.query(
        `INSERT INTO request_history (request_id, actor, action, detail) VALUES ($1, $2, 'created', '')`,
        [requestId, schedulerName],
      );
      if (seed.status !== 'draft') {
        await client.query(
          `INSERT INTO request_history (request_id, actor, action, detail)
           VALUES ($1, $2, 'submitted', $3)`,
          [requestId, schedulerName, `${seed.seats.length} seats opened`],
        );
      }
      for (const seat of seed.seats) {
        const interpreterId =
          seat.interpreter_email === null
            ? null
            : (interpreterIds.get(seat.interpreter_email) as string);
        await client.query(
          `INSERT INTO seats (id, request_id, label, status, interpreter_id, confirmed_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            newId('seat'),
            requestId,
            seat.label,
            interpreterId === null ? 'open' : 'confirmed',
            interpreterId,
            interpreterId === null ? null : new Date(),
          ],
        );
        if (seat.interpreter_email !== null) {
          const displayName =
            INTERPRETERS.find((entry) => entry.email === seat.interpreter_email)?.display_name ?? '';
          await client.query(
            `INSERT INTO request_history (request_id, actor, action, detail)
             VALUES ($1, $2, 'claim_won', $3)`,
            [requestId, displayName, `seat ${seat.label}`],
          );
        }
      }
      if (seed.status === 'completed' && seed.actual_minutes !== null) {
        await client.query(
          `INSERT INTO request_history (request_id, actor, action, detail)
           VALUES ($1, $2, 'completed', $3)`,
          [requestId, COORDINATOR_NAME, `${seed.actual_minutes} actual minutes`],
        );
      }
    }

    const highest = REQUESTS.reduce(
      (top, seed) => Math.max(top, Number(seed.reference.slice(3))),
      1000,
    );
    await client.query(
      `INSERT INTO counters (name, value) VALUES ('reference', $1)
         ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
      [highest],
    );
  });
}
