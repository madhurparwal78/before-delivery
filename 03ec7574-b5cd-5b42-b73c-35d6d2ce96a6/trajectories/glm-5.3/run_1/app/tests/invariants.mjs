// DB-level invariant checks: ledger pairs, audit chain, signatures.
import { poolRef } from '../lib/db.js';
import { createHash, createHmac } from 'node:crypto';

const c = await poolRef().connect();
let fails = 0;
const check = (name, ok, extra) => { if (!ok) { fails++; console.log('FAIL:', name, extra ?? ''); } };

const { rows: movements } = await c.query('SELECT movement_id, sum(raw_amount)::text s, count(*)::int n FROM ledger_entries GROUP BY movement_id');
for (const m of movements) check('movement zero sum ' + m.movement_id, m.s === '0', m);
check('all movements have 2 entries', movements.every((m) => m.n === 2), movements.filter((m) => m.n !== 2).length);

const { rows: balances } = await c.query('SELECT w.id, w.balance_raw::text b, coalesce(sum(l.raw_amount),0)::text s FROM wallets w LEFT JOIN ledger_entries l ON l.account = w.id GROUP BY w.id, w.balance_raw');
for (const w of balances) check('ledger equals balance ' + w.id, w.b === w.s, w);

const { rows: [org] } = await c.query("SELECT webhook_secret FROM organizations WHERE id = 'org_northwind'");
const { rows: rotated } = await c.query("SELECT max(at) r FROM audit_events WHERE organization_id = 'org_northwind' AND type = 'webhook_secret.rotated'");
const rotationAt = rotated[0].r;

const { rows: chain } = await c.query("SELECT * FROM audit_events WHERE organization_id = 'org_northwind' ORDER BY seq");
let prev = '0'.repeat(64);
let seq = 1;
const sortDeep = (v) => Array.isArray(v) ? v.map(sortDeep)
  : (v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v);
for (const e of chain) {
  check('seq gapless', Number(e.seq) === seq, e.seq);
  check('prev hash', e.prev_hash === prev, e.seq);
  const at = new Date(e.at);
  const event = { seq: Number(e.seq), type: e.type, actor: e.actor, subject_id: e.subject_id, at: at.toISOString().slice(0, 19) + 'Z', data: e.data };
  const hash = createHash('sha256').update(e.prev_hash + JSON.stringify(sortDeep(event))).digest('hex');
  check('hash recompute ' + e.seq, hash === e.hash);
  prev = e.hash; seq++;
}

const { rows: events } = await c.query("SELECT * FROM webhook_events WHERE organization_id = 'org_northwind' ORDER BY seq");
for (const ev of events) {
  if (rotationAt && new Date(ev.created_at) <= new Date(rotationAt)) continue;
  const sig = 'v1,' + createHmac('sha256', org.webhook_secret).update(`${ev.id}.${ev.timestamp}.${ev.body}`).digest('base64');
  check('signature ' + ev.seq, sig === ev.signature, ev.seq);
  const body = JSON.parse(ev.body);
  check('body key order', Object.keys(body).join(',') === 'id,type,created_at,data');
}

const { rows: wallets } = await c.query('SELECT * FROM wallets');
for (const w of wallets) {
  const { rows: [r] } = await c.query("SELECT coalesce(sum(raw_amount),0)::text s FROM intents WHERE wallet_id = $1 AND status = 'pending_approval'", [w.id]);
  check('available invariant ' + w.id, BigInt(w.balance_raw) - BigInt(r.s) >= 0n, w.id);
}

const { rows: denied } = await c.query("SELECT count(*)::int n FROM audit_events WHERE type = 'transfer.denied'");
check('transfer.denied events exist', denied[0].n > 0, denied[0].n);
const { rows: deniedSigned } = await c.query("SELECT count(*)::int n FROM webhook_events WHERE type = 'transfer.denied'");
check('transfer.denied signed events exist', deniedSigned[0].n > 0, deniedSigned[0].n);

console.log('DB invariant fails:', fails);
c.release();
await poolRef().end();
process.exit(fails ? 1 : 0);
