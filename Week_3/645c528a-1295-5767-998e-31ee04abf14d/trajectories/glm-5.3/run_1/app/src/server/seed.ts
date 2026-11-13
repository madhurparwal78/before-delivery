import type { Db, PoolClient } from './db.js';
import { id, friendCode } from './util.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';

export interface SeedItem {
  id: string;
  kind: 'cue' | 'cloth';
  name: string;
  currency: 'coins' | 'cash';
  price: number;
  minLevel: number;
  aim: number;
  power: number;
  spin: number;
  time: number;
}

export const SEED_ITEMS: SeedItem[] = [
  { id: 'cue-starter', kind: 'cue', name: 'Starter Cue', currency: 'coins', price: 0, minLevel: 1, aim: 0, power: 0, spin: 0, time: 0 },
  { id: 'cue-ash-break', kind: 'cue', name: 'Ash Break', currency: 'coins', price: 400, minLevel: 1, aim: 5, power: 2, spin: 0, time: 0 },
  { id: 'cue-copper-ferrule', kind: 'cue', name: 'Copper Ferrule', currency: 'coins', price: 1500, minLevel: 3, aim: 10, power: 3, spin: 5, time: 1 },
  { id: 'cue-night-maple', kind: 'cue', name: 'Night Maple', currency: 'coins', price: 6000, minLevel: 7, aim: 15, power: 6, spin: 8, time: 1 },
  { id: 'cue-velvet-taper', kind: 'cue', name: 'Velvet Taper', currency: 'coins', price: 20000, minLevel: 12, aim: 20, power: 8, spin: 12, time: 2 },
  { id: 'cue-long-rail-master', kind: 'cue', name: 'Long Rail Master', currency: 'coins', price: 75000, minLevel: 20, aim: 25, power: 10, spin: 15, time: 3 },
  { id: 'cue-brass-inlay', kind: 'cue', name: 'Brass Inlay', currency: 'cash', price: 40, minLevel: 1, aim: 0, power: 0, spin: 0, time: 0 },
  { id: 'cue-lamp-black', kind: 'cue', name: 'Lamp Black', currency: 'cash', price: 90, minLevel: 3, aim: 0, power: 0, spin: 0, time: 0 },
  { id: 'cloth-hall-blue', kind: 'cloth', name: 'Hall Blue', currency: 'cash', price: 0, minLevel: 1, aim: 0, power: 0, spin: 0, time: 0 },
  { id: 'cloth-oxblood', kind: 'cloth', name: 'Oxblood', currency: 'cash', price: 30, minLevel: 1, aim: 0, power: 0, spin: 0, time: 0 },
  { id: 'cloth-moss', kind: 'cloth', name: 'Moss', currency: 'cash', price: 30, minLevel: 1, aim: 0, power: 0, spin: 0, time: 0 },
  { id: 'cloth-brass-felt', kind: 'cloth', name: 'Brass Felt', currency: 'cash', price: 60, minLevel: 5, aim: 0, power: 0, spin: 0, time: 0 },
];

export const SEED_PACKS = [
  { id: 'pack-chalk', name: 'Chalk Pack', cash: 50, priceUsd: '0.99' },
  { id: 'pack-rack', name: 'Rack Pack', cash: 120, priceUsd: '1.99' },
  { id: 'pack-hall', name: 'Hall Pack', cash: 300, priceUsd: '4.99' },
];

interface SeedPlayer {
  key: string;
  displayName: string;
  level: number;
  weeklyWins: number;
}

export const SEED_PLAYERS: SeedPlayer[] = [
  { key: 'seed-mara-quill', displayName: 'Mara Quill', level: 14, weeklyWins: 41 },
  { key: 'seed-rook-adeyemi', displayName: 'Rook Adeyemi', level: 16, weeklyWins: 38 },
  { key: 'seed-teo-banks', displayName: 'Teo Banks', level: 11, weeklyWins: 33 },
  { key: 'seed-ines-varga', displayName: 'Ines Varga', level: 9, weeklyWins: 27 },
  { key: 'seed-sol-petrov', displayName: 'Sol Petrov', level: 6, weeklyWins: 12 },
  { key: 'seed-hale-dunmore', displayName: 'Hale Dunmore', level: 5, weeklyWins: 0 },
];

export async function seedCatalog(db: Db): Promise<void> {
  for (const item of SEED_ITEMS) {
    await db.pool.query(
      `INSERT INTO items (id, kind, name, currency, price, min_level, aim, power, spin, time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET kind=EXCLUDED.kind, name=EXCLUDED.name, currency=EXCLUDED.currency,
         price=EXCLUDED.price, min_level=EXCLUDED.min_level, aim=EXCLUDED.aim, power=EXCLUDED.power,
         spin=EXCLUDED.spin, time=EXCLUDED.time`,
      [item.id, item.kind, item.name, item.currency, item.price, item.minLevel, item.aim, item.power, item.spin, item.time]
    );
  }
  for (const pack of SEED_PACKS) {
    await db.pool.query(
      `INSERT INTO cash_packs (id, name, cash, price_usd) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, cash=EXCLUDED.cash, price_usd=EXCLUDED.price_usd`,
      [pack.id, pack.name, pack.cash, pack.priceUsd]
    );
  }
}

export async function seedPeople(db: Db): Promise<void> {
  const club = { id: 'club-corner-pocket-society', name: 'Corner Pocket Society', policy: 'open', score: 101 };
  const club2 = { id: 'club-night-rail', name: 'Night Rail Club', policy: 'request', score: 50 };
  const club3 = { id: 'club-full-house-hall', name: 'Full House Hall', policy: 'open', score: 0 };

  const roles: Record<string, 'owner' | 'officer' | 'member'> = {
    'seed-mara-quill': 'owner',
    'seed-teo-banks': 'officer',
    'seed-ines-varga': 'member',
  };

  for (const p of SEED_PLAYERS) {
    await db.pool.query(
      `INSERT INTO players (id, email, password_hash, display_name, birth_year, minor, email_verified, level, xp,
         coins, cash, weekly_wins, friend_code, settings, is_seed)
       VALUES ($1,$2,$3,$4,$5,false,true,$6,0,0,0,$7,$8,$9::jsonb,true)
       ON CONFLICT (id) DO NOTHING`,
      [p.key, `${p.key}@seed.longrail.internal`, '-', p.displayName, 1980, p.level, p.weeklyWins, friendCode(), JSON.stringify(DEFAULT_SETTINGS)]
    );
  }
  for (let i = 1; i <= 49; i++) {
    const pid = `seed-hall-regular-${String(i).padStart(2, '0')}`;
    await db.pool.query(
      `INSERT INTO players (id, email, password_hash, display_name, birth_year, minor, email_verified, level, xp,
         coins, cash, weekly_wins, friend_code, settings, is_seed)
       VALUES ($1,$2,'-',$3,1980,false,true,5,0,0,0,0,$4,$5::jsonb,true)
       ON CONFLICT (id) DO NOTHING`,
      [pid, `${pid}@seed.longrail.internal`, `Hall Regular ${String(i).padStart(2, '0')}`, friendCode(), JSON.stringify(DEFAULT_SETTINGS)]
    );
  }

  await db.pool.query(
    `INSERT INTO clubs (id, name, join_policy, owner_id, weekly_score) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO NOTHING`,
    [club.id, club.name, club.policy, 'seed-mara-quill', club.score]
  );
  await db.pool.query(
    `INSERT INTO clubs (id, name, join_policy, owner_id, weekly_score) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO NOTHING`,
    [club2.id, club2.name, club2.policy, 'seed-rook-adeyemi', club2.score]
  );
  await db.pool.query(
    `INSERT INTO clubs (id, name, join_policy, owner_id, weekly_score) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO NOTHING`,
    [club3.id, club3.name, club3.policy, 'seed-hale-dunmore', club3.score]
  );

  const members: [string, string, 'owner' | 'officer' | 'member'][] = [
    [club.id, 'seed-mara-quill', 'owner'],
    [club.id, 'seed-teo-banks', 'officer'],
    [club.id, 'seed-ines-varga', 'member'],
    [club2.id, 'seed-rook-adeyemi', 'owner'],
    [club2.id, 'seed-sol-petrov', 'member'],
  ];
  for (const [cid, pid, role] of members) {
    await db.pool.query(
      `INSERT INTO club_members (club_id, player_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [cid, pid, role]
    );
  }
  for (let i = 1; i <= 49; i++) {
    await db.pool.query(
      `INSERT INTO club_members (club_id, player_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`,
      [club3.id, `seed-hall-regular-${String(i).padStart(2, '0')}`]
    );
  }
  await db.pool.query(
    `INSERT INTO club_members (club_id, player_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`,
    [club3.id, 'seed-hale-dunmore']
  );

  // Weekly score must equal the roster's weekly wins.
  await db.pool.query(`UPDATE clubs c SET weekly_score = COALESCE((SELECT SUM(p.weekly_wins) FROM club_members m JOIN players p ON p.id = m.player_id WHERE m.club_id = c.id), 0)`);
}

export async function openTournaments(db: Db): Promise<void> {
  for (const tier of [1, 2, 3, 4, 5]) {
    const res = await db.pool.query(`SELECT id FROM tournaments WHERE tier = $1 AND status = 'open'`, [tier]);
    if (res.rowCount === 0) {
      await db.pool.query(
        `INSERT INTO tournaments (id, tier, status, entry) VALUES ($1,$2,'open',$3)`,
        [id('tourn'), tier, [0, 100, 500, 2500, 10000, 50000][tier]]
      );
    }
  }
}

export async function runSeed(db: Db): Promise<void> {
  await seedCatalog(db);
  await seedPeople(db);
  await openTournaments(db);
}

export async function ensureOpenTournament(client: PoolClient, tier: number): Promise<void> {
  const res = await client.query(`SELECT id FROM tournaments WHERE tier = $1 AND status = 'open' LIMIT 1`, [tier]);
  if (res.rowCount === 0) {
    await client.query(
      `INSERT INTO tournaments (id, tier, status, entry) VALUES ($1,$2,'open',$3)`,
      [id('tourn'), tier, [0, 100, 500, 2500, 10000, 50000][tier]]
    );
  }
}
