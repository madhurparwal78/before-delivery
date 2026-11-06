// DP-86: the calendar's waiting totals agree with the pending queue counts.
const BASE = 'http://127.0.0.1:4173';
const TOK = process.env.TOK;
const api = async (path) => (await fetch(BASE + path, { headers: { authorization: `Bearer ${TOK}` } })).json();

const month = process.argv[2] || '2026-10';
const cal = await api(`/api/calendar?month=${month}`);
if (!cal.days) {
  console.log('CALENDAR ERROR:', JSON.stringify(cal).slice(0, 200));
  process.exit(1);
}
let sumWaiting = 0;
for (const d of cal.days) sumWaiting += d.counts.waiting;
let queueWaiting = 0;
const mismatches = [];
for (const p of cal.people) {
  const c = await api(`/api/calendar?month=${month}&person=${encodeURIComponent(p.work_address)}`);
  const w = c.days.reduce((s, d) => s + d.counts.waiting, 0);
  const q = await api(`/api/requests?state=pending&month=${month}&person=${encodeURIComponent(p.work_address)}`);
  queueWaiting += q.matched;
  if (w !== q.matched) mismatches.push(`${p.name}: calendar ${w} queue ${q.matched}`);
}
console.log(`calendar waiting total: ${sumWaiting}, queue pending total: ${queueWaiting}`);
console.log('TOTAL AGREEMENT:', sumWaiting === queueWaiting);
console.log('PER-PERSON:', mismatches.length === 0 ? 'all agree' : mismatches.join('; '));
process.exit(sumWaiting === queueWaiting && mismatches.length === 0 ? 0 : 1);
