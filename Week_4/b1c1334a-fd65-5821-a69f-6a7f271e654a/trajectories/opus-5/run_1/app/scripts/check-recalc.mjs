import { api, check, done, signIn } from './apicheck.mjs';

await signIn('mara');
await signIn('dev');
await signIn('priya');

const docs = await api('mara', 'GET', '/api/documents');
const docId = docs.body.documents.find((d) => d.name === 'Harbour Lane Ops').id;
const read = await api('mara', 'GET', `/api/documents/${docId}`);
const ids = Object.fromEntries(read.body.tables.map((t) => [t.name, t.id]));

const table = async (who, name) =>
  (await api(who, 'GET', `/api/documents/${docId}/tables/${ids[name]}`)).body.table;
const cols = (t) => Object.fromEntries(t.columns.map((c) => [c.name, c.id]));
const rowByDisplay = (t, columnId, display) =>
  t.rows.find((row) => row.cells[columnId].display === display);

const products = await table('mara', 'Products');
const pc = cols(products);
const orders = await table('mara', 'Orders');
const oc = cols(orders);
const summary = await table('mara', 'Orders by Region');
const sc = cols(summary);

const oak = rowByDisplay(products, pc['Name'], 'Oak Shelf Bracket');
const ord1001 = rowByDisplay(orders, oc['Order No'], 'ORD-1001');

const describe = (recalc) =>
  recalc.cells.map((cell) => [cell.old_display, cell.new_display, cell.depth]);

// Example: a price change.
let priceRevision = oak.cells[pc['Price']].revision;
const priceChange = await api(
  'mara',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Products']}/rows/${oak.id}/cells/${pc['Price']}`,
  { value: 13, revision: priceRevision },
);
check('price change status', priceChange.status, 200);
check('price change cell', priceChange.body.cell.display, '13.0000');
check('price change list', describe(priceChange.body.recalc), [
  ['50.0000', '52.0000', 1],
  ['75.0000', '78.0000', 1],
  ['271.1000', '273.1000', 2],
  ['211.0000', '214.0000', 2],
]);
check(
  'price change sentence',
  priceChange.body.recalc.sentence,
  'Recalculated 4 cells in 2 tables.',
);
check('price change revision', priceChange.body.recalc.document_revision, read.body.document.revision + 1);
check('price change stacks', priceChange.body.recalc.stacks, { undo_count: 1, redo_count: 0 });

// The same edit seen by Dev (own rows).
const devPrice = await api(
  'dev',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Products']}/rows/${oak.id}/cells/${pc['Price']}`,
  { value: '12.5', revision: priceChange.body.cell.revision },
);
check("dev's list", describe(devPrice.body.recalc), [
  ['52.0000', '50.0000', 1],
  ['273.1000', '271.1000', 2],
]);
check("dev's sentence", devPrice.body.recalc.sentence, 'Recalculated 2 cells in 2 tables.');
await api('dev', 'POST', `/api/documents/${docId}/undo`);

// Put the price back, so the rest of the run starts from the seed values.
const currentPrice = (await table('mara', 'Products')).rows.find((row) => row.id === oak.id)
  .cells[pc['Price']];
const restorePrice = await api(
  'mara',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Products']}/rows/${oak.id}/cells/${pc['Price']}`,
  { value: '12.5', revision: currentPrice.revision },
);
check('price restored', restorePrice.body.cell.display, '12.5000');

// Stale revision.
const stale = await api(
  'mara',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Products']}/rows/${oak.id}/cells/${pc['Price']}`,
  { value: 99, revision: priceRevision },
);
check('stale status', stale.status, 409);
check('stale code', stale.body.error.code, 'stale_revision');
check('stale current', stale.body.error.current.display, '12.5000');

// Decimal exactness.
const qtyCell = ord1001.cells[oc['Qty']];
const exact = await api(
  'mara',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Orders']}/rows/${ord1001.id}/cells/${oc['Qty']}`,
  { value: 1.00005, revision: qtyCell.revision },
);
check('1.00005 stored', exact.body.cell.display, '1.0001');
const negative = await api(
  'mara',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Orders']}/rows/${ord1001.id}/cells/${oc['Qty']}`,
  { value: '-0.00004', revision: exact.body.cell.revision },
);
check('-0.00004 stored', negative.body.cell.display, '0.0000');
const exponent = await api(
  'mara',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Orders']}/rows/${ord1001.id}/cells/${oc['Qty']}`,
  { value: '1e3', revision: negative.body.cell.revision },
);
check('exponent refused', [exponent.status, exponent.body.error.fields.value], [
  422,
  'Enter a number with up to 15 digits before the decimal point.',
]);
const restoreQty = await api(
  'mara',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Orders']}/rows/${ord1001.id}/cells/${oc['Qty']}`,
  { value: '4', revision: negative.body.cell.revision },
);
check('qty restored', restoreQty.body.cell.display, '4.0000');

// Example: the roll example's five cells.
const roll = await api(
  'mara',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Orders']}/rows/${ord1001.id}/cells/${oc['Qty']}`,
  { value: '4.16', revision: restoreQty.body.cell.revision },
);
check('roll list', describe(roll.body.recalc), [
  ['10.0000', '10.1600', 1],
  ['50.0000', '52.0000', 1],
  ['17.0000', '17.1600', 1],
  ['30.0000', '29.8400', 2],
  ['271.1000', '273.1000', 2],
]);
check('roll sentence', roll.body.recalc.sentence, 'Recalculated 5 cells in 3 tables.');
await api('mara', 'POST', `/api/documents/${docId}/undo`);

// Example: deleting a product and undoing it.
const oakRow = (await table('priya', 'Products')).rows.find((row) => row.id === oak.id);
const del = await api(
  'priya',
  'DELETE',
  `/api/documents/${docId}/tables/${ids['Products']}/rows/${oak.id}?revision=${oakRow.revision}`,
);
check('delete status', del.status, 200);
check('delete list', describe(del.body.recalc), [
  ['Oak Shelf Bracket', '#REF!', 1],
  ['Oak Shelf Bracket', '#REF!', 1],
  ['50.0000', '#REF!', 2],
  ['75.0000', '#REF!', 2],
  ['271.1000', '#REF!', 3],
  ['211.0000', '#REF!', 3],
]);
check('delete sentence', del.body.recalc.sentence, 'Recalculated 6 cells in 2 tables.');
check('delete row counts', del.body.recalc.row_counts[ids['Products']], 3);

const undo = await api('priya', 'POST', `/api/documents/${docId}/undo`);
check('undo kind', undo.body.undone.kind, 'row_delete');
check('undo list', describe(undo.body.recalc), [
  ['#REF!', 'Oak Shelf Bracket', 1],
  ['#REF!', 'Oak Shelf Bracket', 1],
  [null, '10.0000', 2],
  ['#REF!', '50.0000', 2],
  ['#REF!', '75.0000', 2],
  [null, '30.0000', 3],
  ['#REF!', '271.1000', 3],
  ['#REF!', '211.0000', 3],
]);
check('undo sentence', undo.body.recalc.sentence, 'Recalculated 8 cells in 3 tables.');
check('undo row counts', undo.body.recalc.row_counts[ids['Products']], 4);

// Example: creating a summary of Orders by Customer.
const newSummary = await api('mara', 'POST', `/api/documents/${docId}/summaries`, {
  source_table_id: ids['Orders'],
  group_by: [oc['Customer']],
  sum_columns: [oc['Qty']],
});
check('summary status', newSummary.status, 201);
check('summary name', newSummary.body.table.name, 'Orders by Customer');
check(
  'summary list',
  newSummary.body.recalc.cells.map((cell) => [cell.new_display, cell.old_display, cell.depth]),
  [
    ['Pell & Daughters Catering', null, 1],
    ['2.0000', null, 1],
    ['7.0000', null, 1],
    ['Greyfield Installers, Ltd', null, 1],
    ['2.0000', null, 1],
    ['8.0000', null, 1],
    ['Moss Street Bakery', null, 1],
    ['1.0000', null, 1],
    ['10.0000', null, 1],
  ],
);
check('summary sentence', newSummary.body.recalc.sentence, 'Recalculated 9 cells in 1 table.');
check(
  'summary row count',
  newSummary.body.recalc.row_counts[newSummary.body.table.id],
  3,
);

// Example: making and breaking a cycle.
const columnA = await api(
  'mara',
  'POST',
  `/api/documents/${docId}/tables/${ids['Products']}/columns`,
  { name: 'A', type: 'formula', formula: '[B] + 1' },
);
check('column A cells', describe(columnA.body.recalc), [
  [null, '#NAME?', 1],
  [null, '#NAME?', 1],
  [null, '#NAME?', 1],
  [null, '#NAME?', 1],
]);
const columnB = await api(
  'mara',
  'POST',
  `/api/documents/${docId}/tables/${ids['Products']}/columns`,
  { name: 'B', type: 'formula', formula: '[A] + 1' },
);
check('cycle list', describe(columnB.body.recalc), [
  ['#NAME?', '#CIRC!', 1],
  [null, '#CIRC!', 1],
  ['#NAME?', '#CIRC!', 1],
  [null, '#CIRC!', 1],
  ['#NAME?', '#CIRC!', 1],
  [null, '#CIRC!', 1],
  ['#NAME?', '#CIRC!', 1],
  [null, '#CIRC!', 1],
]);
check('cycle sentence', columnB.body.recalc.sentence, 'Recalculated 8 cells in 1 table.');

const breakCycle = await api(
  'mara',
  'PATCH',
  `/api/documents/${docId}/tables/${ids['Products']}/columns/${columnB.body.column.id}`,
  { formula: '5', revision: columnB.body.column.revision },
);
check('break list', describe(breakCycle.body.recalc), [
  ['#CIRC!', '5.0000', 1],
  ['#CIRC!', '5.0000', 1],
  ['#CIRC!', '5.0000', 1],
  ['#CIRC!', '5.0000', 1],
  ['#CIRC!', '6.0000', 2],
  ['#CIRC!', '6.0000', 2],
  ['#CIRC!', '6.0000', 2],
  ['#CIRC!', '6.0000', 2],
]);
check('break sentence', breakCycle.body.recalc.sentence, 'Recalculated 8 cells in 1 table.');

// Column rename rewrites formulas.
const priceColumn = products.columns.find((c) => c.name === 'Price');
const rename = await api(
  'mara',
  'PATCH',
  `/api/documents/${docId}/tables/${ids['Products']}/columns/${priceColumn.id}`,
  { name: 'Unit Price', revision: priceColumn.revision },
);
check('rename status', rename.status, 200);
const afterRename = await table('mara', 'Orders');
check(
  'rewritten formula',
  afterRename.columns.find((c) => c.name === 'Line Total').formula,
  '[Qty] * [Product].[Unit Price]',
);
check('rename list empty', rename.body.recalc.cells.length, 0);
check('renamed column revision', rename.body.column.revision, priceColumn.revision + 1);
const undoRename = await api('mara', 'POST', `/api/documents/${docId}/undo`);
check('undo rename kind', undoRename.body.undone.kind, 'column_update');
check(
  'formula restored',
  (await table('mara', 'Orders')).columns.find((c) => c.name === 'Line Total').formula,
  '[Qty] * [Product].[Price]',
);

// Table rename rewrites formulas and summary names.
const tableRename = await api(
  'mara',
  'PATCH',
  `/api/documents/${docId}/tables/${ids['Orders']}`,
  { name: 'Sales', revision: 1 },
);
check('table rename status', tableRename.status, 200);
const renamedProducts = await table('mara', 'Products');
check(
  'rewritten aggregate',
  renamedProducts.columns.find((c) => c.name === 'Units Ordered').formula,
  'SUMBY(Sales.[Qty], Sales.[Product])',
);
const renamedDoc = await api('mara', 'GET', `/api/documents/${docId}`);
check(
  'summary renamed',
  renamedDoc.body.tables.map((t) => t.name),
  ['Products', 'Customers', 'Sales', 'Sales by Region', 'Sales by Customer'],
);
const undoTableRename = await api('mara', 'POST', `/api/documents/${docId}/undo`);
check('undo table rename kind', undoTableRename.body.undone.kind, 'table_rename');
check(
  'aggregate restored',
  (await table('mara', 'Products')).columns.find((c) => c.name === 'Units Ordered').formula,
  'SUMBY(Orders.[Qty], Orders.[Product])',
);

// Clean up the extra columns and summary for later runs.
for (const columnId of [columnA.body.column.id, columnB.body.column.id]) {
  await api(
    'mara',
    'DELETE',
    `/api/documents/${docId}/tables/${ids['Products']}/columns/${columnId}`,
  );
}

done();
