import { one, query } from './db';
import { publishContent, saveDraftContent } from './publishing';
import { coerceValues, insertRow } from './tables';
import { workspaceNow } from './time';
import { addMember, createUser, createWorkspace } from './routes/auth';
import type { AutomationContent, JsonObject, Role } from '../shared/types';
import type { TableColumn } from './tables';

const PASSWORD = 'switchyard-demo-1';

interface SeedUser {
  name: string;
  email: string;
}

const people: SeedUser[] = [
  { name: 'Imara Teague', email: 'imara@fulfilment.example' },
  { name: 'Dov Marchetti', email: 'dov@fulfilment.example' },
  { name: 'Wren Adeyemi', email: 'wren@fulfilment.example' },
  { name: 'Soren Hale', email: 'soren@harbor.example' },
];

async function userId(email: string, name: string): Promise<string> {
  const existing = await one<{ id: string }>('select id from users where lower(email) = lower($1)', [email]);
  if (existing !== null) return existing.id;
  return createUser(name, email, PASSWORD, true, null);
}

async function seedTable(
  workspaceId: string,
  id: string,
  name: string,
  columns: TableColumn[],
  rows: JsonObject[],
): Promise<void> {
  const existing = await one('select id from data_tables where id = $1', [id]);
  if (existing !== null) return;
  await query('insert into data_tables (id, workspace_id, name, cols) values ($1, $2, $3, $4)', [
    id,
    workspaceId,
    name,
    JSON.stringify(columns),
  ]);
  const record = { id, workspace_id: workspaceId, name, cols: columns, row_seq: 0 };
  for (const row of rows) {
    const coerced = coerceValues(columns, row, null);
    if (coerced.ok) await insertRow(record, coerced.cells);
  }
}

const orderIntake: AutomationContent = {
  trigger: {
    id: 'trigger',
    kind: 'form',
    name: 'Form trigger',
    col: 1,
    row: 2,
    fields: {
      path: 'order-intake',
      form_fields: [
        { name: 'customer', label: 'Customer', type: 'text' },
        { name: 'item', label: 'Item', type: 'text' },
        { name: 'quantity', label: 'Quantity', type: 'number' },
      ],
    },
    sample: { customer: 'Cobalt Studio', item: 'Ribbon', quantity: 12 },
  },
  steps: [
    {
      id: 's1',
      kind: 'add_row',
      name: 'Add row 1',
      col: 2,
      row: 2,
      fields: {
        table: 'tb-orders',
        values: {
          customer: '{{trigger.customer}}',
          item: '{{trigger.item}}',
          quantity: '{{trigger.quantity}}',
        },
      },
    },
    {
      id: 's2',
      kind: 'send_email',
      name: 'Send email 1',
      col: 3,
      row: 2,
      fields: {
        to: 'imara@fulfilment.example',
        subject: 'New order from {{trigger.customer}}',
        body: '{{trigger.quantity}} x {{trigger.item}}',
      },
    },
  ],
  edges: [
    { id: 'e1', from: 'trigger', port: 'out', to: 's1', order: 1 },
    { id: 'e2', from: 's1', port: 'out', to: 's2', order: 1 },
  ],
};

const harborDigest: AutomationContent = {
  trigger: {
    id: 'trigger',
    kind: 'manual',
    name: 'Manual trigger',
    col: 1,
    row: 2,
    fields: {},
    sample: {},
  },
  steps: [],
  edges: [],
};

async function seedAutomation(
  workspaceId: string,
  id: string,
  name: string,
  content: AutomationContent,
  publish: boolean,
): Promise<void> {
  const existing = await one('select id from automations where id = $1', [id]);
  if (existing !== null) return;
  await query(
    `insert into automations (id, workspace_id, name, trigger_kind, draft, revision)
       values ($1, $2, $3, $4, $5, 0)`,
    [id, workspaceId, name, content.trigger.kind, JSON.stringify(content)],
  );
  await saveDraftContent(id, content);
  if (publish) await publishContent(workspaceId, id, content, 1, await workspaceNow(workspaceId));
}

export async function seed(): Promise<void> {
  const ids = new Map<string, string>();
  for (const person of people) ids.set(person.email, await userId(person.email, person.name));

  const fulfilment = await one('select id from workspaces where id = $1', ['ws-fulfilment']);
  if (fulfilment === null) await createWorkspace('Fulfilment Ops', 'ws-fulfilment', 'fulfilment-ops');
  const harbor = await one('select id from workspaces where id = $1', ['ws-harbor']);
  if (harbor === null) await createWorkspace('Harbor Desk', 'ws-harbor', 'harbor-desk');

  const memberships: [string, string, Role][] = [
    ['ws-fulfilment', 'imara@fulfilment.example', 'owner'],
    ['ws-fulfilment', 'dov@fulfilment.example', 'editor'],
    ['ws-fulfilment', 'wren@fulfilment.example', 'viewer'],
    ['ws-harbor', 'soren@harbor.example', 'owner'],
  ];
  for (const [workspaceId, email, role] of memberships) {
    const id = ids.get(email);
    if (id !== undefined) await addMember(workspaceId, id, role);
  }

  await seedTable(
    'ws-fulfilment',
    'tb-orders',
    'Orders',
    [
      { name: 'customer', type: 'text' },
      { name: 'item', type: 'text' },
      { name: 'quantity', type: 'number' },
    ],
    [
      { customer: 'Cobalt Studio', item: 'Ribbon', quantity: 12 },
      { customer: 'Harbor Bakery', item: 'Tape', quantity: 40 },
      { customer: 'Lumen Print', item: 'Labels', quantity: 7 },
    ],
  );
  await seedTable(
    'ws-fulfilment',
    'tb-followups',
    'Followups',
    [
      { name: 'customer', type: 'text' },
      { name: 'position', type: 'number' },
    ],
    [],
  );

  await seedAutomation('ws-fulfilment', 'au-order-intake', 'Order intake', orderIntake, true);
  await seedAutomation('ws-harbor', 'au-harbor-digest', 'Harbor digest', harborDigest, false);
}
