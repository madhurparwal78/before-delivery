import { createHash, randomUUID } from 'node:crypto';
import { STARTER_CLOTH_ID, STARTER_CUE_ID, TIERS } from '../shared/catalog.js';
import { query } from './db.js';

export function seedId(label: string): string {
  const hash = createHash('sha1').update(`long-rail:${label}`).digest('hex');
  return [hash.slice(0, 8), hash.slice(8, 12), `5${hash.slice(13, 16)}`, `8${hash.slice(17, 20)}`, hash.slice(20, 32)].join('-');
}

function seedFriendCode(label: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const hash = createHash('sha1').update(`code:${label}`).digest();
  let code = '';
  for (let index = 0; index < 8; index += 1) code += alphabet[(hash[index] as number) % alphabet.length];
  return code;
}

interface SeedPlayer {
  name: string;
  level: number;
  weeklyWins: number;
}

const SEED_PLAYERS: SeedPlayer[] = [
  { name: 'Mara Quill', level: 14, weeklyWins: 41 },
  { name: 'Rook Adeyemi', level: 16, weeklyWins: 38 },
  { name: 'Teo Banks', level: 11, weeklyWins: 33 },
  { name: 'Ines Varga', level: 9, weeklyWins: 27 },
  { name: 'Sol Petrov', level: 6, weeklyWins: 12 },
  { name: 'Hale Dunmore', level: 5, weeklyWins: 0 },
];

for (let index = 1; index <= 49; index += 1) {
  SEED_PLAYERS.push({ name: `Hall Regular ${String(index).padStart(2, '0')}`, level: 5, weeklyWins: 0 });
}

interface SeedClub {
  name: string;
  policy: 'open' | 'request';
  members: { name: string; role: 'owner' | 'officer' | 'member' }[];
}

const SEED_CLUBS: SeedClub[] = [
  {
    name: 'Corner Pocket Society',
    policy: 'open',
    members: [
      { name: 'Mara Quill', role: 'owner' },
      { name: 'Teo Banks', role: 'officer' },
      { name: 'Ines Varga', role: 'member' },
    ],
  },
  {
    name: 'Night Rail Club',
    policy: 'request',
    members: [
      { name: 'Rook Adeyemi', role: 'owner' },
      { name: 'Sol Petrov', role: 'member' },
    ],
  },
  {
    name: 'Full House Hall',
    policy: 'open',
    members: [
      { name: 'Hale Dunmore', role: 'owner' },
      ...Array.from({ length: 49 }, (_, index) => ({
        name: `Hall Regular ${String(index + 1).padStart(2, '0')}`,
        role: 'member' as const,
      })),
    ],
  },
];

/** Applied idempotently on serve. */
export async function applySeed(): Promise<void> {
  for (const player of SEED_PLAYERS) {
    const id = seedId(player.name);
    await query(
      `INSERT INTO players (id, email, password_hash, display_name, birth_year, level, xp, coins, cash,
         email_verified, minor, weekly_wins, equipped_cue_id, equipped_cloth_id, friend_code, seeded)
       VALUES ($1, NULL, NULL, $2, 1990, $3, 0, 0, 0, TRUE, FALSE, $4, $5, $6, $7, TRUE)
       ON CONFLICT (id) DO UPDATE SET display_name = $2, level = $3, weekly_wins = $4, seeded = TRUE`,
      [id, player.name, player.level, player.weeklyWins, STARTER_CUE_ID, STARTER_CLOTH_ID, seedFriendCode(player.name)],
    );
    await query(`INSERT INTO player_items (player_id, item_id) VALUES ($1,$2), ($1,$3) ON CONFLICT DO NOTHING`, [
      id,
      STARTER_CUE_ID,
      STARTER_CLOTH_ID,
    ]);
  }

  for (const club of SEED_CLUBS) {
    const id = seedId(`club:${club.name}`);
    await query(
      `INSERT INTO clubs (id, name, join_policy) VALUES ($1,$2,$3)
       ON CONFLICT (name) DO UPDATE SET join_policy = $3`,
      [id, club.name, club.policy === 'open' ? 'open' : 'request'],
    );
    for (const member of club.members) {
      await query(
        `INSERT INTO club_members (club_id, player_id, role) VALUES ($1,$2,$3)
         ON CONFLICT (player_id) DO UPDATE SET club_id = $1, role = $3`,
        [id, seedId(member.name), member.role],
      );
    }
  }

  for (const tier of TIERS) {
    const open = await query<{ id: string }>(
      `SELECT id FROM tournaments WHERE tier = $1 AND status = 'open' LIMIT 1`,
      [tier.tier],
    );
    if (open.length === 0) {
      await query(`INSERT INTO tournaments (id, tier, status) VALUES ($1,$2,'open')`, [randomUUID(), tier.tier]);
    }
  }
}
