import type { Queryable } from './pool.js';
import { SCHEMA_SQL } from './schema.js';
import {
  DAY_DATES,
  SEED_ACCOUNTS,
  SEED_BIOS,
  SEED_PASSWORD,
  SEED_RESERVATION,
  SEED_SESSIONS,
  SEED_STAGES,
} from './seedData.js';
import { speakerSlug } from '../domain/fold.js';
import { venueWallClockToInstant } from '../domain/venueTime.js';
import { hashPassword } from '../domain/passwords.js';

/** One fixed key so concurrently starting instances serialise schema creation and seeding. */
const SEED_LOCK_KEY = 7412026;

export async function createSchemaAndSeed(client: Queryable): Promise<void> {
  await client.query('SELECT pg_advisory_lock($1)', [SEED_LOCK_KEY]);
  try {
    await client.query(SCHEMA_SQL);
    await seedRows(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK_KEY]);
  }
}

async function seedRows(client: Queryable): Promise<void> {
  const before = await client.query<{ programme: number }>('SELECT count(*)::int AS programme FROM sessions');
  const firstRun = (before.rows[0]?.programme ?? 0) === 0;
  const passwordHash = await hashPassword(SEED_PASSWORD);
  for (const account of SEED_ACCOUNTS) {
    await client.query(
      `INSERT INTO accounts (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [account.name, account.email, passwordHash, account.role],
    );
  }

  for (const [index, stage] of SEED_STAGES.entries()) {
    await client.query(
      `INSERT INTO stages (slug, name, description, position) VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET name = excluded.name, description = excluded.description, position = excluded.position`,
      [stage.slug, stage.name, stage.description, index],
    );
  }

  const speakerPosition = new Map<string, number>();
  for (const session of SEED_SESSIONS) {
    for (const speaker of session.speakers) {
      const slug = speakerSlug(speaker.name);
      if (speakerPosition.has(slug)) continue;
      speakerPosition.set(slug, speakerPosition.size);
      await client.query(
        `INSERT INTO speakers (slug, name, company, bio, position) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (slug) DO UPDATE SET name = excluded.name, company = excluded.company, position = excluded.position`,
        [slug, speaker.name, speaker.company, SEED_BIOS[slug] ?? '', speakerPosition.size - 1],
      );
    }
  }

  for (const session of SEED_SESSIONS) {
    const date = DAY_DATES[session.day];
    await client.query(
      `INSERT INTO sessions (id, day, date, start_local, end_local, start_instant, end_instant, title, stage, location, format, description, capacity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO NOTHING`,
      [
        session.id,
        session.day,
        date,
        session.startLocal,
        session.endLocal,
        venueWallClockToInstant(date, session.startLocal).toISOString(),
        venueWallClockToInstant(date, session.endLocal).toISOString(),
        session.title,
        session.stage,
        session.location,
        session.format,
        session.description,
        session.capacity,
      ],
    );
    for (const [index, speaker] of session.speakers.entries()) {
      await client.query(
        `INSERT INTO session_speakers (session_id, speaker_slug, position) VALUES ($1, $2, $3)
         ON CONFLICT (session_id, speaker_slug) DO NOTHING`,
        [session.id, speakerSlug(speaker.name), index],
      );
    }
  }

  await client.query('INSERT INTO contest (id) VALUES (1) ON CONFLICT (id) DO NOTHING');

  // Only the first start plants the starting reservation; a later start must
  // not bring back a seat the attendee has since cancelled.
  if (firstRun) {
    await client.query(
      `INSERT INTO reservations (session_id, account_id)
       SELECT $1, a.id FROM accounts a WHERE a.email = $2`,
      [SEED_RESERVATION.sessionId, SEED_RESERVATION.email],
    );
  }
}
