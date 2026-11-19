import { api, check, done, signIn } from './apicheck.mjs';

const base = process.env.BASE ?? 'http://127.0.0.1:4173';

// DP-01: one answer for a wrong password and an unknown email.
const wrongPassword = await fetch(`${base}/api/auth/sign-in`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: base },
  body: JSON.stringify({ email: 'mara@harbourlane.test', password: 'nope' }),
});
const unknownEmail = await fetch(`${base}/api/auth/sign-in`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: base },
  body: JSON.stringify({ email: 'nobody@harbourlane.test', password: 'ledger-demo-2026' }),
});
const wrongPasswordBody = await wrongPassword.text();
const unknownEmailBody = await unknownEmail.text();
check('wrong password status', wrongPassword.status, 401);
check('unknown email status', unknownEmail.status, 401);
check(
  'published sign-in failure',
  wrongPasswordBody,
  '{"error":{"code":"invalid_credentials","message":"Email or password is incorrect."}}',
);
check('identical sign-in failures', unknownEmailBody, wrongPasswordBody);

// DP-02: a session is required.
const noSession = await fetch(`${base}/api/me`);
check('me without session', noSession.status, 401);
check('health without session', (await fetch(`${base}/api/health`)).status, 200);

await signIn('mara');
await signIn('dev');
await signIn('priya');
await signIn('sam');

const docs = await api('mara', 'GET', '/api/documents');
const docId = docs.body.documents[0].id;
const read = await api('mara', 'GET', `/api/documents/${docId}`);
const ids = Object.fromEntries(read.body.tables.map((t) => [t.name, t.id]));
const table = async (who, name) =>
  (await api(who, 'GET', `/api/documents/${docId}/tables/${ids[name]}`)).body.table;
const cols = (t) => Object.fromEntries(t.columns.map((c) => [c.name, c.id]));

const orders = await table('mara', 'Orders');
const oc = cols(orders);
const products = await table('mara', 'Products');
const pc = cols(products);
const customers = await table('mara', 'Customers');
const cc = cols(customers);

// DP-79: cross-site requests.
const cellPath = `/api/documents/${docId}/tables/${ids['Orders']}/rows/${orders.rows[0].id}/cells/${oc['Qty']}`;
const foreign = await api('mara', 'PUT', cellPath, { value: 9, revision: 1 }, {
  origin: 'http://other.example',
});
check('foreign origin', [foreign.status, foreign.body.error.code], [403, 'cross_origin']);
const nullOrigin = await api('mara', 'POST', '/api/auth/sign-out', undefined, { origin: 'null' });
check('null origin', [nullOrigin.status, nullOrigin.body.error.code], [403, 'cross_origin']);
const crossSite = await fetch(`${base}/api/documents/${docId}/tables/${ids['Orders']}/exports`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
});
check('cross-site fetch metadata', crossSite.status, 403);

// DP-35: boundary checks.
const big = await fetch(`${base}/api/documents`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: base },
  body: JSON.stringify({ name: 'x'.repeat(1_000_100) }),
});
check('oversized body', big.status, 413);
const wrongType = await fetch(`${base}/api/documents`, {
  method: 'POST',
  headers: { 'content-type': 'text/plain', origin: base },
  body: 'hello',
});
check('wrong content type', wrongType.status, 415);
const unknownApi = await api('mara', 'GET', '/api/nope');
check('unknown api path', [unknownApi.status, unknownApi.body.error.code], [404, 'not_found']);

// DP-21: role permissions.
const samWrite = await api('sam', 'PUT', cellPath, {
  value: 9,
  revision: orders.rows[0].cells[oc['Qty']].revision,
});
check('viewer write', [samWrite.status, samWrite.body.error.code], [403, 'forbidden']);
const samUndo = await api('sam', 'POST', `/api/documents/${docId}/undo`);
check('viewer undo on empty stack', [samUndo.status, samUndo.body.error.code], [403, 'forbidden']);
const priyaColumn = await api(
  'priya',
  'PATCH',
  `/api/documents/${docId}/tables/${ids['Products']}/columns/${pc['Price']}`,
  { name: 'Cost', revision: 1 },
);
check('editor rename column', [priyaColumn.status, priyaColumn.body.error.code], [403, 'forbidden']);
const priyaTable = await api('priya', 'POST', `/api/documents/${docId}/tables`, { name: 'Jobs' });
check('editor create table', priyaTable.status, 403);
const viewerUnknownTable = await api(
  'sam',
  'POST',
  `/api/documents/${docId}/tables/tbl_missing/rows`,
  { cells: {} },
);
check('viewer unknown table', viewerUnknownTable.status, 404);

// DP-22 and DP-24: row scope.
const hiddenOrder = orders.rows.find(
  (row) => row.cells[oc['Order No']].display === 'ORD-1002',
);
const devHidden = await api(
  'dev',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Orders']}/rows/${hiddenOrder.id}/cells/${oc['Qty']}`,
  { value: 4, revision: hiddenOrder.cells[oc['Qty']].revision },
);
check('write to hidden row', [devHidden.status, devHidden.body.error.code], [404, 'not_found']);
const devRow = await api('dev', 'POST', `/api/documents/${docId}/tables/${ids['Orders']}/rows`, {
  cells: { [oc['Order No']]: 'ORD-9001' },
});
check('own row owner cell', devRow.body.row.cells[oc['Owner']].display, 'dev@harbourlane.test');
const devOther = await api('dev', 'POST', `/api/documents/${docId}/tables/${ids['Orders']}/rows`, {
  cells: { [oc['Order No']]: 'ORD-9002', [oc['Owner']]: 'priya@harbourlane.test' },
});
check('own row only', [devOther.status, devOther.body.error.fields[oc['Owner']]], [
  422,
  'You can only assign rows to yourself.',
]);
const devUndoRow = await api('dev', 'POST', `/api/documents/${docId}/undo`);
check('dev undo row add', devUndoRow.body.undone.kind, 'row_add');

// DP-05: typed values.
const dateColumn = await api(
  'mara',
  'POST',
  `/api/documents/${docId}/tables/${ids['Customers']}/columns`,
  { name: 'Since', type: 'date' },
);
const customerRow = customers.rows[0];
const badDate = await api(
  'mara',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Customers']}/rows/${customerRow.id}/cells/${dateColumn.body.column.id}`,
  { value: '2026-02-30', revision: 1 },
);
check('bad date', [badDate.status, badDate.body.error.fields.value], [
  422,
  'Enter a date as YYYY-MM-DD.',
]);
const goodDate = await api(
  'mara',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Customers']}/rows/${customerRow.id}/cells/${dateColumn.body.column.id}`,
  { value: '2026-03-14', revision: 1 },
);
check('good date', goodDate.body.cell.display, '2026-03-14');
const dateRange = await api(
  'mara',
  'POST',
  `/api/documents/${docId}/tables/${ids['Customers']}/formula-preview`,
  { formula: '[Since] - 800000', row_id: customerRow.id },
);
check('date out of range', dateRange.body.display, '#TYPE!');
const dateMath = await api(
  'mara',
  'POST',
  `/api/documents/${docId}/tables/${ids['Customers']}/formula-preview`,
  { formula: '[Since] + 20', row_id: customerRow.id },
);
check('date plus days', dateMath.body.display, '2026-04-03');
const dateMinus = await api(
  'mara',
  'POST',
  `/api/documents/${docId}/tables/${ids['Customers']}/formula-preview`,
  { formula: '[Since] - [Since]', row_id: customerRow.id },
);
check('date minus date', dateMinus.body.display, '0.0000');
const dateTimes = await api(
  'mara',
  'POST',
  `/api/documents/${docId}/tables/${ids['Customers']}/formula-preview`,
  { formula: '[Since] * 2', row_id: customerRow.id },
);
check('date times', dateTimes.body.display, '#TYPE!');

// Type change and its undo.
const typeChange = await api(
  'mara',
  'PATCH',
  `/api/documents/${docId}/tables/${ids['Customers']}/columns/${dateColumn.body.column.id}`,
  { type: 'text', revision: dateColumn.body.column.revision },
);
check('type change', typeChange.body.column.type, 'text');
const afterType = await table('mara', 'Customers');
check(
  'converted display',
  afterType.rows[0].cells[dateColumn.body.column.id].display,
  '2026-03-14',
);
check('converted kind', afterType.rows[0].cells[dateColumn.body.column.id].kind, 'text');
const undoType = await api('mara', 'POST', `/api/documents/${docId}/undo`);
check('undo type kind', undoType.body.undone.kind, 'column_update');
const restoredType = await table('mara', 'Customers');
check(
  'restored type',
  restoredType.columns.find((c) => c.id === dateColumn.body.column.id).type,
  'date',
);
check(
  'restored value',
  restoredType.rows[0].cells[dateColumn.body.column.id].display,
  '2026-03-14',
);
await api(
  'mara',
  'DELETE',
  `/api/documents/${docId}/tables/${ids['Customers']}/columns/${dateColumn.body.column.id}`,
);

// DP-16: protected columns.
const deleteRegion = await api(
  'mara',
  'DELETE',
  `/api/documents/${docId}/tables/${ids['Orders']}/columns/${oc['Region']}`,
);
check('column in summary', [deleteRegion.status, deleteRegion.body.error.code], [
  409,
  'column_in_summary',
]);
const deleteOwner = await api(
  'mara',
  'DELETE',
  `/api/documents/${docId}/tables/${ids['Orders']}/columns/${oc['Owner']}`,
);
check('column is row owner', [deleteOwner.status, deleteOwner.body.error.code], [
  409,
  'column_is_row_owner',
]);

// DP-17 and DP-20: undo stacks.
const oak = products.rows[0];
const first = await api(
  'priya',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Products']}/rows/${oak.id}/cells/${pc['Price']}`,
  { value: 13, revision: oak.cells[pc['Price']].revision },
);
const second = await api(
  'priya',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Products']}/rows/${oak.id}/cells/${pc['Price']}`,
  { value: 14, revision: first.body.cell.revision },
);
check('second write', second.body.cell.display, '14.0000');
const undo1 = await api('priya', 'POST', `/api/documents/${docId}/undo`);
check('undo 1', [undo1.status, undo1.body.recalc.stacks.redo_count], [200, 1]);
const priceAfterUndo1 = (await table('priya', 'Products')).rows[0].cells[pc['Price']].display;
check('price after undo 1', priceAfterUndo1, '13.0000');
const undo2 = await api('priya', 'POST', `/api/documents/${docId}/undo`);
check('undo 2', undo2.status, 200);
check(
  'price after undo 2',
  (await table('priya', 'Products')).rows[0].cells[pc['Price']].display,
  '12.5000',
);
const undo3 = await api('priya', 'POST', `/api/documents/${docId}/undo`);
check('undo 3', [undo3.status, undo3.body.error.code], [409, 'nothing_to_undo']);
check('undo 3 stacks', undo3.body.error.stacks, { undo_count: 0, redo_count: 2 });
const redo1 = await api('priya', 'POST', `/api/documents/${docId}/redo`);
check('redo 1', [redo1.status, redo1.body.redone.kind], [200, 'cell_write']);
check(
  'price after redo',
  (await table('priya', 'Products')).rows[0].cells[pc['Price']].display,
  '13.0000',
);
await api('priya', 'POST', `/api/documents/${docId}/undo`);

// DP-20: an undo whose target someone else changed.
const priyaWrite = await api(
  'priya',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Products']}/rows/${oak.id}/cells/${pc['Stock']}`,
  { value: 41, revision: oak.cells[pc['Stock']].revision },
);
const maraWrite = await api(
  'mara',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Products']}/rows/${oak.id}/cells/${pc['Stock']}`,
  { value: 42, revision: priyaWrite.body.cell.revision },
);
check('mara overwrote', maraWrite.body.cell.display, '42.0000');
const conflictUndo = await api('priya', 'POST', `/api/documents/${docId}/undo`);
check('undo conflict', [conflictUndo.status, conflictUndo.body.error.code], [409, 'undo_conflict']);
check('entry dropped', conflictUndo.body.error.stacks.undo_count, 0);
const stockNow = (await table('mara', 'Products')).rows[0].cells[pc['Stock']];
await api(
  'mara',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Products']}/rows/${oak.id}/cells/${pc['Stock']}`,
  { value: '40', revision: stockNow.revision },
);

// DP-63: paste.
const ordersNow = await table('priya', 'Orders');
const pasteWrites = ordersNow.rows.slice(0, 3).map((row, index) => ({
  row_id: row.id,
  column_id: oc['Qty'],
  value: `${index + 7}`,
  revision: row.cells[oc['Qty']].revision,
}));
const paste = await api('priya', 'POST', `/api/documents/${docId}/tables/${ids['Orders']}/cells`, {
  writes: pasteWrites,
});
check('paste status', paste.status, 200);
check(
  'paste cells',
  paste.body.cells.map((cell) => cell.cell.display),
  ['7.0000', '8.0000', '9.0000'],
);
const pasteStale = await api(
  'priya',
  'POST',
  `/api/documents/${docId}/tables/${ids['Orders']}/cells`,
  { writes: pasteWrites },
);
check('paste stale', [pasteStale.status, pasteStale.body.error.conflicts.length], [409, 3]);
const pasteUndo = await api('priya', 'POST', `/api/documents/${docId}/undo`);
check('paste is one entry', pasteUndo.body.undone.kind, 'cell_batch');
check(
  'paste undone',
  (await table('priya', 'Orders')).rows.slice(0, 3).map((row) => row.cells[oc['Qty']].display),
  ['4.0000', '2.0000', '10.0000'],
);
const pasteTooMany = await api(
  'priya',
  'POST',
  `/api/documents/${docId}/tables/${ids['Orders']}/cells`,
  { writes: new Array(501).fill(pasteWrites[0]) },
);
check('paste limit', [pasteTooMany.status, pasteTooMany.body.error.fields.writes], [
  422,
  'Send 1 to 500 cell writes.',
]);
const pasteDuplicate = await api(
  'priya',
  'POST',
  `/api/documents/${docId}/tables/${ids['Orders']}/cells`,
  { writes: [pasteWrites[0], pasteWrites[0]] },
);
check('paste duplicate', pasteDuplicate.body.error.fields.writes, 'Each cell can be written once per paste.');

// DP-95: idempotency.
const target = (await table('priya', 'Orders')).rows[0];
const key = 'check-key-1';
const firstCommit = await api(
  'priya',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Orders']}/rows/${target.id}/cells/${oc['Qty']}`,
  { value: 5, revision: target.cells[oc['Qty']].revision },
  { 'idempotency-key': key },
);
const replay = await api(
  'priya',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Orders']}/rows/${target.id}/cells/${oc['Qty']}`,
  { value: 5, revision: target.cells[oc['Qty']].revision },
  { 'idempotency-key': key },
);
check('replay status', replay.status, firstCommit.status);
check('replay body', JSON.stringify(replay.body), JSON.stringify(firstCommit.body));
check('replay header', replay.headers.get('idempotent-replayed'), 'true');
check('first not replayed', firstCommit.headers.get('idempotent-replayed'), null);
const reused = await api(
  'priya',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Orders']}/rows/${target.id}/cells/${oc['Qty']}`,
  { value: 6, revision: firstCommit.body.cell.revision },
  { 'idempotency-key': key },
);
check('reused key', [reused.status, reused.body.error.fields.idempotency_key], [
  422,
  'This key was already used for a different change.',
]);
const badKey = await api(
  'priya',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Orders']}/rows/${target.id}/cells/${oc['Qty']}`,
  { value: 6, revision: firstCommit.body.cell.revision },
  { 'idempotency-key': 'bad key!' },
);
check('malformed key', [badKey.status, badKey.body.error.fields.idempotency_key], [
  422,
  'Send a key of 1 to 100 letters, digits, hyphens or underscores.',
]);
await api('priya', 'POST', `/api/documents/${docId}/undo`);

// DP-85: a row delete racing a cell write.
const raceRow = (await table('priya', 'Orders')).rows[4];
const raceWrite = await api(
  'priya',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Orders']}/rows/${raceRow.id}/cells/${oc['Qty']}`,
  { value: 3, revision: raceRow.cells[oc['Qty']].revision },
);
check('race write ok', raceWrite.status, 200);
const staleDelete = await api(
  'priya',
  'DELETE',
  `/api/documents/${docId}/tables/${ids['Orders']}/rows/${raceRow.id}?revision=${raceRow.revision}`,
);
check('stale delete', [staleDelete.status, staleDelete.body.error.code], [409, 'stale_revision']);
check('stale delete current row', staleDelete.body.error.current.row.id, raceRow.id);
const freshRow = (await table('priya', 'Orders')).rows[4];
const goodDelete = await api(
  'priya',
  'DELETE',
  `/api/documents/${docId}/tables/${ids['Orders']}/rows/${freshRow.id}?revision=${freshRow.revision}`,
);
check('delete ok', goodDelete.status, 200);
const writeGoneRow = await api(
  'priya',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Orders']}/rows/${freshRow.id}/cells/${oc['Qty']}`,
  { value: 1, revision: 1 },
);
check('write to deleted row', [writeGoneRow.status, writeGoneRow.body.error.code], [404, 'not_found']);
const previewGone = await api(
  'priya',
  'POST',
  `/api/documents/${docId}/tables/${ids['Orders']}/formula-preview`,
  { formula: '[Qty]', row_id: freshRow.id },
);
check('preview on deleted row', [previewGone.status, previewGone.body.error.fields.row_id], [
  422,
  'Choose a row in this table.',
]);
await api('priya', 'POST', `/api/documents/${docId}/undo`);
await api('priya', 'POST', `/api/documents/${docId}/undo`);

// DP-89: history and revisions.
const history = await api('sam', 'GET', `/api/documents/${docId}/history`);
const revisions = history.body.entries.map((entry) => entry.revision);
check(
  'history revisions run without gaps',
  revisions.every((revision, index) => revision === index + 1),
  true,
);
const finalRead = await api('mara', 'GET', `/api/documents/${docId}`);
check('document revision matches history', finalRead.body.document.revision, revisions.length);

// DP-92: counts equal a fresh read.
const freshOrders = await table('mara', 'Orders');
check('orders row count', freshOrders.rows.length, 5);
check(
  'orders qty values',
  freshOrders.rows.map((row) => row.cells[oc['Qty']].display),
  ['4.0000', '2.0000', '10.0000', '6.0000', '3.0000'],
);
const freshProducts = await table('mara', 'Products');
check(
  'products stock left',
  freshProducts.rows.map((row) => row.cells[pc['Stock Left']].display),
  ['30.0000', '10.0000', '140.0000', '22.0000'],
);

done();
