import type { PoolClient } from "pg";
import { pool, row, transaction } from "./pool.js";
import { SCHEMA_SQL } from "./schema.js";
import { buildSeedVariants, SEED_ACCOUNTS, SEED_PRODUCTS, SEED_PROJECT } from "./seedData.js";
import { hashPassword } from "../passwords.js";

/** One lock id for the whole schema-and-seed step. */
const MIGRATION_LOCK_ID = 8_472_051;

export async function applySchemaAndSeed(): Promise<void> {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(SCHEMA_SQL);
    await seedCatalogue(client);
    await seedAccounts(client);
    await seedProject(client);
  });
}

async function seedCatalogue(client: PoolClient): Promise<void> {
  for (const [index, product] of SEED_PRODUCTS.entries()) {
    await client.query(
      `INSERT INTO products (slug, name, family, description, watts, cri, ip_rating, default_variant, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, family = EXCLUDED.family, description = EXCLUDED.description,
         watts = EXCLUDED.watts, cri = EXCLUDED.cri, ip_rating = EXCLUDED.ip_rating,
         default_variant = EXCLUDED.default_variant, sort_order = EXCLUDED.sort_order`,
      [
        product.slug,
        product.name,
        product.family,
        product.description,
        product.watts,
        product.cri,
        product.ip_rating,
        product.default_variant,
        index + 1,
      ],
    );
  }

  for (const variant of buildSeedVariants()) {
    await client.query(
      `INSERT INTO variants (code, product_slug, finish, finish_name, beam_deg, cct_k, lumens, candela,
                             retail_price_cents, trade_price_cents, was_price_cents, clearance, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (code) DO UPDATE SET
         finish_name = EXCLUDED.finish_name, lumens = EXCLUDED.lumens, candela = EXCLUDED.candela,
         retail_price_cents = EXCLUDED.retail_price_cents, trade_price_cents = EXCLUDED.trade_price_cents,
         was_price_cents = EXCLUDED.was_price_cents, clearance = EXCLUDED.clearance,
         sort_order = EXCLUDED.sort_order`,
      [
        variant.code,
        variant.product_slug,
        variant.finish,
        variant.finish_name,
        variant.beam_deg,
        variant.cct_k,
        variant.lumens,
        variant.candela,
        variant.retail_price_cents,
        variant.trade_price_cents,
        variant.was_price_cents,
        variant.clearance,
        variant.sort_order,
      ],
    );

    // Starting stock is one `seed` movement, written only the first time.
    if (variant.clearance && variant.stock_on_hand !== null) {
      await client.query(
        `INSERT INTO stock_movements (variant_code, delta, reason, note)
         SELECT $1, $2, 'seed', 'Opening clearance stock'
         WHERE NOT EXISTS (
           SELECT 1 FROM stock_movements WHERE variant_code = $1 AND reason = 'seed'
         )`,
        [variant.code, variant.stock_on_hand],
      );
    }
  }
}

async function seedAccounts(client: PoolClient): Promise<void> {
  for (const account of SEED_ACCOUNTS) {
    const existing = await row<{ id: string }>(client, "SELECT id FROM users WHERE email = $1", [account.email]);
    let userId = existing?.id;
    if (!userId) {
      const created = await row<{ id: string }>(
        client,
        `INSERT INTO users (email, name, password_hash, role, trade_status)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [account.email, account.name, await hashPassword(account.password), account.role, account.trade_status],
      );
      if (!created) throw new Error(`failed to seed account ${account.email}`);
      userId = created.id;
    }

    if (account.trade) {
      const status = account.trade_status ?? "submitted";
      await client.query(
        `INSERT INTO trade_applications (user_id, business_name, nzbn, occupation, status, decided_at)
         VALUES ($1,$2,$3,$4,$5, CASE WHEN $5 = 'submitted' THEN NULL ELSE now() END)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, account.trade.business_name, account.trade.nzbn, account.trade.occupation, status],
      );
    }
  }
}

async function seedProject(client: PoolClient): Promise<void> {
  const owner = await row<{ id: string }>(client, "SELECT id FROM users WHERE email = $1", [
    SEED_PROJECT.owner_email,
  ]);
  const collaborator = await row<{ id: string }>(client, "SELECT id FROM users WHERE email = $1", [
    SEED_PROJECT.collaborator_email,
  ]);
  if (!owner || !collaborator) throw new Error("seed project owner or collaborator is missing");

  const existing = await row<{ id: string }>(client, "SELECT id FROM projects WHERE owner_id = $1 AND name = $2", [
    owner.id,
    SEED_PROJECT.name,
  ]);
  if (existing) return;

  const created = await row<{ id: string }>(
    client,
    `INSERT INTO projects (name, client_name, owner_id, ceiling_height_mm, room_width_mm, room_depth_mm)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      SEED_PROJECT.name,
      SEED_PROJECT.client_name,
      owner.id,
      SEED_PROJECT.ceiling_height_mm,
      SEED_PROJECT.room_width_mm,
      SEED_PROJECT.room_depth_mm,
    ],
  );
  if (!created) throw new Error("failed to seed the Ponsonby Kitchen project");

  for (const line of SEED_PROJECT.lines) {
    await client.query(
      "INSERT INTO project_lines (project_id, variant_code, quantity) VALUES ($1,$2,$3)",
      [created.id, line.variant_code, line.quantity],
    );
  }
  await client.query("INSERT INTO project_collaborators (project_id, user_id) VALUES ($1,$2)", [
    created.id,
    collaborator.id,
  ]);
}

/** Used by the health probe: a live round trip to Postgres. */
export async function pingPostgres(): Promise<void> {
  await pool.query("SELECT 1");
}
