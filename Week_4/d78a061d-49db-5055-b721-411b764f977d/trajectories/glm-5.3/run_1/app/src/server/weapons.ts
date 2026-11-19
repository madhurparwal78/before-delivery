import { query } from './db.js';
import type { Stroke } from '../shared/domain.js';

export type WeaponRow = {
  id: string;
  account_id: string;
  number: number;
  strokes: Stroke[];
  stats: { reach_m: number; weight_kg: number; swing_per_s: number };
  vertices: number;
  created_at: Date;
};

export function weaponJson(w: WeaponRow, equippedOn: string[]): Record<string, unknown> {
  return {
    id: w.id,
    number: w.number,
    strokes: w.strokes,
    stats: w.stats,
    vertices: w.vertices,
    equipped_on: equippedOn,
  };
}

export async function weaponsForAccount(accountId: string): Promise<WeaponRow[]> {
  const res = await query<WeaponRow>(
    `select id, account_id, number, strokes, stats, vertices, created_at
       from weapons where account_id = $1 order by created_at desc, number desc`,
    [accountId],
  );
  return res.rows;
}

export async function weaponById(id: string): Promise<WeaponRow | null> {
  const res = await query<WeaponRow>(
    'select id, account_id, number, strokes, stats, vertices, created_at from weapons where id = $1',
    [id],
  );
  return res.rows[0] ?? null;
}

export async function equippedOnCharacterIds(weaponId: string): Promise<string[]> {
  const res = await query<{ id: string }>('select id from characters where weapon_id = $1', [weaponId]);
  return res.rows.map((r) => r.id);
}
