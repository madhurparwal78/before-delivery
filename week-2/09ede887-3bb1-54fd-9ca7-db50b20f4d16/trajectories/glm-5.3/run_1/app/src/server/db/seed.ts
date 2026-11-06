import type { Pool } from './pool.js';
import { SCHEMA_SQL } from './schema.js';
import {
  SEED_ACCOUNTS,
  SEED_SESSIONS,
  SEED_SPEAKERS,
  SEED_STAGES,
} from './seed-data.js';
import { hashPassword } from '../passwords.js';
import { venueWallToInstant, type WallClock } from '../../shared/venue.js';
import { foldText } from '../../shared/search.js';

/** A lock key so several starting instances serialise schema and seeding. */
const SEED_LOCK_KEY = 62026;

export const SEED_PASSWORD = 'deku-demo-pw-2026';

/** A speaker's slug: their name folded, other-character runs becoming `-`. */
export function speakerSlug(name: string): string {
  const folded = foldText(name);
  return folded.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function wallClock(hhmm: string): WallClock {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return h! * 3600_000 + m! * 60_000;
}

/**
 * Create the schema and seed the exact starting programme. Idempotent: nothing
 * that already exists is inserted again, so restarts never duplicate a row.
 */
export async function installSchemaAndSeed(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK_KEY]);
    await client.query(SCHEMA_SQL);

    for (const stage of SEED_STAGES) {
      await client.query(
        `INSERT INTO stages (slug, name, description, position)
         VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), 0) + 1 FROM stages WHERE false))
         ON CONFLICT (slug) DO NOTHING`,
        [stage.slug, stage.name, stage.description],
      );
    }
    // Stage order is the published order, applied after insertion.
    for (let i = 0; i < SEED_STAGES.length; i++) {
      await client.query('UPDATE stages SET position = $1 WHERE slug = $2', [
        i + 1,
        SEED_STAGES[i]!.slug,
      ]);
    }

    for (const account of SEED_ACCOUNTS) {
      const hash = await hashPassword(SEED_PASSWORD);
      await client.query(
        `INSERT INTO accounts (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING`,
        [account.name, account.email, hash, account.role],
      );
    }

    for (const session of SEED_SESSIONS) {
      const start = wallClock(session.start);
      const end = wallClock(session.end);
      const startInstant = new Date(venueWallToInstant(session.date, start));
      const endInstant = new Date(venueWallToInstant(session.date, end));
      await client.query(
        `INSERT INTO sessions
           (id, day, date, start_local, end_local, start_instant, end_instant,
            title, stage_slug, location, format, format_label, description, capacity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING`,
        [
          session.id,
          session.day,
          session.date,
          session.start,
          session.end,
          startInstant,
          endInstant,
          session.title,
          session.stage,
          session.location,
          session.format,
          session.formatLabel,
          session.description,
          session.capacity,
        ],
      );
    }

    for (const speaker of SEED_SPEAKERS) {
      await client.query(
        `INSERT INTO speakers (slug, name, company, bio)
         VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING`,
        [speakerSlug(speaker.name), speaker.name, speaker.company, speaker.bio],
      );
    }

    // Link sessions to speakers, in agenda order within each session.
    for (const session of SEED_SESSIONS) {
      for (let i = 0; i < session.speakers.length; i++) {
        const ref = session.speakers[i]!;
        const slug = speakerSlug(ref.name);
        await client.query(
          `INSERT INTO session_speakers (session_id, speaker_id, position)
           SELECT $1, id, $2 FROM speakers WHERE slug = $3
           ON CONFLICT (session_id, speaker_id) DO NOTHING`,
          [session.id, i + 1, slug],
        );
      }
    }

    // The one starting reservation: Quinn Hale in Clone Your Writing Voice.
    await client.query(
      `INSERT INTO reservations (session_id, account_id)
       SELECT $1, id FROM accounts WHERE email = $2
       ON CONFLICT (session_id, account_id) DO NOTHING`,
      ['d1-clone-your-writing-voice', 'attendee3@example.com'],
    );

    await client.query(
      `INSERT INTO contest (id, final_figure, revealed_at) VALUES (1, NULL, NULL)
       ON CONFLICT (id) DO NOTHING`,
    );

    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the connection is gone; nothing to roll back */
    }
    throw err;
  } finally {
    client.release();
  }
}
