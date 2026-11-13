import { db, tx } from '../db/pool';
import { Ctx } from '../http/context';
import { redirect, sendHtml } from '../http/respond';
import { route } from '../http/router';
import { ensureCart, loadCart } from '../domain/cart';
import { errorPage, shellFor } from './layout';
import {
  adminAudit,
  adminCase,
  adminDashboard,
  adminGiftCards,
  adminInventory,
  adminOrder,
  adminOrders,
  adminProduct,
  adminProducts,
  adminPromotions,
  adminQueue,
  adminReports
} from './admin';
import {
  carePage,
  collectionPage,
  comparePage,
  homePage,
  productPage,
  registerPage,
  signInPage,
  wishlistPage
} from './storefront';
import { accountPage, bagPage, checkoutPage, orderPage } from './shopping';
import { randomUUID } from 'node:crypto';

function notFoundHtml(ctx: Ctx): void {
  sendHtml(ctx, 404, errorPage(ctx, 'notFound'));
}

function requireStaffPage(ctx: Ctx, roles: string[]): boolean {
  if (ctx.user === null) {
    redirect(ctx, '/sign-in');
    return false;
  }
  if (!roles.includes(ctx.user.role)) {
    sendHtml(ctx, 403, errorPage(ctx, 'staff'));
    return false;
  }
  return true;
}

export function registerViewRoutes(): void {
  route('GET', '/', 'page', async (ctx) => {
    sendHtml(ctx, 200, await homePage(ctx, await shellFor(ctx)));
  });

  route('GET', '/collections/:slug', 'page', async (ctx) => {
    const html = await collectionPage(ctx, await shellFor(ctx), ctx.params.slug);
    if (html === null) notFoundHtml(ctx);
    else sendHtml(ctx, 200, html);
  });

  route('GET', '/products/:slug', 'page', async (ctx) => {
    const html = await productPage(ctx, await shellFor(ctx), ctx.params.slug);
    if (html === null) notFoundHtml(ctx);
    else sendHtml(ctx, 200, html);
  });

  route('GET', '/compare', 'page', async (ctx) => {
    sendHtml(ctx, 200, await comparePage(ctx, await shellFor(ctx)));
  });

  route('GET', '/wishlist', 'page', async (ctx) => {
    sendHtml(ctx, 200, await wishlistPage(ctx, await shellFor(ctx)));
  });

  route('GET', '/care', 'page', async (ctx) => {
    sendHtml(ctx, 200, carePage(ctx, await shellFor(ctx)));
  });

  route('GET', '/sign-in', 'page', async (ctx) => {
    sendHtml(ctx, 200, signInPage(ctx, await shellFor(ctx)));
  });

  route('GET', '/register', 'page', async (ctx) => {
    sendHtml(ctx, 200, registerPage(ctx, await shellFor(ctx)));
  });

  route('GET', '/bag', 'page', async (ctx) => {
    sendHtml(ctx, 200, await bagPage(ctx, await shellFor(ctx)));
  });

  route('GET', '/bag/checkout', 'page', async (ctx) => {
    if (ctx.user === null) {
      redirect(ctx, '/sign-in?next=/bag/checkout');
      return;
    }
    const user = ctx.user;
    const checkoutId = await tx(async (client) => {
      const cart = await loadCart(client, { sessionId: ctx.sessionId, userId: user.id });
      if (cart.lines.length === 0) return null;
      const cartRow = await ensureCart(client, { sessionId: ctx.sessionId, userId: user.id });
      const lineRows = await client.query<{ variant_id: string; sku: string; quantity: number }>(
        `SELECT cl.variant_id, v.sku, cl.quantity FROM cart_lines cl
         JOIN variants v ON v.id = cl.variant_id WHERE cl.cart_id = $1
         ORDER BY cl.created_at ASC, cl.id ASC`,
        [cartRow.id]
      );
      const id = randomUUID();
      await client.query(
        `INSERT INTO checkouts (id, user_id, email, shipping_method, discount_code, gift_card_code, lines)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          id,
          user.id,
          user.email,
          cartRow.shipping_method,
          cartRow.discount_code,
          cartRow.gift_card_code,
          JSON.stringify(
            lineRows.map((row) => ({
              sku: row.sku,
              variant_id: row.variant_id,
              quantity: row.quantity,
              price: null,
              location: null
            }))
          )
        ]
      );
      return id;
    });
    if (checkoutId === null) redirect(ctx, '/bag');
    else redirect(ctx, `/checkout/${checkoutId}`);
  });

  route('GET', '/checkout/:id', 'page', async (ctx) => {
    const html = await checkoutPage(ctx, await shellFor(ctx), ctx.params.id);
    if (html === null) notFoundHtml(ctx);
    else sendHtml(ctx, 200, html);
  });

  route('GET', '/orders/:number', 'page', async (ctx) => {
    const html = await orderPage(ctx, await shellFor(ctx), ctx.params.number);
    if (html === null) notFoundHtml(ctx);
    else sendHtml(ctx, 200, html);
  });

  route('GET', '/account', 'page', async (ctx) => {
    const html = await accountPage(ctx, await shellFor(ctx));
    if (html === null) redirect(ctx, '/sign-in');
    else sendHtml(ctx, 200, html);
  });

  route('GET', '/admin', 'page', async (ctx) => {
    if (!requireStaffPage(ctx, ['operations', 'support'])) return;
    if (ctx.user!.role === 'support') {
      redirect(ctx, '/admin/returns');
      return;
    }
    sendHtml(ctx, 200, await adminDashboard(ctx, await shellFor(ctx)));
  });

  route('GET', '/admin/products', 'page', async (ctx) => {
    if (!requireStaffPage(ctx, ['operations'])) return;
    sendHtml(ctx, 200, await adminProducts(ctx, await shellFor(ctx)));
  });

  route('GET', '/admin/products/:slug', 'page', async (ctx) => {
    if (!requireStaffPage(ctx, ['operations'])) return;
    const html = await adminProduct(ctx, await shellFor(ctx), ctx.params.slug);
    if (html === null) notFoundHtml(ctx);
    else sendHtml(ctx, 200, html);
  });

  route('GET', '/admin/inventory', 'page', async (ctx) => {
    if (!requireStaffPage(ctx, ['operations'])) return;
    sendHtml(ctx, 200, await adminInventory(ctx, await shellFor(ctx)));
  });

  route('GET', '/admin/inventory/:sku', 'page', async (ctx) => {
    if (!requireStaffPage(ctx, ['operations'])) return;
    const variant = await db.one<{ sku: string }>('SELECT sku FROM variants WHERE sku = $1', [ctx.params.sku]);
    if (variant === null) {
      notFoundHtml(ctx);
      return;
    }
    sendHtml(ctx, 200, await adminInventory(ctx, await shellFor(ctx), ctx.params.sku));
  });

  route('GET', '/admin/orders', 'page', async (ctx) => {
    if (!requireStaffPage(ctx, ['operations', 'support'])) return;
    sendHtml(ctx, 200, await adminOrders(ctx, await shellFor(ctx)));
  });

  route('GET', '/admin/orders/:number', 'page', async (ctx) => {
    if (!requireStaffPage(ctx, ['operations', 'support'])) return;
    const html = await adminOrder(ctx, await shellFor(ctx), ctx.params.number);
    if (html === null) notFoundHtml(ctx);
    else sendHtml(ctx, 200, html);
  });

  for (const kind of ['returns', 'trials', 'warranty'] as const) {
    route('GET', `/admin/${kind}`, 'page', async (ctx) => {
      if (!requireStaffPage(ctx, ['support'])) return;
      sendHtml(ctx, 200, await adminQueue(ctx, await shellFor(ctx), kind));
    });

    route('GET', `/admin/${kind}/:number`, 'page', async (ctx) => {
      if (!requireStaffPage(ctx, ['support'])) return;
      const html = await adminCase(ctx, await shellFor(ctx), kind, ctx.params.number);
      if (html === null) notFoundHtml(ctx);
      else sendHtml(ctx, 200, html);
    });
  }

  route('GET', '/admin/promotions', 'page', async (ctx) => {
    if (!requireStaffPage(ctx, ['operations'])) return;
    sendHtml(ctx, 200, await adminPromotions(ctx, await shellFor(ctx)));
  });

  route('GET', '/admin/gift-cards', 'page', async (ctx) => {
    if (!requireStaffPage(ctx, ['operations'])) return;
    sendHtml(ctx, 200, adminGiftCards(ctx, await shellFor(ctx)));
  });

  route('GET', '/admin/audit', 'page', async (ctx) => {
    if (!requireStaffPage(ctx, ['operations', 'support'])) return;
    sendHtml(ctx, 200, await adminAudit(ctx, await shellFor(ctx)));
  });

  route('GET', '/admin/reports', 'page', async (ctx) => {
    if (!requireStaffPage(ctx, ['operations'])) return;
    sendHtml(ctx, 200, adminReports(ctx, await shellFor(ctx)));
  });
}
