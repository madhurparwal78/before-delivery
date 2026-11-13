import { randomUUID } from 'node:crypto';
import { pool, query, transaction } from '../db.js';
import { errors } from '../errors.js';
import { accountById } from '../accounts.js';
import { readJsonBody, requireAccount, type Ctx, type Reply } from '../http.js';
import { parseHeroInput, rowToCharacter, type CharacterRow } from '../domain/hero.js';

async function characterRows(accountId: string): Promise<CharacterRow[]> {
  return query<CharacterRow>(
    `SELECT id, slot, revision, name, parts, proportions, pose, material, accessories,
            model_id, weapon_id
     FROM characters WHERE account_id = $1 ORDER BY slot`,
    [accountId],
  );
}

export async function listCharacters(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const rows = await characterRows(account.id);
  return {
    status: 200,
    body: {
      characters: rows.map((row) => rowToCharacter(row, account.equipped_character_id)),
    },
  };
}

export async function getCharacter(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const rows = await query<CharacterRow>(
    `SELECT id, slot, revision, name, parts, proportions, pose, material, accessories,
            model_id, weapon_id
     FROM characters WHERE id = $1 AND account_id = $2`,
    [ctx.params.id, account.id],
  );
  const row = rows[0];
  if (row === undefined) throw errors.notFound();
  return { status: 200, body: { character: rowToCharacter(row, account.equipped_character_id) } };
}

export async function saveCharacterSlot(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const slot = Number.parseInt(ctx.params.slot, 10);
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) throw errors.notFound();

  const input = parseHeroInput(await readJsonBody(ctx.req));

  if (input.model_id !== null) {
    const models = await query<{ status: string }>(
      'SELECT status FROM models WHERE id = $1 AND account_id = $2',
      [input.model_id, account.id],
    );
    const model = models[0];
    if (model === undefined) throw errors.notFound();
    if (model.status !== 'accepted' && model.status !== 'equipped') {
      throw errors.conflict('model_not_accepted', { key: 'fb.modelNotAccepted' });
    }
  }
  if (input.weapon_id !== null) {
    const weapons = await query<{ id: string }>(
      'SELECT id FROM weapons WHERE id = $1 AND account_id = $2',
      [input.weapon_id, account.id],
    );
    if (weapons[0] === undefined) throw errors.notFound();
  }

  const result = await transaction(async (client) => {
    // The account row serializes saves, so racers on an empty slot see the winner's revision.
    await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [account.id]);
    const existing = await client.query<{ id: string; revision: number; model_id: string | null }>(
      'SELECT id, revision, model_id FROM characters WHERE account_id = $1 AND slot = $2 FOR UPDATE',
      [account.id, slot],
    );
    const current = existing.rows[0];
    const currentRevision = current === undefined ? null : current.revision;
    if (input.revision !== currentRevision) {
      throw errors.staleRevision();
    }

    const values = [
      input.name,
      JSON.stringify(input.parts),
      JSON.stringify(input.proportions),
      JSON.stringify(input.pose),
      input.material,
      JSON.stringify(input.accessories),
      input.model_id,
      input.weapon_id,
    ];

    if (current === undefined) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO characters
           (id, account_id, slot, revision, name, parts, proportions, pose, material, accessories,
            model_id, weapon_id)
         VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, account.id, slot, ...values],
      );
      await client.query(
        'UPDATE accounts SET equipped_character_id = COALESCE(equipped_character_id, $2) WHERE id = $1',
        [account.id, id],
      );
      return { id, created: true };
    }

    await client.query(
      `UPDATE characters SET revision = revision + 1, name = $3, parts = $4, proportions = $5,
              pose = $6, material = $7, accessories = $8, model_id = $9, weapon_id = $10
       WHERE account_id = $1 AND slot = $2`,
      [account.id, slot, ...values],
    );
    return { id: current.id, created: false };
  });

  await syncModelStatuses(account.id);
  const rows = await query<CharacterRow>(
    `SELECT id, slot, revision, name, parts, proportions, pose, material, accessories,
            model_id, weapon_id
     FROM characters WHERE id = $1`,
    [result.id],
  );
  const fresh = await accountById(account.id);
  return {
    status: result.created ? 201 : 200,
    body: { character: rowToCharacter(rows[0], fresh?.equipped_character_id ?? null) },
  };
}

/** Keeps model records between accepted and equipped as heroes take them up or drop them. */
export async function syncModelStatuses(accountId: string): Promise<void> {
  await pool.query(
    `UPDATE models SET status = 'equipped'
     WHERE account_id = $1 AND status = 'accepted'
       AND id IN (SELECT model_id FROM characters WHERE account_id = $1 AND model_id IS NOT NULL)`,
    [accountId],
  );
  await pool.query(
    `UPDATE models SET status = 'accepted'
     WHERE account_id = $1 AND status = 'equipped'
       AND id NOT IN (SELECT COALESCE(model_id, id) FROM characters WHERE account_id = $1)`,
    [accountId],
  );
}

export async function equipCharacter(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const rows = await query<CharacterRow>(
    `SELECT id, slot, revision, name, parts, proportions, pose, material, accessories,
            model_id, weapon_id
     FROM characters WHERE id = $1 AND account_id = $2`,
    [ctx.params.id, account.id],
  );
  const row = rows[0];
  if (row === undefined) throw errors.notFound();
  await pool.query('UPDATE accounts SET equipped_character_id = $2 WHERE id = $1', [
    account.id,
    row.id,
  ]);
  return { status: 200, body: { character: rowToCharacter(row, row.id) } };
}

export async function deleteCharacter(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const rows = await query<{ id: string }>(
    'SELECT id FROM characters WHERE id = $1 AND account_id = $2',
    [ctx.params.id, account.id],
  );
  if (rows[0] === undefined) throw errors.notFound();
  await pool.query('DELETE FROM characters WHERE id = $1', [rows[0].id]);
  if (account.equipped_character_id === rows[0].id) {
    const remaining = await query<{ id: string }>(
      'SELECT id FROM characters WHERE account_id = $1 ORDER BY slot LIMIT 1',
      [account.id],
    );
    await pool.query('UPDATE accounts SET equipped_character_id = $2 WHERE id = $1', [
      account.id,
      remaining[0]?.id ?? null,
    ]);
  }
  await syncModelStatuses(account.id);
  return { status: 204 };
}
