/**
 * Seed data: created only against an empty database, exactly once, under the
 * seed lock, so several instances can start together.
 */
import { PoolClient } from 'pg';
import { makePasswordHash } from './auth.js';
import { newId } from './docstate.js';

const PASSWORD = 'ledger-demo-2026';

const PEOPLE = [
  { displayName: 'Mara Lindqvist', email: 'mara@harbourlane.test' },
  { displayName: 'Dev Okafor', email: 'dev@harbourlane.test' },
  { displayName: 'Priya Raman', email: 'priya@harbourlane.test' },
  { displayName: 'Sam Whitlock', email: 'sam@harbourlane.test' },
  { displayName: 'Jonah Reyes', email: 'jonah@harbourlane.test' },
];

export async function seedIfEmpty(client: PoolClient): Promise<void> {
  const existing = await client.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM persons');
  if (parseInt(existing.rows[0]!.n, 10) > 0) return;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['tallyframe-seed']);
  const again = await client.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM persons');
  if (parseInt(again.rows[0]!.n, 10) > 0) return;

  const hash = await makePasswordHash(PASSWORD);
  const mara = newId();
  await client.query(
    'INSERT INTO persons (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)',
    [mara, 'mara@harbourlane.test', 'Mara Lindqvist', hash],
  );
  for (const p of PEOPLE.slice(1)) {
    await client.query(
      'INSERT INTO persons (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)',
      [newId(), p.email, p.displayName, hash],
    );
  }

  const documentId = newId();
  await client.query(
    'INSERT INTO documents (id, name, owner_person_id, revision) VALUES ($1, $2, $3, 0)',
    [documentId, 'Harbour Lane Ops', mara],
  );

  const mkTable = async (
    name: string,
    kind: 'table' | 'summary',
    position: number,
    sourceTableId: string | null,
    ownerColumnId: string | null,
    groupBy: string[],
    sumColumns: string[],
  ): Promise<string> => {
    const id = newId();
    await client.query(
      `INSERT INTO doc_tables (id, document_id, name, kind, position, source_table_id, revision, owner_column_id, group_by, sum_columns)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8::jsonb, $9::jsonb)`,
      [id, documentId, name, kind, position, sourceTableId, ownerColumnId, JSON.stringify(groupBy), JSON.stringify(sumColumns)],
    );
    return id;
  };
  const mkColumn = async (
    tableId: string,
    name: string,
    type: string,
    position: number,
    formula: string | null = null,
    targetTableId: string | null = null,
    id?: string,
  ): Promise<string> => {
    const columnId = id ?? newId();
    await client.query(
      `INSERT INTO doc_columns (id, table_id, name, type, formula, target_table_id, position, revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
      [columnId, tableId, name, type, formula, targetTableId, position],
    );
    return columnId;
  };
  const mkRow = async (tableId: string, position: number): Promise<string> => {
    const id = newId();
    await client.query(
      'INSERT INTO doc_rows (id, table_id, position, revision, deleted) VALUES ($1, $2, $3, 1, FALSE)',
      [id, tableId, position],
    );
    return id;
  };
  const cells: [string, string, string | null][] = [];
  const setCell = (rowId: string, columnId: string, value: string | null): void => {
    cells.push([rowId, columnId, value]);
  };

  const products = await mkTable('Products', 'table', 1, null, null, [], []);
  const customers = await mkTable('Customers', 'table', 2, null, null, [], []);
  const orders = await mkTable('Orders', 'table', 3, null, null, [], []);

  const pName = await mkColumn(products, 'Name', 'text', 1);
  const pSku = await mkColumn(products, 'SKU', 'text', 2);
  const pPrice = await mkColumn(products, 'Price', 'decimal', 3);
  const pStock = await mkColumn(products, 'Stock', 'decimal', 4);
  const pUnits = await mkColumn(products, 'Units Ordered', 'formula', 5, 'SUMBY(Orders.[Qty], Orders.[Product])');
  const pLeft = await mkColumn(products, 'Stock Left', 'formula', 6, '[Stock] - [Units Ordered]');

  const cName = await mkColumn(customers, 'Name', 'text', 1);
  const cRegion = await mkColumn(customers, 'Region', 'text', 2);
  const cPhone = await mkColumn(customers, 'Phone', 'text', 3);
  const cOwner = await mkColumn(customers, 'Owner', 'text', 4);
  await client.query('UPDATE doc_tables SET owner_column_id = $1 WHERE id = $2', [cOwner, customers]);

  const oNo = await mkColumn(orders, 'Order No', 'text', 1);
  const oCust = await mkColumn(orders, 'Customer', 'reference', 2, null, customers);
  const oProd = await mkColumn(orders, 'Product', 'reference', 3, null, products);
  const oQty = await mkColumn(orders, 'Qty', 'decimal', 4);
  const oOwner = await mkColumn(orders, 'Owner', 'text', 5);
  const oTotal = await mkColumn(orders, 'Line Total', 'formula', 6, '[Qty] * [Product].[Price]');
  const oRegion = await mkColumn(orders, 'Region', 'formula', 7, '[Customer].[Region]');
  await client.query('UPDATE doc_tables SET owner_column_id = $1 WHERE id = $2', [oOwner, orders]);

  const productRows = [
    { name: 'Oak Shelf Bracket', sku: 'OSB-01', price: '12.5000', stock: '40.0000' },
    { name: 'Walnut Floating Shelf', sku: 'WFS-02', price: '68.0000', stock: '12.0000' },
    { name: 'Brass Hinge Pair', sku: 'BHP-03', price: '9.7500', stock: '150.0000' },
    { name: 'Birch Ply Sheet', sku: 'BPS-04', price: '41.2000', stock: '25.0000' },
  ];
  const productIds: string[] = [];
  for (const [i, def] of productRows.entries()) {
    const rowId = await mkRow(products, i + 1);
    productIds.push(rowId);
    setCell(rowId, pName, def.name);
    setCell(rowId, pSku, def.sku);
    setCell(rowId, pPrice, def.price);
    setCell(rowId, pStock, def.stock);
  }

  const customerRows = [
    { name: 'Pell & Daughters Catering', region: 'North', phone: '+1-555-0142', owner: 'dev@harbourlane.test' },
    { name: 'Greyfield Installers, Ltd', region: 'South', phone: '555-0199', owner: 'priya@harbourlane.test' },
    { name: 'Moss Street Bakery', region: 'North', phone: '+1-555-0178', owner: 'dev@harbourlane.test' },
  ];
  const customerIds: string[] = [];
  for (const [i, def] of customerRows.entries()) {
    const rowId = await mkRow(customers, i + 1);
    customerIds.push(rowId);
    setCell(rowId, cName, def.name);
    setCell(rowId, cRegion, def.region);
    setCell(rowId, cPhone, def.phone);
    setCell(rowId, cOwner, def.owner);
  }

  const orderRows = [
    { no: 'ORD-1001', customer: 0, product: 0, qty: '4.0000', owner: 'dev@harbourlane.test' },
    { no: 'ORD-1002', customer: 1, product: 1, qty: '2.0000', owner: 'priya@harbourlane.test' },
    { no: 'ORD-1003', customer: 2, product: 2, qty: '10.0000', owner: 'dev@harbourlane.test' },
    { no: 'ORD-1004', customer: 1, product: 0, qty: '6.0000', owner: 'priya@harbourlane.test' },
    { no: 'ORD-1005', customer: 0, product: 3, qty: '3.0000', owner: 'dev@harbourlane.test' },
  ];
  for (const [i, def] of orderRows.entries()) {
    const rowId = await mkRow(orders, i + 1);
    setCell(rowId, oNo, def.no);
    setCell(rowId, oCust, customerIds[def.customer]!);
    setCell(rowId, oProd, productIds[def.product]!);
    setCell(rowId, oQty, def.qty);
    setCell(rowId, oOwner, def.owner);
  }

  for (const [rowId, columnId, value] of cells) {
    await client.query(
      'INSERT INTO doc_cells (row_id, column_id, value, revision) VALUES ($1, $2, $3, 1)',
      [rowId, columnId, value],
    );
  }

  // the summary of Orders grouped by Region, with the sums of Qty and Line Total
  const summary = await mkTable('Orders by Region', 'summary', 4, orders, null, [oRegion], [oQty, oTotal]);
  await mkColumn(summary, 'Region', 'formula', 1);
  await mkColumn(summary, 'Count', 'decimal', 2);
  await mkColumn(summary, 'Sum of Qty', 'decimal', 3);
  await mkColumn(summary, 'Sum of Line Total', 'decimal', 4);
  // stable group ids for the two seeded groups
  for (const key of ['["text\\u0000North"]', '["text\\u0000South"]']) {
    await client.query(
      'INSERT INTO doc_summary_groups (summary_table_id, document_id, key_json, row_id) VALUES ($1, $2, $3, $4)',
      [summary, documentId, key, newId()],
    );
  }

  // shares: Dev own rows, Priya all rows, Sam a Viewer, all invites sent
  const shareDefs: [string, string, string][] = [
    ['dev@harbourlane.test', 'editor', 'own'],
    ['priya@harbourlane.test', 'editor', 'all'],
    ['sam@harbourlane.test', 'viewer', 'all'],
  ];
  for (const [i, def] of shareDefs.entries()) {
    await client.query(
      'INSERT INTO shares (id, document_id, position, email, role, row_scope, invite_status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [newId(), documentId, i + 1, def[0], def[1], def[2], 'sent'],
    );
  }
}
