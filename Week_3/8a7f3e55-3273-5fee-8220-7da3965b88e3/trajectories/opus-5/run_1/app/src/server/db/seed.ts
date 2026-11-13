import { pool } from './pool.js';
import { SCHEMA_SQL } from './schema.js';
import { hashPassword } from '../http/passwords.js';
import {
  BOOKING_REF_START,
  CONTRACT_INCREMENT_MINUTES,
  CONTRACT_MINIMUM_MINUTES,
  LINE_REF_START,
  SEED_ORGS,
  SEED_PASSWORD,
  SEED_RATE_EFFECTIVE_FROM,
  SEED_USERS,
} from './seed-data.js';

const SETUP_LOCK_KEY = 728_431_905;

export async function applySchemaAndSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SETUP_LOCK_KEY]);
    await client.query(SCHEMA_SQL);

    for (const org of SEED_ORGS) {
      await client.query('INSERT INTO orgs (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [
        org.id,
        org.name,
      ]);
      await client.query(
        `INSERT INTO contracts (id, org_id, minimum_minutes, increment_minutes, rotation_interval_minutes)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [
          org.contractId,
          org.id,
          CONTRACT_MINIMUM_MINUTES,
          CONTRACT_INCREMENT_MINUTES,
          org.rotationIntervalMinutes,
        ],
      );
      await client.query(
        `INSERT INTO contract_rates (contract_id, effective_from, hourly_rate_cents, team_surcharge_bp, mileage_cents_per_mile)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (contract_id, effective_from) DO NOTHING`,
        [
          org.contractId,
          SEED_RATE_EFFECTIVE_FROM,
          org.hourlyRateCents,
          org.teamSurchargeBp,
          org.mileageCentsPerMile,
        ],
      );
    }

    for (const user of SEED_USERS) {
      const existing = await client.query('SELECT 1 FROM users WHERE id = $1', [user.id]);
      if (existing.rowCount === 0) {
        await client.query(
          `INSERT INTO users (id, name, email, password_hash, role, org_id, initials, phone, home_city, pay_rate_cents)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
          [
            user.id,
            user.name,
            user.email,
            hashPassword(SEED_PASSWORD),
            user.role,
            user.orgId,
            user.initials,
            user.phone,
            user.homeCity,
            user.payRateCents,
          ],
        );
      }
      for (const credential of user.credentials) {
        await client.query(
          `INSERT INTO credentials (user_id, code, expires_on) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, code) DO NOTHING`,
          [user.id, credential.code, credential.expiresOn],
        );
      }
    }

    await client.query(
      `INSERT INTO counters (name, value) VALUES ('booking_ref', $1), ('line_ref', $2)
       ON CONFLICT (name) DO NOTHING`,
      [BOOKING_REF_START - 1, LINE_REF_START - 1],
    );
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SETUP_LOCK_KEY]);
    client.release();
  }
}
