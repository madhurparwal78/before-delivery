import type { Queryable } from './db.js';
import { now } from './clock.js';
import { hashPassword, normaliseEmail } from './domain/accounts.js';
import { createStarterIsland } from './domain/village.js';
import type { AccountRole, ClanRole } from '../shared/types.js';

type SeedAccount = {
  displayName: string;
  email: string;
  password: string;
  role: AccountRole;
  timeZone: string;
  trophies: number;
  island: boolean;
  clan?: { role: ClanRole; order: number };
};

const SEED_CLAN = { name: 'Brackwater Kin', motto: 'We keep the sluice open.' };

const SEED_ACCOUNTS: readonly SeedAccount[] = [
  {
    displayName: 'Studio Ops',
    email: 'ops@lowtide.test',
    password: 'Tideline-Operator-27',
    role: 'operator',
    timeZone: 'UTC',
    trophies: 0,
    island: false
  },
  {
    displayName: 'Ivo Brack',
    email: 'ivo@lowtide.test',
    password: 'Saltpan-Ivo-27',
    role: 'islander',
    timeZone: 'America/Chicago',
    trophies: 120,
    island: true,
    clan: { role: 'mate', order: 2 }
  },
  {
    displayName: 'Marrow Quay',
    email: 'marrow@lowtide.test',
    password: 'Saltpan-Marrow-27',
    role: 'islander',
    timeZone: 'Europe/Lisbon',
    trophies: 240,
    island: true
  },
  {
    displayName: 'Pell Saunder',
    email: 'pell@lowtide.test',
    password: 'Saltpan-Pell-27',
    role: 'islander',
    timeZone: 'Australia/Hobart',
    trophies: 610,
    island: true,
    clan: { role: 'skipper', order: 1 }
  },
  {
    displayName: 'Wren Sallow',
    email: 'wren@lowtide.test',
    password: 'Saltpan-Wren-27',
    role: 'islander',
    timeZone: 'Europe/Dublin',
    trophies: 396,
    island: true
  },
  {
    displayName: 'Tamsin Rook',
    email: 'tamsin@lowtide.test',
    password: 'Saltpan-Tamsin-27',
    role: 'islander',
    timeZone: 'Asia/Kolkata',
    trophies: 401,
    island: true
  }
];

export async function applySeedData(client: Queryable): Promise<void> {
  const at = now();
  const { rows: existing } = await client.query<{ email_lower: string }>(
    'SELECT email_lower FROM accounts WHERE email_lower = ANY($1::text[])',
    [SEED_ACCOUNTS.map((account) => normaliseEmail(account.email))]
  );
  const present = new Set(existing.map((row) => row.email_lower));
  const accountIds = new Map<string, number>();

  for (const seed of SEED_ACCOUNTS) {
    const emailLower = normaliseEmail(seed.email);
    if (present.has(emailLower)) continue;
    const passwordHash = await hashPassword(seed.password);
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO accounts
         (email, email_lower, password_hash, display_name, time_zone, verified, role, trophies, created_at)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8)
       ON CONFLICT (email_lower) DO NOTHING
       RETURNING id`,
      [
        seed.email,
        emailLower,
        passwordHash,
        seed.displayName,
        seed.timeZone,
        seed.role,
        seed.trophies,
        at.toISOString()
      ]
    );
    const row = rows[0];
    if (!row) continue;
    const accountId = Number(row.id);
    accountIds.set(emailLower, accountId);
    if (seed.island) await createStarterIsland(client, accountId, at);
  }

  const clanMembers = SEED_ACCOUNTS.filter((seed) => seed.clan).sort(
    (left, right) => (left.clan?.order ?? 0) - (right.clan?.order ?? 0)
  );
  const joiningIds = clanMembers.map((seed) => accountIds.get(normaliseEmail(seed.email)));
  if (joiningIds.every((id) => id !== undefined)) {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO clans (name, name_lower, motto, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name_lower) DO NOTHING
       RETURNING id`,
      [SEED_CLAN.name, SEED_CLAN.name.toLowerCase(), SEED_CLAN.motto, at.toISOString()]
    );
    const clanRow = rows[0];
    if (clanRow) {
      const clanId = Number(clanRow.id);
      for (const [index, seed] of clanMembers.entries()) {
        const accountId = joiningIds[index];
        if (accountId === undefined) continue;
        const role = seed.clan?.role ?? 'deckhand';
        await client.query(
          `INSERT INTO clan_members (clan_id, account_id, role, joined_at, mate_since)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            clanId,
            accountId,
            role,
            new Date(at.getTime() + index).toISOString(),
            role === 'mate' ? at.toISOString() : null
          ]
        );
      }
    }
  }
}
