import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config';
import { Db, tx } from '../db/pool';
import { notFound, validationFailed } from '../errors';
import { sendJson } from '../http/respond';
import { route } from '../http/router';
import { asRecord } from '../http/validate';
import { addCaseHistory, nextCaseNumber } from '../domain/cases';
import { COLOUR_CODES, Location, SIZE_ORDER } from '../domain/constants';
import { hashPassword } from '../domain/passwords';
import { slugify } from '../domain/rules';
import {
  addTimeline,
  checkoutTotals,
  nextOrderNumber,
  warrantyCoveredUntil
} from '../domain/orders';
import { parseCheckoutRow } from '../domain/holds';
import { availableByLocation, pickLocation, writeMovement, writeMovementDirect } from '../domain/stock';
import { queueProduct } from '../services/indexer';

const FIELD_COPY = 'Check this field.';

class SetupErrors {
  private readonly fields: Record<string, string> = {};

  add(key: string): void {
    if (!(key in this.fields)) this.fields[key] = FIELD_COPY;
  }

  throwIfAny(): void {
    if (Object.keys(this.fields).length > 0) throw validationFailed(this.fields);
  }
}

function array(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asRecord(item));
}

function text(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

function integer(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

function decimal(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function variantIdBySku(client: Db, sku: string): Promise<string | null> {
  const row = await client.one<{ id: string }>('SELECT id FROM variants WHERE sku = $1', [sku]);
  return row === null ? null : row.id;
}

export function registerGradingRoutes(): void {
  route('POST', '/api/grading/setup', 'api', async (ctx) => {
    const token = ctx.request.headers['x-grading-token'];
    if (config.gradingToken === '' || token !== config.gradingToken) throw notFound();

    const errors = new SetupErrors();
    const ids: Record<string, string> = {};
    const sessions: Record<string, string> = {};

    const result = await tx(async (client) => {
      for (const [index, entry] of array(ctx.body.users).entries()) {
        const key = text(entry, 'key');
        const email = text(entry, 'email').toLowerCase();
        const name = text(entry, 'name');
        const password = text(entry, 'password');
        const role = text(entry, 'role') === '' ? 'customer' : text(entry, 'role');
        if (key === '' || email === '' || name === '' || password === '') {
          errors.add(`users.${index}.key`);
          continue;
        }
        const existing = await client.one<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
        let userId: string;
        if (existing !== null) {
          userId = existing.id;
          await client.query('UPDATE users SET name = $2, password_hash = $3, role = $4 WHERE id = $1', [
            userId,
            name,
            hashPassword(password),
            role
          ]);
        } else {
          userId = randomUUID();
          await client.query(
            'INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
            [userId, name, email, hashPassword(password), role]
          );
        }
        ids[key] = userId;
        const sessionId = randomBytes(24).toString('hex');
        await client.query('INSERT INTO sessions (id, user_id) VALUES ($1, $2)', [sessionId, userId]);
        sessions[key] = sessionId;
      }

      for (const [index, entry] of array(ctx.body.addresses).entries()) {
        const key = text(entry, 'key');
        const userId = ids[text(entry, 'user')];
        if (key === '' || userId === undefined) {
          errors.add(`addresses.${index}.user`);
          continue;
        }
        const id = randomUUID();
        await client.query(
          `INSERT INTO addresses (id, user_id, label, name, line1, line2, city, state, postcode, phone, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   (SELECT coalesce(max(position), 0) + 1 FROM addresses WHERE user_id = $2))`,
          [
            id,
            userId,
            text(entry, 'label'),
            text(entry, 'name'),
            text(entry, 'line1'),
            text(entry, 'line2'),
            text(entry, 'city'),
            text(entry, 'state'),
            text(entry, 'postcode'),
            text(entry, 'phone')
          ]
        );
        ids[key] = id;
      }

      for (const [index, entry] of array(ctx.body.products).entries()) {
        const key = text(entry, 'key');
        const slug = text(entry, 'slug');
        const name = text(entry, 'name');
        const category = text(entry, 'category');
        if (slug === '' || name === '' || category === '') {
          errors.add(`products.${index}.slug`);
          continue;
        }
        const material = text(entry, 'material') === '' ? 'Polycarbonate' : text(entry, 'material');
        const status = text(entry, 'status') === '' ? 'published' : text(entry, 'status');
        const productId = randomUUID();
        const rank = await client.one<{ rank: number }>(
          'SELECT coalesce(max(featured_rank), 0) + 1 AS rank FROM products'
        );
        await client.query(
          `INSERT INTO products (id, slug, name, category, material, material_slug, description, status,
                                 featured_rank, published_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
          [
            productId,
            slug,
            name,
            category,
            material,
            slugify(material),
            text(entry, 'description'),
            status,
            rank!.rank
          ]
        );
        if (key !== '') ids[key] = productId;

        let position = 0;
        for (const variant of array(entry.variants)) {
          const sizeSlug = text(variant, 'size');
          const size = SIZE_ORDER.find((item) => item.slug === sizeSlug) ?? SIZE_ORDER[4];
          const colour = text(variant, 'colour');
          const sku =
            text(variant, 'sku') === ''
              ? `${slug.slice(0, 3).toUpperCase()}-${COLOUR_CODES[colour] ?? 'XXX'}-${size.code}`
              : text(variant, 'sku');
          const variantId = randomUUID();
          position += 1;
          const compareAtRaw = variant.compare_at;
          await client.query(
            `INSERT INTO variants (id, product_id, sku, colour, colour_slug, size, size_slug,
                                   height_cm, width_cm, depth_cm, weight_kg, price, compare_at, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              variantId,
              productId,
              sku,
              colour,
              slugify(colour),
              size.label,
              size.slug,
              decimal(variant, 'height_cm', 0),
              decimal(variant, 'width_cm', 0),
              decimal(variant, 'depth_cm', 0),
              decimal(variant, 'weight_kg', 0),
              integer(variant, 'price', 1000),
              typeof compareAtRaw === 'number' ? compareAtRaw : null,
              position
            ]
          );
          const available = integer(variant, 'available', 0);
          if (available > 0) {
            await writeMovement(client, variantId, 'stock_received', 'grading', 'bhiwandi', available);
          }
          for (const [imageIndex, study] of ['Front', 'Side', 'Back', 'Open'].entries()) {
            await client.query(
              `INSERT INTO product_images (id, product_id, colour, alt, position, content_type, study)
               VALUES ($1, $2, $3, $4, $5, 'image/svg+xml', $6)`,
              [randomUUID(), productId, colour, `${name} in ${colour}`, imageIndex + 1, study]
            );
          }
        }
        await queueProduct(client, productId);
      }

      for (const [index, entry] of array(ctx.body.stock).entries()) {
        const sku = text(entry, 'sku');
        const location = (text(entry, 'location') === '' ? 'bhiwandi' : text(entry, 'location')) as Location;
        const variantId = await variantIdBySku(client, sku);
        if (variantId === null) {
          errors.add(`stock.${index}.sku`);
          continue;
        }
        const target = integer(entry, 'available', 0);
        const current = (await availableByLocation(client, variantId))[location];
        const difference = target - current;
        if (difference > 0) {
          await writeMovement(client, variantId, 'stock_received', 'grading', location, difference);
        } else if (difference < 0) {
          await writeMovement(client, variantId, 'stock_adjusted', 'grading', location, -difference);
        }
      }

      for (const [index, entry] of array(ctx.body.discount_codes).entries()) {
        const code = text(entry, 'code').toUpperCase();
        if (code === '') {
          errors.add(`discount_codes.${index}.code`);
          continue;
        }
        const collection = typeof entry.collection === 'string' ? entry.collection : null;
        const usageLimit = typeof entry.usage_limit === 'number' ? entry.usage_limit : null;
        await client.query(
          `INSERT INTO discount_codes (code, kind, value, collection, minimum, starts_at, ends_at, usage_limit, used)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (code) DO UPDATE SET kind = EXCLUDED.kind, value = EXCLUDED.value,
             collection = EXCLUDED.collection, minimum = EXCLUDED.minimum, starts_at = EXCLUDED.starts_at,
             ends_at = EXCLUDED.ends_at, usage_limit = EXCLUDED.usage_limit, used = EXCLUDED.used`,
          [
            code,
            text(entry, 'kind') === 'fixed' ? 'fixed' : 'percent',
            integer(entry, 'value', 10),
            collection,
            integer(entry, 'minimum', 0),
            text(entry, 'starts_at') === '' ? new Date(0).toISOString() : text(entry, 'starts_at'),
            text(entry, 'ends_at') === '' ? '2099-01-01T00:00:00Z' : text(entry, 'ends_at'),
            usageLimit,
            integer(entry, 'used', 0)
          ]
        );
        ids[code] = code;
      }

      for (const [index, entry] of array(ctx.body.gift_cards).entries()) {
        const code = text(entry, 'code').toUpperCase();
        if (code === '') {
          errors.add(`gift_cards.${index}.code`);
          continue;
        }
        const balance = integer(entry, 'balance', 0);
        const existing = await client.one<{ code: string }>('SELECT code FROM gift_cards WHERE code = $1', [code]);
        if (existing === null) {
          await client.query('INSERT INTO gift_cards (code) VALUES ($1)', [code]);
        }
        const current = await client.one<{ total: string }>(
          "SELECT coalesce(sum(amount), 0)::bigint AS total FROM gift_card_entries WHERE code = $1 AND account = 'card'",
          [code]
        );
        const difference = balance - Number(current!.total);
        if (difference !== 0) {
          const groupId = randomUUID();
          await client.query(
            `INSERT INTO gift_card_entries (group_id, code, account, amount, reason, ref)
             VALUES ($1, $2, 'issuance', $3, 'issued', $2), ($1, $2, 'card', $4, 'issued', $2)`,
            [groupId, code, -difference, difference]
          );
        }
        ids[code] = code;
      }

      for (const entry of array(ctx.body.carts)) {
        const userId = ids[text(entry, 'user')];
        if (userId === undefined) continue;
        const cartId = randomUUID();
        await client.query(
          `INSERT INTO carts (id, user_id) VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET updated_at = now()`,
          [cartId, userId]
        );
        const cart = await client.one<{ id: string }>('SELECT id FROM carts WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM cart_lines WHERE cart_id = $1', [cart!.id]);
        for (const line of array(entry.lines)) {
          const variantId = await variantIdBySku(client, text(line, 'sku'));
          if (variantId === null) continue;
          await client.query(
            'INSERT INTO cart_lines (id, cart_id, variant_id, quantity) VALUES ($1, $2, $3, $4)',
            [randomUUID(), cart!.id, variantId, integer(line, 'quantity', 1)]
          );
        }
        const discountCode = typeof entry.discount_code === 'string' ? entry.discount_code.toUpperCase() : null;
        const giftCard = typeof entry.gift_card === 'string' ? entry.gift_card.toUpperCase() : null;
        await client.query('UPDATE carts SET discount_code = $2, gift_card_code = $3 WHERE id = $1', [
          cart!.id,
          discountCode,
          giftCard
        ]);
      }

      for (const entry of array(ctx.body.holds)) {
        const key = text(entry, 'key');
        const userId = ids[text(entry, 'user')];
        if (userId === undefined) continue;
        const checkoutId = randomUUID();
        const lines: Array<{ sku: string; variant_id: string; quantity: number; price: number | null; location: Location | null }> = [];
        for (const line of array(entry.lines)) {
          const sku = text(line, 'sku');
          const variantId = await variantIdBySku(client, sku);
          if (variantId === null) continue;
          const quantity = integer(line, 'quantity', 1);
          const byLocation = await availableByLocation(client, variantId);
          const location = pickLocation(byLocation);
          await writeMovement(client, variantId, 'hold_placed', checkoutId, location, quantity);
          const variant = await client.one<{ price: number }>('SELECT price FROM variants WHERE id = $1', [
            variantId
          ]);
          lines.push({ sku, variant_id: variantId, quantity, price: variant!.price, location });
        }
        const reservedAt = text(entry, 'reserved_at') === '' ? new Date().toISOString() : text(entry, 'reserved_at');
        const user = await client.one<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
        await client.query(
          `INSERT INTO checkouts (id, user_id, step, email, lines, hold_reserved_at)
           VALUES ($1, $2, 'payment', $3, $4::jsonb, $5)`,
          [checkoutId, userId, user!.email, JSON.stringify(lines), reservedAt]
        );
        if (key !== '') ids[key] = checkoutId;
      }

      for (const entry of array(ctx.body.orders)) {
        const key = text(entry, 'key');
        const userId = ids[text(entry, 'user')];
        if (userId === undefined) continue;
        const addressId = ids[text(entry, 'address')];
        const address =
          addressId === undefined
            ? null
            : await client.one<Record<string, unknown>>(
                'SELECT label, name, line1, line2, city, state, postcode, phone FROM addresses WHERE id = $1',
                [addressId]
              );
        const user = await client.one<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
        const number = await nextOrderNumber(client);
        const status = text(entry, 'status') === '' ? 'placed' : text(entry, 'status');
        const paymentStatusRaw = text(entry, 'payment_status');
        const paymentStatus = paymentStatusRaw === '' ? 'captured' : paymentStatusRaw;
        const placedAt = text(entry, 'placed_at') === '' ? new Date().toISOString() : text(entry, 'placed_at');
        const deliveredAt = text(entry, 'delivered_at') === '' ? null : text(entry, 'delivered_at');
        const shippingMethod = text(entry, 'shipping_method') === '' ? 'standard' : text(entry, 'shipping_method');
        const discountCode = typeof entry.discount_code === 'string' ? entry.discount_code.toUpperCase() : null;
        const giftCard = typeof entry.gift_card === 'string' ? entry.gift_card.toUpperCase() : null;

        const checkoutLines: Array<{ sku: string; variant_id: string; quantity: number; price: number | null; location: Location | null }> = [];
        const lineKeys: Array<{ key: string; sku: string; fulfillment: string }> = [];
        for (const line of array(entry.lines)) {
          const sku = text(line, 'sku');
          const variantId = await variantIdBySku(client, sku);
          if (variantId === null) continue;
          const variant = await client.one<{ price: number }>('SELECT price FROM variants WHERE id = $1', [
            variantId
          ]);
          checkoutLines.push({
            sku,
            variant_id: variantId,
            quantity: integer(line, 'quantity', 1),
            price: variant!.price,
            location: 'bhiwandi'
          });
          lineKeys.push({
            key: text(line, 'key'),
            sku,
            fulfillment: text(line, 'fulfillment') === '' ? 'unfulfilled' : text(line, 'fulfillment')
          });
        }

        const giftBalance =
          giftCard === null
            ? 0
            : Number(
                (
                  await client.one<{ total: string }>(
                    "SELECT coalesce(sum(amount), 0)::bigint AS total FROM gift_card_entries WHERE code = $1 AND account = 'card'",
                    [giftCard]
                  )
                )!.total
              );
        const pseudoCheckout = parseCheckoutRow({
          id: randomUUID(),
          user_id: userId,
          step: 'payment',
          email: user!.email,
          phone: null,
          address: null,
          shipping_method: shippingMethod,
          shipping_chosen: true,
          gift: false,
          gift_message: '',
          discount_code: discountCode,
          gift_card_code: giftCard,
          lines: checkoutLines,
          hold_reserved_at: null,
          hold_released_at: null,
          order_number: null,
          payment_state: null,
          version: 1
        });
        const computed = await checkoutTotals(client, pseudoCheckout, giftBalance);

        await client.query(
          `INSERT INTO orders (number, user_id, kind, status, payment_status, placed_at, delivered_at,
                               confirmation_emailed_at, email, phone, address, shipping_method, gift, gift_message,
                               discount_code, gift_card_code, totals, shipping_tax, payment_amount, card_amount,
                               gift_card_amount, card_last4)
           VALUES ($1, $2, 'standard', $3, $4, $5, $6, $5, $7, NULL, $8::jsonb, $9, false, '', $10, $11,
                   $12::jsonb, $13, $14, $15, $16, '4242')`,
          [
            number,
            userId,
            status,
            paymentStatus,
            placedAt,
            deliveredAt,
            user!.email,
            JSON.stringify(address),
            shippingMethod,
            discountCode,
            giftCard,
            JSON.stringify(computed.totals),
            computed.shipping_tax,
            computed.grand_total,
            computed.totals.total,
            computed.totals.gift_card
          ]
        );
        await addTimeline(client, number, 'placed', new Date(placedAt));
        if (status !== 'placed') await addTimeline(client, number, status, new Date(deliveredAt ?? placedAt));

        for (const [index, line] of computed.lines.entries()) {
          const meta = lineKeys[index];
          const lineId = randomUUID();
          await client.query(
            `INSERT INTO order_lines (id, order_number, variant_id, sku, product, product_slug, category, colour, size,
                                      quantity, unit_price, line_subtotal, line_discount, line_tax, fulfillment, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
            [
              lineId,
              number,
              line.variant_id,
              line.sku,
              line.product,
              line.product_slug,
              line.category,
              line.colour,
              line.size,
              line.quantity,
              line.unit_price,
              line.line_subtotal,
              line.line_discount,
              line.line_tax,
              meta.fulfillment,
              index + 1
            ]
          );
          if (meta.key !== '') ids[meta.key] = lineId;
          const target =
            meta.fulfillment === 'shipped' || meta.fulfillment === 'out_for_delivery' || meta.fulfillment === 'delivered'
              ? 'dispatched'
              : meta.fulfillment === 'cancelled'
                ? 'available'
                : 'committed';
          await writeMovementDirect(
            client,
            line.variant_id,
            'order_committed',
            number,
            'bhiwandi',
            line.quantity,
            'external',
            target
          );
        }
        if (giftCard !== null && computed.totals.gift_card > 0) {
          const groupId = randomUUID();
          await client.query(
            `INSERT INTO gift_card_entries (group_id, code, account, amount, reason, ref)
             VALUES ($1, $2, 'card', $3, 'spent', $4), ($1, $2, $5, $6, 'spent', $4)`,
            [
              groupId,
              giftCard,
              -computed.totals.gift_card,
              number,
              `order:${number}`,
              computed.totals.gift_card
            ]
          );
        }
        if (key !== '') ids[key] = number;
      }

      for (const entry of array(ctx.body.returns)) {
        const key = text(entry, 'key');
        const lineId = ids[text(entry, 'order_line')];
        if (lineId === undefined) continue;
        const line = await client.one<{ user_id: string }>(
          'SELECT o.user_id FROM order_lines l JOIN orders o ON o.number = l.order_number WHERE l.id = $1',
          [lineId]
        );
        if (line === null) continue;
        const number = await nextCaseNumber(client, 'return');
        await client.query(
          `INSERT INTO returns (number, order_line_id, user_id, status, quantity, reason, outcome, exchange_sku)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            number,
            lineId,
            line.user_id,
            text(entry, 'status') === '' ? 'requested' : text(entry, 'status'),
            integer(entry, 'quantity', 1),
            text(entry, 'reason') === '' ? 'Other' : text(entry, 'reason'),
            text(entry, 'outcome') === '' ? 'refund' : text(entry, 'outcome'),
            typeof entry.exchange_sku === 'string' ? entry.exchange_sku : null
          ]
        );
        await addCaseHistory(client, 'return', number, text(entry, 'status') === '' ? 'requested' : text(entry, 'status'));
        if (key !== '') ids[key] = number;
      }

      for (const entry of array(ctx.body.trials)) {
        const key = text(entry, 'key');
        const lineId = ids[text(entry, 'order_line')];
        if (lineId === undefined) continue;
        const line = await client.one<{ user_id: string }>(
          'SELECT o.user_id FROM order_lines l JOIN orders o ON o.number = l.order_number WHERE l.id = $1',
          [lineId]
        );
        if (line === null) continue;
        const number = await nextCaseNumber(client, 'trial');
        const status = text(entry, 'status') === '' ? 'requested' : text(entry, 'status');
        await client.query(
          'INSERT INTO trials (number, order_line_id, user_id, status, note) VALUES ($1, $2, $3, $4, $5)',
          [number, lineId, line.user_id, status, text(entry, 'note')]
        );
        await addCaseHistory(client, 'trial', number, status);
        if (key !== '') ids[key] = number;
      }

      for (const entry of array(ctx.body.warranty_registrations)) {
        const key = text(entry, 'key');
        const lineId = ids[text(entry, 'order_line')];
        if (lineId === undefined) continue;
        const line = await client.one<{ user_id: string; category: string; delivered_at: Date | null }>(
          `SELECT o.user_id, l.category, o.delivered_at FROM order_lines l
           JOIN orders o ON o.number = l.order_number WHERE l.id = $1`,
          [lineId]
        );
        if (line === null) continue;
        const id = randomUUID();
        const coveredUntil = warrantyCoveredUntil(line.category, line.delivered_at ?? new Date());
        await client.query(
          `INSERT INTO warranty_registrations (id, order_line_id, user_id, covered_until)
           VALUES ($1, $2, $3, $4) ON CONFLICT (order_line_id) DO NOTHING`,
          [id, lineId, line.user_id, coveredUntil]
        );
        const stored = await client.one<{ id: string }>(
          'SELECT id FROM warranty_registrations WHERE order_line_id = $1',
          [lineId]
        );
        if (key !== '') ids[key] = stored!.id;
      }

      for (const entry of array(ctx.body.warranty_claims)) {
        const key = text(entry, 'key');
        const registrationId = ids[text(entry, 'registration')];
        if (registrationId === undefined) continue;
        const registration = await client.one<{ user_id: string }>(
          'SELECT user_id FROM warranty_registrations WHERE id = $1',
          [registrationId]
        );
        if (registration === null) continue;
        const number = await nextCaseNumber(client, 'warranty_claim');
        const status = text(entry, 'status') === '' ? 'submitted' : text(entry, 'status');
        await client.query(
          `INSERT INTO warranty_claims (number, registration_id, user_id, component, description, status)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            number,
            registrationId,
            registration.user_id,
            text(entry, 'component') === '' ? 'Wheels' : text(entry, 'component'),
            text(entry, 'description'),
            status
          ]
        );
        await addCaseHistory(client, 'warranty_claim', number, status);
        if (key !== '') ids[key] = number;
      }

      errors.throwIfAny();
      return { ids, sessions };
    });

    sendJson(ctx, 201, result);
  });
}
