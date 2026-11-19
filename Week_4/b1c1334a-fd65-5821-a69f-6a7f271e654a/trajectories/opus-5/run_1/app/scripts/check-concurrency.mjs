import { api, check, done, signIn } from './apicheck.mjs';

await signIn('mara');
await signIn('priya');

const docs = await api('mara', 'GET', '/api/documents');
const docId = docs.body.documents.find((d) => d.name === 'Harbour Lane Ops').id;
const read = await api('mara', 'GET', `/api/documents/${docId}`);
const ids = Object.fromEntries(read.body.tables.map((t) => [t.name, t.id]));
const table = async (who, name) =>
  (await api(who, 'GET', `/api/documents/${docId}/tables/${ids[name]}`)).body.table;
const cols = (t) => Object.fromEntries(t.columns.map((c) => [c.name, c.id]));

const products = await table('mara', 'Products');
const pc = cols(products);
const oak = products.rows[0];

// DP-07: of simultaneous writes carrying one revision, exactly one succeeds.
const revision = oak.cells[pc['Stock']].revision;
const racers = await Promise.all(
  [51, 52, 53, 54].map((value, index) =>
    api(
      index % 2 === 0 ? 'mara' : 'priya',
      'PUT',
      `/api/documents/${docId}/tables/${ids['Products']}/rows/${oak.id}/cells/${pc['Stock']}`,
      { value, revision },
    ),
  ),
);
check(
  'one winner',
  racers.filter((racer) => racer.status === 200).length,
  1,
);
check(
  'others are stale',
  racers.filter((racer) => racer.status === 409 && racer.body.error.code === 'stale_revision')
    .length,
  3,
);
const winner = racers.find((racer) => racer.status === 200);
const stored = (await table('mara', 'Products')).rows[0].cells[pc['Stock']];
check('stored winner', stored.display, winner.body.cell.display);
check('stored revision', stored.revision, revision + 1);

// DP-66: parallel edits to one document form one chain for a shared aggregate.
const orders = await table('priya', 'Orders');
const oc = cols(orders);
const quantities = orders.rows.slice(0, 3);
const parallel = await Promise.all(
  quantities.map((row, index) =>
    api(
      'priya',
      'PUT',
      `/api/documents/${docId}/tables/${ids['Orders']}/rows/${row.id}/cells/${oc['Qty']}`,
      { value: 20 + index, revision: row.cells[oc['Qty']].revision },
    ),
  ),
);
check('all parallel writes applied', parallel.every((reply) => reply.status === 200), true);
const chain = parallel
  .flatMap((reply) => reply.body.recalc.cells)
  .filter((cell) => cell.table_id === ids['Orders by Region'] && cell.column_id.startsWith('sum:'));
const revisions = parallel.map((reply) => reply.body.recalc.document_revision);
check('revisions are distinct', new Set(revisions).size, revisions.length);
const summary = await table('priya', 'Orders by Region');
const sc = cols(summary);
const lastSums = new Map();
for (const cell of chain) lastSums.set(`${cell.row_id}|${cell.column_id}`, cell.new_display);
const freshSums = new Map();
for (const row of summary.rows) {
  for (const column of summary.columns) {
    if (column.id.startsWith('sum:')) freshSums.set(`${row.id}|${column.id}`, row.cells[column.id].display);
  }
}
const chainEndsAtStored = [...lastSums.keys()].every((key) => {
  const sorted = chain
    .filter((cell) => `${cell.row_id}|${cell.column_id}` === key)
    .map((cell) => cell.new_display);
  return sorted[sorted.length - 1] !== undefined && freshSums.get(key) === sorted[sorted.length - 1];
});
check('the chain ends at the stored value', chainEndsAtStored, true);

// DP-66: parallel row adds take distinct positions.
const adds = await Promise.all(
  [1, 2, 3].map((index) =>
    api('priya', 'POST', `/api/documents/${docId}/tables/${ids['Orders']}/rows`, {
      cells: { [oc['Order No']]: `ORD-80${index}` },
    }),
  ),
);
const counts = adds.map((reply) => reply.body.recalc.row_counts[ids['Orders']]);
check('distinct row counts', new Set(counts).size, 3);
check('counts run up', counts.slice().sort((a, b) => a - b), [6, 7, 8]);
const afterAdds = await table('priya', 'Orders');
check('rows added once each', afterAdds.rows.length, 8);

// DP-69: simultaneous undos each take a distinct entry.
const undos = await Promise.all(
  [1, 2, 3, 4, 5].map(() => api('priya', 'POST', `/api/documents/${docId}/undo`)),
);
const succeeded = undos.filter((reply) => reply.status === 200);
check('six edits, five undos succeed', succeeded.length, 5);
check(
  'distinct stack counts',
  new Set(succeeded.map((reply) => reply.body.recalc.stacks.undo_count)).size,
  5,
);
const empty = undos.filter((reply) => reply.status === 409);
check('extras refused', empty.length, 0);
const lastUndo = await api('priya', 'POST', `/api/documents/${docId}/undo`);
check('sixth undo', lastUndo.status, 200);
const seventh = await Promise.all([
  api('priya', 'POST', `/api/documents/${docId}/undo`),
  api('priya', 'POST', `/api/documents/${docId}/undo`),
]);
check(
  'empty stack answers',
  seventh.filter((reply) => reply.status === 409 && reply.body.error.code === 'nothing_to_undo')
    .length,
  2,
);
const afterUndos = await table('priya', 'Orders');
check('back to five rows', afterUndos.rows.length, 5);
check(
  'quantities restored',
  afterUndos.rows.map((row) => row.cells[oc['Qty']].display),
  ['4.0000', '2.0000', '10.0000', '6.0000', '3.0000'],
);

// DP-95: one key, two identical commits in flight.
const target = afterUndos.rows[0];
const key = 'concurrent-key';
const twice = await Promise.all([
  api(
    'priya',
    'PUT',
    `/api/documents/${docId}/tables/${ids['Orders']}/rows/${target.id}/cells/${oc['Qty']}`,
    { value: 9, revision: target.cells[oc['Qty']].revision },
    { 'idempotency-key': key },
  ),
  api(
    'priya',
    'PUT',
    `/api/documents/${docId}/tables/${ids['Orders']}/rows/${target.id}/cells/${oc['Qty']}`,
    { value: 9, revision: target.cells[oc['Qty']].revision },
    { 'idempotency-key': key },
  ),
]);
check('both answer 200', twice.map((reply) => reply.status), [200, 200]);
check(
  'identical bodies',
  JSON.stringify(twice[0].body) === JSON.stringify(twice[1].body),
  true,
);
const history = await api('priya', 'GET', `/api/documents/${docId}/history`);
const writes = history.body.entries.filter(
  (entry) => entry.revision === twice[0].body.recalc.document_revision,
);
check('one history entry for the key', writes.length, 1);

done();
