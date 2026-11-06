import { insertAccount, type Role } from './db/accounts.js';
import { pool } from './db/pool.js';
import {
  COLLECTIONS,
  countRecords,
  createRecord,
  ensureCollections,
} from './services/pocketbase.js';

interface StaffSeed {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly role: Role;
}

const STAFF: readonly StaffSeed[] = [
  {
    name: 'Mara Okonkwo-Lindqvist',
    email: 'director@opaline-institute.test',
    password: 'bench-days-director-2027',
    role: 'director',
  },
  {
    name: 'Theo Vasquez-Hale',
    email: 'registrar@opaline-institute.test',
    password: 'bench-days-registrar-2027',
    role: 'registrar',
  },
  {
    name: 'Priya Anand-Sorensen',
    email: 'frontdesk@opaline-institute.test',
    password: 'bench-days-frontdesk-2027',
    role: 'frontdesk',
  },
];

const AGENDA = [
  {
    number: 1,
    day: 1,
    format: 'lecture',
    minutes: 90,
    title: 'Shade and translucency mapping',
    outcomes: 'Read chroma, value and translucency zones on a natural incisor',
  },
  {
    number: 2,
    day: 1,
    format: 'hands-on',
    minutes: 150,
    title: 'Palatal shell from a silicone index',
    outcomes: 'Build a thin, even palatal shell from a wax-up index',
  },
  {
    number: 3,
    day: 1,
    format: 'lecture',
    minutes: 60,
    title: 'Dentin mamelons and internal effects',
    outcomes: 'Plan mamelon shape and halo before layering',
  },
  {
    number: 4,
    day: 1,
    format: 'hands-on',
    minutes: 180,
    title: 'Class IV layering on the typodont',
    outcomes: 'Layer dentin, effects and enamel to a natural incisal edge',
  },
  {
    number: 5,
    day: 2,
    format: 'lecture',
    minutes: 60,
    title: 'Posterior anatomy and occlusal stamping',
    outcomes: 'Choose between freehand anatomy and occlusal stamps',
  },
  {
    number: 6,
    day: 2,
    format: 'hands-on',
    minutes: 180,
    title: 'Class II with sectional matrices',
    outcomes: 'Place tight contacts with sectional rings and wedges',
  },
  {
    number: 7,
    day: 2,
    format: 'lecture',
    minutes: 60,
    title: 'Finishing and polishing sequence',
    outcomes: 'Order discs, rubbers and pastes for lasting gloss',
  },
  {
    number: 8,
    day: 2,
    format: 'hands-on',
    minutes: 180,
    title: 'Polish to gloss and photograph',
    outcomes: 'Finish to gloss and record cross-polarised photographs',
  },
] as const;

const HOSPITALITY = [
  {
    title: 'Welcome reception',
    day: 1,
    starts_at: '18:30',
    venue: 'The Opaline Lab foyer',
    tier: 'all',
    description: 'Drinks and small plates with the instructor',
  },
  {
    title: 'Atelier dinner with the instructor',
    day: 1,
    starts_at: '20:00',
    venue: 'Larkspur Room, West Loop',
    tier: 'atelier',
    description: 'A seated tasting menu for Atelier guests and the course director',
  },
  {
    title: 'Bench breakfast',
    day: 2,
    starts_at: '07:30',
    venue: 'The Opaline Lab foyer',
    tier: 'all',
    description: 'Coffee and pastries before the lab opens',
  },
] as const;

const HOTELS = [
  {
    name: 'Fulton Rail Hotel',
    distance: '0.4 miles',
    rate: 'from $289 a night',
    map_url: 'https://maps.example.com/fulton-rail-hotel',
  },
  {
    name: 'Kinzie Loft Suites',
    distance: '0.7 miles',
    rate: 'from $245 a night',
    map_url: 'https://maps.example.com/kinzie-loft-suites',
  },
] as const;

const FAQ = [
  {
    sort: 1,
    question: 'What should I bring?',
    answer:
      'Your own loupes. Typodonts, composites, instruments and curing lights are provided at every bench.',
  },
  {
    sort: 2,
    question: 'How are CE credits awarded?',
    answer: 'Credits are issued after both days of check-in and a matched licence on file.',
  },
  {
    sort: 3,
    question: 'Can my clinic buy several seats?',
    answer:
      'Yes. A clinic account can hold up to six benches at once and pays one group invoice.',
  },
  {
    sort: 4,
    question: 'What is the difference between Bench and Atelier?',
    answer:
      'Atelier seats sit in rows A and B nearest the demo station and include the Atelier dinner.',
  },
] as const;

export async function seedStaffAccounts(): Promise<void> {
  const client = await pool.connect();
  try {
    for (const member of STAFF) {
      await insertAccount(client, {
        name: member.name,
        email: member.email,
        password: member.password,
        role: member.role,
        clinicName: null,
      });
    }
  } finally {
    client.release();
  }
}

async function seedCollection(
  collection: string,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  if ((await countRecords(collection)) > 0) return;
  for (const row of rows) {
    await createRecord(collection, row);
  }
}

export async function seedContent(): Promise<void> {
  await ensureCollections();
  await seedCollection(COLLECTIONS.sessions, AGENDA);
  await seedCollection(COLLECTIONS.hospitality, HOSPITALITY);
  await seedCollection(COLLECTIONS.hotels, HOTELS);
  await seedCollection(COLLECTIONS.faq, FAQ);
}
