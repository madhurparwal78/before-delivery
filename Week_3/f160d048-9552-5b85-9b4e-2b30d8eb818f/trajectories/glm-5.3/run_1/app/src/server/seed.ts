// Applies the schema and the seed data idempotently on every serve.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { App } from '../lib/app.js';
import { randomId, hashPassword } from '../lib/clock.js';

const SCHEMA = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'),
  'utf8',
);

interface SampleLab {
  slug: string;
  name: string;
  city: string;
  size: string;
  domain: string;
}

const SAMPLE_LABS: SampleLab[] = [
  { slug: 'fernhollow-assay-labs', name: 'Fernhollow Assay Labs', city: 'harrowgate', size: '51-200', domain: 'fernhollow.test' },
  { slug: 'thistlecombe-biologics', name: 'Thistlecombe Biologics', city: 'kelvane', size: '11-50', domain: 'thistlecombe.test' },
  { slug: 'larkspur-core-facility', name: 'Larkspur Core Facility', city: 'brindlemoor', size: '11-50', domain: 'larkspur.test' },
];

const CHANNELS = [
  { slug: 'bench-pay-talk', name: 'Bench pay talk' },
  { slug: 'interview-prep', name: 'Interview prep' },
  { slug: 'core-facility-life', name: 'Core facility life' },
];

const SEED_PAY: { slug: string; role: string; city: string; amounts: number[] }[] = [
  { slug: 'fernhollow-assay-labs', role: 'qc_analyst', city: 'harrowgate', amounts: [480000, 510000, 530000, 560000, 580000, 600000, 620000, 650000, 690000, 720000, 780000] },
  { slug: 'thistlecombe-biologics', role: 'research_assistant', city: 'kelvane', amounts: [360000, 410000, 445000] },
  { slug: 'larkspur-core-facility', role: 'core_facility', city: 'brindlemoor', amounts: [520000, 560000, 600000, 640000, 700000, 760000] },
];

export async function migrateAndSeed(app: App): Promise<void> {
  await app.db.query(SCHEMA);
  await seedCompanies(app);
  await seedChannels(app);
  await seedPayReports(app);
}

async function seedCompanies(app: App): Promise<void> {
  for (const [index, lab] of SAMPLE_LABS.entries()) {
    const existing = await app.db.one<{ id: string }>('select id from companies where slug = $1', [lab.slug]);
    if (existing) continue;
    await app.db.query(
      `insert into companies (id, slug, name, city, size, verified, email_domain, sample, sort_order)
       values ($1, $2, $3, $4, $5, false, $6, true, $7)`,
      [randomId(), lab.slug, lab.name, lab.city, lab.size, lab.domain, index],
    );
  }
}

async function seedChannels(app: App): Promise<void> {
  for (const channel of CHANNELS) {
    const existing = await app.db.one<{ id: string }>('select id from channels where slug = $1', [channel.slug]);
    if (existing) continue;
    await app.db.query(
      'insert into channels (id, slug, name, seeded) values ($1, $2, $3, true)',
      [randomId(), channel.slug, channel.name],
    );
  }
}

// Seeded pay reports have no member author, 2 years of experience, month 2026-03.
async function seedPayReports(app: App): Promise<void> {
  const seedUserId = await ensureSeedAuthor(app);
  for (const row of SEED_PAY) {
    const company = await app.db.one<{ id: string }>('select id from companies where slug = $1', [row.slug]);
    if (!company) continue;
    const count = await app.db.one<{ n: number }>(
      'select count(*)::int as n from posts where company_id = $1 and kind = $2 and author_id = $3 and role_family = $4 and city = $5 and state = $6',
      [company.id, 'pay_report', seedUserId, row.role, row.city, 'approved'],
    );
    if ((count?.n ?? 0) > 0) continue;
    for (const amount of row.amounts) {
      await app.db.query(
        `insert into posts (id, kind, company_id, author_id, state, role_family, city, annual_pay, years_experience, created_at)
         values ($1, 'pay_report', $2, $3, 'approved', $4, $5, $6, 2, '2026-03-01T00:00:00Z')`,
        [randomId(), company.id, seedUserId, row.role, row.city, amount],
      );
    }
  }
}

// The seed author is a hidden account so seeded reports have no member author.
async function ensureSeedAuthor(app: App): Promise<string> {
  const existing = await app.db.one<{ id: string }>(
    "select id from users where email = 'seed@candour-bench.test'",
  );
  if (existing) return existing.id;
  const id = randomId();
  await app.db.query(
    `insert into users (id, display_name, email, password_hash, role, unlocked)
     values ($1, 'Seed', 'seed@candour-bench.test', $2, 'member', true)`,
    [id, 'scrypt$seed$seed'],
  );
  return id;
}

export async function seedFounder(
  app: App,
  email: string,
  password: string,
): Promise<void> {
  const existing = await app.db.one<{ id: string }>("select id from users where role = 'founder'");
  if (existing) return;
  await app.db.query(
    `insert into users (id, display_name, email, password_hash, role, unlocked)
     values ($1, 'Founder', $2, $3, 'founder', true)`,
    [randomId(), email, hashPassword(password)],
  );
}

