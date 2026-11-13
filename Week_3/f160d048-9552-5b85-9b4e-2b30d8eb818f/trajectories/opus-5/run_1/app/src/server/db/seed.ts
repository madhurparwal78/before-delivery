import { config } from '../config';
import { hashPassword } from '../domain/passwords';
import { seedUuid } from '../ids';
import { db } from './pool';

interface SeedCompany {
  slug: string;
  name: string;
  city: string;
  size: string;
  emailDomain: string;
}

const SAMPLE_LABS: ReadonlyArray<SeedCompany> = [
  {
    slug: 'fernhollow-assay-labs',
    name: 'Fernhollow Assay Labs',
    city: 'harrowgate',
    size: '51-200',
    emailDomain: 'fernhollow.test',
  },
  {
    slug: 'thistlecombe-biologics',
    name: 'Thistlecombe Biologics',
    city: 'kelvane',
    size: '11-50',
    emailDomain: 'thistlecombe.test',
  },
  {
    slug: 'larkspur-core-facility',
    name: 'Larkspur Core Facility',
    city: 'brindlemoor',
    size: '11-50',
    emailDomain: 'larkspur.test',
  },
];

const SEED_CHANNELS: ReadonlyArray<{ slug: string; name: string }> = [
  { slug: 'bench-pay-talk', name: 'Bench pay talk' },
  { slug: 'interview-prep', name: 'Interview prep' },
  { slug: 'core-facility-life', name: 'Core facility life' },
];

const SEED_PAY_REPORTS: ReadonlyArray<{ slug: string; roleFamily: string; city: string; amounts: number[] }> = [
  {
    slug: 'fernhollow-assay-labs',
    roleFamily: 'qc_analyst',
    city: 'harrowgate',
    amounts: [480000, 510000, 530000, 560000, 580000, 600000, 620000, 650000, 690000, 720000, 780000],
  },
  {
    slug: 'thistlecombe-biologics',
    roleFamily: 'research_assistant',
    city: 'kelvane',
    amounts: [360000, 410000, 445000],
  },
  {
    slug: 'larkspur-core-facility',
    roleFamily: 'core_facility',
    city: 'brindlemoor',
    amounts: [520000, 560000, 600000, 640000, 700000, 760000],
  },
];

const SEED_POST_MONTH = new Date('2026-03-15T00:00:00.000Z');

export async function applySeed(): Promise<void> {
  const createdAt = new Date();

  for (const lab of SAMPLE_LABS) {
    await db.query(
      `INSERT INTO companies (id, slug, name, city, size, verified, email_domain, created_at)
       VALUES ($1, $2, $3, $4, $5, false, $6, $7)
       ON CONFLICT (slug) DO NOTHING`,
      [seedUuid(`company:${lab.slug}`), lab.slug, lab.name, lab.city, lab.size, lab.emailDomain, createdAt],
    );
  }

  for (const channel of SEED_CHANNELS) {
    await db.query(`INSERT INTO channels (id, slug, name) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING`, [
      seedUuid(`channel:${channel.slug}`),
      channel.slug,
      channel.name,
    ]);
  }

  for (const group of SEED_PAY_REPORTS) {
    const companyId = seedUuid(`company:${group.slug}`);
    for (const [index, amount] of group.amounts.entries()) {
      await db.query(
        `INSERT INTO posts (id, kind, company_id, author_id, state, created_at, updated_at,
                            role_family, city, annual_pay, years_experience)
         VALUES ($1, 'pay_report', $2, NULL, 'approved', $3, $3, $4, $5, $6, 2)
         ON CONFLICT (id) DO NOTHING`,
        [
          seedUuid(`pay:${group.slug}:${group.roleFamily}:${index}`),
          companyId,
          SEED_POST_MONTH,
          group.roleFamily,
          group.city,
          amount,
        ],
      );
    }
  }

  if (config.founderEmail && config.founderPassword) {
    const existing = await db.one<{ id: string }>(`SELECT id FROM users WHERE role = 'founder' LIMIT 1`);
    if (!existing) {
      await db.query(
        `INSERT INTO users (id, display_name, email, email_lower, password_hash, role, unlocked, created_at)
         VALUES ($1, 'Founder', $2, $3, $4, 'founder', true, $5)
         ON CONFLICT (email_lower) DO NOTHING`,
        [
          seedUuid(`founder:${config.founderEmail.toLowerCase()}`),
          config.founderEmail,
          config.founderEmail.toLowerCase(),
          await hashPassword(config.founderPassword),
          createdAt,
        ],
      );
    }
  }
}
