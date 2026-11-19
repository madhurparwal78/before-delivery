import { randomUUID } from 'node:crypto';
import { query, transaction } from '../db.js';
import { errors } from '../errors.js';
import { readJsonBody, requireAccount, type Ctx, type Reply } from '../http.js';
import {
  assertForgeable,
  countVertices,
  deriveStats,
  parseStrokes,
  previewDrawing,
} from '../domain/weapon.js';
import { rowToCharacter, type CharacterRow } from '../domain/hero.js';
import type { Stats, Stroke, Weapon } from '../../shared/types.js';

interface WeaponRow {
  id: string;
  number: number;
  strokes: Stroke[];
  stats: Stats;
  vertices: number;
}

async function equippedOn(weaponId: string): Promise<string[]> {
  const rows = await query<{ id: string }>('SELECT id FROM characters WHERE weapon_id = $1', [
    weaponId,
  ]);
  return rows.map((row) => row.id);
}

async function toWeapon(row: WeaponRow): Promise<Weapon> {
  return {
    id: row.id,
    number: row.number,
    strokes: row.strokes,
    stats: row.stats,
    vertices: row.vertices,
    equipped_on: await equippedOn(row.id),
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export async function previewWeapon(ctx: Ctx): Promise<Reply> {
  requireAccount(ctx);
  const input = record(await readJsonBody(ctx.req));
  const revisionRaw = input.drawing_revision;
  if (revisionRaw !== undefined && !Number.isInteger(revisionRaw)) {
    throw errors.invalidField('drawing_revision', { key: 'fb.generic' });
  }
  const strokes = parseStrokes(input.strokes ?? []);
  const revision = revisionRaw === undefined ? null : (revisionRaw as number);
  return { status: 200, body: previewDrawing(strokes, revision) };
}

export async function forgeWeapon(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const input = record(await readJsonBody(ctx.req));
  const characterId = input.character_id;
  if (typeof characterId !== 'string') throw errors.notFound();

  const characters = await query<CharacterRow>(
    `SELECT id, slot, revision, name, parts, proportions, pose, material, accessories,
            model_id, weapon_id
     FROM characters WHERE id = $1 AND account_id = $2`,
    [characterId, account.id],
  );
  if (characters[0] === undefined) throw errors.notFound();

  const strokes = parseStrokes(input.strokes ?? []);
  assertForgeable(strokes);

  const stats = deriveStats(strokes);
  const vertices = countVertices(strokes);
  const id = randomUUID();

  const number = await transaction(async (client) => {
    const counted = await client.query<{ weapon_counter: number }>(
      'UPDATE accounts SET weapon_counter = weapon_counter + 1 WHERE id = $1 RETURNING weapon_counter',
      [account.id],
    );
    const next = counted.rows[0].weapon_counter;
    await client.query(
      `INSERT INTO weapons (id, account_id, number, strokes, stats, vertices)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, account.id, next, JSON.stringify(strokes), JSON.stringify(stats), vertices],
    );
    await client.query('UPDATE characters SET weapon_id = $2 WHERE id = $1', [characterId, id]);
    return next;
  });

  const fresh = await query<CharacterRow>(
    `SELECT id, slot, revision, name, parts, proportions, pose, material, accessories,
            model_id, weapon_id
     FROM characters WHERE id = $1`,
    [characterId],
  );
  return {
    status: 201,
    body: {
      weapon: await toWeapon({ id, number, strokes, stats, vertices }),
      character: rowToCharacter(fresh[0], account.equipped_character_id),
    },
  };
}

export async function listWeapons(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const rows = await query<WeaponRow>(
    'SELECT id, number, strokes, stats, vertices FROM weapons WHERE account_id = $1 ORDER BY number DESC',
    [account.id],
  );
  const weapons: Weapon[] = [];
  for (const row of rows) weapons.push(await toWeapon(row));
  return { status: 200, body: { weapons } };
}

export async function getWeapon(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const rows = await query<WeaponRow>(
    'SELECT id, number, strokes, stats, vertices FROM weapons WHERE id = $1 AND account_id = $2',
    [ctx.params.id, account.id],
  );
  if (rows[0] === undefined) throw errors.notFound();
  return { status: 200, body: { weapon: await toWeapon(rows[0]) } };
}

export async function deleteWeapon(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const rows = await query<{ id: string }>(
    'SELECT id FROM weapons WHERE id = $1 AND account_id = $2',
    [ctx.params.id, account.id],
  );
  if (rows[0] === undefined) throw errors.notFound();
  await transaction(async (client) => {
    await client.query('UPDATE characters SET weapon_id = NULL WHERE weapon_id = $1', [rows[0].id]);
    await client.query('DELETE FROM weapons WHERE id = $1', [rows[0].id]);
  });
  return { status: 204 };
}
