import type { PoolClient } from './db.js';
import type { SessionPlayer } from '../shared/types.js';
import { xpToNext, matchXp, LEVEL_UP_CASH } from '../shared/game.js';

export interface PlayerRow {
  id: string;
  email: string;
  display_name: string;
  birth_year: number;
  minor: boolean;
  email_verified: boolean;
  level: number;
  xp: number;
  coins: number;
  cash: number;
  wins: number;
  losses: number;
  win_streak: number;
  highest_pot: number;
  weekly_wins: number;
  last_win_at: Date | null;
  daily_claimed_day: string | null;
  refills_day: string | null;
  refills_used: number;
  equipped_cue_id: string;
  equipped_cloth_id: string;
  friend_code: string;
  settings: Record<string, unknown>;
  deleted_at: Date | null;
  is_seed: boolean;
}

export function sessionPlayer(row: PlayerRow): SessionPlayer {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    level: row.level,
    xp: row.xp,
    coins: Number(row.coins),
    cash: Number(row.cash),
    emailVerified: row.email_verified,
    minor: row.minor,
  };
}

/** Applies match XP and returns the level deltas; levelling grants LEVEL_UP_CASH. */
export function applyXp(row: PlayerRow, gained: number): { levelUps: number[]; finalLevel: number; finalXp: number; cashGrant: number } {
  let level = row.level;
  let xp = row.xp + gained;
  const levelUps: number[] = [];
  let cash = 0;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    levelUps.push(level);
    cash += LEVEL_UP_CASH;
  }
  void cash;
  return { levelUps, finalLevel: level, finalXp: xp, cashGrant: levelUps.length * LEVEL_UP_CASH };
}

export function matchXpFor(tier: number, won: boolean): number {
  return matchXp(tier, won);
}

export async function loadPlayer(client: PoolClient, playerId: string): Promise<PlayerRow | null> {
  const res = await client.query<PlayerRow>(
    `SELECT id, email, display_name, birth_year, minor, email_verified, level, xp, coins, cash, wins, losses,
            win_streak, highest_pot, weekly_wins, last_win_at, daily_claimed_day, refills_day, refills_used,
            equipped_cue_id, equipped_cloth_id, friend_code, settings, deleted_at, is_seed
     FROM players WHERE id = $1 AND deleted_at IS NULL`,
    [playerId]
  );
  return res.rows[0] ?? null;
}
