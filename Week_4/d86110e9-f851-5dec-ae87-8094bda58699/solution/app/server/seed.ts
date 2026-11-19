import { db } from './db.js';
import { applySetup, type ContentSpec, type SetupSpec } from './grading.js';

const PASSWORD = 'switchyard-demo-1';
const SEED_LOCK = 7_272_002;

const orderIntake: ContentSpec = {
  trigger: {
    kind: 'form',
    col: 1,
    row: 2,
    fields: { path: 'order-intake', form_fields: [
      { name: 'customer', label: 'Customer', type: 'text' },
      { name: 'item', label: 'Item', type: 'text' },
      { name: 'quantity', label: 'Quantity', type: 'number' },
    ] },
    sample: { customer: 'Cobalt Studio', item: 'Ribbon', quantity: 12 },
  },
  steps: [
    { id: 's1', kind: 'add_row', name: 'Add row 1', col: 3, row: 2, fields: {
      table: 'tb-orders', values: { customer: '{{trigger.customer}}', item: '{{trigger.item}}', quantity: '{{trigger.quantity}}' } } },
    { id: 's2', kind: 'send_email', name: 'Send email 1', col: 5, row: 2, fields: {
      to: 'imara@fulfilment.example', subject: 'New order from {{trigger.customer}}', body: '{{trigger.quantity}} x {{trigger.item}}' } },
  ],
  edges: [{ from: 'trigger', port: 'out', to: 's1', order: 1 }, { from: 's1', port: 'out', to: 's2', order: 1 }],
};

const seed: SetupSpec = {
  users: [
    { key: 'imara', name: 'Imara Teague', email: 'imara@fulfilment.example', password: PASSWORD },
    { key: 'dov', name: 'Dov Marchetti', email: 'dov@fulfilment.example', password: PASSWORD },
    { key: 'wren', name: 'Wren Adeyemi', email: 'wren@fulfilment.example', password: PASSWORD },
    { key: 'soren', name: 'Soren Hale', email: 'soren@harbor.example', password: PASSWORD },
  ],
  workspaces: [
    {
      key: 'fulfilment', id: 'ws-fulfilment', name: 'Fulfilment Ops', slug: 'fulfilment-ops',
      members: [{ user: 'imara', role: 'owner' }, { user: 'dov', role: 'editor' }, { user: 'wren', role: 'viewer' }],
      tables: [
        { key: 'orders', id: 'tb-orders', name: 'Orders', columns: [{ name: 'customer', type: 'text' }, { name: 'item', type: 'text' }, { name: 'quantity', type: 'number' }],
          rows: [{ customer: 'Cobalt Studio', item: 'Ribbon', quantity: 12 }, { customer: 'Harbor Bakery', item: 'Tape', quantity: 40 }, { customer: 'Lumen Print', item: 'Labels', quantity: 7 }] },
        { key: 'followups', id: 'tb-followups', name: 'Followups', columns: [{ name: 'customer', type: 'text' }, { name: 'position', type: 'number' }] },
      ],
      automations: [{ key: 'intake', id: 'au-order-intake', name: 'Order intake', versions: [orderIntake] }],
    },
    {
      key: 'harbor', id: 'ws-harbor', name: 'Harbor Desk', slug: 'harbor-desk',
      members: [{ user: 'soren', role: 'owner' }],
      automations: [{ key: 'digest', id: 'au-harbor-digest', name: 'Harbor digest', draft: { trigger: { kind: 'manual', col: 1, row: 2, fields: {} }, steps: [], edges: [] } }],
    },
  ],
};

/** Creates the seeded workspaces, tables and automations on first start; later starts find them and change nothing. */
export async function seedIfAbsent(): Promise<void> {
  await db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK]);
    const present = await client.query('SELECT 1 FROM workspaces WHERE id = $1', ['ws-fulfilment']);
    if (present.rows.length === 0) await applySetup(seed, false);
  });
}
