import { randomUUID, createHash } from 'node:crypto';
import { config } from '../config';
import { Db, db, tx } from '../db/pool';
import {
  FIELD_COPY,
  invalidTransition,
  methodNotAllowed,
  notFound,
  staleVersion,
  storageUnavailable,
  tooLargeFile,
  unsupportedFile,
  validationFailed
} from '../errors';
import { Ctx, requireRole } from '../http/context';
import { sendBytes, sendJson, sendText } from '../http/respond';
import { route } from '../http/router';
import { sniffContentType } from '../http/body';
import {
  FieldErrors,
  parseDateTime,
  parseIsoDate,
  readInteger,
  readString,
  readStringArray,
  validateIdempotencyKey
} from '../http/validate';
import { appendAudit } from '../domain/audit';
import { ClaimRow, ReturnRow, TrialRow, claimPayload, returnPayload, trialPayload } from '../domain/cases';
import { loadProducts, productAvailable } from '../domain/catalogue';
import { CARRIERS, COLLECTIONS, LOCATIONS, Location } from '../domain/constants';
import { publishPriceFor, publishStockFor } from '../domain/events';
import { giftCardBalance, giftCardEntries, giftCardExists } from '../domain/giftcards';
import { runIdempotent } from '../domain/idempotency';
import { isoDateIst, istDayEndUtc, istDayStartUtc, roundHalfUp } from '../domain/money';
import { orderStatusSubject, recordNotification, statusBody } from '../domain/notify';
import {
  OrderLineRow,
  OrderRow,
  addTimeline,
  loadOrder,
  loadOrderLines,
  orderPayload,
  publishOrder
} from '../domain/orders';
import { ORDER_STATUS_WORDS, orderStatusTransitionAllowed, stockBadge } from '../domain/rules';
import { balancesFor, drawFromAccount, lockVariants, writeMovement } from '../domain/stock';
import { transitionClaim, transitionReturn, transitionTrial } from '../domain/transitions';
import { queueProduct } from '../services/indexer';
import { getObject, putConfirmed } from '../services/storage';
import { publish } from '../services/live';
import { cancelOrderRecord } from './orders';

async function adminProductPayload(client: Db, slug?: string): Promise<Record<string, unknown>[]> {
  const products = await loadProducts(client, slug === undefined ? {} : { slug });
  const variantIds = products.flatMap((product) => product.variants.map((variant) => variant.id));
  const balances = await balancesFor(client, variantIds);
  return products.map((product) => ({
    slug: product.slug,
    name: product.name,
    category: product.category,
    material: product.material,
    status: product.status,
    version: product.version,
    published_at: product.published_at.toISOString(),
    available: productAvailable(product),
    variants: product.variants.map((variant) => ({
      sku: variant.sku,
      colour: variant.colour,
      colour_slug: variant.colour_slug,
      size: variant.size,
      size_slug: variant.size_slug,
      price: variant.price,
      compare_at: variant.compare_at,
      version: variant.version,
      available: variant.available,
      badge: stockBadge(variant.available),
      stock: (balances.get(variant.id) ?? []).map((entry) => ({
        location: entry.location,
        available: entry.available,
        reserved: entry.reserved,
        committed: entry.committed,
        on_hand: entry.on_hand
      }))
    })),
    images: product.images.map((image) => ({
      id: image.id,
      colour: image.colour,
      alt: image.alt,
      position: image.position,
      url: `/media/products/${image.id}`
    }))
  }));
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}

function dateRange(ctx: Ctx): { from: Date; to: Date } {
  const fromRaw = ctx.query.get('from');
  const toRaw = ctx.query.get('to');
  if (fromRaw === null && toRaw === null) {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from: istDayStartUtc(isoDateIst(from)), to: istDayEndUtc(isoDateIst(to)) };
  }
  const errors = new FieldErrors();
  const fromDate = fromRaw === null ? null : parseIsoDate(fromRaw);
  const toDate = toRaw === null ? null : parseIsoDate(toRaw);
  if (fromRaw !== null && fromDate === null) errors.add('from', FIELD_COPY.dateRange);
  if (toRaw !== null && toDate === null) errors.add('to', FIELD_COPY.dateRange);
  if (fromRaw === null) errors.add('from', FIELD_COPY.dateRange);
  if (toRaw === null) errors.add('to', FIELD_COPY.dateRange);
  errors.throwIfAny();
  if (fromRaw! > toRaw!) {
    throw validationFailed({ from: FIELD_COPY.dateRange, to: FIELD_COPY.dateRange });
  }
  return { from: istDayStartUtc(fromRaw!), to: istDayEndUtc(toRaw!) };
}

async function statusTransition(
  client: Db,
  order: OrderRow,
  to: string,
  actor: Ctx['user']
): Promise<OrderRow> {
  if (!orderStatusTransitionAllowed(order.status, to)) throw invalidTransition();
  const now = new Date();

  if (to === 'packed') {
    await client.query(
      "UPDATE order_lines SET fulfillment = 'packed' WHERE order_number = $1 AND fulfillment = 'unfulfilled'",
      [order.number]
    );
    await client.query("UPDATE orders SET status = 'packed', version = version + 1 WHERE number = $1", [
      order.number
    ]);
  } else if (to === 'out_for_delivery' || to === 'delivered') {
    await client.query('UPDATE order_lines SET fulfillment = $2 WHERE order_number = $1', [order.number, to]);
    if (to === 'delivered') {
      await client.query(
        "UPDATE orders SET status = 'delivered', delivered_at = $2, version = version + 1 WHERE number = $1",
        [order.number, now]
      );
    } else {
      await client.query(
        "UPDATE orders SET status = 'out_for_delivery', version = version + 1 WHERE number = $1",
        [order.number]
      );
    }
  }

  await addTimeline(client, order.number, to, now);
  const subject = orderStatusSubject(order.number, to);
  await recordNotification(
    client,
    order.user_id,
    subject,
    statusBody(`Order ${order.number}`, ORDER_STATUS_WORDS[to], null),
    'pending'
  );
  await appendAudit(client, actor!, 'status_changed', 'order', order.number, { status: order.status }, { status: to });
  const updated = await loadOrder(client, order.number);
  await publishOrder(client, updated!);
  return updated!;
}

export function registerAdminRoutes(): void {
  route('GET', '/api/admin/products', 'api', async (ctx) => {
    requireRole(ctx, ['operations']);
    sendJson(ctx, 200, await adminProductPayload(db));
  });

  route('GET', '/api/admin/products/:slug', 'api', async (ctx) => {
    requireRole(ctx, ['operations']);
    const [product] = await adminProductPayload(db, ctx.params.slug);
    if (product === undefined) throw notFound();
    sendJson(ctx, 200, product);
  });

  route('PATCH', '/api/admin/products/:slug', 'api', async (ctx) => {
    const actor = requireRole(ctx, ['operations']);
    const payload = await tx(async (client) => {
      const product = await client.one<{ id: string; slug: string; status: string; version: number }>(
        'SELECT id, slug, status, version FROM products WHERE slug = $1 FOR UPDATE',
        [ctx.params.slug]
      );
      if (product === null) throw notFound();
      const version = readInteger(ctx.body, 'version');
      if (version !== product.version) throw staleVersion();
      const status = readString(ctx.body, 'status') ?? '';
      if (!['draft', 'published', 'archived'].includes(status)) {
        throw validationFailed({ status: FIELD_COPY.productStatus });
      }
      await client.query('UPDATE products SET status = $2, version = version + 1 WHERE id = $1', [
        product.id,
        status
      ]);
      await appendAudit(
        client,
        actor,
        'status_changed',
        'product',
        product.slug,
        { status: product.status },
        { status }
      );
      await queueProduct(client, product.id);
      const variants = await client.query<{ id: string }>('SELECT id FROM variants WHERE product_id = $1', [
        product.id
      ]);
      await publishStockFor(client, variants.map((variant) => variant.id));
      const [updated] = await adminProductPayload(client, product.slug);
      return updated;
    });
    sendJson(ctx, 200, payload);
  });

  route('PATCH', '/api/admin/variants/:sku', 'api', async (ctx) => {
    const actor = requireRole(ctx, ['operations']);
    const payload = await tx(async (client) => {
      const variant = await client.one<{
        id: string;
        sku: string;
        product_id: string;
        price: number;
        compare_at: number | null;
        version: number;
      }>('SELECT id, sku, product_id, price, compare_at, version FROM variants WHERE sku = $1 FOR UPDATE', [
        ctx.params.sku
      ]);
      if (variant === null) throw notFound();
      const version = readInteger(ctx.body, 'version');
      if (version !== variant.version) throw staleVersion();

      const errors = new FieldErrors();
      const hasPrice = 'price' in ctx.body;
      const hasCompareAt = 'compare_at' in ctx.body;
      const hasStock = 'stock' in ctx.body;

      let price = variant.price;
      if (hasPrice) {
        const value = readInteger(ctx.body, 'price');
        if (value === null || value < 1 || value > 999999) errors.add('price', FIELD_COPY.price);
        else price = value;
      }
      let compareAt = variant.compare_at;
      if (hasCompareAt) {
        const raw = ctx.body.compare_at;
        if (raw === null) compareAt = null;
        else {
          const value = readInteger(ctx.body, 'compare_at');
          if (value === null || value <= price) errors.add('compare_at', FIELD_COPY.compareAt);
          else compareAt = value;
        }
      } else if (compareAt !== null && compareAt <= price) {
        compareAt = null;
      }

      type StockInput = { location: Location; available: number };
      const stockInputs: StockInput[] = [];
      if (hasStock) {
        const raw = ctx.body.stock;
        if (!Array.isArray(raw)) errors.add('stock.0.available', FIELD_COPY.stockAvailable);
        else {
          raw.forEach((item, index) => {
            const record = item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
            const location = readString(record, 'location') ?? '';
            const available = readInteger(record, 'available');
            if (!LOCATIONS.includes(location as Location)) {
              errors.add(`stock.${index}.location`, FIELD_COPY.stockLocation);
            }
            if (available === null || available < 0 || available > 9999) {
              errors.add(`stock.${index}.available`, FIELD_COPY.stockAvailable);
            }
            if (LOCATIONS.includes(location as Location) && available !== null) {
              stockInputs.push({ location: location as Location, available });
            }
          });
        }
      }
      errors.throwIfAny();

      await lockVariants(client, [variant.id]);
      const balances = (await balancesFor(client, [variant.id])).get(variant.id) ?? [];

      if (hasPrice && price !== variant.price) {
        await appendAudit(
          client,
          actor,
          'price_changed',
          'variant',
          variant.sku,
          { price: variant.price },
          { price }
        );
      }
      if (hasCompareAt && compareAt !== variant.compare_at) {
        await appendAudit(
          client,
          actor,
          'compare_at_changed',
          'variant',
          variant.sku,
          { compare_at: variant.compare_at },
          { compare_at: compareAt }
        );
      }

      for (const input of stockInputs) {
        const current = balances.find((entry) => entry.location === input.location)?.available ?? 0;
        if (current === input.available) continue;
        const difference = input.available - current;
        if (difference > 0) {
          await writeMovement(client, variant.id, 'stock_received', 'staff', input.location, difference);
        } else {
          await writeMovement(client, variant.id, 'stock_adjusted', 'staff', input.location, -difference);
        }
        await appendAudit(
          client,
          actor,
          'stock_adjusted',
          'variant',
          variant.sku,
          { location: input.location, available: current },
          { location: input.location, available: input.available }
        );
      }

      await client.query('UPDATE variants SET price = $2, compare_at = $3, version = version + 1 WHERE id = $1', [
        variant.id,
        price,
        compareAt
      ]);
      await queueProduct(client, variant.product_id);
      if (hasPrice || hasCompareAt) await publishPriceFor(client, variant.id);
      if (stockInputs.length > 0) await publishStockFor(client, [variant.id]);

      const updatedBalances = (await balancesFor(client, [variant.id])).get(variant.id) ?? [];
      const updated = await client.one<{ version: number }>('SELECT version FROM variants WHERE id = $1', [
        variant.id
      ]);
      const totalAvailable = updatedBalances.reduce((sum, entry) => sum + entry.available, 0);
      return {
        sku: variant.sku,
        price,
        compare_at: compareAt,
        version: updated!.version,
        available: totalAvailable,
        badge: stockBadge(totalAvailable),
        stock: updatedBalances.map((entry) => ({
          location: entry.location,
          available: entry.available,
          reserved: entry.reserved,
          committed: entry.committed,
          on_hand: entry.on_hand
        }))
      };
    });
    sendJson(ctx, 200, payload);
  });

  route('POST', '/api/admin/products/:slug/images', 'upload', async (ctx) => {
    const actor = requireRole(ctx, ['operations']);
    const key = validateIdempotencyKey(ctx.request.headers['idempotency-key'] as string | undefined, true);
    const colour = ctx.multipart?.fields.find((field) => field.name === 'colour')?.value ?? '';
    const alt = ctx.multipart?.fields.find((field) => field.name === 'alt')?.value ?? '';
    const file = ctx.multipart?.files.find((item) => item.name === 'file');

    const result = await runIdempotent(
      key,
      actor.id,
      `POST /api/admin/products/${ctx.params.slug}/images`,
      { colour, alt, bytes: file === undefined ? 0 : createHash('sha256').update(file.data).digest('hex') },
      async () => {
        const product = await db.one<{ id: string; slug: string; name: string }>(
          'SELECT id, slug, name FROM products WHERE slug = $1',
          [ctx.params.slug]
        );
        if (product === null) throw notFound();

        const errors = new FieldErrors();
        const colours = await db.query<{ colour: string }>(
          'SELECT DISTINCT colour FROM variants WHERE product_id = $1',
          [product.id]
        );
        if (!colours.some((row) => row.colour === colour)) errors.add('colour', FIELD_COPY.colour);
        if (alt.length < 5 || alt.length > 160) errors.add('alt', FIELD_COPY.alt);
        if (file === undefined || file.data.length === 0) errors.add('file', FIELD_COPY.file);
        errors.throwIfAny();

        if (file!.data.length > config.uploadMaxBytes) throw tooLargeFile();
        const sniffed = sniffContentType(file!.data);
        if (sniffed === null || !['image/jpeg', 'image/png', 'image/webp'].includes(sniffed)) {
          throw unsupportedFile(true);
        }

        const id = randomUUID();
        const storageKey = `products/${product.slug}/${id}`;
        const confirmed = await putConfirmed(storageKey, file!.data, sniffed);
        if (!confirmed) throw storageUnavailable(true);

        const payload = await tx(async (client) => {
          const next = await client.one<{ position: number }>(
            'SELECT coalesce(max(position), 0) + 1 AS position FROM product_images WHERE product_id = $1 AND colour = $2',
            [product.id, colour]
          );
          const position = next!.position;
          await client.query(
            `INSERT INTO product_images (id, product_id, colour, alt, position, content_type, storage_key, bytes, sha256)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              id,
              product.id,
              colour,
              alt,
              position,
              sniffed,
              storageKey,
              file!.data.length,
              createHash('sha256').update(file!.data).digest('hex')
            ]
          );
          await appendAudit(client, actor, 'image_added', 'product', product.slug, null, {
            image_id: id,
            colour,
            alt,
            position
          });
          await queueProduct(client, product.id);
          await publish(client, 'queue', { kind: 'image', number: product.slug, status: 'added' }, { staffOnly: true });
          return { id, colour, alt, position, url: `/media/products/${id}` };
        });
        return { status: 201, payload };
      }
    );
    sendJson(ctx, result.status, result.payload, result.replayed ? { 'Idempotency-Replayed': 'true' } : {});
  });

  route('GET', '/api/admin/inventory', 'api', async (ctx) => {
    requireRole(ctx, ['operations']);
    const lowStockOnly = ctx.query.get('low_stock') === 'true';
    const products = await loadProducts(db, {});
    const variantIds = products.flatMap((product) => product.variants.map((variant) => variant.id));
    const balances = await balancesFor(db, variantIds);
    const rows = products
      .flatMap((product) =>
        product.variants.map((variant) => {
          const locations = balances.get(variant.id) ?? [];
          const available = locations.reduce((sum, entry) => sum + entry.available, 0);
          return {
            sku: variant.sku,
            product: product.name,
            colour: variant.colour,
            size: variant.size,
            locations: locations.map((entry) => ({
              location: entry.location,
              available: entry.available,
              reserved: entry.reserved,
              committed: entry.committed,
              on_hand: entry.on_hand
            })),
            available,
            on_hand: locations.reduce((sum, entry) => sum + entry.on_hand, 0)
          };
        })
      )
      .filter((row) => !lowStockOnly || (row.available >= 0 && row.available <= config.lowStockThreshold))
      .sort((a, b) => a.sku.localeCompare(b.sku));
    sendJson(ctx, 200, rows);
  });

  route('GET', '/api/admin/inventory/:sku/movements', 'api', async (ctx) => {
    requireRole(ctx, ['operations']);
    const variant = await db.one<{ id: string }>('SELECT id FROM variants WHERE sku = $1', [ctx.params.sku]);
    if (variant === null) throw notFound();
    const movements = await db.query<{ id: string; reason: string; ref: string; at: Date }>(
      'SELECT id, reason, ref, at FROM stock_movements WHERE variant_id = $1 ORDER BY at DESC, id DESC LIMIT 200',
      [variant.id]
    );
    const entries = await db.query<{ movement_id: string; account: string; location: string; quantity: number }>(
      `SELECT movement_id, account, location, quantity FROM stock_entries
       WHERE movement_id = ANY($1::uuid[]) ORDER BY id ASC`,
      [movements.map((movement) => movement.id)]
    );
    sendJson(
      ctx,
      200,
      movements.map((movement) => ({
        movement_id: movement.id,
        reason: movement.reason,
        ref: movement.ref,
        at: movement.at.toISOString(),
        entries: entries
          .filter((entry) => entry.movement_id === movement.id)
          .map((entry) => ({ account: entry.account, location: entry.location, quantity: entry.quantity }))
      }))
    );
  });

  route('GET', '/api/admin/orders', 'api', async (ctx) => {
    requireRole(ctx, ['operations', 'support']);
    const search = (ctx.query.get('q') ?? '').trim();
    const status = ctx.query.get('status') ?? '';
    const rows = await db.query<{
      number: string;
      status: string;
      payment_status: string;
      placed_at: Date;
      totals: { total: number };
      email: string;
      name: string;
    }>(
      `SELECT o.number, o.status, o.payment_status, o.placed_at, o.totals, o.email, u.name
       FROM orders o JOIN users u ON u.id = o.user_id
       WHERE ($1 = '' OR o.number ILIKE '%' || $1 || '%' OR o.email ILIKE '%' || $1 || '%')
         AND ($2 = '' OR o.status = $2)
       ORDER BY o.placed_at DESC, o.number DESC`,
      [search, status]
    );
    sendJson(
      ctx,
      200,
      rows.map((row) => ({
        number: row.number,
        status: row.status,
        payment_status: row.payment_status,
        placed_at: row.placed_at.toISOString(),
        total: row.totals.total,
        customer: { name: row.name, email: row.email }
      }))
    );
  });

  route('GET', '/api/admin/orders/:number', 'api', async (ctx) => {
    requireRole(ctx, ['operations', 'support']);
    const order = await loadOrder(db, ctx.params.number);
    if (order === null) throw notFound();
    const customer = await db.one<{ id: string; name: string; email: string }>(
      'SELECT id, name, email FROM users WHERE id = $1',
      [order.user_id]
    );
    sendJson(ctx, 200, { ...(await orderPayload(db, order, new Date())), customer });
  });

  route('POST', '/api/admin/orders/:number/status', 'api', async (ctx) => {
    const actor = requireRole(ctx, ['operations']);
    const payload = await tx(async (client) => {
      const order = await client.one<OrderRow>('SELECT * FROM orders WHERE number = $1 FOR UPDATE', [
        ctx.params.number
      ]);
      if (order === null) throw notFound();
      const version = readInteger(ctx.body, 'version');
      if (version !== order.version) throw staleVersion();
      const status = readString(ctx.body, 'status') ?? '';
      if (!['packed', 'out_for_delivery', 'delivered', 'cancelled'].includes(status)) {
        throw validationFailed({ status: FIELD_COPY.orderStatus });
      }
      if (status === 'cancelled') {
        const cancelled = await cancelOrderRecord(client, order);
        await appendAudit(
          client,
          actor,
          'cancelled',
          'order',
          order.number,
          { status: order.status, payment_status: order.payment_status },
          { status: cancelled.status, payment_status: cancelled.payment_status }
        );
        return orderPayload(client, cancelled, new Date());
      }
      const updated = await statusTransition(client, order, status, actor);
      return orderPayload(client, updated, new Date());
    });
    sendJson(ctx, 200, payload);
  });

  route('POST', '/api/admin/orders/:number/shipments', 'api', async (ctx) => {
    const actor = requireRole(ctx, ['operations']);
    const payload = await tx(async (client) => {
      const order = await client.one<OrderRow>('SELECT * FROM orders WHERE number = $1 FOR UPDATE', [
        ctx.params.number
      ]);
      if (order === null) throw notFound();
      const version = readInteger(ctx.body, 'version');
      if (version !== order.version) throw staleVersion();
      if (order.status !== 'packed' && order.status !== 'partially_shipped') throw invalidTransition();

      const lineIds = readStringArray(ctx.body, 'line_ids') ?? [];
      const carrier = readString(ctx.body, 'carrier') ?? '';
      const trackingNumber = readString(ctx.body, 'tracking_number') ?? '';
      const errors = new FieldErrors();
      if (lineIds.length === 0) errors.add('line_ids', FIELD_COPY.lineIds);
      if (!CARRIERS.includes(carrier)) errors.add('carrier', FIELD_COPY.carrier);
      if (!/^[A-Z0-9-]{6,30}$/.test(trackingNumber)) errors.add('tracking_number', FIELD_COPY.trackingNumber);
      errors.throwIfAny();

      const lines = await loadOrderLines(client, order.number);
      const selected: OrderLineRow[] = [];
      for (const id of lineIds) {
        const line = lines.find((item) => item.id === id);
        if (line === undefined) throw notFound();
        if (line.fulfillment !== 'packed') throw invalidTransition();
        selected.push(line);
      }

      await lockVariants(client, selected.map((line) => line.variant_id));
      for (const line of selected) {
        await drawFromAccount(client, line.variant_id, 'shipped', order.number, line.quantity, 'committed');
        await client.query(
          "UPDATE order_lines SET fulfillment = 'shipped', carrier = $2, tracking_number = $3 WHERE id = $1",
          [line.id, carrier, trackingNumber]
        );
      }

      const remaining = lines.filter(
        (line) => !lineIds.includes(line.id) && line.fulfillment !== 'shipped' && line.fulfillment !== 'cancelled'
      );
      const nextStatus = remaining.length === 0 ? 'shipped' : 'partially_shipped';
      const now = new Date();
      await client.query('UPDATE orders SET status = $2, version = version + 1 WHERE number = $1', [
        order.number,
        nextStatus
      ]);
      await addTimeline(client, order.number, nextStatus, now);

      const subject = orderStatusSubject(order.number, nextStatus);
      await recordNotification(
        client,
        order.user_id,
        subject,
        statusBody(`Order ${order.number}`, ORDER_STATUS_WORDS[nextStatus], null),
        'pending'
      );
      await appendAudit(
        client,
        actor,
        'shipment_created',
        'order',
        order.number,
        { status: order.status, lines: selected.map((line) => ({ id: line.id, fulfillment: line.fulfillment })) },
        { status: nextStatus, lines: selected.map((line) => ({ id: line.id, fulfillment: 'shipped' })) }
      );
      await publishStockFor(client, selected.map((line) => line.variant_id));
      const updated = await loadOrder(client, order.number);
      await publishOrder(client, updated!);
      return orderPayload(client, updated!, new Date());
    });
    sendJson(ctx, 201, payload);
  });

  registerQueueRoutes();
  registerPromotionRoutes();
  registerReportRoutes();
}

async function caseListPayload(
  client: Db,
  kind: 'return' | 'trial' | 'warranty_claim',
  status: string
): Promise<Record<string, unknown>[]> {
  const table = kind === 'return' ? 'returns' : kind === 'trial' ? 'trials' : 'warranty_claims';
  const rows = await client.query<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE ($1 = '' OR status = $1) ORDER BY created_at DESC, number DESC`,
    [status]
  );
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const base =
      kind === 'return'
        ? await returnPayload(client, row as unknown as ReturnRow)
        : kind === 'trial'
          ? await trialPayload(client, row as unknown as TrialRow)
          : await claimPayload(client, row as unknown as ClaimRow);
    const customer = await client.one<{ id: string; name: string; email: string }>(
      'SELECT id, name, email FROM users WHERE id = $1',
      [row.user_id]
    );
    out.push({ ...base, customer });
  }
  return out;
}

function registerQueueRoutes(): void {
  const kinds: Array<{ path: string; kind: 'return' | 'trial' | 'warranty_claim'; table: string }> = [
    { path: 'returns', kind: 'return', table: 'returns' },
    { path: 'trials', kind: 'trial', table: 'trials' },
    { path: 'warranty', kind: 'warranty_claim', table: 'warranty_claims' }
  ];

  for (const entry of kinds) {
    route('GET', `/api/admin/${entry.path}`, 'api', async (ctx) => {
      requireRole(ctx, ['support']);
      sendJson(ctx, 200, await caseListPayload(db, entry.kind, ctx.query.get('status') ?? ''));
    });

    route('GET', `/api/admin/${entry.path}/:number`, 'api', async (ctx) => {
      requireRole(ctx, ['support']);
      const list = await caseListPayload(db, entry.kind, '');
      const found = list.find((item) => item.number === ctx.params.number);
      if (found === undefined) throw notFound();
      sendJson(ctx, 200, found);
    });

    route('POST', `/api/admin/${entry.path}/:number/transition`, 'api', async (ctx) => {
      const actor = requireRole(ctx, ['support']);
      const payload = await tx(async (client) => {
        const row = await client.one<Record<string, unknown>>(
          `SELECT * FROM ${entry.table} WHERE number = $1 FOR UPDATE`,
          [ctx.params.number]
        );
        if (row === null) throw notFound();
        const version = readInteger(ctx.body, 'version');
        if (version !== Number(row.version)) throw staleVersion();
        const to = readString(ctx.body, 'to') ?? '';
        const reason = readString(ctx.body, 'reason');
        if (entry.kind === 'return') {
          return transitionReturn(client, row as unknown as ReturnRow, to, reason, actor);
        }
        if (entry.kind === 'trial') {
          return transitionTrial(client, row as unknown as TrialRow, to, reason, actor);
        }
        return transitionClaim(client, row as unknown as ClaimRow, to, reason, actor);
      });
      sendJson(ctx, 200, payload);
    });
  }

  route('GET', '/api/admin/warranty/evidence/:id/content', 'raw', async (ctx) => {
    requireRole(ctx, ['support']);
    const row = await db.one<{ storage_key: string; content_type: string; filename: string }>(
      'SELECT storage_key, content_type, filename FROM evidence WHERE id::text = $1',
      [ctx.params.id]
    );
    if (row === null) throw notFound();
    const bytes = await getObject(row.storage_key);
    if (bytes === null) throw notFound();
    const extra: Record<string, string> =
      row.content_type === 'application/pdf'
        ? { 'Content-Disposition': `attachment; filename="${row.filename.replace(/"/g, '')}"` }
        : {};
    sendBytes(ctx, 200, bytes, row.content_type, extra);
  });
}

function registerPromotionRoutes(): void {
  route('GET', '/api/admin/discount-codes', 'api', async (ctx) => {
    requireRole(ctx, ['operations']);
    const rows = await db.query<{
      code: string;
      kind: string;
      value: number;
      collection: string | null;
      minimum: number;
      starts_at: Date;
      ends_at: Date;
      usage_limit: number | null;
      used: number;
    }>('SELECT * FROM discount_codes ORDER BY code ASC');
    sendJson(
      ctx,
      200,
      rows.map((row) => ({
        ...row,
        starts_at: row.starts_at.toISOString(),
        ends_at: row.ends_at.toISOString()
      }))
    );
  });

  route('POST', '/api/admin/discount-codes', 'api', async (ctx) => {
    const actor = requireRole(ctx, ['operations']);
    const errors = new FieldErrors();
    const code = (readString(ctx.body, 'code') ?? '').trim();
    const kind = readString(ctx.body, 'kind') ?? '';
    const valueRaw = ctx.body.value;
    const collection = readString(ctx.body, 'collection');
    const minimum = readInteger(ctx.body, 'minimum') ?? 0;
    const startsRaw = readString(ctx.body, 'starts_at') ?? '';
    const endsRaw = readString(ctx.body, 'ends_at') ?? '';
    const usageLimitRaw = ctx.body.usage_limit;

    if (!/^[A-Z0-9]{3,20}$/.test(code)) errors.add('code', FIELD_COPY.promoCode);
    if (kind !== 'percent' && kind !== 'fixed') errors.add('kind', FIELD_COPY.promoKind);
    const value = typeof valueRaw === 'number' && Number.isInteger(valueRaw) ? valueRaw : null;
    if (value === null) errors.add('value', FIELD_COPY.promoValue);
    else if (kind === 'percent' && (value < 1 || value > 90)) errors.add('value', FIELD_COPY.promoValue);
    else if (kind === 'fixed' && (value < 1 || value > 999999)) errors.add('value', FIELD_COPY.promoValue);
    if (collection !== null && !COLLECTIONS.some((item) => item.slug === collection && item.slug !== 'all')) {
      errors.add('collection', FIELD_COPY.promoCollection);
    }
    if (minimum < 0) errors.add('minimum', FIELD_COPY.promoMinimum);
    const startsAt = parseDateTime(startsRaw);
    const endsAt = parseDateTime(endsRaw);
    if (startsAt === null) errors.add('starts_at', FIELD_COPY.dateTime);
    if (endsAt === null) errors.add('ends_at', FIELD_COPY.dateTime);
    if (startsAt !== null && endsAt !== null && endsAt.getTime() <= startsAt.getTime()) {
      errors.add('ends_at', FIELD_COPY.endsAfterStart);
    }
    let usageLimit: number | null = null;
    if (usageLimitRaw !== null && usageLimitRaw !== undefined && usageLimitRaw !== '') {
      const parsed = typeof usageLimitRaw === 'number' ? usageLimitRaw : Number(usageLimitRaw);
      if (!Number.isInteger(parsed) || parsed < 1) errors.add('usage_limit', FIELD_COPY.usageLimit);
      else usageLimit = parsed;
    }
    if (/^[A-Z0-9]{3,20}$/.test(code)) {
      const existing = await db.one<{ code: string }>('SELECT code FROM discount_codes WHERE code = $1', [code]);
      if (existing !== null) errors.add('code', FIELD_COPY.promoCodeExists);
    }
    errors.throwIfAny();

    const payload = await tx(async (client) => {
      await client.query(
        `INSERT INTO discount_codes (code, kind, value, collection, minimum, starts_at, ends_at, usage_limit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [code, kind, value, collection, minimum, startsAt, endsAt, usageLimit]
      );
      const created = {
        code,
        kind,
        value,
        collection,
        minimum,
        starts_at: startsAt!.toISOString(),
        ends_at: endsAt!.toISOString(),
        usage_limit: usageLimit,
        used: 0
      };
      await appendAudit(client, actor, 'created', 'discount_code', code, null, created);
      return created;
    });
    sendJson(ctx, 201, payload);
  });

  route('GET', '/api/admin/gift-cards/:code', 'api', async (ctx) => {
    requireRole(ctx, ['operations']);
    if (!(await giftCardExists(db, ctx.params.code))) throw notFound();
    sendJson(ctx, 200, {
      code: ctx.params.code.toUpperCase(),
      balance: await giftCardBalance(db, ctx.params.code),
      entries: await giftCardEntries(db, ctx.params.code)
    });
  });

  route('GET', '/api/admin/audit', 'api', async (ctx) => {
    requireRole(ctx, ['operations', 'support']);
    const entity = ctx.query.get('entity') ?? '';
    const entityId = ctx.query.get('entity_id') ?? '';
    const rows = await db.query<{
      id: string;
      actor_id: string;
      actor_name: string;
      actor_role: string;
      action: string;
      entity: string;
      entity_id: string;
      before: unknown;
      after: unknown;
      at: Date;
    }>(
      `SELECT * FROM audit_entries
       WHERE ($1 = '' OR entity = $1) AND ($2 = '' OR entity_id = $2)
       ORDER BY id DESC LIMIT 500`,
      [entity, entityId]
    );
    sendJson(
      ctx,
      200,
      rows.map((row) => ({
        id: Number(row.id),
        actor: { id: row.actor_id, name: row.actor_name, role: row.actor_role },
        action: row.action,
        entity: row.entity,
        entity_id: row.entity_id,
        before: row.before,
        after: row.after,
        at: row.at.toISOString()
      }))
    );
  });

  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    route(method, '/api/admin/audit/:id', 'api', async () => {
      throw methodNotAllowed(true);
    });
  }
}

function registerReportRoutes(): void {
  route('GET', '/api/admin/metrics', 'api', async (ctx) => {
    requireRole(ctx, ['operations']);
    const range = dateRange(ctx);
    const orders = await db.query<{ number: string; totals: { total: number }; payment_amount: number }>(
      `SELECT number, totals, payment_amount FROM orders
       WHERE kind = 'standard' AND placed_at >= $1 AND placed_at <= $2`,
      [range.from, range.to]
    );
    const units = await db.one<{ total: string }>(
      `SELECT coalesce(sum(l.quantity), 0)::bigint AS total FROM order_lines l
       JOIN orders o ON o.number = l.order_number
       WHERE o.kind = 'standard' AND o.placed_at >= $1 AND o.placed_at <= $2`,
      [range.from, range.to]
    );
    const refunds = await db.one<{ total: string }>(
      `SELECT coalesce(sum(amount), 0)::bigint AS total FROM refunds WHERE at >= $1 AND at <= $2`,
      [range.from, range.to]
    );
    const gross = orders.reduce((sum, order) => sum + order.payment_amount, 0);
    const refundTotal = refunds === null ? 0 : Number(refunds.total);
    sendJson(ctx, 200, {
      orders: orders.length,
      gross_sales: gross,
      refunds: refundTotal,
      net_sales: gross - refundTotal,
      units_sold: units === null ? 0 : Number(units.total),
      average_order_value: orders.length === 0 ? 0 : roundHalfUp(gross / orders.length)
    });
  });

  route('GET', '/api/admin/reports/orders.csv', 'raw', async (ctx) => {
    requireRole(ctx, ['operations']);
    const range = dateRange(ctx);
    const rows = await db.query<{
      number: string;
      placed_at: Date;
      email: string;
      status: string;
      payment_status: string;
      totals: { subtotal: number; discount: number; shipping: number; tax: number; gift_card: number; total: number };
      refunded: number;
    }>(
      `SELECT number, placed_at, email, status, payment_status, totals, refunded FROM orders
       WHERE placed_at >= $1 AND placed_at <= $2 ORDER BY placed_at ASC, number ASC`,
      [range.from, range.to]
    );
    const lines = [
      'order_number,placed_at,customer_email,status,payment_status,subtotal,discount,shipping,tax,gift_card,total,refunded'
    ];
    for (const row of rows) {
      lines.push(
        csvRow([
          row.number,
          row.placed_at.toISOString(),
          row.email,
          row.status,
          row.payment_status,
          row.totals.subtotal,
          row.totals.discount,
          row.totals.shipping,
          row.totals.tax,
          row.totals.gift_card,
          row.totals.total,
          row.refunded
        ])
      );
    }
    sendText(ctx, 200, `${lines.join('\n')}\n`, 'text/csv; charset=utf-8', {
      'Content-Disposition': 'attachment; filename="orders.csv"'
    });
  });

  route('GET', '/api/admin/reports/inventory.csv', 'raw', async (ctx) => {
    requireRole(ctx, ['operations']);
    const products = await loadProducts(db, {});
    const variantIds = products.flatMap((product) => product.variants.map((variant) => variant.id));
    const balances = await balancesFor(db, variantIds);
    const rows: string[] = ['sku,product,colour,size,location,available,reserved,committed,on_hand'];
    const flat = products
      .flatMap((product) =>
        product.variants.flatMap((variant) =>
          (balances.get(variant.id) ?? []).map((entry) => ({
            sku: variant.sku,
            product: product.name,
            colour: variant.colour,
            size: variant.size,
            location: entry.location,
            available: entry.available,
            reserved: entry.reserved,
            committed: entry.committed,
            on_hand: entry.on_hand
          }))
        )
      )
      .sort((a, b) => a.sku.localeCompare(b.sku) || a.location.localeCompare(b.location));
    for (const entry of flat) {
      rows.push(
        csvRow([
          entry.sku,
          entry.product,
          entry.colour,
          entry.size,
          entry.location,
          entry.available,
          entry.reserved,
          entry.committed,
          entry.on_hand
        ])
      );
    }
    sendText(ctx, 200, `${rows.join('\n')}\n`, 'text/csv; charset=utf-8', {
      'Content-Disposition': 'attachment; filename="inventory.csv"'
    });
  });
}
