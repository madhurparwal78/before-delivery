import crypto from 'node:crypto'
import type { DbClient } from './db.js'
import { SEED_USERS } from './db.js'
import { all_variants, PRODUCT_DEFS, product_variants } from './seed.js'

/** scrypt password hashing: salt and hash stored as one string. */
export function hash_password(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 32).toString('hex')
  return `${salt}:${hash}`
}

export function verify_password(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const check = crypto.scryptSync(password, salt, 32).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'))
}

/** Apply schema seed data. Idempotent: safe when two instances start at once. */
export async function seed_data(client: DbClient): Promise<void> {
  for (const def of PRODUCT_DEFS) {
    await client.query(
      `INSERT INTO products (slug, name, code, family, description, watts, cri, ip_rating, default_variant)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (slug) DO UPDATE SET
         name=EXCLUDED.name, code=EXCLUDED.code, family=EXCLUDED.family, description=EXCLUDED.description,
         watts=EXCLUDED.watts, cri=EXCLUDED.cri, ip_rating=EXCLUDED.ip_rating, default_variant=EXCLUDED.default_variant`,
      [def.slug, def.name, def.code, def.family, def.description, def.watts, def.cri, def.ip_rating, def.default_variant],
    )
    const product = await client.query<{ id: number }>('SELECT id FROM products WHERE slug=$1', [def.slug])
    const product_id = product.rows[0]!.id
    for (const v of product_variants(def)) {
      await client.query(
        `INSERT INTO variants (code, product_id, finish, beam_deg, cct_k, lumens, candela,
            retail_price_cents, trade_price_cents, clearance, clearance_price_cents, was_price_cents, stock_on_hand, discontinued)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (code) DO UPDATE SET
           product_id=EXCLUDED.product_id, finish=EXCLUDED.finish, beam_deg=EXCLUDED.beam_deg, cct_k=EXCLUDED.cct_k,
           lumens=EXCLUDED.lumens, candela=EXCLUDED.candela,
           retail_price_cents=EXCLUDED.retail_price_cents, trade_price_cents=EXCLUDED.trade_price_cents,
           clearance=EXCLUDED.clearance, clearance_price_cents=EXCLUDED.clearance_price_cents,
           was_price_cents=EXCLUDED.was_price_cents, discontinued=EXCLUDED.discontinued`,
        [v.code, product_id, v.finish, v.beam, v.cct, v.lumens, v.candela, v.retail_price_cents, v.trade_price_cents, v.clearance, v.clearance_price_cents, v.was_price_cents, v.stock_on_hand, false],
      )
      if (v.clearance && v.stock_on_hand > 0) {
        const variant = await client.query<{ id: number }>('SELECT id FROM variants WHERE code=$1', [v.code])
        const existing = await client.query(`SELECT 1 FROM stock_movements WHERE variant_id=$1 AND reason='seed'`, [variant.rows[0]!.id])
        if (existing.rowCount === 0) {
          await client.query(
            `INSERT INTO stock_movements (variant_id, delta, reason, note) VALUES ($1,$2,'seed','Starting stock')`,
            [variant.rows[0]!.id, v.stock_on_hand],
          )
        }
      }
    }
  }

  for (const user of SEED_USERS) {
    const result = await client.query<{ id: number }>(
      `INSERT INTO users (email, password_hash, name, role, trade_status)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [user.email, hash_password(user.password), user.name, user.role, user.trade_status],
    )
    if (result.rowCount === 0 || !user.business) continue
    const user_id = result.rowCount ? result.rows[0]!.id
      : (await client.query<{ id: number }>('SELECT id FROM users WHERE email=$1', [user.email])).rows[0]!.id
    if (user.business && user.nzbn && user.occupation) {
      await client.query(
        `INSERT INTO trade_applications (user_id, business_name, nzbn, occupation, status)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id) DO NOTHING`,
        [user_id, user.business, user.nzbn, user.occupation, user.trade_status],
      )
    }
  }

  // Seeded project: Ponsonby Kitchen owned by Rangi Parata.
  const rangi = await client.query<{ id: number }>(`SELECT id FROM users WHERE email=$1`, ['rangi@kowhai-electrical.test'])
  const isla = await client.query<{ id: number }>(`SELECT id FROM users WHERE email=$1`, ['isla@harbourlight.test'])
  const existing = await client.query<{ id: number }>(`SELECT id FROM projects WHERE name='Ponsonby Kitchen'`)
  if (existing.rowCount === 0) {
    const project = await client.query<{ id: number }>(
      `INSERT INTO projects (name, client_name, owner_id, ceiling_height_mm, room_width_mm, room_depth_mm)
       VALUES ('Ponsonby Kitchen','M. and T. Hale',$1,2700,6000,4500) RETURNING id`,
      [rangi.rows[0]!.id],
    )
    const project_id = project.rows[0]!.id
    for (const [code, qty] of [['KDL-BK-24-2700', 6], ['TTS-BK-36-3000', 2]] as const) {
      const variant = await client.query<{ id: number }>('SELECT id FROM variants WHERE code=$1', [code])
      const product = await client.query<{ name: string }>(
        'SELECT p.name FROM products p JOIN variants v ON v.product_id=p.id WHERE v.id=$1',
        [variant.rows[0]!.id],
      )
      await client.query(
        `INSERT INTO project_lines (project_id, variant_id, product_name, quantity) VALUES ($1,$2,$3,$4)`,
        [project_id, variant.rows[0]!.id, product.rows[0]!.name, qty],
      )
    }
    await client.query(`INSERT INTO project_collaborators (project_id, user_id) VALUES ($1,$2)`, [project_id, isla.rows[0]!.id])
  }
  // Keep all variant rows present even if a product definition widened.
  void all_variants()
}
