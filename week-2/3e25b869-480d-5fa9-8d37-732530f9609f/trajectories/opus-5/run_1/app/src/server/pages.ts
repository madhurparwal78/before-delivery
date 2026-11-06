import { UI, say } from '../shared/copy.js';
import type { Locale } from '../shared/types.js';
import { db } from './db/pool.js';
import type { Customer } from './http/context.js';

const PAGE_PATTERNS: readonly string[] = [
  '/',
  '/checkout',
  '/checkout/placed/{number}',
  '/subscribe',
  '/account',
  '/account/orders/{number}',
  '/account/subscriptions/{number}',
  '/contact',
  '/studio',
  '/studio/batches',
  '/studio/packing',
  '/studio/finance',
  '/studio/reconciliation',
  '/studio/audit',
  '/studio/notices',
];

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const expected = pattern.split('/').filter(Boolean);
  const actual = path.split('/').filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index] as string;
    const value = actual[index] as string;
    if (segment.startsWith('{')) params[segment.slice(1, -1)] = value;
    else if (segment !== value) return null;
  }
  return params;
}

async function ownsRecord(
  customer: Customer | null,
  table: 'orders' | 'subscriptions',
  number: string,
): Promise<boolean> {
  if (!customer) return false;
  const result = await db.query(
    `SELECT 1 FROM ${table} WHERE number = $1 AND customer_id = $2`,
    [number, customer.id],
  );
  return result.rowCount === 1;
}

/** Unknown pages, and records that are not yours, are served as the not-found page with status 404. */
export async function pageStatus(path: string, customer: Customer | null): Promise<number> {
  for (const pattern of PAGE_PATTERNS) {
    const params = matchPattern(pattern, path);
    if (!params) continue;
    const number = params['number'];
    if (number === undefined) return 200;
    const table = pattern.startsWith('/account/subscriptions') ? 'subscriptions' : 'orders';
    return (await ownsRecord(customer, table, number)) ? 200 : 404;
  }
  return 404;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderShell(locale: Locale, status: number): string {
  const title = say(UI.brand, locale);
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
<link rel="icon" href="data:,">
</head>
<body>
<div id="app" data-locale="${locale}" data-page-status="${status}"></div>
<script src="/assets/app.js" defer></script>
</body>
</html>
`;
}
