import type { Hono } from "hono";
import { one, query, transaction } from "../db.js";
import { ApiError, FIELD, notFound, validationFailed } from "../errors.js";
import { noContent, ok, route, type Reply, type Request } from "../http.js";
import { publicId, secretToken } from "../id.js";
import { config } from "../config.js";
import { imageUrl, loadProduct, rankedOffers, unitPrice, type ListingRow } from "../services/catalogue.js";
import { Body } from "../validate.js";

type ShareKind = "wishlist" | "cart";

interface ItemRow {
  id: string;
  listing: ListingRow;
  title: string;
  brand: string;
  category: string;
  product_id: string;
}

function accountId(req: Request): string {
  return (req.actor as NonNullable<Request["actor"]>).accountId;
}

async function wishlistRows(account: string): Promise<ItemRow[]> {
  return query<ItemRow & Record<string, unknown>>(
    `SELECT w.id, to_jsonb(l) AS listing, p.title, p.brand, p.category, p.id AS product_id
       FROM wishlist_items w JOIN listings l ON l.id = w.listing_id JOIN products p ON p.id = w.product_id
      WHERE w.account_id = $1 ORDER BY w.seq`,
    [account],
  );
}

function wishlistItem(row: ItemRow, nowMs: number): Record<string, unknown> {
  return {
    item_id: row.id,
    product_id: row.product_id,
    listing_id: row.listing.id,
    title: row.title,
    brand: row.brand,
    category: row.category,
    image_url: imageUrl(row.product_id, row.category),
    price_paise: unitPrice(row.listing, nowMs),
  };
}

async function addToWishlist(req: Request): Promise<Reply> {
  const account = accountId(req);
  const body = new Body(req.json(), ["product_id", "listing_id"]);
  const productId = body.text("product_id", { label: "Product", min: 1, max: 80 });
  const listingId = body.text("listing_id", { label: "Listing", max: 40, optional: true });
  body.done();
  if (productId === undefined) throw validationFailed({});
  const product = await loadProduct(productId);
  let chosen = listingId;
  if (chosen === undefined) chosen = (await rankedOffers(product.id, null, req.nowMs)).find((offer) => offer.featured)?.listing_id;
  else if (!(await one("SELECT 1 FROM listings WHERE id = $1 AND product_id = $2", [chosen, product.id]))) {
    throw validationFailed({ listing_id: FIELD.listingNotOfProduct });
  }
  if (chosen === undefined) throw notFound();
  const held = await one<{ n: number }>("SELECT count(*)::int AS n FROM wishlist_items WHERE account_id = $1", [account]);
  const existing = await one<{ id: string }>("SELECT id FROM wishlist_items WHERE account_id = $1 AND product_id = $2", [account, product.id]);
  if (!existing && (held?.n ?? 0) >= 100) throw validationFailed({ product_id: FIELD.wishlistFull });
  const id = existing?.id ?? publicId("WI");
  if (existing) await query("UPDATE wishlist_items SET listing_id = $2 WHERE id = $1", [id, chosen]);
  else await query("INSERT INTO wishlist_items (id, account_id, product_id, listing_id) VALUES ($1, $2, $3, $4)", [id, account, product.id, chosen]);
  const row = (await wishlistRows(account)).find((item) => item.id === id) as ItemRow;
  return ok(wishlistItem(row, req.nowMs), existing ? 200 : 201);
}

async function createShare(req: Request, kind: ShareKind, regenerate: boolean): Promise<Reply> {
  const account = accountId(req);
  const body = new Body(req.json(), ["display_name"]);
  const name = body.text("display_name", { label: "Name to show", min: 1, max: 40 });
  body.done();
  if (name === undefined) throw validationFailed({});
  // One link per owner and kind: concurrent requests queue on the owner's lock, so only the first creates it.
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`share:${account}:${kind}`]);
    const live = await one<{ token: string; display_name: string; expires_at: number }>(
      "SELECT token, display_name, expires_at FROM shares WHERE owner_id = $1 AND kind = $2 AND active AND expires_at > $3",
      [account, kind, req.nowMs],
      client,
    );
    if (live && !regenerate) return ok(shareBody(live.token, live.display_name, live.expires_at), 200);
    await query("UPDATE shares SET active = false WHERE owner_id = $1 AND kind = $2", [account, kind], client);
    const token = secretToken(18);
    const expiresAt = req.nowMs + config.seconds.shareTtl * 1000;
    await query(
      "INSERT INTO shares (id, owner_id, kind, token, display_name, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [publicId("SH"), account, kind, token, name, expiresAt],
      client,
    );
    return ok(shareBody(token, name, expiresAt), 201);
  });
}

function shareBody(token: string, name: string, expiresAt: number): Record<string, unknown> {
  return { token, url: `/s/${token}`, display_name: name, expires_at: new Date(expiresAt).toISOString() };
}

async function readShared(req: Request): Promise<Reply> {
  if (req.method !== "GET") throw new ApiError(405, "read_only");
  const share = await one<{ owner_id: string; kind: ShareKind; display_name: string }>(
    "SELECT owner_id, kind, display_name FROM shares WHERE token = $1 AND active AND expires_at > $2",
    [req.params.token, req.nowMs],
  );
  if (!share) throw new ApiError(404, "link_not_found");
  const rows =
    share.kind === "wishlist"
      ? await wishlistRows(share.owner_id)
      : await query<ItemRow & Record<string, unknown>>(
          `SELECT cl.id, to_jsonb(l) AS listing, p.title, p.brand, p.category, p.id AS product_id
             FROM cart_lines cl JOIN listings l ON l.id = cl.listing_id JOIN products p ON p.id = l.product_id
            WHERE cl.account_id = $1 AND NOT cl.saved ORDER BY cl.seq`,
          [share.owner_id],
        );
  return {
    status: 200,
    exact: true,
    json: {
      kind: share.kind,
      display_name: share.display_name,
      items: rows.map((row) => ({
        product_id: row.product_id,
        listing_id: row.listing.id,
        title: row.title,
        image_url: imageUrl(row.product_id, row.category),
        price_paise: unitPrice(row.listing, req.nowMs),
      })),
    },
  };
}

export function registerSharing(app: Hono): void {
  const shopper = { access: ["shopper"] } as const;
  route(app, ["GET"], "/api/wishlist", shopper, async (req) =>
    ok({ items: (await wishlistRows(accountId(req))).map((row) => wishlistItem(row, req.nowMs)) }),
  );
  route(app, ["POST"], "/api/wishlist", shopper, addToWishlist);
  for (const kind of ["wishlist", "cart"] as const) {
    route(app, ["POST"], `/api/${kind}/share`, shopper, (req) => createShare(req, kind, false));
    route(app, ["POST"], `/api/${kind}/share/regenerate`, shopper, (req) => createShare(req, kind, true));
    route(app, ["DELETE"], `/api/${kind}/share`, shopper, async (req) => {
      await query("UPDATE shares SET active = false WHERE owner_id = $1 AND kind = $2", [accountId(req), kind]);
      return noContent();
    });
  }
  route(app, ["DELETE"], "/api/wishlist/:id", shopper, async (req) => {
    const removed = await query("DELETE FROM wishlist_items WHERE id = $1 AND account_id = $2 RETURNING id", [req.params.id, accountId(req)]);
    if (removed.length === 0) throw notFound();
    return noContent();
  });
  route(app, ["GET", "POST", "PUT", "PATCH", "DELETE"], "/api/shared/:token", { access: "public", rate: { bucket: "shared", limit: 30 } }, readShared);
}
