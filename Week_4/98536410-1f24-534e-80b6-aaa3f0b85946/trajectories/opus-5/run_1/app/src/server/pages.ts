import { query } from './db.js';
import type { SessionUser } from './http/context.js';

export type PageDecision =
  | { kind: 'page'; notFound: false }
  | { kind: 'not-found' }
  | { kind: 'redirect'; location: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORE_CODE = /^[A-Z]{2}\d{2}$/;
const SKU = /^[A-Za-z0-9-]{1,40}$/;

type PublishedRoute = {
  test: (parts: string[]) => boolean;
  allow: (session: SessionUser, parts: string[]) => Promise<boolean>;
};

const PUBLISHED_ROUTES: PublishedRoute[] = [
  {
    test: (parts) => parts.length === 1 && parts[0] === 'estate',
    allow: async (session) => session.role === 'lead',
  },
  {
    test: (parts) => parts.length === 2 && parts[0] === 'shop' && STORE_CODE.test(parts[1] as string),
    allow: async (session, parts) =>
      session.role === 'manager' && session.storeIds.includes(parts[1] as string),
  },
  {
    test: (parts) => parts.length === 1 && parts[0] === 'care',
    allow: async (session) => session.role === 'care',
  },
  {
    test: (parts) =>
      parts.length === 3 && parts[0] === 'care' && parts[1] === 'orders' && UUID.test(parts[2] as string),
    allow: async (session, parts) => {
      if (session.role !== 'care') return false;
      const rows = await query(`SELECT id FROM orders WHERE id = $1 AND operator_id = $2`, [
        parts[2],
        session.operatorId,
      ]);
      return rows.length > 0;
    },
  },
  {
    test: (parts) => parts.length === 1 && parts[0] === 'catalogue',
    allow: async (session) => session.role === 'shopper',
  },
  {
    test: (parts) => parts.length === 2 && parts[0] === 'products' && SKU.test(parts[1] as string),
    allow: async (session, parts) => {
      if (session.role !== 'shopper') return false;
      const rows = await query(`SELECT sku FROM products WHERE operator_id = $1 AND sku = $2`, [
        session.operatorId,
        parts[1],
      ]);
      return rows.length > 0;
    },
  },
  {
    test: (parts) => parts.length === 1 && parts[0] === 'cart',
    allow: async (session) => session.role === 'shopper',
  },
  {
    test: (parts) => parts.length === 2 && parts[0] === 'orders' && UUID.test(parts[1] as string),
    allow: async (session, parts) => {
      if (session.role !== 'shopper') return false;
      const rows = await query(`SELECT id FROM orders WHERE id = $1 AND user_id = $2`, [
        parts[1],
        session.userId,
      ]);
      return rows.length > 0;
    },
  },
];

export async function decidePage(
  pathname: string,
  search: string,
  session: SessionUser | null,
): Promise<PageDecision> {
  const parts = pathname.split('/').filter((part) => part !== '');

  if (parts.length === 0 || (parts.length === 1 && parts[0] === 'sign-in')) {
    return { kind: 'page', notFound: false };
  }

  const published = PUBLISHED_ROUTES.find((candidate) => candidate.test(parts));
  if (!published) return { kind: 'not-found' };

  if (!session) {
    return { kind: 'redirect', location: `/sign-in?next=${encodeURIComponent(pathname + search)}` };
  }
  return (await published.allow(session, parts))
    ? { kind: 'page', notFound: false }
    : { kind: 'not-found' };
}

export function shell(notFound: boolean, signedIn: boolean): string {
  const boot = JSON.stringify({ not_found: notFound, signed_in: signedIn });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tramela Estate</title>
<link rel="preload" href="/fonts/big-shoulders-display-700-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/public-sans-400-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/app.css">
<script type="application/json" id="boot">${boot}</script>
<script type="module" src="/app.js" defer></script>
</head>
<body>
<div id="root"></div>
</body>
</html>
`;
}
