import { randomUUID } from 'node:crypto';
import { TIERS } from '../shared/domain';
import type { Db } from './db';

const COIN_CUES = [
  ['cue-starter', 'Starter Cue', 0, 1, 0, 0, 0, 0],
  ['cue-ash-break', 'Ash Break', 400, 1, 5, 2, 0, 0],
  ['cue-copper-ferrule', 'Copper Ferrule', 1500, 3, 10, 3, 5, 1],
  ['cue-night-maple', 'Night Maple', 6000, 7, 15, 6, 8, 1],
  ['cue-velvet-taper', 'Velvet Taper', 20000, 12, 20, 8, 12, 2],
  ['cue-long-rail-master', 'Long Rail Master', 75000, 20, 25, 10, 15, 3],
] as const;
const CASH_CUES = [
  ['cue-brass-inlay', 'Brass Inlay', 40, 1],
  ['cue-lamp-black', 'Lamp Black', 90, 3],
] as const;
const CLOTHS = [
  ['cloth-hall-blue', 'Hall Blue', 0, 1],
  ['cloth-oxblood', 'Oxblood', 30, 1],
  ['cloth-moss', 'Moss', 30, 1],
  ['cloth-brass-felt', 'Brass Felt', 60, 5],
] as const;
const PACKS = [
  ['pack-chalk', 'Chalk Pack', 50, 99],
  ['pack-rack', 'Rack Pack', 120, 199],
  ['pack-hall', 'Hall Pack', 300, 499],
] as const;

interface SeedMember {
  name: string;
  level: number;
  wins: number;
}

const MEMBERS: Record<string, SeedMember> = {
  mara: { name: 'Mara Quill', level: 14, wins: 41 },
  rook: { name: 'Rook Adeyemi', level: 16, wins: 38 },
  teo: { name: 'Teo Banks', level: 11, wins: 33 },
  ines: { name: 'Ines Varga', level: 9, wins: 27 },
  sol: { name: 'Sol Petrov', level: 6, wins: 12 },
  hale: { name: 'Hale Dunmore', level: 5, wins: 0 },
};
for (let number = 1; number <= 49; number += 1) {
  const label = String(number).padStart(2, '0');
  MEMBERS[`regular-${label}`] = { name: `Hall Regular ${label}`, level: 5, wins: 0 };
}

const REGULARS = Array.from({ length: 49 }, (_, index) => `regular-${String(index + 1).padStart(2, '0')}`);
const CLUBS = [
  { key: 'corner-pocket', name: 'Corner Pocket Society', policy: 'open', members: [['mara', 'owner'], ['teo', 'officer'], ['ines', 'member']] },
  { key: 'night-rail', name: 'Night Rail Club', policy: 'request', members: [['rook', 'owner'], ['sol', 'member']] },
  { key: 'full-house', name: 'Full House Hall', policy: 'open', members: [['hale', 'owner'], ...REGULARS.map((key) => [key, 'member'])] },
] as const;

export async function ensureOpenBracket(client: Db, tier: number): Promise<void> {
  await client.query(`INSERT INTO tournaments (id, tier, status) VALUES ($1,$2,'open') ON CONFLICT (tier) WHERE status = 'open' DO NOTHING`, [randomUUID(), tier]);
}

export async function applySeed(client: Db): Promise<void> {
  let sort = 0;
  const addItem = async (kind: string, currency: string, id: string, name: string, price: number, minLevel: number, stats: readonly number[]): Promise<void> => {
    sort += 1;
    await client.query(
      `INSERT INTO items (id, kind, name, currency, price, min_level, aim, power, spin, time, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
      [id, kind, name, currency, price, minLevel, ...stats, sort],
    );
  };
  for (const [id, name, price, level, aim, power, spin, time] of COIN_CUES) await addItem('cue', 'coins', id, name, price, level, [aim, power, spin, time]);
  for (const [id, name, price, level] of CASH_CUES) await addItem('cue', 'cash', id, name, price, level, [0, 0, 0, 0]);
  for (const [id, name, price, level] of CLOTHS) await addItem('cloth', 'cash', id, name, price, level, [0, 0, 0, 0]);
  for (const [id, name, cash, cents] of PACKS) {
    await client.query('INSERT INTO cash_packs (id, name, cash, price_cents) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', [id, name, cash, cents]);
  }

  for (const { tier } of TIERS) await ensureOpenBracket(client, tier);

  const ids = new Map<string, string>();
  for (const [key, member] of Object.entries(MEMBERS)) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO players (id, seed_key, display_name, level, fixed_weekly_wins) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (seed_key) DO UPDATE SET seed_key = EXCLUDED.seed_key RETURNING id`,
      [randomUUID(), key, member.name, member.level, member.wins],
    );
    ids.set(key, rows[0].id);
  }
  for (const club of CLUBS) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO clubs (id, seed_key, name, join_policy) VALUES ($1,$2,$3,$4)
       ON CONFLICT (seed_key) DO NOTHING RETURNING id`,
      [randomUUID(), club.key, club.name, club.policy],
    );
    if (rows.length === 0) continue;
    for (const [key, role] of club.members) {
      await client.query('INSERT INTO club_members (player_id, club_id, role) VALUES ($1,$2,$3)', [ids.get(key), rows[0].id, role]);
    }
  }
}
