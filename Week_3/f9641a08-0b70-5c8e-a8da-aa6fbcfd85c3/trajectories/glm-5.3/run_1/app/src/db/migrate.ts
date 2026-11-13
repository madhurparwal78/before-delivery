import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Client } from './pool.js';
import { withClient } from './pool.js';
import { hashPassword, sha256Hex } from '../domain/password.js';
import { moveStock, type Location } from '../domain/ledger.js';
import { bagSvg, VIEW_NAMES } from '../services/images.js';
import {
  seedProducts, SEED_STOCK_DEFAULT, SEED_STOCK_EXCEPTIONS, SEED_ACCOUNTS, SEED_ADDRESSES,
  SEED_DISCOUNT_CODES, SEED_GIFT_CARDS,
} from './seed.js';
import { AIRLINES } from '../services/airlines.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function applySchemaAndSeed(): Promise<void> {
  await withClient(async (client) => {
    await client.query('SELECT pg_advisory_lock(727491)');
    try {
      const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
      await client.query(schema);
      const count = await client.query<{ n: string }>(`SELECT COUNT(*)::TEXT AS n FROM products`);
      if (Number(count.rows[0].n) === 0) {
        await seedAll(client);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock(727491)');
    }
  });
}

async function seedAll(client: Client): Promise<void> {
  await client.query('BEGIN');
  try {
    for (const airline of AIRLINES) {
      await client.query(
        `INSERT INTO airlines (code, name, height_cm, width_cm, depth_cm, weight_kg) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (code) DO NOTHING`,
        [airline.code, airline.name, airline.height_cm, airline.width_cm, airline.depth_cm, airline.weight_kg]);
    }

    const userIds = new Map<string, number>();
    for (const account of SEED_ACCOUNTS) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id::TEXT AS id`,
        [account.name, account.email, hashPassword(account.password), account.role]);
      userIds.set(account.email, Number(res.rows[0].id));
    }

    const ashaId = userIds.get('asha@roamhouse.example')!;
    for (const address of SEED_ADDRESSES) {
      await client.query(
        `INSERT INTO addresses (user_id, label, name, line1, line2, city, state, postcode, phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [ashaId, address.label, address.name, address.line1, address.line2, address.city, address.state, address.postcode, address.phone]);
    }

    let rank = 1;
    for (const { product, variants } of seedProducts()) {
      await client.query(
        `INSERT INTO products (slug, name, category, material, description, status, version, featured_rank, published_at)
         VALUES ($1,$2,$3,$4,$5,'published',1,$6,$7)`,
        [product.slug, product.name, product.category, product.material, product.description, rank++, product.publishedAt]);
      for (const variant of variants) {
        await client.query(
          `INSERT INTO variants (sku, product_slug, colour, colour_slug, size, size_slug, height_cm, width_cm, depth_cm, weight_kg, price, compare_at, version, position)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13)`,
          [variant.sku, product.slug, variant.colour, variant.colourSlug, variant.size, variant.sizeSlug,
            variant.height, variant.width, variant.depth, variant.weight, variant.price, variant.compareAt, variant.position]);
        for (const view of VIEW_NAMES) {
          const svg = bagSvg(variant.colour, view, product.name, { h: variant.height, w: variant.width, d: variant.depth });
          await client.query(
            `INSERT INTO product_images (id, product_slug, colour, colour_slug, alt, position, content_type, bytes, sha256, storage)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'db')`,
            [`${variant.sku}-${view.toLowerCase()}`, product.slug, variant.colour, variant.colourSlug,
              `${product.name} in ${variant.colour}`, VIEW_NAMES.indexOf(view) + 1, 'image/svg+xml', Buffer.from(svg, 'utf8'), sha256Hex(svg)]);
        }
      }
      // Stock: 8 at bhiwandi, 0 at gurugram, with published exceptions.
      for (const variant of variants) {
        const available = SEED_STOCK_EXCEPTIONS[variant.sku] ?? SEED_STOCK_DEFAULT;
        if (available > 0) {
          await moveStock(client, 'stock_received', `seed/${variant.sku}/bhiwandi`, [
            { sku: variant.sku, location: 'bhiwandi' as Location, quantity: available },
          ]);
        }
      }
    }

    for (const code of SEED_DISCOUNT_CODES) {
      await client.query(
        `INSERT INTO discount_codes (code, kind, value, collection, minimum, starts_at, ends_at, usage_limit, used)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [code.code, code.kind, code.value, code.collection, code.minimum, code.startsAt, code.endsAt, code.usageLimit, code.used]);
    }

    for (const card of SEED_GIFT_CARDS) {
      await client.query(`INSERT INTO gift_cards (code) VALUES ($1) ON CONFLICT (code) DO NOTHING`, [card.code]);
      const group = await client.query<{ id: string }>(`INSERT INTO gift_card_ledger (group_id, code, account, amount, reason, ref) VALUES (0,$1,'issuance',$2,'issuance',$3) RETURNING id::TEXT AS id`, [card.code, card.balance, `seed/${card.code}`]);
      await client.query(`UPDATE gift_card_ledger SET group_id = $1 WHERE id = $1`, [Number(group.rows[0].id)]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}
