import { query } from './db.js';

export type CharacterRow = {
  id: string;
  account_id: string;
  slot: number;
  revision: number;
  name: string;
  parts: Record<string, string>;
  proportions: Record<string, number>;
  pose: { right_arm_raise: number };
  material: string;
  accessories: Record<string, string>;
  model_id: string | null;
  weapon_id: string | null;
  equipped: boolean;
};

export function characterJson(c: CharacterRow): Record<string, unknown> {
  return {
    id: c.id,
    slot: c.slot,
    revision: c.revision,
    name: c.name,
    parts: c.parts,
    proportions: c.proportions,
    pose: c.pose,
    material: c.material,
    accessories: c.accessories,
    model_id: c.model_id,
    weapon_id: c.weapon_id,
    equipped: c.equipped,
  };
}

export async function charactersForAccount(accountId: string): Promise<CharacterRow[]> {
  const res = await query<CharacterRow>(
    `select id, account_id, slot, revision, name, parts, proportions, pose, material, accessories, model_id, weapon_id, equipped
       from characters where account_id = $1 order by slot`,
    [accountId],
  );
  return res.rows;
}

export async function characterById(id: string): Promise<CharacterRow | null> {
  const res = await query<CharacterRow>(
    `select id, account_id, slot, revision, name, parts, proportions, pose, material, accessories, model_id, weapon_id, equipped
       from characters where id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}

export async function equippedCharacter(accountId: string): Promise<CharacterRow | null> {
  const all = await charactersForAccount(accountId);
  return all.find((c) => c.equipped) ?? null;
}

