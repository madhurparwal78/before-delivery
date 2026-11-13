/** Wishlist items and the read-only share links for a wishlist or a cart. */

import { config } from '../config.js';
import { one, query } from '../db.js';
import { newId, newToken } from '../domain/identity.js';
import { markFeatured, rankOffers } from '../domain/offers.js';
import { standardDeliveryFee } from '../domain/money.js';
import { ApiError, notFound, validationFailed } from '../http/errors.js';
import { empty, json, route, type Ctx, type Reply } from '../http/router.js';
import { Validator } from '../http/validate.js';
import {
  effectivePrice,
  getListing,
  getListingsForProduct,
  productImageUrl,
} from '../repo.js';
import { FIELD } from '../../shared/messages.js';
import type { SharedPage } from '../../shared/types.js';

const MAX_WISHLIST_ITEMS = 100;

function accountOf(ctx: Ctx): string {
  return ctx.account?.accountId ?? '';
}

/** The listing a wishlist item stores when the shopper did not name one. */
async function featuredListingFor(productId: string): Promise<string | null> {
  const listings = await getListingsForProduct(productId);
  if (listings.length === 0) return null;
  const now = new Date();
  const offers = markFeatured(
    rankOffers(
      listings.map((listing) => {
        const price = effectivePrice(listing, now);
        return {
          listing_id: listing.listing_id,
          seller_id: listing.seller_id,
          seller_name: listing.seller_name,
          seller_rating: listing.seller_rating,
          price_paise: price,
          delivery_fee_paise: standardDeliveryFee(price),
          landed_paise: price + standardDeliveryFee(price),
          promise_date: null,
          cod_available: listing.cod_allowed && listing.seller_cod_allowed,
          in_stock: listing.stock > 0,
          featured: false,
        };
      }),
    ),
  );
  const featured = offers.find((offer) => offer.featured) ?? offers[0];
  return featured.listing_id;
}

type WishlistRow = {
  item_id: string;
  product_id: string;
  listing_id: string;
  title: string;
  image_url: string;
  price_paise: number;
};

async function wishlistItems(accountId: string): Promise<WishlistRow[]> {
  const rows = await query<{
    item_id: string;
    product_id: string;
    listing_id: string;
    title: string;
    price_paise: number;
    deal_price_paise: number | null;
    deal_ends_at: string | null;
  }>(
    `SELECT w.item_id, w.product_id, w.listing_id, p.title, l.price_paise, l.deal_price_paise, l.deal_ends_at
       FROM wishlist_items w
       JOIN listings l ON l.id = w.listing_id
       JOIN products p ON p.id = w.product_id
      WHERE w.account_id = $1
      ORDER BY w.created_seq`,
    [accountId],
  );
  const now = Date.now();
  return rows.map((row) => ({
    item_id: row.item_id,
    product_id: row.product_id,
    listing_id: row.listing_id,
    title: row.title,
    image_url: productImageUrl(row.product_id),
    price_paise:
      row.deal_price_paise !== null &&
      row.deal_ends_at !== null &&
      new Date(row.deal_ends_at).getTime() > now
        ? row.deal_price_paise
        : row.price_paise,
  }));
}

async function cartShareItems(accountId: string): Promise<SharedPage['items']> {
  const rows = await query<{
    product_id: string;
    listing_id: string;
    title: string;
    price_paise: number;
    deal_price_paise: number | null;
    deal_ends_at: string | null;
  }>(
    `SELECT l.product_id, l.id AS listing_id, p.title, l.price_paise, l.deal_price_paise, l.deal_ends_at
       FROM cart_lines cl
       JOIN listings l ON l.id = cl.listing_id
       JOIN products p ON p.id = l.product_id
      WHERE cl.account_id = $1 AND cl.state = 'cart'
      ORDER BY cl.created_seq`,
    [accountId],
  );
  const now = Date.now();
  return rows.map((row) => ({
    product_id: row.product_id,
    listing_id: row.listing_id,
    title: row.title,
    image_url: productImageUrl(row.product_id),
    price_paise:
      row.deal_price_paise !== null &&
      row.deal_ends_at !== null &&
      new Date(row.deal_ends_at).getTime() > now
        ? row.deal_price_paise
        : row.price_paise,
  }));
}

async function shareReply(
  ctx: Ctx,
  kind: 'wishlist' | 'cart',
  regenerate: boolean,
): Promise<Reply> {
  const validator = new Validator(ctx.body, ['display_name']);
  const displayName = validator.text('display_name', {
    label: 'Name to show',
    min: 1,
    max: 40,
  });
  validator.done();
  const accountId = accountOf(ctx);
  const existing = await one<{ token: string; display_name: string; expires_at: string }>(
    `SELECT token, display_name, expires_at::text FROM share_links WHERE account_id = $1 AND kind = $2`,
    [accountId, kind],
  );
  if (existing !== null && !regenerate) {
    return json({
      token: existing.token,
      url: `/s/${existing.token}`,
      display_name: existing.display_name,
      expires_at: new Date(existing.expires_at).toISOString(),
    });
  }
  await query(`DELETE FROM share_links WHERE account_id = $1 AND kind = $2`, [accountId, kind]);
  const token = newToken(24);
  const row = await one<{ expires_at: string }>(
    `INSERT INTO share_links (token, account_id, kind, display_name, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)
     RETURNING expires_at::text`,
    [token, accountId, kind, displayName, String(config.shareTtlSeconds)],
  );
  return json(
    {
      token,
      url: `/s/${token}`,
      display_name: displayName,
      expires_at: new Date(row?.expires_at ?? Date.now()).toISOString(),
    },
    201,
  );
}

export function registerWishlistRoutes(): void {
  route('GET', '/api/wishlist', 'shopper', async (ctx) =>
    json({ items: await wishlistItems(accountOf(ctx)) }),
  );

  route('POST', '/api/wishlist', 'shopper', async (ctx) => {
    const validator = new Validator(ctx.body, ['product_id', 'listing_id']);
    const productId = typeof ctx.body.product_id === 'string' ? ctx.body.product_id : '';
    const listingIdRaw = ctx.body.listing_id;
    validator.done();
    const accountId = accountOf(ctx);
    const product = await one<{ id: string }>(`SELECT id FROM products WHERE id = $1`, [productId]);
    if (product === null) throw notFound();
    let listingId: string | null = null;
    if (typeof listingIdRaw === 'string' && listingIdRaw !== '') {
      const listing = await getListing(listingIdRaw);
      if (listing === null) throw notFound();
      if (listing.product_id !== productId) {
        throw validationFailed({ listing_id: FIELD.unsettable });
      }
      listingId = listing.listing_id;
    } else {
      listingId = await featuredListingFor(productId);
    }
    if (listingId === null) throw notFound();
    const count = await one<{ count: number }>(
      `SELECT count(*)::int AS count FROM wishlist_items WHERE account_id = $1`,
      [accountId],
    );
    const already = await one<{ item_id: string }>(
      `SELECT item_id FROM wishlist_items WHERE account_id = $1 AND product_id = $2 AND listing_id = $3`,
      [accountId, productId, listingId],
    );
    if (already === null) {
      if ((count?.count ?? 0) >= MAX_WISHLIST_ITEMS) {
        throw validationFailed({ product_id: FIELD.cartLineLimit });
      }
      await query(
        `INSERT INTO wishlist_items (item_id, account_id, product_id, listing_id) VALUES ($1, $2, $3, $4)`,
        [newId('WL-'), accountId, productId, listingId],
      );
    }
    return json({ items: await wishlistItems(accountId) }, 201);
  });

  route('DELETE', '/api/wishlist/:itemId', 'shopper', async (ctx) => {
    const rows = await query<{ item_id: string }>(
      `DELETE FROM wishlist_items WHERE item_id = $1 AND account_id = $2 RETURNING item_id`,
      [ctx.params.itemId, accountOf(ctx)],
    );
    if (rows.length === 0) throw notFound();
    return json({ items: await wishlistItems(accountOf(ctx)) });
  });

  route('POST', '/api/wishlist/share', 'shopper', async (ctx) => shareReply(ctx, 'wishlist', false));
  route('POST', '/api/cart/share', 'shopper', async (ctx) => shareReply(ctx, 'cart', false));
  route('POST', '/api/wishlist/share/regenerate', 'shopper', async (ctx) =>
    shareReply(ctx, 'wishlist', true),
  );
  route('POST', '/api/cart/share/regenerate', 'shopper', async (ctx) =>
    shareReply(ctx, 'cart', true),
  );

  route('DELETE', '/api/wishlist/share', 'shopper', async (ctx) => {
    await query(`DELETE FROM share_links WHERE account_id = $1 AND kind = 'wishlist'`, [
      accountOf(ctx),
    ]);
    return empty(204);
  });

  route('DELETE', '/api/cart/share', 'shopper', async (ctx) => {
    await query(`DELETE FROM share_links WHERE account_id = $1 AND kind = 'cart'`, [accountOf(ctx)]);
    return empty(204);
  });

  route(
    'GET',
    '/api/shared/:token',
    'public',
    async (ctx) => {
      const link = await one<{ account_id: string; kind: 'wishlist' | 'cart'; display_name: string }>(
        `SELECT account_id, kind, display_name FROM share_links
          WHERE token = $1 AND expires_at > now()`,
        [ctx.params.token],
      );
      if (link === null) throw new ApiError(404, 'link_not_found');
      const items =
        link.kind === 'wishlist'
          ? (await wishlistItems(link.account_id)).map((item) => ({
              product_id: item.product_id,
              listing_id: item.listing_id,
              title: item.title,
              image_url: item.image_url,
              price_paise: item.price_paise,
            }))
          : await cartShareItems(link.account_id);
      const page: SharedPage = {
        kind: link.kind,
        display_name: link.display_name,
        items,
      };
      return json(page);
    },
    { rate: 'shared', exactKeys: true },
  );
}
