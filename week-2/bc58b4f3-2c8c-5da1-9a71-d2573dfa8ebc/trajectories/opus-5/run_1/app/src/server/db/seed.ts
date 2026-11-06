import type { Role } from '../../shared/contract.js';
import { hashPassword } from '../auth/passwords.js';
import { pool } from './pool.js';
import { SCHEMA_SQL } from './schema.js';

const SEED_PASSWORD = 'Teamseat-demo-2026';

const LANGUAGES: Array<{ code: string; name: string }> = [
  { code: 'asl', name: 'ASL' },
  { code: 'es', name: 'Spanish' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'so', name: 'Somali' },
  { code: 'ar', name: 'Arabic' },
];

const ORGS: Array<{ code: string; name: string }> = [
  { code: 'RVH', name: 'Riverbend Valley Hospital' },
  { code: 'CPSD', name: 'Cedar Prairie School District' },
  { code: 'LFC', name: 'Lakeview Family Clinic' },
];

interface SeedPerson {
  name: string;
  email: string;
  role: Role;
  org: string | null;
  phone: string;
  languages: string[];
}

const PEOPLE: SeedPerson[] = [
  { name: 'Dana Whitcombe', email: 'dana.whitcombe@northfold.example', role: 'dispatcher', org: null, phone: '', languages: [] },
  { name: 'Marguerite Ellison', email: 'marguerite.ellison@northfold.example', role: 'billing_lead', org: null, phone: '', languages: [] },
  { name: 'Tomas Herrera', email: 'tomas.herrera@rvh.example', role: 'scheduler', org: 'RVH', phone: '312-555-0141', languages: [] },
  { name: 'Alina Brooks', email: 'alina.brooks@rvh.example', role: 'scheduler', org: 'RVH', phone: '312-555-0142', languages: [] },
  { name: 'Helen Marsh', email: 'helen.marsh@rvh.example', role: 'org_admin', org: 'RVH', phone: '312-555-0140', languages: [] },
  { name: 'Grace Lindqvist', email: 'grace.lindqvist@cpsd.example', role: 'scheduler', org: 'CPSD', phone: '847-555-0163', languages: [] },
  { name: 'Victor Ames', email: 'victor.ames@cpsd.example', role: 'org_admin', org: 'CPSD', phone: '847-555-0160', languages: [] },
  { name: 'Owen Pakulski', email: 'owen.pakulski@lfc.example', role: 'scheduler', org: 'LFC', phone: '773-555-0175', languages: [] },
  { name: 'Nora Quist', email: 'nora.quist@lfc.example', role: 'org_admin', org: 'LFC', phone: '773-555-0170', languages: [] },
  { name: 'Rosa Mendez', email: 'rosa.mendez@interp.example', role: 'interpreter', org: null, phone: '', languages: ['asl', 'es'] },
  { name: 'Samuel Okoye', email: 'samuel.okoye@interp.example', role: 'interpreter', org: null, phone: '', languages: ['asl'] },
  { name: 'Jordan Fairweather', email: 'jordan.fairweather@interp.example', role: 'interpreter', org: null, phone: '', languages: ['asl'] },
  { name: 'Linh Tran', email: 'linh.tran@interp.example', role: 'interpreter', org: null, phone: '', languages: ['vi', 'es'] },
  { name: 'Abdi Warsame', email: 'abdi.warsame@interp.example', role: 'interpreter', org: null, phone: '', languages: ['so', 'ar'] },
];

const RATE_CARDS: Array<{ org: string; serviceLine: string; hourly: number; mileage: number }> = [
  { org: 'RVH', serviceLine: 'asl', hourly: 8575, mileage: 70 },
  { org: 'RVH', serviceLine: 'spoken', hourly: 6550, mileage: 70 },
  { org: 'CPSD', serviceLine: 'asl', hourly: 7800, mileage: 65 },
  { org: 'CPSD', serviceLine: 'spoken', hourly: 6000, mileage: 65 },
  { org: 'LFC', serviceLine: 'asl', hourly: 8575, mileage: 70 },
  { org: 'LFC', serviceLine: 'spoken', hourly: 6550, mileage: 70 },
];

export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1] ?? '') : '';
  const letters = [first, last].filter((word) => word.length > 0).map((word) => `${word[0]?.toUpperCase() ?? ''}.`);
  return letters.join('');
}

export async function applySchemaAndSeed(): Promise<void> {
  await pool.query(SCHEMA_SQL);

  for (const [index, language] of LANGUAGES.entries()) {
    await pool.query(
      'INSERT INTO languages (code, name, sort_order) VALUES ($1, $2, $3) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order',
      [language.code, language.name, index],
    );
  }

  for (const org of ORGS) {
    await pool.query('INSERT INTO orgs (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING', [
      org.code,
      org.name,
    ]);
  }

  for (const person of PEOPLE) {
    const passwordHash = await hashPassword(SEED_PASSWORD);
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role, org_id, phone, initials)
       VALUES ($1, $2, $3, $4, (SELECT id FROM orgs WHERE code = $5), $6, $7)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [person.name, person.email, passwordHash, person.role, person.org, person.phone, initialsFor(person.name)],
    );
    const userId = inserted.rows[0]?.id;
    if (userId === undefined) {
      continue;
    }
    for (const languageCode of person.languages) {
      await pool.query('INSERT INTO user_languages (user_id, language_code) VALUES ($1, $2)', [userId, languageCode]);
    }
  }

  for (const rate of RATE_CARDS) {
    await pool.query(
      `INSERT INTO rate_cards (org_id, service_line, effective_from, hourly_rate_cents, mileage_cents_per_mile)
       VALUES ((SELECT id FROM orgs WHERE code = $1), $2, DATE '2026-01-01', $3, $4)
       ON CONFLICT (org_id, service_line, effective_from) DO NOTHING`,
      [rate.org, rate.serviceLine, rate.hourly, rate.mileage],
    );
  }
}
