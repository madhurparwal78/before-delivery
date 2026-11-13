import { Router } from 'express';
import { h } from './h.js';
import type { Client } from '../db/pool.js';
import { pool, withClient, inTransaction } from '../db/pool.js';
import { CONFIG } from '../config.js';
import { Errors, dateText, digitGroup } from '../domain/errors.js';
import { readSession, requireStaff, type SessionInfo } from './session.js';
import { publish } from '../domain/events.js';
import { audit } from '../domain/audit.js';
import { moveStock, availableFor, stockFigures } from '../domain/ledger.js';
import { stockBadge, isLowStock } from '../domain/fit.js';
import { sniff, pdfIsSafe, cleanFilename } from '../services/sniff.js';
import { s3 } from '../services/s3.js';
import { sha256Hex } from '../domain/password.js';
import { orderCanMove, orderBodyByNumber, cancelOrder } from './orders.js';
import { publishStock, publishPrice } from './checkout.js';
import { pushDoc, unindexDoc } from '../services/indexer.js';
import { sendEmail } from '../services/mail.js';

export const staffRouter = Router();

type Actor = { id: number; name: string; role: string };

staffRouter.use(async (req, res, next) => {
  const session = await readSession(req, res);
  (req as unknown as { session: SessionInfo }).session = session;
  next();
});

function actor(req: { session: SessionInfo }): Actor {
  const s = req.session;
  return { id: s.userId ?? 0, name: s.role ?? '', role: s.role ?? '' };
}

// --- products ----------------------------------------------------------------

staffRouter.get('/products', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations']);
  const rows = await pool.query(`
    SELECT p.slug, p.name, p.category, p.status, p.version, p.featured_rank, p.published_at
    FROM products p ORDER BY p.featured_rank`);
  res.status(200).json(rows.rows.map((r) => ({
    slug: r.slug, name: r.name, category: r.category, status: r.status, version: Number(r.version),
  })));
}));

staffRouter.get('/products/:slug', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations']);
  const slug = req.params.slug;
  const data = await withClient(async (client) => {
    const product = await client.query(`SELECT slug, name, category, material, status, version FROM products WHERE slug = $1`, [slug]);
    if (product.rows.length === 0) throw Errors.notFound();
    const variants = await client.query(`
      SELECT v.sku, v.colour, v.colour_slug, v.size, v.size_slug, v.price, v.compare_at, v.version, v.position,
        COALESCE(SUM(e.quantity) FILTER (WHERE e.account = 'available'), 0)::INT AS available
      FROM variants v LEFT JOIN stock_entries e ON e.sku = v.sku
      WHERE v.product_slug = $1 GROUP BY v.sku ORDER BY v.position`, [slug]);
    const stock = await stockFigures(client, variants.rows.map((v) => v.sku));
    const images = await client.query(
      `SELECT id, colour, colour_slug, alt, position FROM product_images WHERE product_slug = $1 ORDER BY position`, [slug]);
    return {
      slug: product.rows[0].slug, name: product.rows[0].name, category: product.rows[0].category,
      material: product.rows[0].material, status: product.rows[0].status, version: Number(product.rows[0].version),
      variants: variants.rows.map((v) => ({
        sku: v.sku, colour: v.colour, colour_slug: v.colour_slug, size: v.size, size_slug: v.size_slug,
        price: v.price, compare_at: v.compare_at, version: Number(v.version), available: v.available,
        badge: stockBadge(v.available),
        stock: (stock.get(v.sku) ?? []).map((s) => ({ location: s.location, available: s.available, reserved: s.reserved, committed: s.committed, on_hand: s.on_hand })),
      })),
      images: images.rows,
    };
  });
  res.status(200).json(data);
}));

staffRouter.patch('/products/:slug', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations']);
  const slug = req.params.slug;
  const body = req.body as { version?: unknown; status?: unknown };
  const status = typeof body.status === 'string' ? body.status : '';
  if (!['draft','published','archived'].includes(status)) throw Errors.validationFailed({ status: 'Choose draft, published or archived.' });
  await inTransaction(async (client) => {
    const row = await client.query<{ version: number; status: string; slug: string; name: string }>(
      `SELECT version, status, slug, name FROM products WHERE slug = $1 FOR UPDATE`, [slug]);
    if (row.rows.length === 0) throw Errors.notFound();
    if (Number(body.version) !== Number(row.rows[0].version)) throw Errors.staleVersion();
    const before = { status: row.rows[0].status };
    await client.query(`UPDATE products SET status = $1, version = version + 1, updated_at = now() WHERE slug = $2`, [status, slug]);
    const after = { status };
    await audit(client, actorFrom(session), 'status_changed', 'product', slug, before, after);
    if (status === 'published') {
      await pushDoc(client, slug);
    } else {
      await unindexDoc(slug);
    }
  });
  const fresh = await withClient((client) => client.query(`SELECT version, status FROM products WHERE slug = $1`, [slug]));
  res.status(200).json({ slug, status, version: Number(fresh.rows[0].version) });
}));

function actorFrom(session: SessionInfo): Actor {
  return { id: session.userId ?? 0, name: session.userName ?? '', role: session.role ?? '' };
}

// --- variants ------------------------------------------------------------------

staffRouter.patch('/variants/:sku', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations']);
  const sku = req.params.sku;
  const body = req.body as Record<string, unknown>;
  await inTransaction(async (client) => {
    const row = await client.query<{ version: number; price: number; compare_at: number | null; product_slug: string }>(
      `SELECT version, price, compare_at, product_slug FROM variants WHERE sku = $1 FOR UPDATE`, [sku]);
    if (row.rows.length === 0) throw Errors.notFound();
    if (Number(body.version) !== Number(row.rows[0].version)) throw Errors.staleVersion();

    const fields: Record<string, string> = {};
    let price: number | null = null;
    let compareAt: number | null | undefined = undefined;
    if (body.price !== undefined) {
      price = Number(body.price);
      if (!Number.isInteger(price) || price < 1 || price > 999999) fields.price = 'Enter a whole-rupee price from 1 to 9,99,999.';
    }
    if (body.compare_at !== undefined) {
      if (body.compare_at === null) {
        compareAt = null;
      } else {
        compareAt = Number(body.compare_at);
        if (!Number.isInteger(compareAt) || compareAt <= (price ?? row.rows[0].price)) {
          fields.compare_at = 'Enter a compare-at price above the price, or leave it empty.';
        }
      }
    }
    const stockInput = Array.isArray(body.stock) ? body.stock as { location?: unknown; available?: unknown }[] : [];
    for (const [i, entry] of stockInput.entries()) {
      const available = Number(entry.available);
      if (!Number.isInteger(available) || available < 0 || available > 9999) {
        fields[`stock.${i}.available`] = 'Enter a whole number of units from 0 to 9,999.';
      }
      if (entry.location !== 'bhiwandi' && entry.location !== 'gurugram') {
        fields[`stock.${i}.location`] = 'Choose bhiwandi or gurugram.';
      }
    }
    if (Object.keys(fields).length > 0) throw Errors.validationFailed(fields);

    const changes: { field: string; before: unknown; after: unknown }[] = [];
    if (price !== null && price !== row.rows[0].price) {
      changes.push({ field: 'price_changed', before: { price: row.rows[0].price }, after: { price } });
      await client.query(`UPDATE variants SET price = $1 WHERE sku = $2`, [price, sku]);
    }
    if (compareAt !== undefined && compareAt !== row.rows[0].compare_at) {
      changes.push({ field: 'compare_at_changed', before: { compare_at: row.rows[0].compare_at }, after: { compare_at: compareAt } });
      await client.query(`UPDATE variants SET compare_at = $1 WHERE sku = $2`, [compareAt, sku]);
    }
    for (const [i, entry] of stockInput.entries()) {
      const location = String(entry.location);
      const target = Number(entry.available);
      const currentFigures = await stockFigures(client, [sku]);
      const current = (currentFigures.get(sku) ?? []).find((s) => s.location === location);
      const currentAvailable = current?.available ?? 0;
      if (target !== currentAvailable) {
        const diff = target - currentAvailable;
        const reason = diff > 0 ? 'stock_received' : 'stock_adjusted';
        await moveStock(client, reason, `staff/${sku}/${location}`, [{ sku, location: location as 'bhiwandi' | 'gurugram', quantity: Math.abs(diff) }]);
        changes.push({ field: 'stock_adjusted', before: { location, available: currentAvailable }, after: { location, available: target } });
      }
    }
    await client.query(`UPDATE variants SET version = version + 1 WHERE sku = $1`, [sku]);
    for (const change of changes) {
      await audit(client, actorFrom(session), change.field as 'price_changed', 'variant', sku, change.before as Record<string, unknown>, change.after as Record<string, unknown>);
    }
    await pushDoc(client, row.rows[0].product_slug);
    await publishStock(client, sku);
    await publishPrice(client, sku);
  });
  const fresh = await withClient(async (client) => {
    const v = await client.query(`SELECT version, price, compare_at FROM variants WHERE sku = $1`, [sku]);
    const stock = await stockFigures(client, [sku]);
    return { version: Number(v.rows[0].version), price: v.rows[0].price, compare_at: v.rows[0].compare_at, stock: stock.get(sku) ?? [] };
  });
  res.status(200).json({
    sku, version: fresh.version, price: fresh.price, compare_at: fresh.compare_at,
    stock: fresh.stock.map((s) => ({ location: s.location, available: s.available })),
  });
}));

// --- images ---------------------------------------------------------------------

staffRouter.post('/products/:slug/images', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations']);
  const slug = req.params.slug;
  const idemKey = req.header('idempotency-key') ?? '';
  if (idemKey.length < 8 || idemKey.length > 128) {
    throw Errors.validationFailed({ 'Idempotency-Key': 'Send an Idempotency-Key of 8 to 128 characters.' });
  }
  const body = req.body as { colour?: unknown; alt?: unknown };
  const file = (req as unknown as { file?: { buffer: Buffer; originalname: string } }).file;
  const colour = typeof body.colour === 'string' ? body.colour : '';
  const alt = typeof body.alt === 'string' ? body.alt : '';
  const fields: Record<string, string> = {};
  if (alt.length < 5 || alt.length > 160) fields.alt = 'Write alt text of 5 to 160 characters.';
  if (file === undefined) fields.file = 'Choose a file to upload.';
  if (Object.keys(fields).length > 0) throw Errors.validationFailed(fields);

  const route = `POST /api/admin/products/${slug}/images`;
  const bodyHash = sha256Hex(`${colour}|${alt}|${sha256Hex(file!.buffer)}`);
  const prior = await pool.query<{ status: number; response: string; body_hash: string }>(
    `SELECT status, response, body_hash FROM idempotency_keys WHERE key = $1 AND user_id = $2 AND route = $3`,
    [idemKey, session.userId, route]);
  if (prior.rows.length > 0) {
    if (prior.rows[0].body_hash !== bodyHash) throw Errors.idempotencyMismatch();
    res.setHeader('Idempotency-Replayed', 'true');
    res.status(prior.rows[0].status).json(JSON.parse(prior.rows[0].response));
    return;
  }

  const created = await inTransaction(async (client) => {
    const product = await client.query(`SELECT slug, name FROM products WHERE slug = $1`, [slug]);
    if (product.rows.length === 0) throw Errors.notFound();
    const variant = await client.query<{ colour: string; colour_slug: string }>(
      `SELECT colour, colour_slug FROM variants WHERE product_slug = $1 AND colour = $2 LIMIT 1`, [slug, colour]);
    if (variant.rows.length === 0) throw Errors.validationFailed({ colour: 'Choose one of this product\'s colours.' });

    const sniffed = sniff(file!.buffer);
    if (sniffed.type === null || sniffed.type === 'pdf') throw Errors.unsupportedFileImages();

    const positionRow = await client.query<{ max: string }>(
      `SELECT COALESCE(MAX(position), 0)::TEXT AS max FROM product_images WHERE product_slug = $1 AND colour_slug = $2`, [slug, variant.rows[0].colour_slug]);
    const position = Number(positionRow.rows[0].max) + 1;
    const imageId = `${slug}-${variant.rows[0].colour_slug}-${position}-${Date.now()}`;
    const key = `products/${slug}/${imageId}`;
    const confirmed = await s3.put(key, file!.buffer, sniffed.content_type!);
    if (!confirmed) throw Errors.storageUnavailableImages();
    const sizeOk = await s3.confirmSize(key, file!.buffer.length);
    if (!sizeOk) throw Errors.storageUnavailableImages();

    await client.query(
      `INSERT INTO product_images (id, product_slug, colour, colour_slug, alt, position, content_type, sha256, storage)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'s3')`,
      [imageId, slug, variant.rows[0].colour, variant.rows[0].colour_slug, alt, position, sniffed.content_type!, sha256Hex(file!.buffer)]);
    await audit(client, actorFrom(session), 'image_added', 'product', slug, null,
      { image_id: imageId, colour: variant.rows[0].colour, alt, position });
    await pushDoc(client, slug);
    return { id: imageId, colour: variant.rows[0].colour, alt, position, url: `/media/products/${imageId}` };
  });
  await pool.query(
    `INSERT INTO idempotency_keys (key, user_id, route, body_hash, status, response) VALUES ($1,$2,$3,$4,201,$5)
     ON CONFLICT (key, user_id, route) DO NOTHING`,
    [idemKey, session.userId, route, bodyHash, JSON.stringify(created)]);
  res.status(201).json(created);
}));

// --- inventory -----------------------------------------------------------------

staffRouter.get('/inventory', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations']);
  const lowOnly = req.query.low_stock === 'true';
  const rows = await withClient(async (client) => {
    const res = await client.query<{ sku: string; product: string; colour: string; size: string; available: string }>(`
      SELECT v.sku, p.name AS product, v.colour, v.size,
             COALESCE(SUM(e.quantity) FILTER (WHERE e.account = 'available'), 0)::TEXT AS available
      FROM variants v JOIN products p ON p.slug = v.product_slug
      LEFT JOIN stock_entries e ON e.sku = v.sku
      GROUP BY v.sku, p.name, v.colour, v.size ORDER BY v.sku`);
    const out = [];
    for (const row of res.rows) {
      const figures = await stockFigures(client, [row.sku]);
      const available = Number(row.available);
      if (lowOnly && !isLowStock(available)) continue;
      out.push({
        sku: row.sku, product: row.product, colour: row.colour, size: row.size,
        locations: (figures.get(row.sku) ?? []).map((sf) => ({
          location: sf.location, available: sf.available, reserved: sf.reserved, committed: sf.committed, on_hand: sf.on_hand,
        })),
        available, on_hand: (figures.get(row.sku) ?? []).reduce((sum, sf) => sum + sf.on_hand, 0),
      });
    }
    return out;
  });
  res.status(200).json(rows);
}));

staffRouter.get('/inventory/:sku/movements', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations']);
  const sku = req.params.sku;
  const variant = await pool.query(`SELECT sku FROM variants WHERE sku = $1`, [sku]);
  if (variant.rows.length === 0) throw Errors.notFound();
  const rows = await pool.query<{ movement_id: string; reason: string; ref: string; at: Date; account: string; location: string; quantity: number }>(`
    SELECT m.id::TEXT AS movement_id, m.reason, m.ref, m.at, e.account, e.location, e.quantity
    FROM stock_movements m JOIN stock_entries e ON e.movement_id = m.id
    WHERE e.sku = $1 ORDER BY m.at DESC, m.id DESC, e.id`, [sku]);
  const grouped = new Map<string, { movement_id: number; reason: string; ref: string; at: string; entries: { account: string; location: string; quantity: number }[] }>();
  for (const row of rows.rows) {
    const entry = grouped.get(row.movement_id) ?? {
      movement_id: Number(row.movement_id), reason: row.reason, ref: row.ref, at: row.at.toISOString(), entries: [],
    };
    entry.entries.push({ account: row.account, location: row.location, quantity: row.quantity });
    grouped.set(row.movement_id, entry);
  }
  res.status(200).json([...grouped.values()]);
}));

// --- staff orders -----------------------------------------------------------------

staffRouter.get('/orders', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations', 'support']);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const rows = await withClient(async (client) => {
    const params: unknown[] = [];
    let where = 'TRUE';
    if (q !== '') {
      params.push(`%${q}%`);
      where += ` AND (o.number ILIKE $1 OR u.email ILIKE $1)`;
    }
    if (status !== '') {
      params.push(status);
      where += ` AND o.status = $${params.length}`;
    }
    const result = await client.query<{ number: string; user_id: string; status: string; placed_at: Date; total: number; email: string }>(`
      SELECT o.number, o.user_id::TEXT AS user_id, o.status, o.placed_at, o.total, u.email
      FROM orders o JOIN users u ON u.id = o.user_id
      WHERE ${where} ORDER BY o.placed_at DESC, o.number DESC LIMIT 200`, params);
    return result.rows.map((r) => ({
      number: r.number, status: r.status, placed_at: r.placed_at.toISOString(), total: r.total,
      customer: { email: r.email },
    }));
  });
  res.status(200).json(rows);
}));

staffRouter.get('/orders/:number', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations', 'support']);
  const order = await pool.query<{ user_id: string }>(`SELECT user_id::TEXT AS user_id FROM orders WHERE number = $1`, [req.params.number]);
  if (order.rows.length === 0) throw Errors.notFound();
  const body = await orderBodyByNumber(req.params.number, Number(order.rows[0].user_id));
  const customer = await pool.query(`SELECT id, name, email, role FROM users WHERE id = $1`, [Number(order.rows[0].user_id)]);
  res.status(200).json({ ...body, customer: customer.rows[0] });
}));

staffRouter.post('/orders/:number/status', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations']);
  const number = req.params.number;
  const body = req.body as { version?: unknown; status?: unknown };
  const status = typeof body.status === 'string' ? body.status : '';
  if (!['packed','out_for_delivery','delivered','cancelled'].includes(status)) {
    throw Errors.validationFailed({ status: 'Choose packed, out for delivery, delivered or cancelled.' });
  }
  const result = await inTransaction(async (client) => {
    const row = await client.query<{ version: number; status: string; user_id: string; email: string }>(
      `SELECT version, status, user_id::TEXT AS user_id, email FROM orders WHERE number = $1 FOR UPDATE`, [number]);
    if (row.rows.length === 0) throw Errors.notFound();
    if (Number(body.version) !== Number(row.rows[0].version)) throw Errors.staleVersion();
    if (status === 'cancelled') {
      return cancelOrder(number, null, null, actorFrom(session));
    }
    if (!orderCanMove(row.rows[0].status, status)) throw Errors.invalidTransition();
    const before = { status: row.rows[0].status };
    const newVersion = Number(row.rows[0].version) + 1;
    if (status === 'delivered') {
      await client.query(`UPDATE orders SET status = $1, version = $2, delivered_at = now() WHERE number = $3`, [status, newVersion, number]);
    } else {
      await client.query(`UPDATE orders SET status = $1, version = $2 WHERE number = $3`, [status, newVersion, number]);
    }
    // The lines follow the order: packed covers unfulfilled; the later moves
    // cover every line still at or below their previous state.
    if (status === 'packed') {
      await client.query(`UPDATE order_lines SET fulfillment = 'packed' WHERE order_id = $1 AND fulfillment = 'unfulfilled'`, [number]);
    } else if (status === 'out_for_delivery') {
      await client.query(`UPDATE order_lines SET fulfillment = 'out_for_delivery' WHERE order_id = $1 AND fulfillment IN ('unfulfilled','packed','shipped')`, [number]);
    } else if (status === 'delivered') {
      await client.query(`UPDATE order_lines SET fulfillment = 'delivered' WHERE order_id = $1 AND fulfillment IN ('unfulfilled','packed','shipped','out_for_delivery')`, [number]);
    }
    await client.query(`INSERT INTO order_timeline (order_number, status, at) VALUES ($1,$2,now())`, [number, status]);
    await audit(client, actorFrom(session), 'status_changed', 'order', number, before, { status });
    const subject = `Order ${number}: ${statusWord(status)}`;
    const sent = await sendEmail(row.rows[0].email, subject, `Order ${number} is ${statusWord(status)}.\n\nRoam House\n`);
    await client.query(`INSERT INTO notifications (user_id, text, email_status, emailed_at) VALUES ($1,$2,$3,now())`,
      [Number(row.rows[0].user_id), subject, sent ? 'emailed' : 'pending']);
    await publish(client, 'notification', { text: subject, email_status: sent ? 'emailed' : 'pending' },
      { userId: Number(row.rows[0].user_id), sessionId: null, staffVisible: true });
    await publishOrderEvent(client, number, status, newVersion, Number(row.rows[0].user_id));
    return orderBodyByNumber(number, Number(row.rows[0].user_id), client);
  });
  res.status(200).json(result);
}));

function statusWord(status: string): string {
  const words: Record<string, string> = {
    placed: 'Placed', packed: 'Packed', partially_shipped: 'Partially shipped', shipped: 'Shipped',
    out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled',
  };
  return words[status] ?? status;
}

async function publishOrderEvent(client: Client, number: string, status: string, version: number, userId: number): Promise<void> {
  const lines = await client.query<{ id: string; fulfillment: string; carrier: string | null; tracking_number: string | null }>(
    `SELECT id::TEXT AS id, fulfillment, carrier, tracking_number FROM order_lines WHERE order_id = $1`, [number]);
  const payment = await client.query<{ status: string }>(`SELECT status FROM payments WHERE order_number = $1`, [number]);
  await publish(client, 'order', {
    number, status, payment_status: payment.rows[0]?.status ?? 'pending', version,
    lines: lines.rows.map((l) => ({ id: Number(l.id), fulfillment: l.fulfillment, shipment: l.carrier === null ? null : { carrier: l.carrier, tracking_number: l.tracking_number } })),
  }, { userId, sessionId: null, staffVisible: true });
}

staffRouter.post('/orders/:number/shipments', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations']);
  const number = req.params.number;
  const body = req.body as { version?: unknown; line_ids?: unknown; carrier?: unknown; tracking_number?: unknown };
  const lineIds = Array.isArray(body.line_ids) ? body.line_ids.map((v) => Number(v)) : [];
  const carrier = typeof body.carrier === 'string' ? body.carrier : '';
  const tracking = typeof body.tracking_number === 'string' ? body.tracking_number.trim() : '';
  const fields: Record<string, string> = {};
  if (lineIds.length === 0) fields.line_ids = 'Choose at least one line to ship.';
  if (carrier !== 'Coastline Couriers' && carrier !== 'Peak Express') fields.carrier = 'Choose a carrier.';
  if (!/^[A-Z0-9-]{6,30}$/.test(tracking)) fields.tracking_number = 'Use 6 to 30 capital letters, digits and hyphens.';
  if (Object.keys(fields).length > 0) throw Errors.validationFailed(fields);

  const result = await inTransaction(async (client) => {
    const row = await client.query<{ version: number; status: string; user_id: string; email: string }>(
      `SELECT version, status, user_id::TEXT AS user_id, email FROM orders WHERE number = $1 FOR UPDATE`, [number]);
    if (row.rows.length === 0) throw Errors.notFound();
    if (Number(body.version) !== Number(row.rows[0].version)) throw Errors.staleVersion();
    if (row.rows[0].status !== 'packed' && row.rows[0].status !== 'partially_shipped') throw Errors.invalidTransition();

    const lines = await client.query<{ id: string; fulfillment: string; quantity: number }>(
      `SELECT id::TEXT AS id, fulfillment, quantity FROM order_lines WHERE order_id = $1 ORDER BY id`, [number]);
    const byId = new Map(lines.rows.map((l) => [Number(l.id), l]));
    for (const id of lineIds) {
      if (!byId.has(id)) throw Errors.notFound();
      if (byId.get(id)!.fulfillment === 'shipped') throw Errors.invalidTransition();
    }
    const shippedSet = new Set(lineIds);
    const alreadyShipped = lines.rows.filter((l) => l.fulfillment === 'shipped' || l.fulfillment === 'out_for_delivery' || l.fulfillment === 'delivered').length;
    const newStatus = alreadyShipped + lineIds.length === lines.rows.length ? 'shipped' : 'partially_shipped';
    if (row.rows[0].status === 'partially_shipped' && newStatus === 'partially_shipped') {
      // more partial shipments stay partially_shipped
    }
    if (row.rows[0].status === 'partially_shipped' && alreadyShipped + lineIds.length < lines.rows.length && newStatus === 'shipped') {
      throw Errors.invalidTransition();
    }

    await client.query(
      `UPDATE order_lines SET fulfillment = 'shipped', carrier = $1, tracking_number = $2 WHERE id = ANY($3)`,
      [carrier, tracking, lineIds]);
    const committed = await client.query<{ sku: string; location: string; quantity: number }>(
      `SELECT l.sku, h.location, l.quantity FROM order_lines l
       JOIN hold_lines h ON h.sku = l.sku
       WHERE l.id = ANY($1)`, [lineIds]);
    await moveStock(client, 'shipped', `order/${number}`, committed.rows.map((c) => ({ sku: c.sku, location: c.location as 'bhiwandi' | 'gurugram', quantity: c.quantity })));
    const newVersion = Number(row.rows[0].version) + 1;
    if (row.rows[0].status !== newStatus) {
      await client.query(`INSERT INTO order_timeline (order_number, status, at) VALUES ($1,$2,now())`, [number, newStatus]);
    }
    await client.query(`UPDATE orders SET status = $1, version = $2 WHERE number = $3`, [newStatus, newVersion, number]);
    const shippedLines = await client.query<{ id: string; fulfillment: string }>(`SELECT id::TEXT AS id, fulfillment FROM order_lines WHERE order_id = $1`, [number]);
    await audit(client, actorFrom(session), 'shipment_created', 'order', number,
      { status: row.rows[0].status },
      { status: newStatus, lines: shippedLines.rows.map((l) => ({ id: Number(l.id), fulfillment: l.fulfillment })) });
    const subject = `Order ${number}: ${statusWord(newStatus)}`;
    const sent = await sendEmail(row.rows[0].email, subject, `Order ${number} is ${statusWord(newStatus)}.\n${carrier} ${tracking}\n\nRoam House\n`);
    await client.query(`INSERT INTO notifications (user_id, text, email_status, emailed_at) VALUES ($1,$2,$3,now())`,
      [Number(row.rows[0].user_id), subject, sent ? 'emailed' : 'pending']);
    await publish(client, 'notification', { text: subject, email_status: sent ? 'emailed' : 'pending' },
      { userId: Number(row.rows[0].user_id), sessionId: null, staffVisible: true });
    await publishOrderEvent(client, number, newStatus, newVersion, Number(row.rows[0].user_id));
    return orderBodyByNumber(number, Number(row.rows[0].user_id), client);
  });
  res.status(201).json(result);
}));

// --- case queues -------------------------------------------------------------------

const CASE_TABLES = { returns: 'return_cases', trials: 'trial_cases', warranty: 'warranty_claims' } as const;
type QueueKind = keyof typeof CASE_TABLES;

staffRouter.get('/:kind(returns|trials|warranty)', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['support']);
  const kind = req.params.kind as QueueKind;
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const table = CASE_TABLES[kind];
  const rows = await pool.query<{ number: string; user_id: string }>(
    `SELECT number, user_id::TEXT AS user_id FROM ${table} ${status !== '' ? 'WHERE status = $1' : ''} ORDER BY created_at DESC, number DESC`,
    status !== '' ? [status] : []);
  const out = [];
  for (const row of rows.rows) {
    const customer = await pool.query(`SELECT name, email FROM users WHERE id = $1`, [Number(row.user_id)]);
    const body = kind === 'returns'
      ? await returnBodyStaff(row.number)
      : kind === 'trials'
        ? await trialBodyStaff(row.number)
        : await claimBodyStaff(row.number);
    out.push({ ...body, customer: customer.rows[0] });
  }
  res.status(200).json(out);
}));

async function returnBodyStaff(number: string): Promise<Record<string, unknown>> {
  const row = await pool.query(`
    SELECT r.number, r.status, r.version, o.number AS order_number, r.order_line_id::TEXT AS order_line_id, r.quantity,
           r.reason, r.outcome, r.exchange_sku, r.exchange_order_number, r.rejection_reason, r.refund_amount
    FROM return_cases r JOIN order_lines l ON l.id = r.order_line_id JOIN orders o ON o.number = l.order_id
    WHERE r.number = $1`, [number]);
  if (row.rows.length === 0) throw Errors.notFound();
  const r = row.rows[0];
  const history = await pool.query(`SELECT status, at FROM case_history WHERE case_type = 'return' AND case_id = (SELECT id FROM return_cases WHERE number = $1) ORDER BY at, id`, [number]);
  return {
    number: r.number, status: r.status, version: Number(r.version), order_number: r.order_number,
    order_line_id: Number(r.order_line_id), quantity: r.quantity, reason: r.reason, outcome: r.outcome,
    exchange_sku: r.exchange_sku, exchange_order_number: r.exchange_order_number,
    rejection_reason: r.rejection_reason, refund_amount: r.refund_amount,
    history: history.rows.map((h) => ({ status: h.status, at: (h.at as Date).toISOString() })),
  };
}

async function trialBodyStaff(number: string): Promise<Record<string, unknown>> {
  const row = await pool.query(`
    SELECT t.number, t.status, t.version, o.number AS order_number, t.order_line_id::TEXT AS order_line_id, t.note,
           t.rejection_reason, t.refund_amount
    FROM trial_cases t JOIN order_lines l ON l.id = t.order_line_id JOIN orders o ON o.number = l.order_id
    WHERE t.number = $1`, [number]);
  if (row.rows.length === 0) throw Errors.notFound();
  const r = row.rows[0];
  const history = await pool.query(`SELECT status, at FROM case_history WHERE case_type = 'trial' AND case_id = (SELECT id FROM trial_cases WHERE number = $1) ORDER BY at, id`, [number]);
  return {
    number: r.number, status: r.status, version: Number(r.version), order_number: r.order_number,
    order_line_id: Number(r.order_line_id), note: r.note, rejection_reason: r.rejection_reason, refund_amount: r.refund_amount,
    history: history.rows.map((h) => ({ status: h.status, at: (h.at as Date).toISOString() })),
  };
}

async function claimBodyStaff(number: string): Promise<Record<string, unknown>> {
  const row = await pool.query(`
    SELECT w.number, w.status, w.version, o.number AS order_number, l.id::TEXT AS order_line_id, w.component,
           w.description, w.resolution_order_number, w.rejection_reason
    FROM warranty_claims w
    JOIN warranty_registrations g ON g.id = w.registration_id
    JOIN order_lines l ON l.id = g.order_line_id
    JOIN orders o ON o.number = l.order_id
    WHERE w.number = $1`, [number]);
  if (row.rows.length === 0) throw Errors.notFound();
  const r = row.rows[0];
  const history = await pool.query(`SELECT status, at FROM case_history WHERE case_type = 'warranty' AND case_id = (SELECT id FROM warranty_claims WHERE number = $1) ORDER BY at, id`, [number]);
  const evidence = await pool.query(`
    SELECT e.id::TEXT AS id, e.kind, e.filename, e.status FROM evidence e
    JOIN claim_evidence ce ON ce.evidence_id = e.id WHERE ce.claim_id = (SELECT id FROM warranty_claims WHERE number = $1)`, [number]);
  return {
    number: r.number, status: r.status, version: Number(r.version), order_number: r.order_number,
    order_line_id: Number(r.order_line_id), component: r.component, description: r.description,
    resolution_order_number: r.resolution_order_number, rejection_reason: r.rejection_reason,
    evidence: evidence.rows.map((e) => ({ id: Number(e.id), kind: e.kind, filename: e.filename, status: e.status })),
    history: history.rows.map((h) => ({ status: h.status, at: (h.at as Date).toISOString() })),
  };
}

staffRouter.get('/:kind(returns|trials|warranty)/:number', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['support']);
  const kind = req.params.kind as QueueKind;
  const number = req.params.number;
  const row = await pool.query<{ user_id: string }>(
    `SELECT user_id::TEXT AS user_id FROM ${CASE_TABLES[kind]} WHERE number = $1`, [number]);
  if (row.rows.length === 0) throw Errors.notFound();
  const customer = await pool.query(`SELECT name, email FROM users WHERE id = $1`, [Number(row.rows[0].user_id)]);
  const body = kind === 'returns' ? await returnBodyStaff(number) : kind === 'trials' ? await trialBodyStaff(number) : await claimBodyStaff(number);
  res.status(200).json({ ...body, customer: customer.rows[0] });
}));

staffRouter.get('/warranty/evidence/:id/content', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['support']);
  const id = Number(req.params.id);
  const row = await pool.query<{ user_id: string; kind: string; content_type: string; filename: string }>(
    `SELECT user_id::TEXT AS user_id, kind, content_type, filename FROM evidence WHERE id = $1`, [id]);
  if (row.rows.length === 0) throw Errors.notFound();
  const content = await s3.get(`evidence/${row.rows[0].user_id}/${id}`);
  if (content === null) throw Errors.notFound();
  res.setHeader('content-type', row.rows[0].content_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (row.rows[0].kind === 'receipt') res.setHeader('Content-Disposition', `attachment; filename="${row.rows[0].filename}"`);
  res.status(200).send(content);
}));

// --- case transitions -----------------------------------------------------------

const RETURN_MOVES: Record<string, string[]> = {
  requested: ['approved', 'rejected'],
  approved: ['in_transit'],
  in_transit: ['received'],
  received: ['inspected'],
  inspected: ['refunded', 'exchanged'],
};
const TRIAL_MOVES: Record<string, string[]> = {
  requested: ['approved', 'rejected'],
  approved: ['returned'],
  returned: ['refunded'],
};
const WARRANTY_MOVES: Record<string, string[]> = {
  submitted: ['under_review'],
  under_review: ['approved', 'rejected'],
  approved: ['repair', 'replacement'],
  repair: ['resolved'],
  replacement: ['resolved'],
};

staffRouter.post('/:kind(returns|trials|warranty)/:number/transition', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['support']);
  const kind = req.params.kind as QueueKind;
  const number = req.params.number;
  const body = req.body as { version?: unknown; to?: unknown; reason?: unknown };
  const to = typeof body.to === 'string' ? body.to : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const moves = kind === 'returns' ? RETURN_MOVES : kind === 'trials' ? TRIAL_MOVES : WARRANTY_MOVES;

  const result = await inTransaction(async (client) => {
    const table = CASE_TABLES[kind];
    const row = await client.query<{ id: string; status: string; version: number; user_id: string; order_line_id: string | null }>(
      kind === 'warranty'
        ? `SELECT c.id::TEXT AS id, c.status, c.version, c.user_id::TEXT AS user_id, g.order_line_id::TEXT AS order_line_id
           FROM warranty_claims c JOIN warranty_registrations g ON g.id = c.registration_id WHERE c.number = $1 FOR UPDATE OF c`
        : `SELECT id::TEXT AS id, status, version, user_id::TEXT AS user_id, order_line_id::TEXT AS order_line_id FROM ${table} WHERE number = $1 FOR UPDATE`,
      [number]);
    if (row.rows.length === 0) throw Errors.notFound();
    if (Number(body.version) !== Number(row.rows[0].version)) throw Errors.staleVersion();
    const current = row.rows[0].status;
    if (!(moves[current] ?? []).includes(to)) throw Errors.validationFailed({ to: 'Choose a status this case can move to.' });
    if ((to === 'rejected') && (reason.length < 5 || reason.length > 500)) {
      throw Errors.validationFailed({ reason: 'Give a reason of 5 to 500 characters.' });
    }

    const caseId = Number(row.rows[0].id);
    const userId = Number(row.rows[0].user_id);
    const lineId = Number(row.rows[0].order_line_id);
    const entity = kind === 'returns' ? 'return' : kind === 'trials' ? 'trial' : 'warranty_claim';
    const user = await client.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [userId]);

    const statusWordMap: Record<string, string> = {
      requested: 'Requested', approved: 'Approved', rejected: 'Rejected', in_transit: 'In transit',
      received: 'Received', inspected: 'Inspected', refunded: 'Refunded', exchanged: 'Exchanged',
      returned: 'Returned', submitted: 'Submitted', under_review: 'Under review', repair: 'Repair',
      replacement: 'Replacement', resolved: 'Resolved',
    };

    if (kind === 'returns' && to === 'received') {
      const line = await client.query<{ sku: string; quantity: number }>(`SELECT sku, quantity FROM order_lines WHERE id = $1`, [lineId]);
      const holds = await client.query<{ location: string }>(
        `SELECT h.location FROM hold_lines h WHERE h.sku = $1 LIMIT 1`, [line.rows[0].sku]);
      const caseQty = await client.query<{ quantity: number }>(`SELECT quantity FROM return_cases WHERE id = $1`, [caseId]);
      const location = holds.rows[0]?.location ?? 'bhiwandi';
      await moveStock(client, 'return_received', `return/${number}`, [
        { sku: line.rows[0].sku, location: location as 'bhiwandi' | 'gurugram', quantity: caseQty.rows[0].quantity },
      ]);
      await publishStock(client, line.rows[0].sku);
    }
    if (kind === 'trials' && to === 'returned') {
      const line = await client.query<{ sku: string }>(`SELECT sku FROM order_lines WHERE id = $1`, [lineId]);
      const holds = await client.query<{ location: string }>(`SELECT h.location FROM hold_lines h WHERE h.sku = $1 LIMIT 1`, [line.rows[0].sku]);
      const location = holds.rows[0]?.location ?? 'bhiwandi';
      await moveStock(client, 'trial_returned', `trial/${number}`, [
        { sku: line.rows[0].sku, location: location as 'bhiwandi' | 'gurugram', quantity: 1 },
      ]);
      await publishStock(client, line.rows[0].sku);
    }

    let refundAmount: number | null = null;
    let exchangeOrder: string | null = null;
    if (kind === 'returns' && to === 'refunded') {
      refundAmount = await refundLineShare(client, lineId, number);
    }
    if (kind === 'trials' && to === 'refunded') {
      refundAmount = await refundLineWhole(client, lineId, number);
    }
    if (kind === 'returns' && to === 'exchanged') {
      exchangeOrder = await createExchangeOrder(client, number, caseId, userId, session);
    }
    if (kind === 'warranty' && to === 'replacement') {
      exchangeOrder = await createReplacementOrder(client, number, caseId, userId);
    }

    if (kind === 'returns') {
      await client.query(
        `UPDATE return_cases SET status = $1, version = version + 1, updated_at = now(),
           rejection_reason = CASE WHEN $1 = 'rejected' THEN $2 ELSE rejection_reason END,
           refund_amount = CASE WHEN $1 = 'refunded' THEN $3 ELSE refund_amount END,
           exchange_order_number = CASE WHEN $1 = 'exchanged' THEN $4 ELSE exchange_order_number END
         WHERE id = $5`,
        [to, reason === '' ? null : reason, refundAmount, exchangeOrder, caseId]);
    } else if (kind === 'trials') {
      await client.query(
        `UPDATE trial_cases SET status = $1, version = version + 1, updated_at = now(),
           rejection_reason = CASE WHEN $1 = 'rejected' THEN $2 ELSE rejection_reason END,
           refund_amount = CASE WHEN $1 = 'refunded' THEN $3 ELSE refund_amount END
         WHERE id = $4`,
        [to, reason === '' ? null : reason, refundAmount, caseId]);
    } else {
      await client.query(
        `UPDATE warranty_claims SET status = $1, version = version + 1, updated_at = now(),
           rejection_reason = CASE WHEN $1 = 'rejected' THEN $2 ELSE rejection_reason END,
           resolution_order_number = CASE WHEN $1 = 'replacement' THEN $3 ELSE resolution_order_number END
         WHERE id = $4`,
        [to, reason === '' ? null : reason, exchangeOrder, caseId]);
    }

    await client.query(`INSERT INTO case_history (case_type, case_id, status) VALUES ($1,$2,$3)`,
      [entity === 'return' ? 'return' : entity === 'trial' ? 'trial' : 'warranty', caseId, to]);
    await audit(client, actorFrom(session), 'status_changed', entity as 'return', number, { status: current }, { status: to });

    const subject = kind === 'returns'
      ? `Return ${number}: ${statusWordMap[to]}`
      : kind === 'trials'
        ? `Trial return ${number}: ${statusWordMap[to]}`
        : `Warranty claim ${number}: ${statusWordMap[to]}`;
    const sent = await sendEmail(user.rows[0].email, subject, `${subject}\n${refundAmount !== null ? `Refund ₹${digitGroup(refundAmount)}\n` : ''}\nRoam House\n`);
    await client.query(`INSERT INTO notifications (user_id, text, email_status, emailed_at) VALUES ($1,$2,$3,now())`,
      [userId, subject, sent ? 'emailed' : 'pending']);
    await publish(client, 'notification', { text: subject, email_status: sent ? 'emailed' : 'pending' },
      { userId, sessionId: null, staffVisible: true });
    await publish(client, kind === 'returns' ? 'return' : kind === 'trials' ? 'trial' : 'warranty',
      { number, status: to, version: Number(row.rows[0].version) + 1 }, { userId, sessionId: null, staffVisible: true });
    await publish(client, 'queue', { kind: kind === 'returns' ? 'return' : kind === 'trials' ? 'trial' : 'warranty', number, status: to },
      { userId: null, sessionId: null, staffVisible: true });

    const fresh = await client.query<{ status: string; version: number }>(`SELECT status, version FROM ${table} WHERE id = $1`, [caseId]);
    return { number, status: fresh.rows[0].status, version: Number(fresh.rows[0].version) };
  });
  res.status(200).json(result);
}));

/** Refunds the exact paid share for the returned quantity of a line. */
async function refundLineShare(client: Client, lineId: number, number: string): Promise<number> {
  const line = await client.query<{ order_number: string; quantity: number; line_subtotal: number; line_discount: number; line_tax: number; returned_quantity: number }>(
    `SELECT l.order_id AS order_number, l.quantity, l.line_subtotal, l.line_discount, l.line_tax, l.returned_quantity
     FROM order_lines l WHERE l.id = $1`, [lineId]);
  const l = line.rows[0];
  const caseQty = await client.query<{ quantity: number }>(`SELECT quantity FROM return_cases WHERE number = $1`, [number]);
  const q = caseQty.rows[0].quantity;
  const paid = l.line_subtotal - l.line_discount + l.line_tax;
  const already = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::TEXT AS total FROM refunds WHERE order_number = $1 AND order_line_id = $2 AND kind = 'return'`,
    [l.order_number, lineId]);
  const alreadyRefunded = Number(already.rows[0].total);
  const remainingShare = paid - alreadyRefunded;
  const amount = q === l.quantity ? remainingShare : roundHalfUp((paid * q) / l.quantity);
  await applyRefund(client, l.order_number, lineId, amount, 'return');
  await client.query(`UPDATE order_lines SET returned_quantity = returned_quantity + $1 WHERE id = $2`, [q, lineId]);
  return amount;
}

async function refundLineWhole(client: Client, lineId: number, number: string): Promise<number> {
  const line = await client.query<{ order_number: string; quantity: number; line_subtotal: number; line_discount: number; line_tax: number }>(
    `SELECT l.order_id AS order_number, l.quantity, l.line_subtotal, l.line_discount, l.line_tax FROM order_lines l WHERE l.id = $1`, [lineId]);
  const l = line.rows[0];
  const paid = l.line_subtotal - l.line_discount + l.line_tax;
  await applyRefund(client, l.order_number, lineId, paid, 'trial');
  return paid;
}

async function applyRefund(client: Client, orderNumber: string, lineId: number | null, amount: number, kind: 'return' | 'trial' | 'cancellation'): Promise<void> {
  await client.query(`INSERT INTO refunds (order_number, order_line_id, amount, kind) VALUES ($1,$2,$3,$4)`, [orderNumber, lineId, amount, kind]);
  const payment = await client.query<{ amount: number; card_amount: number; refunded: number }>(
    `SELECT amount, card_amount, refunded FROM payments WHERE order_number = $1 FOR UPDATE`, [orderNumber]);
  const p = payment.rows[0];
  const totalRefunded = p.refunded + amount;
  const status = totalRefunded >= p.amount ? 'refunded' : 'partially_refunded';
  await client.query(`UPDATE payments SET refunded = $1, status = $2 WHERE order_number = $3`, [totalRefunded, status, orderNumber]);
  // The card is refunded first; anything beyond the card amount returns to the gift card.
  const toCard = Math.min(amount, Math.max(0, p.card_amount - p.refunded));
  const toGiftCard = amount - toCard;
  if (toGiftCard > 0) {
    const order = await client.query<{ gift_card_code: string | null }>(`SELECT gift_card_code FROM orders WHERE number = $1`, [orderNumber]);
    if (order.rows[0].gift_card_code !== null) {
      const code = order.rows[0].gift_card_code;
      const g1 = await client.query<{ id: string }>(
        `INSERT INTO gift_card_ledger (group_id, code, account, amount, reason, ref) VALUES (0,$1,'order',$2,'refund',$3) RETURNING id::TEXT AS id`,
        [code, toGiftCard, `order/${orderNumber}`]);
      await client.query(`UPDATE gift_card_ledger SET group_id = $1 WHERE id = $1`, [Number(g1.rows[0].id)]);
      const g2 = await client.query<{ id: string }>(
        `INSERT INTO gift_card_ledger (group_id, code, account, amount, reason, ref) VALUES (0,$1,'card',$2,'refund',$3) RETURNING id::TEXT AS id`,
        [code, -toGiftCard, `order/${orderNumber}`]);
      await client.query(`UPDATE gift_card_ledger SET group_id = $1 WHERE id = $1`, [Number(g2.rows[0].id)]);
    }
  }
}

function roundHalfUp(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value));
}

/** A zero-value exchange order, one unit per returned quantity, stock committed. */
async function createExchangeOrder(client: Client, number: string, caseId: number, userId: number, session: SessionInfo): Promise<string> {
  const caseRow = await client.query<{ exchange_sku: string | null; quantity: number }>(
    `SELECT exchange_sku, quantity FROM return_cases WHERE id = $1`, [caseId]);
  const sku = caseRow.rows[0].exchange_sku;
  if (sku === null) throw Errors.notEligible();
  const available = await availableFor(client, [sku]);
  const have = available.get(sku) ?? 0;
  const qty = caseRow.rows[0].quantity;
  if (have < qty) throw Errors.outOfStockSome(have);
  const variant = await client.query<{ product: string; colour: string; size: string }>(
    `SELECT p.name AS product, v.colour, v.size FROM variants v JOIN products p ON p.slug = v.product_slug WHERE v.sku = $1`, [sku]);
  const number2 = await nextStaffOrderNumber(client);
  const customer = await client.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [userId]);
  const address = await client.query<{ address: Record<string, unknown> }>(
    `SELECT address FROM orders WHERE user_id = $1 ORDER BY placed_at DESC LIMIT 1`, [userId]);
  await client.query(
    `INSERT INTO orders (number, user_id, status, kind, email, address, shipping_method, subtotal, discount, shipping, shipping_tax, tax, gift_card_amount, total, placed_at)
     VALUES ($1,$2,'placed','exchange',$3,$4,'standard',0,0,0,0,0,0,0,now())`,
    [number2, userId, customer.rows[0].email, JSON.stringify(address.rows[0]?.address ?? {})]).catch(async () => {
      await client.query(
        `INSERT INTO orders (number, user_id, status, kind, email, address, shipping_method, subtotal, discount, shipping, shipping_tax, tax, gift_card_amount, total, placed_at)
         VALUES ($1,$2,'placed','exchange',$3,'{}'::jsonb,'standard',0,0,0,0,0,0,0,now())`,
        [number2, userId, customer.rows[0].email]);
    });
  await client.query(
    `INSERT INTO order_lines (order_id, sku, product, colour, size, quantity, unit_price, line_subtotal, line_discount, line_tax, fulfillment)
     VALUES ($1,$2,$3,$4,$5,$6,0,0,0,0,'unfulfilled')`,
    [number2, sku, variant.rows[0].product, variant.rows[0].colour, variant.rows[0].size, qty]);
  await client.query(`INSERT INTO order_timeline (order_number, status, at) VALUES ($1,'placed',now())`, [number2]);
  await client.query(`INSERT INTO payments (order_number, status, amount, card_amount, gift_card_amount) VALUES ($1,'captured',0,0,0)`, [number2]);
  const holdLines = await client.query<{ location: string }>(`SELECT location FROM hold_lines WHERE sku = $1 LIMIT 1`, [sku]);
  const location = (holdLines.rows[0]?.location ?? 'bhiwandi') as 'bhiwandi' | 'gurugram';
  await moveStock(client, 'exchange_committed', `return/${number}`, [{ sku, location, quantity: qty }]);
  await publishStock(client, sku);
  return number2;
}

async function createReplacementOrder(client: Client, number: string, caseId: number, userId: number): Promise<string> {
  const reg = await client.query<{ order_line_id: string }>(`SELECT order_line_id::TEXT AS order_line_id FROM warranty_registrations WHERE id = (SELECT registration_id FROM warranty_claims WHERE id = $1)`, [caseId]);
  const lineId = Number(reg.rows[0].order_line_id);
  const line = await client.query<{ sku: string; product: string; colour: string; size: string; quantity: number }>(
    `SELECT sku, product, colour, size, quantity FROM order_lines WHERE id = $1`, [lineId]);
  const sku = line.rows[0].sku;
  const available = await availableFor(client, [sku]);
  if ((available.get(sku) ?? 0) <= 0) throw Errors.outOfStockGone(`${line.rows[0].product} — ${line.rows[0].colour}, ${line.rows[0].size}`);
  const number2 = await nextStaffOrderNumber(client);
  const customer = await client.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [userId]);
  await client.query(
    `INSERT INTO orders (number, user_id, status, kind, email, address, shipping_method, subtotal, discount, shipping, shipping_tax, tax, gift_card_amount, total, placed_at)
     VALUES ($1,$2,'placed','replacement',$3,'{}'::jsonb,'standard',0,0,0,0,0,0,0,now())`,
    [number2, userId, customer.rows[0].email]);
  await client.query(
    `INSERT INTO order_lines (order_id, sku, product, colour, size, quantity, unit_price, line_subtotal, line_discount, line_tax, fulfillment)
     VALUES ($1,$2,$3,$4,$5,1,0,0,0,0,'unfulfilled')`,
    [number2, sku, line.rows[0].product, line.rows[0].colour, line.rows[0].size]);
  await client.query(`INSERT INTO order_timeline (order_number, status, at) VALUES ($1,'placed',now())`, [number2]);
  await client.query(`INSERT INTO payments (order_number, status, amount, card_amount, gift_card_amount) VALUES ($1,'captured',0,0,0)`, [number2]);
  const holdLines = await client.query<{ location: string }>(`SELECT location FROM hold_lines WHERE sku = $1 LIMIT 1`, [sku]);
  const location = (holdLines.rows[0]?.location ?? 'bhiwandi') as 'bhiwandi' | 'gurugram';
  await moveStock(client, 'replacement_committed', `warranty/${number}`, [{ sku, location, quantity: 1 }]);
  await publishStock(client, sku);
  return number2;
}

async function nextStaffOrderNumber(client: Client): Promise<string> {
  const res = await client.query<{ n: string }>(
    `SELECT COALESCE(MAX(SUBSTRING(number FROM 4)::INT), 100000) + 1 AS n FROM orders WHERE number LIKE 'RH-%'`);
  return `RH-${res.rows[0].n}`;
}

// --- promotions -----------------------------------------------------------------

staffRouter.get('/discount-codes', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations']);
  const rows = await pool.query(`
    SELECT code, kind, value, collection, minimum, starts_at, ends_at, usage_limit, used FROM discount_codes ORDER BY code`);
  res.status(200).json(rows.rows.map((r) => ({
    code: r.code, kind: r.kind, value: r.value, collection: r.collection, minimum: r.minimum,
    starts_at: (r.starts_at as Date).toISOString(), ends_at: (r.ends_at as Date).toISOString(),
    usage_limit: r.usage_limit, used: r.used,
  })));
}));

staffRouter.post('/discount-codes', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations']);
  const body = req.body as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{3,20}$/.test(code)) fields.code = 'Use 3 to 20 capital letters and digits.';
  const kind = body.kind === 'percent' || body.kind === 'fixed' ? String(body.kind) : '';
  if (kind === '') fields.kind = 'Choose percentage or fixed amount.';
  const value = Number(body.value);
  if (kind === 'percent' && (!Number.isInteger(value) || value < 1 || value > 90)) fields.value = 'Enter a percentage from 1 to 90 or a fixed amount from ₹1 to ₹9,99,999.';
  if (kind === 'fixed' && (!Number.isInteger(value) || value < 1 || value > 999999)) fields.value = 'Enter a percentage from 1 to 90 or a fixed amount from ₹1 to ₹9,99,999.';
  const collection = body.collection === null ? null : typeof body.collection === 'string' ? String(body.collection) : '';
  if (collection !== null && !['luggage','backpacks','totes','wallets','accessories'].includes(collection)) {
    fields.collection = 'Choose a collection or every line.';
  }
  const minimum = body.minimum === undefined || body.minimum === null ? 0 : Number(body.minimum);
  if (!Number.isInteger(minimum) || minimum < 0) fields.minimum = 'Enter a minimum spend of ₹0 or more.';
  const startsRaw = typeof body.starts_at === 'string' ? body.starts_at : '';
  const endsRaw = typeof body.ends_at === 'string' ? body.ends_at : '';
  const startsAt = new Date(startsRaw);
  const endsAt = new Date(endsRaw);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    fields.starts_at = 'Enter a date and time.';
    fields.ends_at = 'Enter a date and time.';
  }
  const usageLimit = body.usage_limit === undefined || body.usage_limit === null || body.usage_limit === '' ? null : Number(body.usage_limit);
  if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1)) fields.usage_limit = 'Enter a usage limit of 1 or more, or leave it empty.';
  if (Object.keys(fields).length === 0 && endsAt <= startsAt) fields.ends_at = 'End after the start.';
  if (Object.keys(fields).length > 0) throw Errors.validationFailed(fields);

  await inTransaction(async (client) => {
    const existing = await client.query(`SELECT code FROM discount_codes WHERE UPPER(code) = $1`, [code]);
    if (existing.rows.length > 0) {
      throw Errors.validationFailed({ code: 'That code already exists.' });
    }
    await client.query(
      `INSERT INTO discount_codes (code, kind, value, collection, minimum, starts_at, ends_at, usage_limit, used)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0)`,
      [code, kind, value, collection, minimum, startsAt, endsAt, usageLimit]);
    await audit(client, actorFrom(session), 'created', 'discount_code', code, null, {
      code, kind, value, collection, minimum, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), usage_limit: usageLimit,
    });
  });
  const row = await pool.query(`SELECT code, kind, value, collection, minimum, starts_at, ends_at, usage_limit, used FROM discount_codes WHERE code = $1`, [code]);
  const r = row.rows[0];
  res.status(201).json({
    code: r.code, kind: r.kind, value: r.value, collection: r.collection, minimum: r.minimum,
    starts_at: (r.starts_at as Date).toISOString(), ends_at: (r.ends_at as Date).toISOString(),
    usage_limit: r.usage_limit, used: r.used,
  });
}));

// --- gift cards -----------------------------------------------------------------

staffRouter.get('/gift-cards/:code', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations']);
  const code = req.params.code.toUpperCase();
  const card = await pool.query(`SELECT code FROM gift_cards WHERE code = $1`, [code]);
  if (card.rows.length === 0) throw Errors.notFound();
  const entries = await pool.query<{ group_id: string; account: string; amount: number; reason: string; ref: string; at: Date }>(
    `SELECT group_id::TEXT AS group_id, account, amount, reason, ref, at FROM gift_card_ledger WHERE code = $1 ORDER BY at, id`, [code]);
  const balance = entries.rows.reduce((sum, e) => sum + e.amount, 0);
  res.status(200).json({
    code, balance,
    entries: entries.rows.map((e) => ({
      group_id: Number(e.group_id), account: e.account, amount: e.amount, reason: e.reason, ref: e.ref, at: e.at.toISOString(),
    })),
  });
}));

// --- audit ------------------------------------------------------------------------

staffRouter.get('/audit', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations', 'support']);
  const entity = typeof req.query.entity === 'string' ? req.query.entity : '';
  const entityId = typeof req.query.entity_id === 'string' ? req.query.entity_id : '';
  const params: unknown[] = [];
  let where = 'TRUE';
  if (entity !== '') {
    params.push(entity);
    where += ` AND entity = $${params.length}`;
  }
  if (entityId !== '') {
    params.push(entityId);
    where += ` AND entity_id = $${params.length}`;
  }
  const rows = await pool.query<{ id: string; actor_name: string; actor_role: string; action: string; entity: string; entity_id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; at: Date }>(
    `SELECT id::TEXT AS id, actor_name, actor_role, action, entity, entity_id, before, after, at
     FROM audit_entries WHERE ${where} ORDER BY at DESC, id DESC LIMIT 200`, params);
  res.status(200).json(rows.rows.map((r) => ({
    id: Number(r.id),
    actor: { id: 0, name: r.actor_name, role: r.actor_role },
    action: r.action, entity: r.entity, entity_id: r.entity_id,
    before: r.before, after: r.after, at: r.at.toISOString(),
  })));
}));

// --- metrics -----------------------------------------------------------------------

function istDayBounds(from: string, to: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(`${to}T23:59:59.999+05:30`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (start > end) return null;
  return { start, end };
}

staffRouter.get('/metrics', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations']);
  const from = String(req.query.from ?? '');
  const to = String(req.query.to ?? '');
  const bounds = istDayBounds(from, to);
  if (bounds === null) {
    throw Errors.validationFailed({ from: 'Enter a date as YYYY-MM-DD, with From on or before To.', to: 'Enter a date as YYYY-MM-DD, with From on or before To.' });
  }
  const orders = await pool.query<{ count: string; gross: string; units: string }>(`
    SELECT COUNT(*)::TEXT AS count, COALESCE(SUM(total), 0)::TEXT AS gross,
           COALESCE((SELECT SUM(l.quantity) FROM order_lines l JOIN orders o2 ON o2.number = l.order_id
                     WHERE o2.placed_at BETWEEN $1 AND $2 AND o2.kind = 'order'), 0)::TEXT AS units
    FROM orders o WHERE o.placed_at BETWEEN $1 AND $2 AND o.kind = 'order'`, [bounds.start, bounds.end]);
  const refunds = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(r.amount), 0)::TEXT AS total FROM refunds r WHERE r.at BETWEEN $1 AND $2`, [bounds.start, bounds.end]);
  const count = Number(orders.rows[0].count);
  const gross = Number(orders.rows[0].gross);
  const refundTotal = Number(refunds.rows[0].total);
  const units = Number(orders.rows[0].units);
  res.status(200).json({
    orders: count,
    gross_sales: gross,
    refunds: refundTotal,
    net_sales: gross - refundTotal,
    units_sold: units,
    average_order_value: count === 0 ? 0 : Math.round((gross + count / 2) / count),
  });
}));

// --- CSV reports ---------------------------------------------------------------------

staffRouter.get('/reports/orders.csv', h(async (req, res) => {
  const session = (req as unknown as { session: SessionInfo }).session;
  requireStaff(session, ['operations']);
  const from = String(req.query.from ?? '');
  const to = String(req.query.to ?? '');
  const bounds = istDayBounds(from, to);
  if (bounds === null) {
    throw Errors.validationFailed({ from: 'Enter a date as YYYY-MM-DD, with From on or before To.', to: 'Enter a date as YYYY-MM-DD, with From on or before To.' });
  }
  const rows = await pool.query(`
    SELECT o.number, o.placed_at, u.email, o.status, p.status AS payment_status,
           o.subtotal, o.discount, o.shipping, o.tax + o.shipping_tax AS tax, o.gift_card_amount, o.total, p.refunded
    FROM orders o JOIN users u ON u.id = o.user_id JOIN payments p ON p.order_number = o.number
    WHERE o.placed_at BETWEEN $1 AND $2 AND o.kind = 'order'
    ORDER BY o.placed_at ASC`, [bounds.start, bounds.end]);
  const lines = ['order_number,placed_at,customer_email,status,payment_status,subtotal,discount,shipping,tax,gift_card,total,refunded'];
  for (const r of rows.rows) {
    lines.push([r.number, (r.placed_at as Date).toISOString(), r.email, r.status, r.payment_status,
      String(r.subtotal), String(r.discount), String(r.shipping), String(r.tax), String(r.gift_card_amount), String(r.total), String(r.refunded)]
      .map(csvField).join(','));
  }
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.status(200).send(lines.join('\n') + '\n');
}));

staffRouter.get('/reports/inventory.csv', async (_req, res) => {
  const rows = await pool.query(`
    SELECT v.sku, p.name AS product, v.colour, v.size, e.location,
      COALESCE(SUM(e.quantity) FILTER (WHERE e.account = 'available'), 0)::INT AS available,
      COALESCE(SUM(e.quantity) FILTER (WHERE e.account = 'reserved'), 0)::INT AS reserved,
      COALESCE(SUM(e.quantity) FILTER (WHERE e.account = 'committed'), 0)::INT AS committed
    FROM variants v
    JOIN products p ON p.slug = v.product_slug
    LEFT JOIN stock_entries e ON e.sku = v.sku
    GROUP BY v.sku, p.name, v.colour, v.size, e.location ORDER BY v.sku, e.location`);
  const lines = ['sku,product,colour,size,location,available,reserved,committed,on_hand'];
  for (const r of rows.rows) {
    const onHand = r.available + r.reserved;
    lines.push([r.sku, r.product, r.colour, r.size, r.location ?? 'bhiwandi', String(r.available), String(r.reserved), String(r.committed), String(onHand)].map(csvField).join(','));
  }
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.status(200).send(lines.join('\n') + '\n');
});

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
