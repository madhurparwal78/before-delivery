import pg from 'pg';
import { BASE, check, login, page, pageLogin, summary } from './harness.mjs';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const stored = await client.query('SELECT count(*)::int AS count FROM logistics_requests');
const missing = 5000 - stored.rows[0].count;
if (missing > 0) {
  console.log(`inserting ${missing} requests`);
  await client.query(
    `WITH numbers AS (
       SELECT generate_series(
         (SELECT coalesce(max(substring(id from 4)::int), 0) + 1 FROM logistics_requests),
         (SELECT coalesce(max(substring(id from 4)::int), 0) + $1 FROM logistics_requests)
       ) AS n
     ),
     inserted AS (
       INSERT INTO logistics_requests
         (id, tour_name, transport_type, trucks_requested, requester_id, status, created_at)
       SELECT 'LR-' || lpad(n::text, 4, '0'),
              'Load tour ' || n,
              'tour',
              2,
              CASE WHEN n % 2 = 0 THEN 3 ELSE 4 END,
              'submitted',
              now() - make_interval(secs => n)
       FROM numbers
       RETURNING id, requester_id, created_at
     ),
     stops_written AS (
       INSERT INTO stops (request_id, kind, date, address, city, region, postal_code, country)
       SELECT inserted.id, kind, DATE '2026-05-01', '1 Load Lane', 'Ottawa', 'ON', 'K1A 0B1', 'Canada'
       FROM inserted, unnest(ARRAY['pickup', 'delivery', 'first_show', 'last_show']) AS kind
       RETURNING 1
     )
     INSERT INTO activity (request_id, kind, actor_id, note, created_at)
     SELECT id, 'submitted', requester_id, 'Requested 2 trucks', created_at FROM inserted`,
    [missing]
  );
}
const total = (await client.query('SELECT count(*)::int AS count FROM logistics_requests')).rows[0].count;
console.log(`stored requests: ${total}`);

const token = await login('dispatcher@example.com');
const timed = async (name, run, budgetMs) => {
  const started = Date.now();
  const result = await run();
  const elapsed = Date.now() - started;
  check(`${name} under ${budgetMs}ms`, elapsed < budgetMs, `${elapsed}ms`);
  return result;
};

await timed('API list page', async () => {
  const response = await fetch(`${BASE}/api/requests?limit=50`, { headers: { authorization: `Bearer ${token}` } });
  return response.json();
}, 1000);

const cursorResponse = await fetch(`${BASE}/api/requests?limit=50`, { headers: { authorization: `Bearer ${token}` } });
const cursor = cursorResponse.headers.get('x-next-cursor');
await timed('API cursor page', async () => {
  const response = await fetch(`${BASE}/api/requests?limit=50&cursor=${encodeURIComponent(cursor)}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  return response.json();
}, 1000);

await timed('API search', async () => {
  const response = await fetch(`${BASE}/api/requests?q=Load%20tour%204999`, {
    headers: { authorization: `Bearer ${token}` }
  });
  return response.json();
}, 1000);

await timed('API dispatch board', async () => {
  const response = await fetch(`${BASE}/api/dispatch`, { headers: { authorization: `Bearer ${token}` } });
  return response.json();
}, 1000);

await timed('API fleet', async () => {
  const response = await fetch(`${BASE}/api/trucks`, { headers: { authorization: `Bearer ${token}` } });
  return response.json();
}, 1000);

const cookie = await pageLogin('dispatcher@example.com');

await timed('requests page', () => page('/requests', { cookie }), 3000);
await timed('dispatch page', () => page('/dispatch', { cookie }), 3000);
await timed('show more fragment', () => page(`/requests/list?cursor=${encodeURIComponent(cursor)}`, { cookie }), 1000);

/* DP-41: paging stays stable while new requests arrive */
const firstPage = await fetch(`${BASE}/api/requests?limit=50`, { headers: { authorization: `Bearer ${token}` } });
const firstIds = (await firstPage.json()).map((item) => item.id);
const nextCursor = firstPage.headers.get('x-next-cursor');
await client.query(
  `INSERT INTO logistics_requests (id, tour_name, transport_type, trucks_requested, requester_id, status)
   VALUES ('LR-9001', 'Arrived while paging', 'tour', 1, 3, 'submitted')
   ON CONFLICT (id) DO NOTHING`
);
const secondPage = await fetch(`${BASE}/api/requests?limit=50&cursor=${encodeURIComponent(nextCursor)}`, {
  headers: { authorization: `Bearer ${token}` }
});
const secondIds = (await secondPage.json()).map((item) => item.id);
check('DP-41 no repeats while new requests arrive', secondIds.every((id) => !firstIds.includes(id)));
check('DP-41 the new request does not jump into a later page', !secondIds.includes('LR-9001'));
await client.query("DELETE FROM logistics_requests WHERE id = 'LR-9001'");

await client.end();
process.exit(summary() ? 0 : 1);
