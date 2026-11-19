import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import { config } from './config.js';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export type Client = pg.PoolClient;

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  connectionTimeoutMillis: 4000,
  idleTimeoutMillis: 30000,
  statement_timeout: 20000,
});

export class DatabaseUnavailable extends Error {}

export async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  let client: Client;
  try {
    client = await pool.connect();
  } catch {
    throw new DatabaseUnavailable('database unreachable');
  }
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  client: Client,
  run: () => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    const result = await run();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || saltHex === undefined || hashHex === undefined) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

const SCHEMA = `
create table if not exists accounts (
  id text primary key,
  email text not null unique,
  display_name text not null,
  password_hash text not null
);
create table if not exists sessions (
  token text primary key,
  account_id text not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists documents (
  id text primary key,
  name text not null,
  owner_id text not null references accounts(id),
  revision integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists shares (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  email text not null,
  role text not null,
  row_scope text not null,
  invite_status text not null,
  seq bigserial,
  unique (document_id, email)
);
create table if not exists doc_tables (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  name text not null,
  kind text not null,
  revision integer not null default 1,
  owner_column_id text,
  source_table_id text,
  group_by jsonb,
  sum_columns jsonb,
  seq bigserial
);
create table if not exists doc_columns (
  id text primary key,
  table_id text not null references doc_tables(id) on delete cascade,
  name text not null,
  type text not null,
  formula text,
  target_table_id text,
  position integer not null,
  revision integer not null default 1,
  deleted boolean not null default false
);
create table if not exists doc_rows (
  id text primary key,
  table_id text not null references doc_tables(id) on delete cascade,
  revision integer not null default 1,
  seq bigint not null,
  deleted boolean not null default false
);
create table if not exists doc_cells (
  row_id text not null references doc_rows(id) on delete cascade,
  column_id text not null references doc_columns(id) on delete cascade,
  raw text,
  revision integer not null default 1,
  primary key (row_id, column_id)
);
create table if not exists history (
  document_id text not null references documents(id) on delete cascade,
  revision integer not null,
  kind text not null,
  actor_id text not null,
  table_id text,
  primary key (document_id, revision)
);
create table if not exists undo_entries (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  actor_id text not null,
  stack text not null,
  position bigint not null,
  kind text not null,
  payload jsonb not null
);
create table if not exists idempotency_keys (
  document_id text not null,
  actor_id text not null,
  key text not null,
  method text not null,
  path text not null,
  query text not null,
  body text not null,
  status integer not null,
  response text not null,
  created_at timestamptz not null default now(),
  primary key (document_id, actor_id, key)
);
create table if not exists exports (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  table_id text not null,
  file_name text not null,
  status text not null,
  byte_size bigint,
  sha256 text,
  created_by text not null,
  document_revision integer not null,
  created_at timestamptz not null default now()
);
create index if not exists doc_tables_document on doc_tables (document_id, seq);
create index if not exists doc_columns_table on doc_columns (table_id, position);
create index if not exists doc_rows_table on doc_rows (table_id, seq);
create index if not exists exports_document on exports (document_id, created_at desc);
create index if not exists undo_entries_actor on undo_entries (document_id, actor_id, stack, position);
`;

let schemaReady = false;

export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  await withClient(async (client) => {
    await client.query('select pg_advisory_lock(hashtext($1))', ['tallyframe_schema']);
    try {
      await client.query(SCHEMA);
      const accounts = await client.query<{ count: string }>('select count(*) from accounts');
      if ((accounts.rows[0]?.count ?? '0') === '0') await seed(client);
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', ['tallyframe_schema']);
    }
  });
  schemaReady = true;
}

export const SEED_PASSWORD = 'ledger-demo-2026';

type SeedColumn = {
  name: string;
  type: string;
  formula?: string;
  target?: string;
  rowOwner?: boolean;
};

async function seed(client: Client): Promise<void> {
  const people = [
    { email: 'mara@harbourlane.test', name: 'Mara Lindqvist' },
    { email: 'dev@harbourlane.test', name: 'Dev Okafor' },
    { email: 'priya@harbourlane.test', name: 'Priya Raman' },
    { email: 'sam@harbourlane.test', name: 'Sam Whitlock' },
    { email: 'jonah@harbourlane.test', name: 'Jonah Reyes' },
  ];
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const ids = new Map<string, string>();
  for (const person of people) {
    const id = newId('acc');
    ids.set(person.email, id);
    await client.query(
      'insert into accounts (id, email, display_name, password_hash) values ($1, $2, $3, $4)',
      [id, person.email, person.name, passwordHash],
    );
  }

  const documentId = newId('doc');
  await client.query(
    'insert into documents (id, name, owner_id, revision) values ($1, $2, $3, 0)',
    [documentId, 'Harbour Lane Ops', ids.get('mara@harbourlane.test')],
  );
  const shares: Array<[string, string, string]> = [
    ['dev@harbourlane.test', 'editor', 'own'],
    ['priya@harbourlane.test', 'editor', 'all'],
    ['sam@harbourlane.test', 'viewer', 'all'],
  ];
  for (const [email, role, scope] of shares) {
    await client.query(
      `insert into shares (id, document_id, email, role, row_scope, invite_status)
       values ($1, $2, $3, $4, $5, 'sent')`,
      [newId('shr'), documentId, email, role, scope],
    );
  }

  const tableIds = new Map<string, string>();
  const columnIds = new Map<string, string>();
  const rowIds = new Map<string, string>();

  const createTable = async (name: string, columns: SeedColumn[]): Promise<void> => {
    const tableId = newId('tbl');
    tableIds.set(name, tableId);
    await client.query(
      `insert into doc_tables (id, document_id, name, kind, revision) values ($1, $2, $3, 'table', 1)`,
      [tableId, documentId, name],
    );
    let ownerColumnId: string | null = null;
    for (const [position, column] of columns.entries()) {
      const columnId = newId('col');
      columnIds.set(`${name}.${column.name}`, columnId);
      if (column.rowOwner === true) ownerColumnId = columnId;
      await client.query(
        `insert into doc_columns (id, table_id, name, type, formula, target_table_id, position, revision)
         values ($1, $2, $3, $4, $5, $6, $7, 1)`,
        [
          columnId,
          tableId,
          column.name,
          column.type,
          column.formula ?? null,
          column.target === undefined ? null : (tableIds.get(column.target) as string),
          position,
        ],
      );
    }
    if (ownerColumnId !== null) {
      await client.query('update doc_tables set owner_column_id = $2 where id = $1', [
        tableId,
        ownerColumnId,
      ]);
    }
  };

  const addRows = async (table: string, rows: Array<Record<string, string | null>>) => {
    const tableId = tableIds.get(table) as string;
    for (const [index, cells] of rows.entries()) {
      const rowId = newId('row');
      await client.query(
        'insert into doc_rows (id, table_id, revision, seq) values ($1, $2, 1, $3)',
        [rowId, tableId, index + 1],
      );
      for (const [columnName, raw] of Object.entries(cells)) {
        await client.query(
          'insert into doc_cells (row_id, column_id, raw, revision) values ($1, $2, $3, 1)',
          [rowId, columnIds.get(`${table}.${columnName}`), raw],
        );
      }
      rowIds.set(`${table}.${Object.values(cells)[0] as string}`, rowId);
    }
  };

  await createTable('Products', [
    { name: 'Name', type: 'text' },
    { name: 'SKU', type: 'text' },
    { name: 'Price', type: 'decimal' },
    { name: 'Stock', type: 'decimal' },
    { name: 'Units Ordered', type: 'formula', formula: 'SUMBY(Orders.[Qty], Orders.[Product])' },
    { name: 'Stock Left', type: 'formula', formula: '[Stock] - [Units Ordered]' },
  ]);
  await createTable('Customers', [
    { name: 'Name', type: 'text' },
    { name: 'Region', type: 'text' },
    { name: 'Phone', type: 'text' },
    { name: 'Owner', type: 'text', rowOwner: true },
  ]);
  await createTable('Orders', [
    { name: 'Order No', type: 'text' },
    { name: 'Customer', type: 'reference', target: 'Customers' },
    { name: 'Product', type: 'reference', target: 'Products' },
    { name: 'Qty', type: 'decimal' },
    { name: 'Owner', type: 'text', rowOwner: true },
    { name: 'Line Total', type: 'formula', formula: '[Qty] * [Product].[Price]' },
    { name: 'Region', type: 'formula', formula: '[Customer].[Region]' },
  ]);

  await addRows('Products', [
    { Name: 'Oak Shelf Bracket', SKU: 'OSB-01', Price: '12.5000', Stock: '40.0000' },
    { Name: 'Walnut Floating Shelf', SKU: 'WFS-02', Price: '68.0000', Stock: '12.0000' },
    { Name: 'Brass Hinge Pair', SKU: 'BHP-03', Price: '9.7500', Stock: '150.0000' },
    { Name: 'Birch Ply Sheet', SKU: 'BPS-04', Price: '41.2000', Stock: '25.0000' },
  ]);
  await addRows('Customers', [
    {
      Name: 'Pell & Daughters Catering',
      Region: 'North',
      Phone: '+1-555-0142',
      Owner: 'dev@harbourlane.test',
    },
    {
      Name: 'Greyfield Installers, Ltd',
      Region: 'South',
      Phone: '555-0199',
      Owner: 'priya@harbourlane.test',
    },
    {
      Name: 'Moss Street Bakery',
      Region: 'North',
      Phone: '+1-555-0178',
      Owner: 'dev@harbourlane.test',
    },
  ]);
  await addRows('Orders', [
    {
      'Order No': 'ORD-1001',
      Customer: rowIds.get('Customers.Pell & Daughters Catering') ?? null,
      Product: rowIds.get('Products.Oak Shelf Bracket') ?? null,
      Qty: '4.0000',
      Owner: 'dev@harbourlane.test',
    },
    {
      'Order No': 'ORD-1002',
      Customer: rowIds.get('Customers.Greyfield Installers, Ltd') ?? null,
      Product: rowIds.get('Products.Walnut Floating Shelf') ?? null,
      Qty: '2.0000',
      Owner: 'priya@harbourlane.test',
    },
    {
      'Order No': 'ORD-1003',
      Customer: rowIds.get('Customers.Moss Street Bakery') ?? null,
      Product: rowIds.get('Products.Brass Hinge Pair') ?? null,
      Qty: '10.0000',
      Owner: 'dev@harbourlane.test',
    },
    {
      'Order No': 'ORD-1004',
      Customer: rowIds.get('Customers.Greyfield Installers, Ltd') ?? null,
      Product: rowIds.get('Products.Oak Shelf Bracket') ?? null,
      Qty: '6.0000',
      Owner: 'priya@harbourlane.test',
    },
    {
      'Order No': 'ORD-1005',
      Customer: rowIds.get('Customers.Pell & Daughters Catering') ?? null,
      Product: rowIds.get('Products.Birch Ply Sheet') ?? null,
      Qty: '3.0000',
      Owner: 'dev@harbourlane.test',
    },
  ]);

  const ordersId = tableIds.get('Orders') as string;
  await client.query(
    `insert into doc_tables (id, document_id, name, kind, revision, source_table_id, group_by, sum_columns)
     values ($1, $2, $3, 'summary', 1, $4, $5, $6)`,
    [
      newId('tbl'),
      documentId,
      'Orders by Region',
      ordersId,
      JSON.stringify([columnIds.get('Orders.Region')]),
      JSON.stringify([columnIds.get('Orders.Qty'), columnIds.get('Orders.Line Total')]),
    ],
  );
}
