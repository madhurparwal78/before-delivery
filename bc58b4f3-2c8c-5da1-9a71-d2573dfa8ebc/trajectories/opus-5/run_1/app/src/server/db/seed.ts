import { LANGUAGES, ORGANISATIONS } from '../../shared/catalog.js';
import { hashPassword } from '../security.js';
import type { Role, ServiceLine } from '../domain/types.js';
import { query } from './pool.js';
import { SCHEMA_SQL } from './schema.js';

const SEED_PASSWORD = 'Teamseat-demo-2026';

interface SeedPerson {
  name: string;
  email: string;
  role: Role;
  orgCode: string | null;
  phone: string;
  languages: string[];
}

const PEOPLE: SeedPerson[] = [
  {
    name: 'Dana Whitcombe',
    email: 'dana.whitcombe@northfold.example',
    role: 'dispatcher',
    orgCode: null,
    phone: '',
    languages: [],
  },
  {
    name: 'Marguerite Ellison',
    email: 'marguerite.ellison@northfold.example',
    role: 'billing_lead',
    orgCode: null,
    phone: '',
    languages: [],
  },
  {
    name: 'Tomas Herrera',
    email: 'tomas.herrera@rvh.example',
    role: 'scheduler',
    orgCode: 'RVH',
    phone: '312-555-0141',
    languages: [],
  },
  {
    name: 'Alina Brooks',
    email: 'alina.brooks@rvh.example',
    role: 'scheduler',
    orgCode: 'RVH',
    phone: '312-555-0142',
    languages: [],
  },
  {
    name: 'Helen Marsh',
    email: 'helen.marsh@rvh.example',
    role: 'org_admin',
    orgCode: 'RVH',
    phone: '312-555-0140',
    languages: [],
  },
  {
    name: 'Grace Lindqvist',
    email: 'grace.lindqvist@cpsd.example',
    role: 'scheduler',
    orgCode: 'CPSD',
    phone: '847-555-0163',
    languages: [],
  },
  {
    name: 'Victor Ames',
    email: 'victor.ames@cpsd.example',
    role: 'org_admin',
    orgCode: 'CPSD',
    phone: '847-555-0160',
    languages: [],
  },
  {
    name: 'Owen Pakulski',
    email: 'owen.pakulski@lfc.example',
    role: 'scheduler',
    orgCode: 'LFC',
    phone: '773-555-0175',
    languages: [],
  },
  {
    name: 'Nora Quist',
    email: 'nora.quist@lfc.example',
    role: 'org_admin',
    orgCode: 'LFC',
    phone: '773-555-0170',
    languages: [],
  },
  {
    name: 'Rosa Mendez',
    email: 'rosa.mendez@interp.example',
    role: 'interpreter',
    orgCode: null,
    phone: '',
    languages: ['asl', 'es'],
  },
  {
    name: 'Samuel Okoye',
    email: 'samuel.okoye@interp.example',
    role: 'interpreter',
    orgCode: null,
    phone: '',
    languages: ['asl'],
  },
  {
    name: 'Jordan Fairweather',
    email: 'jordan.fairweather@interp.example',
    role: 'interpreter',
    orgCode: null,
    phone: '',
    languages: ['asl'],
  },
  {
    name: 'Linh Tran',
    email: 'linh.tran@interp.example',
    role: 'interpreter',
    orgCode: null,
    phone: '',
    languages: ['vi', 'es'],
  },
  {
    name: 'Abdi Warsame',
    email: 'abdi.warsame@interp.example',
    role: 'interpreter',
    orgCode: null,
    phone: '',
    languages: ['so', 'ar'],
  },
];

const RATES: {
  orgCode: string;
  serviceLine: ServiceLine;
  hourlyRateCents: number;
  mileageCentsPerMile: number;
}[] = [
  { orgCode: 'RVH', serviceLine: 'asl', hourlyRateCents: 8575, mileageCentsPerMile: 70 },
  { orgCode: 'RVH', serviceLine: 'spoken', hourlyRateCents: 6550, mileageCentsPerMile: 70 },
  { orgCode: 'CPSD', serviceLine: 'asl', hourlyRateCents: 7800, mileageCentsPerMile: 65 },
  { orgCode: 'CPSD', serviceLine: 'spoken', hourlyRateCents: 6000, mileageCentsPerMile: 65 },
  { orgCode: 'LFC', serviceLine: 'asl', hourlyRateCents: 8575, mileageCentsPerMile: 70 },
  { orgCode: 'LFC', serviceLine: 'spoken', hourlyRateCents: 6550, mileageCentsPerMile: 70 },
];

export function initialsOf(name: string): string {
  const words = name.split(' ').filter((word) => word.length > 0);
  const first = words[0]?.[0] ?? '';
  const last = words[words.length - 1]?.[0] ?? '';
  return `${first.toUpperCase()}.${last.toUpperCase()}.`;
}

export async function applySchemaAndSeed(): Promise<void> {
  await query(SCHEMA_SQL);

  for (const org of ORGANISATIONS) {
    await query('insert into orgs (code, name) values ($1, $2) on conflict (code) do update set name = excluded.name', [
      org.code,
      org.name,
    ]);
  }

  for (const [index, language] of LANGUAGES.entries()) {
    await query(
      `insert into languages (code, name, seed_order) values ($1, $2, $3)
       on conflict (code) do update set name = excluded.name, seed_order = excluded.seed_order`,
      [language.code, language.name, index + 1],
    );
  }

  const passwordHash = await hashPassword(SEED_PASSWORD);
  for (const person of PEOPLE) {
    const rows = await query<{ id: string }>(
      `insert into users (name, email, role, org_code, phone, initials, password_hash)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (email) do update set name = excluded.name, role = excluded.role,
         org_code = excluded.org_code, phone = excluded.phone, initials = excluded.initials
       returning id`,
      [
        person.name,
        person.email,
        person.role,
        person.orgCode,
        person.phone,
        initialsOf(person.name),
        passwordHash,
      ],
    );
    const userId = rows[0]?.id;
    if (userId === undefined) continue;
    for (const language of person.languages) {
      await query(
        `insert into interpreter_languages (user_id, language_code) values ($1, $2)
         on conflict do nothing`,
        [userId, language],
      );
    }
  }

  for (const rate of RATES) {
    await query(
      `insert into rate_cards (org_code, service_line, effective_from, hourly_rate_cents, mileage_cents_per_mile)
       values ($1, $2, '2026-01-01', $3, $4)
       on conflict (org_code, service_line, effective_from) do nothing`,
      [rate.orgCode, rate.serviceLine, rate.hourlyRateCents, rate.mileageCentsPerMile],
    );
  }
}
