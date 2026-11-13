// The server recovers from dropped database connections with no restart.
import { query, closePool } from '../src/db/pool.ts';

let fails = 0;
let checks = 0;
const chk = (label: string, got: unknown, want: unknown): void => {
  checks += 1;
  const ok = String(got) === String(want);
  if (!ok) fails += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label} = ${String(got)}${ok ? '' : `  want ${String(want)}`}`,
  );
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const BASE = 'http://127.0.0.1:4173';
const token = await (async (): Promise<string> => {
  const reply = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor_id: 'stw-ines' }),
  });
  return ((await reply.json()) as { token: string }).token;
})();

const read = async (): Promise<number> => {
  const reply = await fetch(`${BASE}/api/pools`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return reply.status;
};

console.log('---- the server works before the connections are dropped (DP-55)');
chk('a read succeeds', await read(), 200);

console.log('---- every connection to the database is terminated');
const killed = await query<{ count: string }>(
  `SELECT count(pg_terminate_backend(pid))::text AS count
   FROM pg_stat_activity
   WHERE datname = current_database() AND pid <> pg_backend_pid()`,
);
chk('connections were terminated', Number(killed.rows[0]?.count ?? '0') > 0, true);

console.log('---- the server reconnects by itself, with no restart (DP-55)');
let recovered = false;
const started = Date.now();
for (let i = 0; i < 20; i += 1) {
  const status = await read();
  if (status === 200) {
    recovered = true;
    break;
  }
  await sleep(500);
}
const tookMs = Date.now() - started;
chk('reads succeed again', recovered, true);
chk('within 5 seconds of the database accepting connections', tookMs < 5000, true);
console.log(`     recovery took ${tookMs} ms`);

console.log('---- the health check reports ready again (DP-58)');
const health = (await fetch(`${BASE}/api/health`).then((r) => r.json())) as { status: string };
chk('health is ok', health.status, 'ok');

console.log('---- the ledger is still balanced (DP-03)');
const totals = (await fetch(`${BASE}/api/ledger/totals`, {
  headers: { authorization: `Bearer ${token}` },
}).then((r) => r.json())) as { assets: Array<{ asset: string; net: string }> };
for (const asset of totals.assets) chk(`net ${asset.asset}`, asset.net, '0');

await closePool();
console.log(fails === 0 ? `\nALL ${checks} PASS` : `\n${fails} of ${checks} FAILED`);
if (fails > 0) process.exitCode = 1;
