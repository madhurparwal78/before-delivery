import { api, check, done, signIn } from './apicheck.mjs';

const mara = await signIn('mara');
const dev = await signIn('dev');

const documents = await api('mara', 'GET', '/api/documents');
check('documents list', documents.body.documents.length, 1);
const docId = documents.body.documents[0].id;
check('document name', documents.body.documents[0].name, 'Harbour Lane Ops');

const read = await api('mara', 'GET', `/api/documents/${docId}`);
check('revision 0', read.body.document.revision, 0);
check(
  'tables',
  read.body.tables.map((t) => [t.name, t.kind, t.row_count, t.column_count]),
  [
    ['Products', 'table', 4, 6],
    ['Customers', 'table', 3, 4],
    ['Orders', 'table', 5, 7],
    ['Orders by Region', 'summary', 2, 4],
  ],
);

const ids = Object.fromEntries(read.body.tables.map((t) => [t.name, t.id]));
const products = await api('mara', 'GET', `/api/documents/${docId}/tables/${ids['Products']}`);
const columnsOf = (table) => Object.fromEntries(table.columns.map((c) => [c.name, c.id]));
const pcols = columnsOf(products.body.table);
check(
  'products displays',
  products.body.table.rows.map((row) => [
    row.cells[pcols['Name']].display,
    row.cells[pcols['Price']].display,
    row.cells[pcols['Units Ordered']].display,
    row.cells[pcols['Stock Left']].display,
  ]),
  [
    ['Oak Shelf Bracket', '12.5000', '10.0000', '30.0000'],
    ['Walnut Floating Shelf', '68.0000', '2.0000', '10.0000'],
    ['Brass Hinge Pair', '9.7500', '10.0000', '140.0000'],
    ['Birch Ply Sheet', '41.2000', '3.0000', '22.0000'],
  ],
);

const orders = await api('mara', 'GET', `/api/documents/${docId}/tables/${ids['Orders']}`);
const ocols = columnsOf(orders.body.table);
check(
  'orders displays',
  orders.body.table.rows.map((row) => [
    row.cells[ocols['Order No']].display,
    row.cells[ocols['Customer']].display,
    row.cells[ocols['Product']].display,
    row.cells[ocols['Qty']].display,
    row.cells[ocols['Line Total']].display,
    row.cells[ocols['Region']].display,
  ]),
  [
    ['ORD-1001', 'Pell & Daughters Catering', 'Oak Shelf Bracket', '4.0000', '50.0000', 'North'],
    ['ORD-1002', 'Greyfield Installers, Ltd', 'Walnut Floating Shelf', '2.0000', '136.0000', 'South'],
    ['ORD-1003', 'Moss Street Bakery', 'Brass Hinge Pair', '10.0000', '97.5000', 'North'],
    ['ORD-1004', 'Greyfield Installers, Ltd', 'Oak Shelf Bracket', '6.0000', '75.0000', 'South'],
    ['ORD-1005', 'Pell & Daughters Catering', 'Birch Ply Sheet', '3.0000', '123.6000', 'North'],
  ],
);

const summary = await api(
  'mara',
  'GET',
  `/api/documents/${docId}/tables/${ids['Orders by Region']}`,
);
const scols = summary.body.table.columns;
check(
  'summary columns',
  scols.map((c) => c.name),
  ['Region', 'Count', 'Sum of Qty', 'Sum of Line Total'],
);
check(
  'summary rows',
  summary.body.table.rows.map((row) => scols.map((c) => row.cells[c.id].display)),
  [
    ['North', '3.0000', '17.0000', '271.1000'],
    ['South', '2.0000', '8.0000', '211.0000'],
  ],
);

const devOrders = await api('dev', 'GET', `/api/documents/${docId}/tables/${ids['Orders']}`);
check(
  "dev's orders",
  devOrders.body.table.rows.map((row) => row.cells[ocols['Order No']].display),
  ['ORD-1001', 'ORD-1003', 'ORD-1005'],
);
const devProducts = await api('dev', 'GET', `/api/documents/${docId}/tables/${ids['Products']}`);
check(
  "dev's products",
  devProducts.body.table.rows.map((row) => [
    row.cells[pcols['Units Ordered']].display,
    row.cells[pcols['Stock Left']].display,
  ]),
  [
    ['4.0000', '36.0000'],
    ['0.0000', '12.0000'],
    ['10.0000', '140.0000'],
    ['3.0000', '22.0000'],
  ],
);
const devSummary = await api(
  'dev',
  'GET',
  `/api/documents/${docId}/tables/${ids['Orders by Region']}`,
);
check(
  "dev's summary",
  devSummary.body.table.rows.map((row) => scols.map((c) => row.cells[c.id].display)),
  [['North', '3.0000', '17.0000', '271.1000']],
);

const devPreviewCount = await api(
  'dev',
  'POST',
  `/api/documents/${docId}/tables/${ids['Products']}/formula-preview`,
  { formula: 'COUNT(Orders)', row_id: devProducts.body.table.rows[0].id },
);
check("dev's COUNT(Orders)", devPreviewCount.body.display, '3.0000');
const devMax = await api(
  'dev',
  'POST',
  `/api/documents/${docId}/tables/${ids['Products']}/formula-preview`,
  { formula: 'MAX(Orders.[Qty])', row_id: devProducts.body.table.rows[0].id },
);
check("dev's MAX", devMax.body.display, '10.0000');
const devAvg = await api(
  'dev',
  'POST',
  `/api/documents/${docId}/tables/${ids['Products']}/formula-preview`,
  { formula: 'AVERAGE(Orders.[Qty])', row_id: devProducts.body.table.rows[0].id },
);
check("dev's AVERAGE", devAvg.body.display, '5.6667');

const diagnoses = [
  ['1e3', 'Check the formula: it could not be read at character 2.'],
  ['=1e3', 'Check the formula: it could not be read at character 3.'],
  ['[Qty] * * 2', 'Check the formula: it could not be read at character 9.'],
  ['[Qty] * 2)', 'Check the formula: it could not be read at character 10.'],
  ['[Qty] & "each', 'Check the formula: it could not be read at character 9.'],
  ['[Qty', 'Check the formula: it could not be read at character 1.'],
  ['[Qty] # 2', 'Check the formula: it could not be read at character 7.'],
  ['5. + 1', 'Check the formula: it could not be read at character 2.'],
  ['"é" & é', 'Check the formula: it could not be read at character 7.'],
  ['Orders', 'Check the formula: it could not be read at character 1.'],
  ['Foo + 1', 'Check the formula: it could not be read at character 1.'],
  ['Foo.[Qty] + 1', 'Check the formula: it could not be read at character 1.'],
  ['=Orders.[Qty] + 1', 'Check the formula: it could not be read at character 2.'],
  ['SUM(Orders.[Qty] + 1)', 'Check the formula: it could not be read at character 5.'],
  ['[Qty] *', 'Check the formula: it ended too early.'],
  ['SUM(', 'Check the formula: it ended too early.'],
  ['SUM(Orders.[Qty]', 'Check the formula: it ended too early.'],
  ['=', 'Check the formula: it ended too early.'],
];
const firstOrder = orders.body.table.rows[0].id;
for (const [formula, expected] of diagnoses) {
  const reply = await api(
    'mara',
    'POST',
    `/api/documents/${docId}/tables/${ids['Orders']}/formula-preview`,
    { formula, row_id: firstOrder },
  );
  check(`diagnosis ${JSON.stringify(formula)}`, reply.body.diagnosis, expected);
}

const results = [
  ['SUM(Foo.[Qty])', '#NAME?'],
  ['COUNT(Foo)', '#NAME?'],
  ['[Nope] + 1', '#NAME?'],
  ['FOO(1)', '#NAME?'],
  ['true', 'TRUE'],
  ['SUM([Qty])', '#TYPE!'],
  ['COUNT([Qty])', '#TYPE!'],
  ['10/3', '3.3333'],
  ['2/3', '0.6667'],
  ['0 * -1', '0.0000'],
  ['-0.00001 + 0', '0.0000'],
  ['ROUND(2.345, 2)', '2.3500'],
  ['ROUND(-2.345, 2)', '-2.3500'],
  ['ROUND(10/3, 2)', '3.3300'],
  ['"oak" = "Oak"', 'FALSE'],
  ['"B" < "a"', 'TRUE'],
  ['[Product].[Price] & " each"', '12.5000 each'],
  ['1/0', '#DIV/0!'],
  ['IFERROR(1/0, 7)', '7.0000'],
  ['[Qty] * 2', '8.0000'],
  ['IF([Qty] > 3, "big", "small")', 'big'],
  ['MIN(Orders.[Qty])', '2.0000'],
  ['COUNTBY(Orders.[Product])', '#TYPE!'],
];
for (const [formula, expected] of results) {
  const reply = await api(
    'mara',
    'POST',
    `/api/documents/${docId}/tables/${ids['Orders']}/formula-preview`,
    { formula, row_id: firstOrder },
  );
  check(`result ${JSON.stringify(formula)}`, reply.body.display, expected);
}

done();
