import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { hashPassword, insertDefaultHero } from './accounts.js';
import type { Locale } from '../shared/i18n/index.js';

interface SeedAccount {
  email: string;
  password: string;
  displayName: string;
  locale: Locale;
  heroName: string;
}

const SEED_ACCOUNTS: readonly SeedAccount[] = [
  { email: 'aiko@linewright.test', password: 'paper-lantern-01', displayName: 'Aiko_Sketch', locale: 'ja', heroName: 'Aiko' },
  { email: 'mateo@linewright.test', password: 'paper-lantern-02', displayName: 'MateoTrazo', locale: 'es', heroName: 'Mateo' },
  { email: 'robin@linewright.test', password: 'paper-lantern-03', displayName: 'RobinInk', locale: 'en', heroName: 'Robin' },
  { email: 'sol@linewright.test', password: 'paper-lantern-04', displayName: 'SolDoodle', locale: 'en', heroName: 'Sol' },
  { email: 'kenji@linewright.test', password: 'paper-lantern-05', displayName: 'KenjiLines', locale: 'ja', heroName: 'Kenji' },
  { email: 'noa@linewright.test', password: 'paper-lantern-06', displayName: 'NoaPencil', locale: 'en', heroName: 'Noa' },
  { email: 'lucia@linewright.test', password: 'paper-lantern-07', displayName: 'LuciaGrafito', locale: 'es', heroName: 'Lucia' },
  { email: 'haru@linewright.test', password: 'paper-lantern-08', displayName: 'HaruSumi', locale: 'ja', heroName: 'Haru' },
];

export async function insertSeedData(): Promise<void> {
  await transaction(async (client) => {
    const ids: string[] = [];
    for (const seed of SEED_ACCOUNTS) {
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM accounts WHERE email_lower = $1',
        [seed.email.toLowerCase()],
      );
      if (existing.rows.length > 0) {
        ids.push(existing.rows[0].id);
        continue;
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO accounts
           (id, email, email_lower, password_hash, display_name, display_name_lower, locale,
            email_verified, verification_email, storage_notice)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'sent', NULL)`,
        [
          id,
          seed.email,
          seed.email.toLowerCase(),
          hashPassword(seed.password),
          seed.displayName,
          seed.displayName.toLowerCase(),
          seed.locale,
        ],
      );
      await insertDefaultHero(client, id, seed.heroName);
      ids.push(id);
    }

    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const low = ids[i] < ids[j] ? ids[i] : ids[j];
        const high = ids[i] < ids[j] ? ids[j] : ids[i];
        await client.query(
          `INSERT INTO friendships (low_id, high_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [low, high],
        );
      }
    }
  });
}
