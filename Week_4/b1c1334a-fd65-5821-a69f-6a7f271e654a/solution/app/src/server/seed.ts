// The first-start seed: the invented Harbour Lane accounts and their Harbour Lane Ops document.
import { hashPassword } from "./auth.js";
import type { Db } from "./db.js";
import type { ColumnRec, ColumnType, DocState, RowRec, TableRec } from "./model.js";
import { cellKey } from "./model.js";
import { newId } from "./ops.js";
import { persistState } from "./store.js";

const PASSWORD = "ledger-demo-2026";

const PEOPLE = [
  { name: "Mara Lindqvist", email: "mara@harbourlane.test" },
  { name: "Dev Okafor", email: "dev@harbourlane.test" },
  { name: "Priya Raman", email: "priya@harbourlane.test" },
  { name: "Sam Whitlock", email: "sam@harbourlane.test" },
  { name: "Jonah Reyes", email: "jonah@harbourlane.test" },
];

export async function seed(db: Db): Promise<void> {
  const ids = new Map<string, string>();
  for (const person of PEOPLE) {
    const id = newId("u");
    ids.set(person.email, id);
    await db.query("INSERT INTO accounts (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)", [
      id, person.email, person.name, await hashPassword(PASSWORD),
    ]);
  }
  const docId = newId("d");
  await db.query("INSERT INTO documents (id, name, owner_id, revision) VALUES ($1, 'Harbour Lane Ops', $2, 0)", [
    docId, ids.get("mara@harbourlane.test"),
  ]);
  for (const [email, role, scope] of [
    ["dev@harbourlane.test", "editor", "own"],
    ["priya@harbourlane.test", "editor", "all"],
    ["sam@harbourlane.test", "viewer", "all"],
  ]) {
    await db.query(
      "INSERT INTO shares (id, document_id, email, role, row_scope, invite_status) VALUES ($1, $2, $3, $4, $5, 'sent')",
      [newId("h"), docId, email, role, scope],
    );
  }

  const state: DocState = { id: docId, name: "Harbour Lane Ops", ownerId: ids.get("mara@harbourlane.test")!, revision: 0, tables: [], columns: [], rows: [], cells: new Map() };
  const table = (name: string): TableRec => {
    const t: TableRec = {
      id: newId("t"), name, kind: "table", revision: 1, ownerColumnId: null, sourceTableId: null, groupBy: [], sumColumns: [],
      seq: state.tables.length + 1, writer: "",
    };
    state.tables.push(t);
    return t;
  };
  const column = (t: TableRec, name: string, type: ColumnType, extra: Partial<ColumnRec> = {}): ColumnRec => {
    const c: ColumnRec = {
      id: newId("c"), tableId: t.id, name, type, formula: null, targetTableId: null,
      position: state.columns.filter((x) => x.tableId === t.id).length, revision: 1, deleted: false, writer: "", ...extra,
    };
    state.columns.push(c);
    return c;
  };
  const row = (t: TableRec, values: [ColumnRec, string | null][]): RowRec => {
    const r: RowRec = { id: newId("r"), tableId: t.id, seq: state.rows.filter((x) => x.tableId === t.id).length + 1, revision: 1, deleted: false, writer: "" };
    state.rows.push(r);
    for (const [c, value] of values) if (value !== null) state.cells.set(cellKey(r.id, c.id), { value, revision: 1, writer: "" });
    return r;
  };

  const products = table("Products");
  const customers = table("Customers");
  const orders = table("Orders");
  const pName = column(products, "Name", "text");
  const sku = column(products, "SKU", "text");
  const price = column(products, "Price", "decimal");
  const stock = column(products, "Stock", "decimal");
  column(products, "Units Ordered", "formula", { formula: "SUMBY(Orders.[Qty], Orders.[Product])" });
  column(products, "Stock Left", "formula", { formula: "[Stock] - [Units Ordered]" });
  const cName = column(customers, "Name", "text");
  const region = column(customers, "Region", "text");
  const phone = column(customers, "Phone", "text");
  const cOwner = column(customers, "Owner", "text");
  customers.ownerColumnId = cOwner.id;
  const orderNo = column(orders, "Order No", "text");
  const customer = column(orders, "Customer", "reference", { targetTableId: customers.id });
  const product = column(orders, "Product", "reference", { targetTableId: products.id });
  const qty = column(orders, "Qty", "decimal");
  const oOwner = column(orders, "Owner", "text");
  column(orders, "Line Total", "formula", { formula: "[Qty] * [Product].[Price]" });
  const oRegion = column(orders, "Region", "formula", { formula: "[Customer].[Region]" });
  orders.ownerColumnId = oOwner.id;

  const p = [
    row(products, [[pName, "Oak Shelf Bracket"], [sku, "OSB-01"], [price, "12.5000"], [stock, "40.0000"]]),
    row(products, [[pName, "Walnut Floating Shelf"], [sku, "WFS-02"], [price, "68.0000"], [stock, "12.0000"]]),
    row(products, [[pName, "Brass Hinge Pair"], [sku, "BHP-03"], [price, "9.7500"], [stock, "150.0000"]]),
    row(products, [[pName, "Birch Ply Sheet"], [sku, "BPS-04"], [price, "41.2000"], [stock, "25.0000"]]),
  ];
  const dev = "dev@harbourlane.test";
  const priya = "priya@harbourlane.test";
  const c = [
    row(customers, [[cName, "Pell & Daughters Catering"], [region, "North"], [phone, "+1-555-0142"], [cOwner, dev]]),
    row(customers, [[cName, "Greyfield Installers, Ltd"], [region, "South"], [phone, "555-0199"], [cOwner, priya]]),
    row(customers, [[cName, "Moss Street Bakery"], [region, "North"], [phone, "+1-555-0178"], [cOwner, dev]]),
  ];
  for (const [no, cust, prod, q, who] of [
    ["ORD-1001", c[0]!, p[0]!, "4.0000", dev],
    ["ORD-1002", c[1]!, p[1]!, "2.0000", priya],
    ["ORD-1003", c[2]!, p[2]!, "10.0000", dev],
    ["ORD-1004", c[1]!, p[0]!, "6.0000", priya],
    ["ORD-1005", c[0]!, p[3]!, "3.0000", dev],
  ] as const) {
    row(orders, [[orderNo, no], [customer, cust.id], [product, prod.id], [qty, q], [oOwner, who]]);
  }
  const summary: TableRec = {
    id: newId("s"), name: "", kind: "summary", revision: 1, ownerColumnId: null, sourceTableId: orders.id,
    groupBy: [oRegion.id], sumColumns: [qty.id, state.columns.find((x) => x.name === "Line Total")!.id], seq: 4, writer: "",
  };
  state.tables.push(summary);

  const empty: DocState = { ...state, tables: [], columns: [], rows: [], cells: new Map() };
  await persistState(db, empty, state);
}
