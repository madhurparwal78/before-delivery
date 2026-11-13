import { config } from "../config";
import { first, pool } from "../db/pool";
import { hashPassword } from "./passwords";

const CHANNELS = [
  { slug: "bench-pay-talk", name: "Bench pay talk" },
  { slug: "interview-prep", name: "Interview prep" },
  { slug: "core-facility-life", name: "Core facility life" },
];

const LABS = [
  {
    slug: "fernhollow-assay-labs", name: "Fernhollow Assay Labs", city: "harrowgate", size: "51-200", domain: "fernhollow.test",
    role: "qc_analyst",
    amounts: [480000, 510000, 530000, 560000, 580000, 600000, 620000, 650000, 690000, 720000, 780000],
  },
  {
    slug: "thistlecombe-biologics", name: "Thistlecombe Biologics", city: "kelvane", size: "11-50", domain: "thistlecombe.test",
    role: "research_assistant", amounts: [360000, 410000, 445000],
  },
  {
    slug: "larkspur-core-facility", name: "Larkspur Core Facility", city: "brindlemoor", size: "11-50", domain: "larkspur.test",
    role: "core_facility", amounts: [520000, 560000, 600000, 640000, 700000, 760000],
  },
];

const SAMPLE_REPORT_DATE = "2026-03-15T00:00:00Z";
const SEED_LOCK = 7351002;

/** Inserts whatever seed data is missing; running it again changes nothing. */
export async function seedMissing(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SEED_LOCK]);
    for (const channel of CHANNELS) {
      await client.query("INSERT INTO channels (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING", [channel.slug, channel.name]);
    }
    for (const lab of LABS) {
      const company = await client.query<{ id: string }>(
        `INSERT INTO companies (slug, name, city, size, verified, email_domain) VALUES ($1, $2, $3, $4, false, $5)
         ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
        [lab.slug, lab.name, lab.city, lab.size, lab.domain],
      );
      const companyId = company.rows[0]?.id;
      for (const [index, amount] of lab.amounts.entries()) {
        await client.query(
          `INSERT INTO posts (id, kind, company_id, state, created_at, role_family, city, annual_pay, years_experience)
           VALUES ($1, 'pay_report', $2, 'approved', $3, $4, $5, $6, 2) ON CONFLICT (id) DO NOTHING`,
          [`seed-${lab.slug}-${index}`, companyId, SAMPLE_REPORT_DATE, lab.role, lab.city, amount],
        );
      }
    }
    await client.query("SELECT pg_advisory_unlock($1)", [SEED_LOCK]);
  } finally {
    client.release();
  }
  await seedFounder();
}

async function seedFounder(): Promise<void> {
  const { email, password } = config.founder;
  if (email === undefined || password === undefined) return;
  if (await first("SELECT 1 FROM users WHERE role = 'founder'")) return;
  await pool.query(
    `INSERT INTO users (role, display_name, email, password_hash, unlocked) VALUES ('founder', 'Founder', $1, $2, true)
     ON CONFLICT DO NOTHING`,
    [email, await hashPassword(password)],
  );
}
