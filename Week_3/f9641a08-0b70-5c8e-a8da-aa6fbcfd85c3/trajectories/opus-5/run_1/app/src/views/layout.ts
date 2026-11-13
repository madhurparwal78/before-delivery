import { publicConfig } from '../config';
import { db } from '../db/pool';
import { Ctx, SessionUser } from '../http/context';
import { loadCart } from '../domain/cart';
import { loadWishlist } from '../api/accounts';

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function attr(value: unknown): string {
  return escapeHtml(value);
}

export type Shell = {
  ctx: Ctx;
  user: SessionUser | null;
  cartCount: number;
  wishlistCount: number;
};

export async function shellFor(ctx: Ctx): Promise<Shell> {
  const owner = { sessionId: ctx.sessionId, userId: ctx.user?.id ?? null };
  const [cart, wishlist] = await Promise.all([loadCart(db, owner), loadWishlist(db, owner)]);
  return { ctx, user: ctx.user, cartCount: cart.count, wishlistCount: wishlist.count };
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function itemsLabel(count: number): string {
  return `${count} ${plural(count, 'item', 'items')}`;
}

function header(shell: Shell, options: { showBagDrawer: boolean }): string {
  const wishlistName = `Wishlist, ${itemsLabel(shell.wishlistCount)}`;
  const bagName = `Bag, ${itemsLabel(shell.cartCount)}`;
  return `
<header class="masthead-bar">
  <a class="wordmark" href="/" aria-label="Roam House home">Roam House</a>
  <nav class="tab" aria-label="Sections">
    <a href="/collections/all">Collections</a>
    <a href="/compare">Compare</a>
    <a href="/care">Care</a>
  </nav>
  <button type="button" class="menu-button" data-menu-open aria-label="Menu" aria-haspopup="dialog">Menu</button>
  <div class="search-shell">
    <label class="visually-hidden" for="search-products">Search products</label>
    <input id="search-products" type="text" role="combobox" aria-label="Search products" aria-expanded="false"
           aria-controls="search-suggestions" aria-autocomplete="list" autocomplete="off"
           placeholder="Search products" value="${attr(shell.ctx.query.get('q') ?? '')}" data-search-input>
    <ul id="search-suggestions" role="listbox" aria-label="Suggestions" class="suggestions" hidden></ul>
  </div>
  <div class="header-links">
    <a href="/wishlist" data-wishlist-link aria-label="${attr(wishlistName)}">${escapeHtml(wishlistName)}</a>
    ${
      shell.user === null
        ? '<a href="/sign-in">Sign in</a>'
        : '<a href="/account">Account</a>'
    }
    <button type="button" data-bag-open aria-label="${attr(bagName)}" ${
      options.showBagDrawer ? 'aria-haspopup="dialog"' : ''
    }>${escapeHtml(bagName)}</button>
  </div>
</header>
<div class="live-regions">
  <div role="status" aria-live="polite" aria-label="Cart updates" data-region="cart-updates"></div>
  <div role="status" aria-live="polite" aria-label="Connection" data-region="connection"></div>
</div>
<div class="toast-shell" data-toast hidden data-motion-ms="200"></div>
<dialog class="sheet menu-sheet" aria-label="Menu" data-dialog="menu" data-motion-ms="320" data-state="closed">
  <nav aria-label="Menu links">
    <a href="/collections/all">Collections</a>
    <a href="/compare">Compare</a>
    <a href="/care">Care</a>
    <a href="/wishlist">Wishlist</a>
    ${shell.user === null ? '<a href="/sign-in">Sign in</a>' : '<a href="/account">Account</a>'}
  </nav>
  <button type="button" data-dialog-close="menu">Close menu</button>
</dialog>`;
}

export function bagDrawer(): string {
  return `
<dialog class="sheet bag-sheet" aria-label="Your bag" data-dialog="bag" data-motion-ms="320" data-state="closed">
  <h2>Your bag</h2>
  <div data-bag-lines></div>
  <div data-bag-undo></div>
  <form data-code-form novalidate>
    <label for="bag-code">Discount or gift card code</label>
    <input id="bag-code" type="text" aria-label="Discount or gift card code" data-code-input
           aria-describedby="bag-code-error">
    <p class="field-error" id="bag-code-error" data-code-error></p>
    <button type="submit" data-code-apply>Apply</button>
  </form>
  <div data-code-applied></div>
  <div role="region" aria-label="Bag totals" data-bag-totals data-motion-ms="180"></div>
  <a href="/bag" data-check-out>Check out</a>
  <button type="button" data-dialog-close="bag">Close bag</button>
</dialog>`;
}

export type PageOptions = {
  title: string;
  page: string;
  content: string;
  showBagDrawer?: boolean;
  bodyData?: Record<string, string>;
};

export function renderPage(shell: Shell, options: PageOptions): string {
  const showBagDrawer = options.showBagDrawer !== false;
  const dataAttributes = Object.entries(options.bodyData ?? {})
    .map(([key, value]) => `data-${key}="${attr(value)}"`)
    .join(' ');
  return `<!DOCTYPE html>
<html lang="en" data-motion="full">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)} · Roam House</title>
<link rel="stylesheet" href="/assets/styles.css">
<script type="application/json" id="app-config">${JSON.stringify(publicConfig())}</script>
<script type="application/json" id="app-session">${JSON.stringify({
    signed_in: shell.user !== null,
    role: shell.user?.role ?? null
  })}</script>
</head>
<body data-page="${attr(options.page)}" ${dataAttributes}>
${header(shell, { showBagDrawer })}
<main id="main">
${options.content}
</main>
${showBagDrawer ? bagDrawer() : ''}
<script type="module" src="/assets/client/main.js"></script>
</body>
</html>`;
}

const ERROR_COPY: Record<string, { heading: string; status: number }> = {
  notFound: { heading: "We couldn't find that page.", status: 404 },
  server: { heading: 'Something went wrong on our side. Try again.', status: 500 },
  staff: { heading: 'This area is for Roam House staff.', status: 403 }
};

export function errorPage(ctx: Ctx, kind: 'notFound' | 'server' | 'staff'): string {
  const copy = ERROR_COPY[kind];
  const shell: Shell = { ctx, user: ctx.user, cartCount: 0, wishlistCount: 0 };
  return renderPage(shell, {
    title: copy.heading,
    page: 'error',
    content: `<section class="panel colour-panel"><h1>${escapeHtml(copy.heading)}</h1></section>`
  });
}

export function sideNote(content: string): string {
  return `<aside class="side-note">${content}</aside>`;
}
