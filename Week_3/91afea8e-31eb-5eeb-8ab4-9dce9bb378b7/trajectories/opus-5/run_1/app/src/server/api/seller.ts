/** The seller console: listings, stock, photos, fulfilment, returns and the settlement statement. */

import { one, query } from '../db.js';
import { newId } from '../domain/identity.js';
import { indiaDate } from '../domain/time.js';
import { returnMoveAllowed, shipmentMoveAllowed } from '../domain/transitions.js';
import { ApiError, invalidTransition, notFound, validationFailed } from '../http/errors.js';
import { empty, json, pdf, route, type Ctx } from '../http/router.js';
import { Validator } from '../http/validate.js';
import { readLabel } from '../documents.js';
import {
  createRefund,
  lineRefundAmount,
  postReturnSettlement,
  postSaleSettlement,
  recordCodCollection,
  shipmentPaymentStatus,
} from '../payments.js';
import { objectKeys, putObject } from '../services/storage.js';
import { decodeCursor, encodeCursor } from '../searchQuery.js';
import { sellerShipmentView, returnView } from '../views.js';
import { FIELD } from '../../shared/messages.js';
import type { ShipmentState } from '../../shared/types.js';

const MAX_LIVE_LISTINGS = 200;
const PHOTO_BYTE_LIMIT = 2_000_000;
const CERTIFICATE_BYTE_LIMIT = 5_000_000;
const MAX_PHOTOS = 6;

const UNSETTABLE_LISTING_FIELDS = ['commission_percent', 'featured', 'seller_id', 'rating'];

async function sellerOf(ctx: Ctx): Promise<string> {
  const row = await one<{ id: string }>(`SELECT id FROM sellers WHERE account_id = $1`, [
    ctx.account?.accountId,
  ]);
  if (row === null) throw notFound();
  return row.id;
}

type ListingView = {
  listing_id: string;
  product_id: string;
  title: string;
  brand: string;
  category: string;
  price_paise: number;
  cost_price_paise: number;
  stock: number;
  status: 'live' | 'unlisted';
  photo_count: number;
  cod_allowed: boolean;
  no_cost_emi: boolean;
  description: string;
  return_note: string;
  deal: { price_paise: number; ends_at: string } | null;
  photos: { photo_id: string; url: string }[];
};

async function listingView(listingId: string): Promise<ListingView | null> {
  const row = await one<{
    listing_id: string;
    product_id: string;
    title: string;
    brand: string;
    category: string;
    price_paise: number;
    cost_price_paise: number;
    stock: number;
    status: 'live' | 'unlisted';
    photo_count: number;
    cod_allowed: boolean;
    no_cost_emi: boolean;
    description: string;
    return_note: string;
    deal_price_paise: number | null;
    deal_ends_at: string | null;
  }>(
    `SELECT l.id AS listing_id, l.product_id, p.title, p.brand, p.category_slug AS category,
            l.price_paise, l.cost_price_paise, l.stock, l.status,
            (SELECT count(*)::int FROM listing_photos ph WHERE ph.listing_id = l.id) AS photo_count,
            l.cod_allowed, l.no_cost_emi, l.description, l.return_note,
            l.deal_price_paise, l.deal_ends_at
       FROM listings l JOIN products p ON p.id = l.product_id WHERE l.id = $1`,
    [listingId],
  );
  if (row === null) return null;
  const photos = await query<{ photo_id: string; ext: string }>(
    `SELECT photo_id, ext FROM listing_photos WHERE listing_id = $1 ORDER BY created_seq`,
    [listingId],
  );
  return {
    listing_id: row.listing_id,
    product_id: row.product_id,
    title: row.title,
    brand: row.brand,
    category: row.category,
    price_paise: row.price_paise,
    cost_price_paise: row.cost_price_paise,
    stock: row.stock,
    status: row.status,
    photo_count: row.photo_count,
    cod_allowed: row.cod_allowed,
    no_cost_emi: row.no_cost_emi,
    description: row.description,
    return_note: row.return_note,
    deal:
      row.deal_price_paise === null || row.deal_ends_at === null
        ? null
        : {
            price_paise: row.deal_price_paise,
            ends_at: new Date(row.deal_ends_at).toISOString(),
          },
    photos: photos.map((photo) => ({
      photo_id: photo.photo_id,
      url: `/photos/${listingId}/${photo.photo_id}.${photo.ext}`,
    })),
  };
}

async function ownListing(sellerId: string, listingId: string): Promise<{ id: string; product_id: string; status: string }> {
  const row = await one<{ id: string; product_id: string; status: string }>(
    `SELECT id, product_id, status FROM listings WHERE id = $1 AND seller_id = $2`,
    [listingId, sellerId],
  );
  if (row === null) throw notFound();
  return row;
}

async function liveListingCount(sellerId: string): Promise<number> {
  const row = await one<{ count: number }>(
    `SELECT count(*)::int AS count FROM listings WHERE seller_id = $1 AND status = 'live'`,
    [sellerId],
  );
  return row === null ? 0 : row.count;
}

function fileKind(bytes: Buffer): 'jpg' | 'png' | 'webp' | 'pdf' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  return null;
}

const CONTENT_TYPES: Record<'jpg' | 'png' | 'webp' | 'pdf', string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

function readListingFields(validator: Validator): {
  description?: string;
  price_paise?: number;
  cost_price_paise?: number;
  stock?: number;
  cod_allowed?: boolean;
  no_cost_emi?: boolean;
  return_note?: string;
} {
  const out: Record<string, unknown> = {};
  if (validator.has('description')) {
    out.description = validator.text('description', { label: 'Description', min: 0, max: 2000 });
  }
  if (validator.has('return_note')) {
    out.return_note = validator.text('return_note', { label: 'Return note', min: 0, max: 500 });
  }
  if (validator.has('price_paise')) {
    out.price_paise = validator.integer('price_paise', { min: 1, max: 100_000_000 });
  }
  if (validator.has('cost_price_paise')) {
    out.cost_price_paise = validator.integer('cost_price_paise', { min: 0, max: 100_000_000 });
  }
  if (validator.has('stock')) {
    out.stock = validator.integer('stock', { min: 0, max: 9_999 });
  }
  if (validator.has('cod_allowed')) out.cod_allowed = validator.boolean('cod_allowed', true);
  if (validator.has('no_cost_emi')) out.no_cost_emi = validator.boolean('no_cost_emi', false);
  return out as ReturnType<typeof readListingFields>;
}

export function registerSellerRoutes(): void {
  route('GET', '/api/seller/listings', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    const limitRaw = ctx.query.get('limit');
    let limit = 24;
    if (limitRaw !== null && limitRaw !== '') {
      const parsed = Number(limitRaw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 24) {
        throw validationFailed({ limit: FIELD.badSearchLimit });
      }
      limit = parsed;
    }
    const search = ctx.query.get('q') ?? '';
    const category = ctx.query.get('category');
    const status = ctx.query.get('status');
    const cursor = decodeCursor(ctx.query.get('cursor'));
    const rows = await query<{
      listing_id: string;
      product_id: string;
      title: string;
      category: string;
      price_paise: number;
      cost_price_paise: number;
      stock: number;
      status: 'live' | 'unlisted';
      photo_count: number;
      cod_allowed: boolean;
      no_cost_emi: boolean;
      created_seq: number;
    }>(
      `SELECT l.id AS listing_id, l.product_id, p.title, p.category_slug AS category, l.price_paise,
              l.cost_price_paise, l.stock, l.status,
              (SELECT count(*)::int FROM listing_photos ph WHERE ph.listing_id = l.id) AS photo_count,
              l.cod_allowed, l.no_cost_emi, l.created_seq
         FROM listings l JOIN products p ON p.id = l.product_id
        WHERE l.seller_id = $1
          AND ($2 = '' OR p.title ILIKE '%' || $2 || '%')
          AND ($3::text IS NULL OR p.category_slug = $3)
          AND ($4::text IS NULL OR l.status = $4)
          AND ($5::bigint IS NULL OR l.created_seq < $5::bigint)
        ORDER BY l.created_seq DESC
        LIMIT $6`,
      [sellerId, search, category, status, cursor?.s ?? null, limit + 1],
    );
    const facets = await query<{ category: string; count: number }>(
      `SELECT p.category_slug AS category, count(*)::int AS count
         FROM listings l JOIN products p ON p.id = l.product_id
        WHERE l.seller_id = $1
          AND ($2 = '' OR p.title ILIKE '%' || $2 || '%')
          AND ($3::text IS NULL OR l.status = $3)
        GROUP BY p.category_slug`,
      [sellerId, search, status],
    );
    const page = rows.slice(0, limit);
    return json({
      listings: page.map((row) => ({
        listing_id: row.listing_id,
        product_id: row.product_id,
        title: row.title,
        category: row.category,
        price_paise: row.price_paise,
        cost_price_paise: row.cost_price_paise,
        stock: row.stock,
        status: row.status,
        photo_count: row.photo_count,
        cod_allowed: row.cod_allowed,
        no_cost_emi: row.no_cost_emi,
      })),
      facets: {
        category: Object.fromEntries(facets.map((row) => [row.category, row.count])),
      },
      next_cursor:
        rows.length > limit && page.length > 0
          ? encodeCursor({ s: page[page.length - 1].created_seq })
          : null,
    });
  });

  route('GET', '/api/seller/listings/:listingId', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    await ownListing(sellerId, ctx.params.listingId);
    const view = await listingView(ctx.params.listingId);
    if (view === null) throw notFound();
    return json(view);
  });

  route('POST', '/api/seller/listings', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    const validator = new Validator(ctx.body, [
      'product_id',
      'title',
      'brand',
      'category',
      'description',
      'price_paise',
      'cost_price_paise',
      'stock',
      'cod_allowed',
      'no_cost_emi',
      'return_note',
    ]);
    for (const field of UNSETTABLE_LISTING_FIELDS) {
      if (ctx.body[field] !== undefined) validator.fail(field, FIELD.unsettable);
    }
    const fields = readListingFields(validator);
    let productId = typeof ctx.body.product_id === 'string' ? ctx.body.product_id : null;
    let title = '';
    let brand = '';
    let category = '';
    if (productId === null) {
      title = validator.text('title', { label: 'Title', min: 3, max: 120 });
      brand = validator.text('brand', { label: 'Title', min: 1, max: 60 });
      category = typeof ctx.body.category === 'string' ? ctx.body.category : '';
      const known = await one<{ slug: string }>(`SELECT slug FROM categories WHERE slug = $1`, [
        category,
      ]);
      if (known === null) validator.fail('category', FIELD.unsettable);
    }
    validator.done();

    if (await liveListingCount(sellerId) >= MAX_LIVE_LISTINGS) {
      throw new ApiError(409, 'listing_quota');
    }
    if (productId === null) {
      productId = newId('P-');
      await query(
        `INSERT INTO products (id, title, brand, category_slug, rating, description, specs)
         VALUES ($1, $2, $3, $4, 0, $5, '{}'::jsonb)`,
        [productId, title, brand, category, fields.description ?? ''],
      );
    } else {
      const product = await one<{ id: string }>(`SELECT id FROM products WHERE id = $1`, [productId]);
      if (product === null) throw notFound();
    }
    const listingId = newId('L-');
    await query(
      `INSERT INTO listings (id, product_id, seller_id, price_paise, cost_price_paise, stock, status,
                             cod_allowed, no_cost_emi, description, return_note)
       VALUES ($1, $2, $3, $4, $5, $6, 'live', $7, $8, $9, $10)`,
      [
        listingId,
        productId,
        sellerId,
        fields.price_paise ?? 0,
        fields.cost_price_paise ?? 0,
        fields.stock ?? 0,
        fields.cod_allowed ?? true,
        fields.no_cost_emi ?? false,
        fields.description ?? '',
        fields.return_note ?? '',
      ],
    );
    const view = await listingView(listingId);
    if (view === null) throw notFound();
    return json(view, 201);
  });

  route('PATCH', '/api/seller/listings/:listingId', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    const listing = await ownListing(sellerId, ctx.params.listingId);
    const validator = new Validator(ctx.body, [
      'title',
      'brand',
      'category',
      'description',
      'price_paise',
      'cost_price_paise',
      'stock',
      'cod_allowed',
      'no_cost_emi',
      'return_note',
      'status',
    ]);
    for (const field of [...UNSETTABLE_LISTING_FIELDS, 'product_id']) {
      if (ctx.body[field] !== undefined) validator.fail(field, FIELD.unsettable);
    }
    const fields = readListingFields(validator);
    const title = validator.has('title')
      ? validator.text('title', { label: 'Title', min: 3, max: 120 })
      : null;
    const brand = validator.has('brand')
      ? validator.text('brand', { label: 'Title', min: 1, max: 60 })
      : null;
    let category: string | null = null;
    if (validator.has('category')) {
      category = typeof ctx.body.category === 'string' ? ctx.body.category : '';
      const known = await one<{ slug: string }>(`SELECT slug FROM categories WHERE slug = $1`, [
        category,
      ]);
      if (known === null) validator.fail('category', FIELD.unsettable);
    }
    const status = validator.has('status') ? ctx.body.status : null;
    if (status !== null && status !== 'live' && status !== 'unlisted') {
      validator.fail('status', FIELD.unsettable);
    }
    validator.done();

    if (status === 'live' && listing.status !== 'live') {
      if ((await liveListingCount(sellerId)) >= MAX_LIVE_LISTINGS) {
        throw new ApiError(409, 'listing_quota');
      }
    }
    if (title !== null || brand !== null || category !== null) {
      await query(
        `UPDATE products SET title = COALESCE($2, title), brand = COALESCE($3, brand),
                category_slug = COALESCE($4, category_slug)
          WHERE id = $1`,
        [listing.product_id, title, brand, category],
      );
    }
    await query(
      `UPDATE listings SET
         description = COALESCE($2, description),
         return_note = COALESCE($3, return_note),
         price_paise = COALESCE($4, price_paise),
         cost_price_paise = COALESCE($5, cost_price_paise),
         stock = COALESCE($6, stock),
         cod_allowed = COALESCE($7, cod_allowed),
         no_cost_emi = COALESCE($8, no_cost_emi),
         status = COALESCE($9, status),
         updated_at = now()
       WHERE id = $1`,
      [
        listing.id,
        fields.description ?? null,
        fields.return_note ?? null,
        fields.price_paise ?? null,
        fields.cost_price_paise ?? null,
        fields.stock ?? null,
        fields.cod_allowed ?? null,
        fields.no_cost_emi ?? null,
        status,
      ],
    );
    const view = await listingView(listing.id);
    if (view === null) throw notFound();
    return json(view);
  });

  route('PUT', '/api/seller/listings/:listingId/stock', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    const listing = await ownListing(sellerId, ctx.params.listingId);
    const validator = new Validator(ctx.body, ['stock']);
    const stock = validator.integer('stock', { min: 0, max: 9_999 });
    validator.done();
    await query(`UPDATE listings SET stock = $2, updated_at = now() WHERE id = $1`, [
      listing.id,
      stock,
    ]);
    const view = await listingView(listing.id);
    if (view === null) throw notFound();
    return json(view);
  });

  route('PUT', '/api/seller/listings/:listingId/deal', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    const listing = await ownListing(sellerId, ctx.params.listingId);
    const validator = new Validator(ctx.body, ['deal_price_paise', 'ends_at']);
    const dealPrice = validator.integer('deal_price_paise', { min: 1, max: 100_000_000 });
    const endsAt = typeof ctx.body.ends_at === 'string' ? ctx.body.ends_at : '';
    const endsAtTime = Date.parse(endsAt);
    if (!Number.isFinite(endsAtTime) || endsAtTime <= Date.now()) {
      validator.fail('ends_at', FIELD.unsettable);
    }
    const current = await one<{ price_paise: number }>(
      `SELECT price_paise FROM listings WHERE id = $1`,
      [listing.id],
    );
    if (current !== null && dealPrice >= current.price_paise) {
      validator.fail('deal_price_paise', FIELD.unsettable);
    }
    validator.done();
    await query(
      `UPDATE listings SET deal_price_paise = $2, deal_ends_at = $3, updated_at = now() WHERE id = $1`,
      [listing.id, dealPrice, new Date(endsAtTime).toISOString()],
    );
    const view = await listingView(listing.id);
    if (view === null) throw notFound();
    return json(view);
  });

  route('DELETE', '/api/seller/listings/:listingId/deal', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    const listing = await ownListing(sellerId, ctx.params.listingId);
    await query(
      `UPDATE listings SET deal_price_paise = NULL, deal_ends_at = NULL, updated_at = now()
        WHERE id = $1`,
      [listing.id],
    );
    return empty(204);
  });

  route(
    'POST',
    '/api/seller/listings/:listingId/photos',
    'seller',
    async (ctx) => {
      const sellerId = await sellerOf(ctx);
      const listing = await ownListing(sellerId, ctx.params.listingId);
      const file = ctx.file;
      if (file === null) throw validationFailed({ file: FIELD.unsettable });
      if (file.bytes.length > PHOTO_BYTE_LIMIT) {
        throw new ApiError(413, 'file_too_large', { kind: 'photo' });
      }
      const kind = fileKind(file.bytes);
      if (kind === null || kind === 'pdf') {
        throw new ApiError(415, 'unsupported_type', { kind: 'photo' });
      }
      const count = await one<{ count: number }>(
        `SELECT count(*)::int AS count FROM listing_photos WHERE listing_id = $1`,
        [listing.id],
      );
      if ((count?.count ?? 0) >= MAX_PHOTOS) throw new ApiError(409, 'photo_limit');
      const photoId = newId('PH-');
      const stored = await putObject(
        objectKeys.photo(listing.id, photoId, kind),
        file.bytes,
        CONTENT_TYPES[kind],
      );
      if (!stored) throw new ApiError(503, 'storage_unavailable');
      await query(`INSERT INTO listing_photos (photo_id, listing_id, ext) VALUES ($1, $2, $3)`, [
        photoId,
        listing.id,
        kind,
      ]);
      return json(
        {
          photo_id: photoId,
          url: `/photos/${listing.id}/${photoId}.${kind}`,
        },
        201,
      );
    },
    { upload: true },
  );

  route('DELETE', '/api/seller/listings/:listingId/photos/:photoId', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    const listing = await ownListing(sellerId, ctx.params.listingId);
    const rows = await query<{ photo_id: string }>(
      `DELETE FROM listing_photos WHERE photo_id = $1 AND listing_id = $2 RETURNING photo_id`,
      [ctx.params.photoId, listing.id],
    );
    if (rows.length === 0) throw notFound();
    return empty(204);
  });

  route(
    'POST',
    '/api/seller/gst-certificate',
    'seller',
    async (ctx) => {
      const sellerId = await sellerOf(ctx);
      const file = ctx.file;
      if (file === null) throw validationFailed({ file: FIELD.unsettable });
      if (file.bytes.length > CERTIFICATE_BYTE_LIMIT) {
        throw new ApiError(413, 'file_too_large', { kind: 'certificate' });
      }
      const kind = fileKind(file.bytes);
      if (kind === null || kind === 'webp') {
        throw new ApiError(415, 'unsupported_type', { kind: 'certificate' });
      }
      const stored = await putObject(
        objectKeys.gstCertificate(sellerId, kind),
        file.bytes,
        CONTENT_TYPES[kind],
      );
      if (!stored) throw new ApiError(503, 'storage_unavailable');
      await query(
        `INSERT INTO seller_documents (seller_id, ext) VALUES ($1, $2)
         ON CONFLICT (seller_id) DO UPDATE SET ext = $2, stored_at = now()`,
        [sellerId, kind],
      );
      return json({ status: 'stored' }, 201);
    },
    { upload: true },
  );

  route('GET', '/api/seller/low-stock', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    const listings = await query(
      `SELECT l.id AS listing_id, p.title, l.stock
         FROM listings l JOIN products p ON p.id = l.product_id
        WHERE l.seller_id = $1 AND l.stock BETWEEN 1 AND 5
        ORDER BY l.stock, l.created_seq`,
      [sellerId],
    );
    return json({ listings });
  });

  route('GET', '/api/seller/commission-rates', 'seller', async () => {
    const rates = await query(
      `SELECT slug AS category, commission_percent FROM categories ORDER BY sort_order`,
    );
    return json({ rates });
  });

  route('GET', '/api/seller/shipments', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    const limitRaw = ctx.query.get('limit');
    let limit = 24;
    if (limitRaw !== null && limitRaw !== '') {
      const parsed = Number(limitRaw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 24) {
        throw validationFailed({ limit: FIELD.badSearchLimit });
      }
      limit = parsed;
    }
    const state = ctx.query.get('state');
    const cursor = decodeCursor(ctx.query.get('cursor'));
    const rows = await query<{ id: string; created_seq: number }>(
      `SELECT id, created_seq FROM shipments
        WHERE seller_id = $1 AND ($2::text IS NULL OR state = $2)
          AND ($3::bigint IS NULL OR created_seq < $3::bigint)
        ORDER BY created_seq DESC LIMIT $4`,
      [sellerId, state, cursor?.s ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    const shipments = [];
    for (const row of page) {
      const view = await sellerShipmentView(row.id);
      if (view !== null) shipments.push(view);
    }
    return json({
      shipments,
      next_cursor:
        rows.length > limit && page.length > 0
          ? encodeCursor({ s: page[page.length - 1].created_seq })
          : null,
    });
  });

  const move = (
    action: 'pack' | 'ship' | 'deliver',
    to: ShipmentState,
  ): void => {
    route(
      'POST',
      `/api/seller/shipments/:shipmentId/${action}`,
      'seller',
      async (ctx) => {
        const sellerId = await sellerOf(ctx);
        const shipment = await one<{
          id: string;
          state: ShipmentState;
          label_stored: boolean;
          payment_kind: 'prepaid' | 'cod';
        }>(
          `SELECT id, state, label_stored, payment_kind FROM shipments
            WHERE id = $1 AND seller_id = $2`,
          [ctx.params.shipmentId, sellerId],
        );
        if (shipment === null) throw notFound();
        if (!shipmentMoveAllowed(shipment.state, to, 'seller')) {
          throw invalidTransition(shipment.state, to);
        }
        if (to === 'packed' && shipment.payment_kind === 'prepaid') {
          const status = await shipmentPaymentStatus(shipment.id);
          if (status === 'pending') {
            throw invalidTransition(shipment.state, to, 'payment_pending');
          }
        }
        if (to === 'shipped' && !shipment.label_stored) {
          throw invalidTransition(shipment.state, to, 'label_pending');
        }
        await query(
          `UPDATE shipments SET state = $2, delivered_on = CASE WHEN $2 = 'delivered'
             THEN $3::date ELSE delivered_on END WHERE id = $1`,
          [shipment.id, to, indiaDate()],
        );
        await query(`INSERT INTO shipment_timeline (shipment_id, state) VALUES ($1, $2)`, [
          shipment.id,
          to,
        ]);
        if (to === 'delivered') {
          if (shipment.payment_kind === 'cod') await recordCodCollection(shipment.id);
          await postSaleSettlement(shipment.id);
        }
        const view = await sellerShipmentView(shipment.id);
        if (view === null) throw notFound();
        return json(view);
      },
      { exactKeys: true },
    );
  };
  move('pack', 'packed');
  move('ship', 'shipped');
  move('deliver', 'delivered');

  route('GET', '/api/seller/shipments/:shipmentId/label', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    const shipment = await one<{ id: string; order_id: string; label_stored: boolean }>(
      `SELECT id, order_id, label_stored FROM shipments WHERE id = $1 AND seller_id = $2`,
      [ctx.params.shipmentId, sellerId],
    );
    if (shipment === null) throw notFound();
    if (!shipment.label_stored) throw new ApiError(409, 'document_pending');
    const bytes = await readLabel(shipment.order_id, shipment.id);
    if (bytes === null) throw new ApiError(409, 'document_pending');
    return pdf(bytes, `LABEL-${shipment.id}.pdf`);
  });

  route('GET', '/api/seller/returns', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    const rows = await query<{ id: string }>(
      `SELECT id FROM returns WHERE seller_id = $1 ORDER BY created_at DESC`,
      [sellerId],
    );
    const returns = [];
    for (const row of rows) {
      const view = await returnView(row.id);
      if (view !== null) returns.push(view);
    }
    return json({ returns });
  });

  route('POST', '/api/seller/returns/:returnId/pickup', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    const row = await one<{
      id: string;
      state: 'requested' | 'picked' | 'declined' | 'refunded';
      quantity: number;
      shipment_id: string;
      shipment_line_id: string;
      order_id: string;
    }>(
      `SELECT r.id, r.state, r.quantity, r.shipment_id, r.shipment_line_id, s.order_id
         FROM returns r JOIN shipments s ON s.id = r.shipment_id
        WHERE r.id = $1 AND r.seller_id = $2`,
      [ctx.params.returnId, sellerId],
    );
    if (row === null) throw notFound();
    if (!returnMoveAllowed(row.state, 'picked')) throw invalidTransition(row.state, 'picked');
    const amount = await lineRefundAmount(row.shipment_line_id, row.quantity);
    const refund = await createRefund({
      orderId: row.order_id,
      shipmentId: row.shipment_id,
      shipmentLineId: row.shipment_line_id,
      quantity: row.quantity,
      amountPaise: amount,
      kind: 'return',
      reason: 'Return picked up',
    });
    await query(`UPDATE returns SET state = 'picked', refund_id = $2 WHERE id = $1`, [
      row.id,
      refund.refundId,
    ]);
    await postReturnSettlement({
      shipmentId: row.shipment_id,
      lineId: row.shipment_line_id,
      quantity: row.quantity,
      refundId: refund.refundId,
    });
    const view = await returnView(row.id);
    if (view === null) throw notFound();
    return json(view);
  });

  route('POST', '/api/seller/returns/:returnId/decline', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    const validator = new Validator(ctx.body, ['reason']);
    const reason = validator.text('reason', { label: 'Reason', min: 10, max: 500 });
    validator.done();
    const row = await one<{ id: string; state: 'requested' | 'picked' | 'declined' | 'refunded' }>(
      `SELECT id, state FROM returns WHERE id = $1 AND seller_id = $2`,
      [ctx.params.returnId, sellerId],
    );
    if (row === null) throw notFound();
    if (!returnMoveAllowed(row.state, 'declined')) throw invalidTransition(row.state, 'declined');
    await query(`UPDATE returns SET state = 'declined', decline_reason = $2 WHERE id = $1`, [
      row.id,
      reason,
    ]);
    const view = await returnView(row.id);
    if (view === null) throw notFound();
    return json(view);
  });

  route('GET', '/api/seller/settlements', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    const from = ctx.query.get('from');
    const to = ctx.query.get('to');
    const rows = await query<{
      settlement_line_id: string;
      shipment_id: string;
      line_id: string;
      kind: 'sale' | 'return';
      posted_on: string;
      gross_paise: number;
      commission_percent: number;
      commission_paise: number;
      commission_gst_paise: number;
      tcs_paise: number;
      tds_paise: number;
      emi_subvention_paise: number;
      net_paise: number;
    }>(
      `SELECT id AS settlement_line_id, shipment_id, line_id, kind, posted_on::text AS posted_on,
              gross_paise, commission_percent, commission_paise, commission_gst_paise, tcs_paise,
              tds_paise, emi_subvention_paise, net_paise
         FROM settlement_lines
        WHERE seller_id = $1
          AND ($2::date IS NULL OR posted_on >= $2::date)
          AND ($3::date IS NULL OR posted_on <= $3::date)
        ORDER BY posted_on, created_seq`,
      [sellerId, from === '' ? null : from, to === '' ? null : to],
    );
    const lines = [];
    for (const row of rows) {
      const status = await shipmentPaymentStatus(row.shipment_id);
      lines.push({
        ...row,
        status: status === 'pending' ? ('payment_pending' as const) : ('payment_confirmed' as const),
      });
    }
    const totals = lines.reduce(
      (sum, line) => ({
        gross_paise: sum.gross_paise + line.gross_paise,
        commission_paise: sum.commission_paise + line.commission_paise,
        commission_gst_paise: sum.commission_gst_paise + line.commission_gst_paise,
        tcs_paise: sum.tcs_paise + line.tcs_paise,
        tds_paise: sum.tds_paise + line.tds_paise,
        emi_subvention_paise: sum.emi_subvention_paise + line.emi_subvention_paise,
        net_paise: sum.net_paise + line.net_paise,
      }),
      {
        gross_paise: 0,
        commission_paise: 0,
        commission_gst_paise: 0,
        tcs_paise: 0,
        tds_paise: 0,
        emi_subvention_paise: 0,
        net_paise: 0,
      },
    );
    return json({ lines, totals });
  });

  route('PUT', '/api/seller/payout-account', 'seller', async (ctx) => {
    const sellerId = await sellerOf(ctx);
    const validator = new Validator(ctx.body, ['account_holder', 'ifsc', 'account_number']);
    const holder = validator.text('account_holder', { label: 'Name', min: 1, max: 60 });
    const ifsc = typeof ctx.body.ifsc === 'string' ? ctx.body.ifsc.toUpperCase() : '';
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) validator.fail('ifsc', FIELD.unsettable);
    const accountNumber =
      typeof ctx.body.account_number === 'string' ? ctx.body.account_number.trim() : '';
    if (!/^[0-9]{9,18}$/.test(accountNumber)) {
      validator.fail('account_number', FIELD.unsettable);
    }
    validator.done();
    await query(
      `INSERT INTO payout_accounts (seller_id, account_holder, ifsc, account_number)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (seller_id) DO UPDATE SET account_holder = $2, ifsc = $3, account_number = $4`,
      [sellerId, holder, ifsc, accountNumber],
    );
    return json({
      account_holder: holder,
      ifsc,
      account_number_masked: `${'*'.repeat(Math.max(accountNumber.length - 4, 0))}${accountNumber.slice(-4)}`,
    });
  });
}
