import * as fs from "node:fs";
import * as path from "node:path";

type Account = { id: string; role: string; name: string; firstName: string } | null;

/** Lucide icons (ISC) bundled at /assets/icons.svg, inlined once into every page. */
const iconsPath = path.join(process.cwd(), "dist", "public", "assets", "icons.svg");
const ICONS = fs.existsSync(iconsPath) ? fs.readFileSync(iconsPath, "utf8") : "";

interface RouteDef { title: string; bodyClass: string }

const ROUTES: Record<string, RouteDef> = {
  "/": { title: "Chauraha Bazaar", bodyClass: "page-home" },
  "/search": { title: "Search - Chauraha", bodyClass: "page-search" },
  "/compare": { title: "Compare - Chauraha", bodyClass: "page-compare" },
  "/cart": { title: "Cart - Chauraha", bodyClass: "page-cart" },
  "/wishlist": { title: "Wishlist - Chauraha", bodyClass: "page-wishlist" },
  "/orders": { title: "Orders - Chauraha", bodyClass: "page-orders" },
  "/account": { title: "Account - Chauraha", bodyClass: "page-account" },
  "/signin": { title: "Sign in - Chauraha", bodyClass: "page-auth" },
  "/signin/code": { title: "Sign in - Chauraha", bodyClass: "page-auth" },
  "/signup": { title: "Sign up - Chauraha", bodyClass: "page-auth" },
  "/signup/code": { title: "Sign up - Chauraha", bodyClass: "page-auth" },
  "/forgot": { title: "Forgot password - Chauraha", bodyClass: "page-auth" },
  "/checkout/address": { title: "Address - Chauraha", bodyClass: "page-checkout" },
  "/checkout/payment": { title: "Payment - Chauraha", bodyClass: "page-checkout" },
  "/checkout/review": { title: "Review - Chauraha", bodyClass: "page-checkout" },
  "/seller/listings": { title: "Listings - Chauraha Seller", bodyClass: "page-seller" },
  "/seller/listings/new": { title: "New listing - Chauraha Seller", bodyClass: "page-seller" },
  "/seller/stock": { title: "Stock - Chauraha Seller", bodyClass: "page-seller" },
  "/seller/shipments": { title: "Shipments - Chauraha Seller", bodyClass: "page-seller" },
  "/seller/returns": { title: "Returns - Chauraha Seller", bodyClass: "page-seller" },
  "/seller/statement": { title: "Statement - Chauraha Seller", bodyClass: "page-seller" },
  "/support": { title: "Support - Chauraha", bodyClass: "page-support" },
};

export function renderPage(pathname: string, url: URL, account: Account): string {
  // route patterns with parameters
  let route = ROUTES[pathname] ?? null;
  let title = route?.title ?? "Chauraha";
  if (/^\/p\/[^/]+$/.test(pathname)) { title = "Product - Chauraha"; route = { title, bodyClass: "page-product" }; }
  else if (/^\/p\/[^/]+\/offers$/.test(pathname)) { title = "Offers - Chauraha"; route = { title, bodyClass: "page-product" }; }
  else if (/^\/orders\/[^/]+\/placed$/.test(pathname)) { title = "Order placed - Chauraha"; route = { title, bodyClass: "page-orders" }; }
  else if (/^\/orders\/[^/]+$/.test(pathname)) { title = "Order - Chauraha"; route = { title, bodyClass: "page-orders" }; }
  else if (/^\/s\/[^/]+$/.test(pathname)) { title = "Shared - Chauraha"; route = { title, bodyClass: "page-shared" }; }
  else if (/^\/seller\/listings\/[^/]+$/.test(pathname)) { title = "Listing - Chauraha Seller"; route = { title, bodyClass: "page-seller" }; }
  else if (/^\/support\/orders\/[^/]+$/.test(pathname)) { title = "Order - Chauraha Support"; route = { title, bodyClass: "page-support" }; }
  else if (!route) { title = "Not found - Chauraha"; }

  const notFound = route === null;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/styles.css">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#2437e0">
</head>
<body class="${route?.bodyClass ?? "page-notfound"}${account ? " signed-in" : ""}" data-path="${escapeHtml(pathname)}" data-query="${escapeHtml(url.search)}">
<!-- Lucide icons, ISC licensed, bundled with the app -->
<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${ICONS}</svg>
<a class="skip-link" href="#main">skip to main</a>
<div id="app" aria-busy="true">
  <noscript><div class="panel-pink js-off">the bazaar needs JavaScript. enable it and come back.</div></noscript>
</div>
<div id="noise-backdrop" aria-hidden="true"></div>
<canvas id="fx-canvas" aria-hidden="true"></canvas>
<script type="module" src="/assets/app-entry.js"></script>
${notFound ? "" : ""}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
