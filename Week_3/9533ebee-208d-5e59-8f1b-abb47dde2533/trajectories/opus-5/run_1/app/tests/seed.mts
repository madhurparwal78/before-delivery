import { applySchemaAndSeed } from '../src/db/migrate.ts';
import { query, closePool, readBig } from '../src/db/pool.ts';
import { trialBalance, poolBalances, walletBalances } from '../src/ledger/postings.ts';
import { poolFigures, sharePriceScaled } from '../src/domain/pool.ts';
import { ASSET_CODES } from '../src/domain/assets.ts';
import { formatAmount, formatPercent } from '../src/domain/deskformat.ts';

let fails = 0;
const chk = (label: string, got: unknown, want: unknown): void => {
  const ok = String(got) === String(want);
  if (!ok) fails += 1;
  console.log(
    (ok ? 'PASS' : 'FAIL') +
      ' ' +
      label +
      ' = ' +
      String(got) +
      (ok ? '' : '  want ' + String(want)),
  );
};

await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
console.log('dropped schema, applying seed...');
await applySchemaAndSeed();
await applySchemaAndSeed(); // second call must be a no-op

const actors = await query<{ n: string }>('SELECT count(*)::text AS n FROM actors');
chk('actor count', actors.rows[0]?.n, '12');
const postings = await query<{ n: string }>('SELECT count(*)::text AS n FROM ledger_postings');
chk('seed postings', postings.rows[0]?.n, String(13 + 3 + 5 + 5));

// Trial balance nets to zero in every asset
const totals = await trialBalance({ query });
for (const t of totals) chk('net ' + t.asset, t.net, 0n);

// QUSD pool figures
const qb = await poolBalances({ query }, 'QUSD');
const qf = poolFigures(qb);
chk('QUSD available', formatAmount(qf.availableLiquidity, 6), '1\u202F799\u202F000,000000');
chk('QUSD borrowed', formatAmount(qf.totalBorrowed, 6), '201\u202F000,000000');
chk('QUSD utilization', formatPercent(qf.utilizationBps), '10,05%');
const shares = await query<{ total_shares: string }>(
  "SELECT total_shares FROM assets WHERE asset='QUSD'",
);
chk(
  'QUSD share price',
  sharePriceScaled(qb.supply, readBig(shares.rows[0]?.total_shares ?? '0')),
  10n ** 12n,
);

const mb = poolFigures(await poolBalances({ query }, 'MBTC'));
chk('MBTC available', formatAmount(mb.availableLiquidity, 8), '40,00000000');
chk('MBTC borrowed', mb.totalBorrowed, 0n);
chk('MBTC utilization', mb.utilizationBps, 0n);
const eb = poolFigures(await poolBalances({ query }, 'METH'));
chk('METH available', formatAmount(eb.availableLiquidity, 18), '600,000000000000000000');

// Wallets at start
const wallets: Array<[string, string, string]> = [
  ['tr-petra', 'MBTC', '100000000'],
  ['tr-petra', 'QUSD', '50000000000'],
  ['tr-petra', 'METH', '5000000000000000000'],
  ['lq-kestrel', 'QUSD', '250000000000'],
  ['lq-vane', 'QUSD', '250000000000'],
  ['lp-rosa', 'QUSD', '100000000000'],
  ['lp-rosa', 'MBTC', '0'],
  ['lp-tomas', 'METH', '10000000000000000000'],
  ['br-sanna', 'QUSD', '60000000000'],
  ['br-sanna', 'MBTC', '0'],
  ['br-dele', 'QUSD', '64000000000'],
  ['br-mara', 'QUSD', '40000000000'],
  ['br-yusuf', 'QUSD', '21000000000'],
  ['br-ivo', 'QUSD', '16000000000'],
  ['stw-ines', 'QUSD', '0'],
  ['stw-odile', 'METH', '0'],
];
for (const [actor, asset, want] of wallets) {
  const w = await walletBalances({ query }, actor);
  chk('wallet ' + actor + ' ' + asset, w[asset as 'QUSD'], BigInt(want));
}

// Positions
const pos = await query<{
  position_id: string;
  state: string;
  round: number;
  principal: string;
  margin_notice_armed: boolean;
}>(
  'SELECT position_id, state, round, principal, margin_notice_armed FROM positions ORDER BY position_id',
);
chk('position count', pos.rows.length, 5);
for (const p of pos.rows)
  chk(
    p.position_id + ' state/round/armed',
    p.state + '/' + p.round + '/' + p.margin_notice_armed,
    'healthy/0/true',
  );

// Collateral and loan balances per position
const cl = await query<{ account: string; balance: string }>(
  "SELECT account, SUM(amount)::text AS balance FROM ledger_legs WHERE account LIKE 'collateral:%' OR account LIKE 'loan:%' GROUP BY account ORDER BY account",
);
for (const r of cl.rows) console.log('     ' + r.account + ' = ' + r.balance);

// Prices
const prices = await query<{
  asset: string;
  price: string;
  source: string;
  evidence_key: string | null;
  posted_by: string;
}>(
  'SELECT a.asset, p.price, p.source, p.evidence_key, p.posted_by FROM assets a JOIN price_posts p ON p.price_post_id = a.current_price_post_id ORDER BY a.asset',
);
chk('price rows', prices.rows.length, 3);
for (const r of prices.rows) {
  chk(
    'price ' + r.asset + ' source/evidence/by',
    r.source + '/' + String(r.evidence_key) + '/' + r.posted_by,
    'manual/null/stw-ines',
  );
}
const byAsset = new Map(prices.rows.map((r) => [r.asset, r.price]));
chk('QUSD price', byAsset.get('QUSD'), '100000000');
chk('MBTC price', byAsset.get('MBTC'), '6400000000000');
chk('METH price', byAsset.get('METH'), '320000000000');

// No events, no notices, no settlements from the seed
for (const t of ['outbox_events', 'notices', 'settlements', 'pdf_renders']) {
  const r = await query<{ n: string }>('SELECT count(*)::text AS n FROM ' + t);
  chk('seed ' + t + ' empty', r.rows[0]?.n, '0');
}
void ASSET_CODES;
await closePool();
console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
