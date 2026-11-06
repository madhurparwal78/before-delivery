import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Trade } from '../shared/domain.js';
import { hashPassword } from './auth.js';
import { db, withTransaction, type Queryable } from './db.js';
import { createNote } from './core/notes.js';
import type { Outline } from './core/geometry.js';
import { withSeedLock } from './schema.js';
import { objectExists, putObject, StorageUnavailable } from './services/objectstore.js';

const SEED_PASSWORD = 'paper-plan-2026';
const SEED_MARKER = 'larchmere-2026';

const ASSET_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'plans');

const PLAN_ASSETS: Record<string, string> = {
  'Hale kitchen and bath': 'plan-hale.png',
  'Oduya basement': 'plan-oduya.png',
};

type SeedPerson = {
  key: string;
  name: string;
  email: string;
  phone: string;
  isOwner: boolean;
};

const PEOPLE: SeedPerson[] = [
  { key: 'dana', name: 'Dana Whitcombe', email: 'dana@larchmere.example', phone: '555-0101', isOwner: true },
  { key: 'ravi', name: 'Ravi Okafor', email: 'ravi@larchmere.example', phone: '555-0102', isOwner: false },
  { key: 'marco', name: 'Marco Ruiz', email: 'marco@brightwire.example', phone: '555-0141', isOwner: false },
  { key: 'tess', name: 'Tess Lindqvist', email: 'tess@lindqvisttile.example', phone: '555-0142', isOwner: false },
  { key: 'paul', name: 'Paul Ferrante', email: 'paul@ferrantepaint.example', phone: '555-0143', isOwner: false },
  { key: 'priya', name: 'Priya Hale', email: 'priya.hale@example.com', phone: '555-0177', isOwner: false },
  { key: 'sam', name: 'Sam Oduya', email: 'sam.oduya@example.net', phone: '555-0188', isOwner: false },
];

function outline(corners: [number, number][]): Outline {
  return corners.map(([x, y]) => ({ x: Math.round(x * 10000), y: Math.round(y * 10000) }));
}

type SeedRoom = { name: string; corners: [number, number][] };
type SeedItem = {
  room: string;
  title: string;
  trade: Trade | null;
  status: 'open' | 'in_progress' | 'ready_for_check' | 'verified';
  pin: [number, number] | null;
  costNote: string | null;
  createdBy: string;
};

const HALE_ROOMS: SeedRoom[] = [
  {
    name: 'Kitchen',
    corners: [
      [0.04, 0.05],
      [0.52, 0.05],
      [0.52, 0.3],
      [0.4, 0.3],
      [0.4, 0.47],
      [0.04, 0.47],
    ],
  },
  {
    name: 'Primary bath',
    corners: [
      [0.58, 0.05],
      [0.96, 0.05],
      [0.96, 0.45],
      [0.58, 0.45],
    ],
  },
  {
    name: 'Hall',
    corners: [
      [0.04, 0.53],
      [0.44, 0.53],
      [0.44, 0.75],
      [0.5, 0.75],
      [0.5, 0.95],
      [0.04, 0.95],
    ],
  },
  {
    name: 'Laundry',
    corners: [
      [0.5, 0.53],
      [0.96, 0.53],
      [0.96, 0.95],
      [0.5, 0.95],
    ],
  },
];

const HALE_ITEMS: SeedItem[] = [
  {
    room: 'Kitchen',
    title: 'Touch-up paint by the window',
    trade: 'paint',
    status: 'open',
    pin: [0.3, 0.12],
    costNote: 'Leftover wall paint in garage; no charge',
    createdBy: 'ravi',
  },
  {
    room: 'Kitchen',
    title: 'Pendant over island flickers',
    trade: 'electrical',
    status: 'in_progress',
    pin: [0.24, 0.3],
    costNote: 'Fixture under supplier warranty',
    createdBy: 'ravi',
  },
  {
    room: 'Primary bath',
    title: 'Regrout shower corner',
    trade: 'tile',
    status: 'in_progress',
    pin: [0.86, 0.16],
    costNote: null,
    createdBy: 'ravi',
  },
  {
    room: 'Primary bath',
    title: 'Caulk gap behind vanity',
    trade: null,
    status: 'open',
    pin: [0.7, 0.32],
    costNote: null,
    createdBy: 'ravi',
  },
  {
    room: 'Hall',
    title: 'Outlet cover missing by closet',
    trade: 'electrical',
    status: 'open',
    pin: null,
    costNote: null,
    createdBy: 'dana',
  },
  {
    room: 'Hall',
    title: 'Door sticks at the head',
    trade: null,
    status: 'verified',
    pin: [0.2, 0.72],
    costNote: null,
    createdBy: 'ravi',
  },
];

const ODUYA_ROOMS: SeedRoom[] = [
  {
    name: 'Rec room',
    corners: [
      [0.05, 0.05],
      [0.65, 0.05],
      [0.65, 0.65],
      [0.05, 0.65],
    ],
  },
  {
    name: 'Utility',
    corners: [
      [0.7, 0.05],
      [0.95, 0.05],
      [0.95, 0.45],
      [0.7, 0.45],
    ],
  },
];

const ODUYA_ITEMS: SeedItem[] = [
  {
    room: 'Rec room',
    title: 'Baseboard gap at stair',
    trade: 'paint',
    status: 'open',
    pin: [0.3, 0.3],
    costNote: null,
    createdBy: 'ravi',
  },
  {
    room: 'Utility',
    title: 'Label the panel circuits',
    trade: 'electrical',
    status: 'open',
    pin: null,
    costNote: null,
    createdBy: 'ravi',
  },
];

type Ids = Map<string, string>;

async function insertRooms(
  tx: Queryable,
  jobId: string,
  rooms: SeedRoom[],
  at: Date,
): Promise<Ids> {
  const ids: Ids = new Map();
  for (let index = 0; index < rooms.length; index++) {
    const id = randomUUID();
    await tx.query(
      `insert into rooms (id, job_id, name, outline, position, created_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, jobId, rooms[index].name, JSON.stringify(outline(rooms[index].corners)), index + 1, at.toISOString()],
    );
    ids.set(rooms[index].name, id);
  }
  await tx.query(`update jobs set room_seq = $2 where id = $1`, [jobId, rooms.length]);
  return ids;
}

async function insertItems(
  tx: Queryable,
  jobId: string,
  items: SeedItem[],
  rooms: Ids,
  people: Ids,
  names: Map<string, string>,
  at: Date,
): Promise<Ids> {
  const ids: Ids = new Map();
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const id = randomUUID();
    await tx.query(
      `insert into items (id, job_id, number, title, room_id, trade, status, pin_x, pin_y,
                          pin_status, cost_note, created_by, last_by, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
      [
        id,
        jobId,
        index + 1,
        item.title,
        rooms.get(item.room),
        item.trade,
        item.status,
        item.pin === null ? null : Math.round(item.pin[0] * 10000),
        item.pin === null ? null : Math.round(item.pin[1] * 10000),
        item.pin === null ? 'unpinned' : 'placed',
        item.costNote,
        people.get(item.createdBy),
        names.get(item.createdBy),
        at.toISOString(),
      ],
    );
    ids.set(String(index + 1), id);
  }
  await tx.query(`update jobs set item_seq = $2 where id = $1`, [jobId, items.length]);
  return ids;
}

async function insertNote(
  tx: Queryable,
  jobId: string,
  itemId: string,
  parentId: string | null,
  audience: 'crew' | 'everyone',
  authorId: string,
  authorName: string,
  authorRole: string,
  memberId: string,
  text: string,
  at: Date,
): Promise<string> {
  const id = randomUUID();
  const doc = createNote(
    text,
    { personId: authorId, memberId, name: authorName, role: authorRole },
    at.toISOString(),
  );
  await tx.query(
    `insert into notes (id, job_id, item_id, parent_id, audience, author_id, doc, rev, body, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9)`,
    [id, jobId, itemId, parentId, audience, authorId, JSON.stringify(doc), text, at.toISOString()],
  );
  return id;
}

async function seedRecords(): Promise<void> {
  const at = new Date();
  const passwordHash = await hashPassword(SEED_PASSWORD);
  await withTransaction(async (tx) => {
    const firmId = randomUUID();
    await tx.query(`insert into firms (id, name) values ($1, $2)`, [
      firmId,
      'Larchmere Renovation Co.',
    ]);

    const people: Ids = new Map();
    const names = new Map<string, string>();
    for (const person of PEOPLE) {
      const id = randomUUID();
      await tx.query(
        `insert into people (id, name, email, phone, password_hash, is_owner, firm_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          person.name,
          person.email,
          person.phone,
          passwordHash,
          person.isOwner,
          person.isOwner ? firmId : null,
          at.toISOString(),
        ],
      );
      people.set(person.key, id);
      names.set(person.key, person.name);
    }

    const memberIds = new Map<string, string>();
    const addMember = async (
      jobId: string,
      personKey: string,
      role: string,
      trade: Trade | null,
    ): Promise<string> => {
      const id = randomUUID();
      await tx.query(
        `insert into job_members (id, job_id, person_id, role, trade, active, created_at)
         values ($1, $2, $3, $4, $5, true, $6)`,
        [id, jobId, people.get(personKey), role, trade, at.toISOString()],
      );
      memberIds.set(`${jobId}:${personKey}`, id);
      return id;
    };

    const haleId = randomUUID();
    await tx.query(
      `insert into jobs (id, firm_id, name, address, time_zone, status, created_at)
       values ($1, $2, $3, $4, $5, 'active', $6)`,
      [
        haleId,
        firmId,
        'Hale kitchen and bath',
        '14 Orchard Lane, Maple Falls',
        'America/Chicago',
        at.toISOString(),
      ],
    );
    await tx.query(
      `insert into access_cards (job_id, lockbox_code, alarm_code, garage_code, house_note)
       values ($1, '4826', '7319', '5550', $2)`,
      [haleId, 'Biscuit the dog stays in the laundry room; keep that door shut.'],
    );
    await addMember(haleId, 'dana', 'owner', null);
    const raviHale = await addMember(haleId, 'ravi', 'lead', null);
    const marcoHale = await addMember(haleId, 'marco', 'trade', 'electrical');
    await addMember(haleId, 'tess', 'trade', 'tile');
    await addMember(haleId, 'paul', 'trade', 'paint');
    const priyaHale = await addMember(haleId, 'priya', 'homeowner', null);

    const haleRooms = await insertRooms(tx, haleId, HALE_ROOMS, at);
    const haleItems = await insertItems(tx, haleId, HALE_ITEMS, haleRooms, people, names, at);

    await insertNote(
      tx,
      haleId,
      haleItems.get('2')!,
      null,
      'crew',
      people.get('ravi')!,
      'Ravi Okafor',
      'lead',
      raviHale,
      "Marco thinks it's the dimmer; bring a spare.",
      at,
    );
    const homeownerNote = await insertNote(
      tx,
      haleId,
      haleItems.get('1')!,
      null,
      'everyone',
      people.get('priya')!,
      'Priya Hale',
      'homeowner',
      priyaHale,
      "There's also a scuff on the base cabinet.",
      at,
    );
    await insertNote(
      tx,
      haleId,
      haleItems.get('1')!,
      homeownerNote,
      'everyone',
      people.get('ravi')!,
      'Ravi Okafor',
      'lead',
      raviHale,
      "We'll cover it with the window touch-up.",
      new Date(at.getTime() + 1000),
    );

    await tx.query(
      `insert into visits (id, job_id, member_id, starts_local, ends_local, recurrence, created_at)
       values ($1, $2, $3, '2030-03-04T08:00:00', '2030-03-04T12:00:00', null, $4)`,
      [randomUUID(), haleId, marcoHale, at.toISOString()],
    );

    const oduyaId = randomUUID();
    await tx.query(
      `insert into jobs (id, firm_id, name, address, time_zone, status, created_at)
       values ($1, $2, $3, $4, $5, 'active', $6)`,
      [
        oduyaId,
        firmId,
        'Oduya basement',
        '9 Quarry Road, Ridgeview',
        'America/Denver',
        new Date(at.getTime() - 60_000).toISOString(),
      ],
    );
    await tx.query(
      `insert into access_cards (job_id, lockbox_code, alarm_code, garage_code, house_note)
       values ($1, '1193', '6604', '2871', $2)`,
      [oduyaId, 'Side door sticks; lift the handle.'],
    );
    await addMember(oduyaId, 'dana', 'owner', null);
    await addMember(oduyaId, 'ravi', 'lead', null);
    await addMember(oduyaId, 'paul', 'trade', 'paint');
    await addMember(oduyaId, 'sam', 'homeowner', null);
    const oduyaRooms = await insertRooms(tx, oduyaId, ODUYA_ROOMS, at);
    await insertItems(tx, oduyaId, ODUYA_ITEMS, oduyaRooms, people, names, at);

    for (const [jobId, jobName] of [
      [haleId, 'Hale kitchen and bath'],
      [oduyaId, 'Oduya basement'],
    ] as [string, string][]) {
      await tx.query(
        `insert into plan_revisions (id, job_id, revision, object_key, content_type,
                                     reference_points, uploaded_by, created_at, moved, needs_review)
         values ($1, $2, 1, $3, 'image/png', null, $4, $5, 0, 0)`,
        [
          randomUUID(),
          jobId,
          `jobs/${jobId}/plan/${randomUUID()}.png`,
          people.get('dana'),
          at.toISOString(),
        ],
      );
      if (PLAN_ASSETS[jobName] === undefined) throw new Error(`no plan asset for ${jobName}`);
    }

    await tx.query(`insert into seed_markers (key) values ($1)`, [SEED_MARKER]);
  });
}

/** Uploads the seeded plan images whenever storage is reachable and they are missing. */
export async function uploadSeedPlans(): Promise<void> {
  const { rows } = await db.query(
    `select j.name, r.object_key from plan_revisions r
       join jobs j on j.id = r.job_id
      where r.revision = 1 and j.name = any($1::text[])`,
    [Object.keys(PLAN_ASSETS)],
  );
  for (const row of rows) {
    const asset = PLAN_ASSETS[row.name as string];
    if (asset === undefined) continue;
    const key = row.object_key as string;
    if (await objectExists(key)) continue;
    const bytes = await readFile(join(ASSET_ROOT, asset));
    await putObject(key, bytes, 'image/png');
  }
}

export async function applySeed(): Promise<void> {
  await withSeedLock(async () => {
    const marker = await db.query(`select key from seed_markers where key = $1`, [SEED_MARKER]);
    if (marker.rowCount === 0) await seedRecords();
  });
  try {
    await uploadSeedPlans();
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
  }
}
