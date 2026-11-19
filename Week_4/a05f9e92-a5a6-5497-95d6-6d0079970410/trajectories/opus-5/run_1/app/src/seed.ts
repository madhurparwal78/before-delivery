/**
 * Seed data for Marlowe Quarry Architects. Inserted only when the database is
 * empty, and restored whole by the grading reset.
 */

import { createHash, randomBytes } from 'node:crypto';

import { iso, now, nowMs } from './clock';
import { query, setSequence, transaction, type PoolClient } from './db';
import type { RoleKey } from './domain/roles';

export function hashPassword(password: string, salt: string): string {
  return `${salt}:${createHash('sha256').update(`${salt}:${password}`).digest('hex')}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt] = stored.split(':');
  return hashPassword(password, salt) === stored;
}

export function newSalt(): string {
  return randomBytes(8).toString('hex');
}

interface SeedUser {
  readonly username: string;
  readonly displayName: string;
  readonly roles: readonly RoleKey[];
  readonly department: string;
  readonly timeZone?: string;
}

const users: readonly SeedUser[] = [
  { username: 'oona', displayName: 'Oona Petrakis', roles: ['operator'], department: 'IT provider' },
  { username: 'teodor', displayName: 'Teodor Lindqvist', roles: ['technician'], department: 'IT provider' },
  { username: 'bastian', displayName: 'Bastian Quell', roles: ['technician'], department: 'IT provider' },
  { username: 'ruth', displayName: 'Ruth Abernathy', roles: ['requester'], department: 'Design Studio' },
  { username: 'kofi', displayName: 'Kofi Marsh', roles: ['requester'], department: 'Finance' },
  { username: 'ana', displayName: 'Ana Feld', roles: ['approver', 'requester'], department: 'Finance' },
  { username: 'dev', displayName: 'Devika Raman', roles: ['approver', 'requester'], department: 'Design Studio' },
  { username: 'jonas', displayName: 'Jonas Brandt', roles: ['approver', 'requester'], department: 'Studio Operations' },
  { username: 'mae', displayName: 'Mae Castellan', roles: ['manager', 'requester'], department: 'Design Studio' },
  {
    username: 'hugo',
    displayName: 'Hugo Varga',
    roles: ['manager', 'requester'],
    department: 'Finance',
    timeZone: 'Europe/Lisbon',
  },
];

const departments = ['IT provider', 'Design Studio', 'Finance', 'Studio Operations', 'Leadership'];

interface DirectoryPerson {
  readonly username: string;
  readonly displayName: string;
  readonly department: string;
}

function directoryPeople(): DirectoryPerson[] {
  const out: DirectoryPerson[] = [];
  for (let i = 1; i <= 45; i += 1) {
    const n = String(i).padStart(2, '0');
    out.push({ username: `design${n}`, displayName: `Design staff ${n}`, department: 'Design Studio' });
  }
  for (let i = 1; i <= 6; i += 1) {
    const n = String(i).padStart(2, '0');
    out.push({ username: `fin${n}`, displayName: `Finance staff ${n}`, department: 'Finance' });
  }
  for (let i = 1; i <= 13; i += 1) {
    const n = String(i).padStart(2, '0');
    out.push({ username: `ops${n}`, displayName: `Operations staff ${n}`, department: 'Studio Operations' });
  }
  for (let i = 1; i <= 6; i += 1) {
    const n = String(i).padStart(2, '0');
    out.push({ username: `lead${n}`, displayName: `Leadership staff ${n}`, department: 'Leadership' });
  }
  return out;
}

const officeHolidays = [
  '2026-01-01',
  '2026-04-03',
  '2026-04-06',
  '2026-05-01',
  '2026-05-14',
  '2026-05-25',
  '2026-10-03',
  '2026-12-25',
  '2026-12-26',
];

interface SeedCi {
  readonly name: string;
  readonly className: string;
  readonly criticality: number;
  readonly businessCritical?: boolean;
  readonly attributes?: Record<string, unknown>;
  readonly usedByDepartments?: readonly string[];
  readonly usedByPeople?: readonly string[];
}

const cis: readonly SeedCi[] = [
  {
    name: 'Payroll',
    className: 'Business service',
    criticality: 3,
    businessCritical: true,
    usedByDepartments: ['Finance', 'Leadership'],
    usedByPeople: ['ops01'],
  },
  {
    name: 'Project files',
    className: 'Business service',
    criticality: 3,
    businessCritical: true,
    usedByDepartments: ['Design Studio', 'Studio Operations'],
  },
  {
    name: 'Mail',
    className: 'Business service',
    criticality: 3,
    businessCritical: true,
    usedByDepartments: ['Design Studio', 'Finance', 'Studio Operations', 'Leadership'],
  },
  {
    name: 'Sign-in',
    className: 'Business service',
    criticality: 3,
    businessCritical: true,
    usedByDepartments: ['Design Studio', 'Finance', 'Studio Operations', 'Leadership'],
  },
  {
    name: 'Remote access',
    className: 'Business service',
    criticality: 2,
    usedByDepartments: ['Design Studio', 'Leadership'],
  },
  {
    name: 'Printing',
    className: 'Business service',
    criticality: 1,
    usedByDepartments: ['Design Studio', 'Studio Operations'],
  },
  { name: 'Payroll app', className: 'Application', criticality: 3, attributes: { version: '4.2' } },
  { name: 'Mail relay', className: 'Application', criticality: 3, attributes: { version: '2.8' } },
  { name: 'Directory', className: 'Application', criticality: 3, attributes: { version: '9.1' } },
  { name: 'File gateway', className: 'Application', criticality: 3, attributes: { version: '3.4' } },
  { name: 'Print server', className: 'Application', criticality: 1, attributes: { version: '1.7' } },
  {
    name: 'payroll-vm',
    className: 'Virtual server',
    criticality: 3,
    attributes: { operating_system: 'Linux', location: 'Kanal rack 1', host_name: 'Host cluster' },
  },
  {
    name: 'mail-vm',
    className: 'Virtual server',
    criticality: 3,
    attributes: { operating_system: 'Linux', location: 'Kanal rack 1', host_name: 'Host cluster' },
  },
  {
    name: 'dir-vm',
    className: 'Virtual server',
    criticality: 3,
    attributes: { operating_system: 'Linux', location: 'Kanal rack 1', host_name: 'Host cluster' },
  },
  {
    name: 'print-vm',
    className: 'Virtual server',
    criticality: 1,
    attributes: { operating_system: 'Linux', location: 'Kanal rack 2', host_name: 'Host cluster' },
  },
  {
    name: 'host-a',
    className: 'Server',
    criticality: 2,
    attributes: { operating_system: 'Linux', location: 'Kanal rack 1' },
  },
  {
    name: 'host-b',
    className: 'Server',
    criticality: 2,
    attributes: { operating_system: 'Linux', location: 'Kanal rack 1' },
  },
  {
    name: 'host-c',
    className: 'Server',
    criticality: 2,
    attributes: { operating_system: 'Linux', location: 'Kanal rack 2' },
  },
  { name: 'Host cluster', className: 'Cluster', criticality: 3, attributes: { required_healthy: 2 } },
  { name: 'File cluster', className: 'Cluster', criticality: 3, attributes: { required_healthy: 2 } },
  {
    name: 'fs-node-1',
    className: 'Server',
    criticality: 2,
    attributes: { operating_system: 'Linux', location: 'Hafen rack 1' },
  },
  {
    name: 'fs-node-2',
    className: 'Server',
    criticality: 2,
    attributes: { operating_system: 'Linux', location: 'Hafen rack 1' },
  },
  {
    name: 'fs-node-3',
    className: 'Server',
    criticality: 2,
    attributes: { operating_system: 'Linux', location: 'Hafen rack 2' },
  },
  { name: 'Core switch', className: 'Network device', criticality: 3, attributes: { location: 'Kanal rack 0' } },
  { name: 'VPN gateway', className: 'Network device', criticality: 2, attributes: { location: 'Kanal rack 0' } },
  { name: 'Main storage array', className: 'Storage', criticality: 3, attributes: { capacity_gb: 96000 } },
];

const relationships: readonly [string, string, string][] = [
  ['Payroll', 'depends on', 'Payroll app'],
  ['Payroll', 'depends on', 'Sign-in'],
  ['Project files', 'depends on', 'File gateway'],
  ['Project files', 'depends on', 'Sign-in'],
  ['Mail', 'depends on', 'Mail relay'],
  ['Mail', 'depends on', 'Sign-in'],
  ['Sign-in', 'depends on', 'Directory'],
  ['Remote access', 'depends on', 'VPN gateway'],
  ['Remote access', 'depends on', 'Sign-in'],
  ['Printing', 'depends on', 'Print server'],
  ['Payroll app', 'runs on', 'payroll-vm'],
  ['Mail relay', 'runs on', 'mail-vm'],
  ['Directory', 'runs on', 'dir-vm'],
  ['Print server', 'runs on', 'print-vm'],
  ['File gateway', 'runs on', 'File cluster'],
  ['payroll-vm', 'hosted by', 'Host cluster'],
  ['mail-vm', 'hosted by', 'Host cluster'],
  ['dir-vm', 'hosted by', 'Host cluster'],
  ['print-vm', 'hosted by', 'Host cluster'],
  ['host-a', 'member of', 'Host cluster'],
  ['host-b', 'member of', 'Host cluster'],
  ['host-c', 'member of', 'Host cluster'],
  ['fs-node-1', 'member of', 'File cluster'],
  ['fs-node-2', 'member of', 'File cluster'],
  ['fs-node-3', 'member of', 'File cluster'],
  ['Host cluster', 'depends on', 'Main storage array'],
  ['Host cluster', 'depends on', 'Core switch'],
  ['File cluster', 'depends on', 'Core switch'],
  ['VPN gateway', 'depends on', 'Core switch'],
];

const catalogItems = [
  {
    id: 'laptop',
    name: 'Laptop',
    workflow: 'Laptop fulfilment',
    variables: [
      {
        name: 'model',
        label: 'Model',
        type: 'select',
        required: true,
        default: null,
        choices: [
          { value: 'standard14', label: 'Standard 14-inch', when: null },
          { value: 'studio16', label: 'Studio 16-inch', when: null },
        ],
      },
      {
        name: 'memory',
        label: 'Memory',
        type: 'select',
        required: true,
        default: null,
        choices: [
          { value: '16', label: '16 GB', when: { variable: 'model', equals: 'standard14' } },
          { value: '32', label: '32 GB', when: { variable: 'model', equals: 'studio16' } },
          { value: '64', label: '64 GB', when: { variable: 'model', equals: 'studio16' } },
        ],
      },
      {
        name: 'justification',
        label: 'Why you need it',
        type: 'multiline',
        required: false,
        default: null,
        choices: [],
      },
    ],
  },
  {
    id: 'software-licence',
    name: 'Software licence',
    workflow: 'Standard fulfilment',
    variables: [
      {
        name: 'seat',
        label: 'Seat type',
        type: 'select',
        required: true,
        default: null,
        choices: [
          { value: 'cad', label: 'CAD seat', when: null },
          { value: 'render', label: 'Rendering seat', when: null },
          { value: 'suite', label: 'Design suite', when: null },
        ],
      },
      { name: 'cost_centre', label: 'Cost centre', type: 'text', required: false, default: null, choices: [] },
    ],
  },
  {
    id: 'building-pass',
    name: 'Building pass',
    workflow: 'Standard fulfilment',
    variables: [
      {
        name: 'office',
        label: 'Office',
        type: 'select',
        required: true,
        default: null,
        choices: [
          { value: 'kanal', label: 'Kanal office', when: null },
          { value: 'hafen', label: 'Hafen office', when: null },
        ],
      },
      { name: 'start_date', label: 'Start date', type: 'date', required: true, default: null, choices: [] },
    ],
  },
  {
    id: 'shared-drive',
    name: 'Shared drive access',
    workflow: 'Drive access',
    variables: [
      {
        name: 'drive',
        label: 'Drive',
        type: 'select',
        required: true,
        default: null,
        choices: [
          { value: 'projects', label: 'Projects', when: null },
          { value: 'finance', label: 'Finance', when: null },
          { value: 'archive', label: 'Archive', when: null },
        ],
      },
      {
        name: 'access',
        label: 'Access level',
        type: 'select',
        required: true,
        default: null,
        choices: [
          { value: 'read', label: 'Read', when: null },
          { value: 'write', label: 'Write', when: { variable: 'drive', equals: 'projects' } },
          { value: 'write', label: 'Write', when: { variable: 'drive', equals: 'finance' } },
        ],
      },
    ],
  },
];

const workflows = [
  {
    name: 'Laptop fulfilment',
    steps: [
      {
        id: 'trigger',
        type: 'trigger',
        name: 'Laptop ordered',
        on: 'item_ordered',
        table: 'request_item',
        items: ['laptop'],
        condition: 'true',
      },
      {
        id: 'studio_check',
        type: 'if',
        name: 'Studio model',
        condition: 'variables.model = "studio16"',
        then: [
          {
            id: 'studio_approval',
            type: 'approval',
            name: 'Studio laptop approval',
            approvers: { kind: 'department_approvers', user: null },
            rule: 'any',
          },
        ],
        else: [],
      },
      {
        id: 'prepare',
        type: 'create_task',
        name: 'Prepare laptop',
        group: 'Desk',
        short_description: 'Prepare laptop',
        wait: true,
      },
      { id: 'deliver', type: 'set_fields', name: 'Deliver', fields: { state: '"delivered"' } },
    ],
  },
  {
    name: 'Standard fulfilment',
    steps: [
      {
        id: 'trigger',
        type: 'trigger',
        name: 'Item ordered',
        on: 'item_ordered',
        table: 'request_item',
        items: ['software-licence', 'building-pass'],
        condition: 'true',
      },
      {
        id: 'fulfil',
        type: 'create_task',
        name: 'Fulfil request',
        group: 'Desk',
        short_description: 'Fulfil request',
        wait: true,
      },
      { id: 'deliver', type: 'set_fields', name: 'Deliver', fields: { state: '"delivered"' } },
    ],
  },
  {
    name: 'Drive access',
    steps: [
      {
        id: 'trigger',
        type: 'trigger',
        name: 'Drive ordered',
        on: 'item_ordered',
        table: 'request_item',
        items: ['shared-drive'],
        condition: 'true',
      },
      {
        id: 'write_check',
        type: 'if',
        name: 'Write access',
        condition: 'variables.access = "write"',
        then: [
          {
            id: 'write_approval',
            type: 'approval',
            name: 'Drive write approval',
            approvers: { kind: 'department_approvers', user: null },
            rule: 'any',
          },
        ],
        else: [],
      },
      {
        id: 'grant',
        type: 'create_task',
        name: 'Grant drive access',
        group: 'Desk',
        short_description: 'Grant drive access',
        wait: true,
      },
      { id: 'deliver', type: 'set_fields', name: 'Deliver', fields: { state: '"delivered"' } },
    ],
  },
];

const queues = [
  { name: 'Open incidents', filter: 'state in ["new", "assigned", "in_progress", "on_hold"]', order: 10 },
  {
    name: 'My work',
    filter: 'assigned_to.username = me() and state in ["new", "assigned", "in_progress", "on_hold"]',
    order: 20,
  },
  { name: 'Unassigned', filter: 'is_empty(assigned_to) and state in ["new", "assigned"]', order: 30 },
  {
    name: 'Awaiting requester',
    filter: 'state = "on_hold" and hold_reason = "awaiting_requester"',
    order: 40,
  },
  {
    name: 'Major incidents',
    filter: 'is_major = true and state in ["new", "assigned", "in_progress", "on_hold"]',
    order: 50,
  },
];

const articles = [
  {
    number: 'ART-000001',
    title: 'Clearing an A1 plotter jam',
    keywords: ['plotter', 'jam', 'paper'],
    body: 'Open the front cover, lift the green lever and pull the sheet towards you. Reload the roll before closing.',
    yes: 4,
    no: 0,
    audience: { roles: [], departments: [] },
    validUntil: null as string | null,
  },
  {
    number: 'ART-000002',
    title: 'Connecting to Remote access from home',
    keywords: ['vpn', 'remote', 'home'],
    body: 'Start the Remote access client, choose Marlowe Office and sign in with your usual password. If it drops, restart your home router.',
    yes: 2,
    no: 1,
    audience: { roles: [], departments: [] },
    validUntil: null,
  },
  {
    number: 'ART-000003',
    title: 'Resetting your sign-in password',
    keywords: ['password', 'reset', 'locked'],
    body: 'Use the Reset password link on the sign-in page. After five failed tries the account locks for fifteen minutes.',
    yes: 0,
    no: 0,
    audience: { roles: [], departments: [] },
    validUntil: null,
  },
  {
    number: 'ART-000004',
    title: 'Payroll export checklist',
    keywords: ['payroll', 'export', 'contractors'],
    body: 'Check that every contractor has a cost centre before running the monthly export.',
    yes: 0,
    no: 0,
    audience: { roles: [], departments: ['Finance'] },
    validUntil: null,
  },
  {
    number: 'ART-000005',
    title: 'Installing the old plotter driver',
    keywords: ['plotter', 'driver'],
    body: 'Download the driver from the print server share and run the installer.',
    yes: 0,
    no: 0,
    audience: { roles: [], departments: [] },
    validUntil: '2026-06-30',
  },
];

const dashboardWidgets = [
  {
    id: 'open-by-priority',
    title: 'Open by priority',
    kind: 'bar',
    table: 'incident',
    filter: 'state in ["new", "assigned", "in_progress", "on_hold"]',
    group_by: 'priority',
    bucket: null,
    date_field: null,
  },
  {
    id: 'breached-slas',
    title: 'Breached SLAs',
    kind: 'count',
    table: 'incident',
    filter: 'sla_breached = true and state in ["new", "assigned", "in_progress", "on_hold"]',
    group_by: null,
    bucket: null,
    date_field: null,
  },
  {
    id: 'opened-per-day',
    title: 'Opened per day',
    kind: 'trend',
    table: 'incident',
    filter: '',
    group_by: null,
    bucket: 'day',
    date_field: 'created_at',
  },
  {
    id: 'open-major-incidents',
    title: 'Open major incidents',
    kind: 'count',
    table: 'incident',
    filter: 'is_major = true and state in ["new", "assigned", "in_progress", "on_hold"]',
    group_by: null,
    bucket: null,
    date_field: null,
  },
];

export async function isEmptyDatabase(): Promise<boolean> {
  const rows = await query<{ n: string }>(`SELECT count(*) AS n FROM person`);
  return Number(rows[0]?.n ?? 0) === 0;
}

/** Deletes every row the app owns, so the seed can be laid down again. */
export async function clearAll(client: PoolClient): Promise<void> {
  const tables = [
    'record_activity',
    'record_audit',
    'record_link',
    'sla_instance',
    'attachment',
    'presence',
    'approval_vote',
    'approval_step',
    'item_approval',
    'page',
    'inbox_item',
    'inbox_rule',
    'cart_line',
    'idempotency_record',
    'workflow_run',
    'workflow_version',
    'workflow',
    'knowledge_vote',
    'knowledge_article',
    'export_job',
    'import_job',
    'config_set',
    'config_item_origin',
    'saved_filter',
    'dashboard',
    'major_proposal',
    'maintenance_window',
    'ci_relationship',
    'configuration_item',
    'freeze_window',
    'board',
    'escalation_policy',
    'rotation_override',
    'rotation',
    'form_policy',
    'assignment_rule',
    'access_rule',
    'business_rule',
    'sla_definition',
    'business_schedule',
    'catalog_item',
    'order_guide',
    'record',
    'session',
    'audit_log',
    'work_group',
    'person',
    'department',
    'sequence_counter',
    'app_state',
    'background_state',
  ];
  for (const table of tables) await client.query(`DELETE FROM ${table}`);
}

export async function seed(): Promise<void> {
  await transaction(async (client) => {
    await insertSeed(client);
  });
}

export async function reseed(): Promise<void> {
  await transaction(async (client) => {
    await clearAll(client);
    await insertSeed(client);
  });
}

async function insertSeed(client: PoolClient): Promise<void> {
  const at = now();
  const createdAt = nowMs();

  for (const name of departments) {
    await client.query(`INSERT INTO department (name) VALUES ($1)`, [name]);
  }

  for (const user of users) {
    await client.query(
      `INSERT INTO person (username, display_name, department, password_hash, roles, time_zone,
                           active, can_sign_in, digest)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, TRUE, TRUE, 'immediate')`,
      [
        user.username,
        user.displayName,
        user.department,
        hashPassword(`${user.username}-yard-2026`, newSalt()),
        JSON.stringify(user.roles),
        user.timeZone ?? 'Europe/Berlin',
      ],
    );
  }

  for (const person of directoryPeople()) {
    await client.query(
      `INSERT INTO person (username, display_name, department, roles, time_zone, active, can_sign_in)
       VALUES ($1, $2, $3, '[]'::jsonb, 'Europe/Berlin', TRUE, FALSE)`,
      [person.username, person.displayName, person.department],
    );
  }

  await client.query(
    `INSERT INTO work_group (name, members, escalation_policy)
     VALUES ('Desk', $1::jsonb, 'Desk ladder'), ('Triage', '[]'::jsonb, NULL)`,
    [JSON.stringify(['oona', 'teodor', 'bastian'])],
  );

  const officeHours = {
    mon: [['08:00', '17:00']],
    tue: [['08:00', '17:00']],
    wed: [['08:00', '17:00']],
    thu: [['08:00', '17:00']],
    fri: [['08:00', '17:00']],
    sat: [],
    sun: [],
  };
  const allDay = {
    mon: [['00:00', '24:00']],
    tue: [['00:00', '24:00']],
    wed: [['00:00', '24:00']],
    thu: [['00:00', '24:00']],
    fri: [['00:00', '24:00']],
    sat: [['00:00', '24:00']],
    sun: [['00:00', '24:00']],
  };
  await client.query(
    `INSERT INTO business_schedule (name, time_zone, hours, holidays) VALUES
     ('Office hours', 'Europe/Berlin', $1::jsonb, $2::jsonb),
     ('Around the clock', 'Europe/Berlin', $3::jsonb, '[]'::jsonb)`,
    [JSON.stringify(officeHours), JSON.stringify(officeHolidays), JSON.stringify(allDay)],
  );

  await client.query(
    `INSERT INTO sla_definition (name, table_name, start_expr, pause_expr, stop_expr, schedule, targets) VALUES
     ('Incident response', 'incident', 'true', 'state = "on_hold"', 'state != "new"', 'Office hours', $1::jsonb),
     ('Incident resolution', 'incident', 'true', 'state = "on_hold"', 'state in ["resolved", "closed", "cancelled"]', 'Office hours', $2::jsonb),
     ('Request fulfilment', 'request_item', 'true', 'state = "awaiting_approval"', 'state in ["delivered", "closed", "rejected", "cancelled"]', 'Office hours', $3::jsonb)`,
    [
      JSON.stringify({ '1': 900, '2': 1800, '3': 3600, '4': 14400, '5': 28800 }),
      JSON.stringify({ '1': 14400, '2': 32400, '3': 64800, '4': 129600, '5': 259200 }),
      JSON.stringify({ '1': 97200, '2': 97200, '3': 97200, '4': 97200, '5': 97200 }),
    ],
  );

  for (const ci of cis) {
    await client.query(
      `INSERT INTO configuration_item (name, class_name, criticality, business_critical, owner_department,
                                       status, attributes, used_by_departments, used_by_people)
       VALUES ($1, $2, $3, $4, 'IT provider', 'healthy', $5::jsonb, $6::jsonb, $7::jsonb)`,
      [
        ci.name,
        ci.className,
        ci.criticality,
        ci.businessCritical ?? false,
        JSON.stringify(ci.attributes ?? {}),
        JSON.stringify(ci.usedByDepartments ?? []),
        JSON.stringify(ci.usedByPeople ?? []),
      ],
    );
  }

  for (const [source, type, target] of relationships) {
    await client.query(
      `INSERT INTO ci_relationship (source, rel_type, target) VALUES ($1, $2, $3)`,
      [source, type, target],
    );
  }

  await client.query(
    `INSERT INTO freeze_window (name, start_at, end_at, time_zone, scope) VALUES
     ('Payroll freeze', $1, $2, 'Europe/Berlin', $3::jsonb),
     ('Year-end freeze', $4, $5, 'Europe/Berlin', '"all"'::jsonb)`,
    [
      new Date('2026-11-24T23:00:00Z'),
      new Date('2026-11-30T23:00:00Z'),
      JSON.stringify({ items: ['Payroll'] }),
      new Date('2026-12-20T23:00:00Z'),
      new Date('2027-01-03T23:00:00Z'),
    ],
  );

  await client.query(
    `INSERT INTO board (name, rule, n, threshold_percent, window_hours, members) VALUES
     ('Change board', 'weighted', NULL, 60, 48, $1::jsonb),
     ('Emergency board', 'any', NULL, NULL, 1, $2::jsonb)`,
    [
      JSON.stringify([
        { username: 'ana', weight: 2 },
        { username: 'dev', weight: 1 },
        { username: 'jonas', weight: 1 },
      ]),
      JSON.stringify([
        { username: 'ana', weight: 1 },
        { username: 'dev', weight: 1 },
        { username: 'jonas', weight: 1 },
      ]),
    ],
  );

  await client.query(
    `INSERT INTO rotation (name, time_zone, handover_weekday, handover_time, members, anchor_date)
     VALUES ('Weekly on-call', 'Europe/Berlin', 'monday', '09:00', $1::jsonb, '2026-01-05')`,
    [JSON.stringify(['teodor', 'bastian'])],
  );

  await client.query(
    `INSERT INTO escalation_policy (name, levels) VALUES ('Desk ladder', $1::jsonb)`,
    [
      JSON.stringify([
        { target: { rotation: 'Weekly on-call' }, ack_minutes: null },
        { target: { user: 'oona' }, ack_minutes: null },
      ]),
    ],
  );

  await client.query(
    `INSERT INTO assignment_rule (name, run_order, table_name, condition_expr, group_name) VALUES
     ('Payroll to Desk', 100, 'incident', 'configuration_item.name = "Payroll"', 'Desk'),
     ('Everything to Desk', 200, 'incident', 'true', 'Desk')`,
  );

  await client.query(
    `INSERT INTO business_rule (name, table_name, when_run, run_order, operations, condition_expr, actions)
     VALUES ('Major incidents are resolved', 'incident', 'before', 100, $1::jsonb,
             'is_major = true and changes_to(state, "cancelled")', $2::jsonb)`,
    [
      JSON.stringify(['insert', 'update']),
      JSON.stringify([{ abort: 'Major incidents are resolved, not cancelled.' }]),
    ],
  );

  await client.query(
    `INSERT INTO access_rule (name, rule_type, table_name, field, operation, roles, condition_expr) VALUES
     ('Affected person hidden from managers', 'field', 'incident', 'affected_person', 'read', $1::jsonb, NULL),
     ('Confidential incidents', 'row', 'incident', NULL, 'read', $2::jsonb, 'confidential = true')`,
    [JSON.stringify(['manager']), JSON.stringify(['technician', 'manager', 'approver'])],
  );

  await client.query(
    `INSERT INTO form_policy (name, table_name, catalog_item, run_order, condition_expr, actions) VALUES
     ('Studio laptops need a reason', NULL, 'laptop', 100, 'variables.model = "studio16"', $1::jsonb),
     ('Laptop reason hidden otherwise', NULL, 'laptop', 50, 'true', $2::jsonb),
     ('Cost centre is fixed', NULL, 'software-licence', 100, 'true', $3::jsonb),
     ('Hold reason when on hold', 'incident', NULL, 100, 'state = "on_hold"', $4::jsonb),
     ('Hold reason hidden otherwise', 'incident', NULL, 50, 'true', $5::jsonb)`,
    [
      JSON.stringify([{ field: 'justification', mandatory: true, visible: true, read_only: null }]),
      JSON.stringify([{ field: 'justification', mandatory: false, visible: false, read_only: null }]),
      JSON.stringify([{ field: 'cost_centre', mandatory: null, visible: null, read_only: true }]),
      JSON.stringify([{ field: 'hold_reason', mandatory: true, visible: true, read_only: null }]),
      JSON.stringify([{ field: 'hold_reason', mandatory: null, visible: false, read_only: null }]),
    ],
  );

  for (const item of catalogItems) {
    await client.query(
      `INSERT INTO catalog_item (id, name, variables, workflow) VALUES ($1, $2, $3::jsonb, $4)`,
      [item.id, item.name, JSON.stringify(item.variables), item.workflow],
    );
  }

  await client.query(
    `INSERT INTO order_guide (id, name, questions, rules) VALUES ('new-starter', 'New starter', $1::jsonb, $2::jsonb)`,
    [
      JSON.stringify([
        {
          name: 'role',
          label: "New starter's role",
          type: 'select',
          required: true,
          default: null,
          choices: [
            { value: 'architect', label: 'Architect', when: null },
            { value: 'finance', label: 'Finance', when: null },
            { value: 'operations', label: 'Operations', when: null },
          ],
        },
      ]),
      JSON.stringify([
        { item: 'laptop', condition: 'true' },
        { item: 'software-licence', condition: 'answers.role = "architect"' },
        { item: 'shared-drive', condition: 'true' },
        { item: 'building-pass', condition: 'true' },
      ]),
    ],
  );

  for (const flow of workflows) {
    await client.query(
      `INSERT INTO workflow (id, name, kind, inputs, outputs, draft)
       VALUES ($1, $2, 'flow', '[]'::jsonb, '[]'::jsonb, $3::jsonb)`,
      [flow.name, flow.name, JSON.stringify(flow.steps)],
    );
    await client.query(
      `INSERT INTO workflow_version (workflow_id, version, steps, created_at)
       VALUES ($1, 1, $2::jsonb, $3)`,
      [flow.name, JSON.stringify(flow.steps), at],
    );
  }

  for (const queue of queues) {
    await client.query(
      `INSERT INTO saved_filter (name, table_name, filter_text, shared, owner, queue_order)
       VALUES ($1, 'incident', $2, TRUE, NULL, $3)`,
      [queue.name, queue.filter, queue.order],
    );
  }

  for (const article of articles) {
    await client.query(
      `INSERT INTO knowledge_article (number, version, title, body, keywords, state, valid_until,
                                      helpful_yes, helpful_no, audience, author, published_at)
       VALUES ($1, 1, $2, $3, $4::jsonb, 'published', $5, $6, $7, $8::jsonb, 'oona', $9)`,
      [
        article.number,
        article.title,
        article.body,
        JSON.stringify(article.keywords),
        article.validUntil,
        article.yes,
        article.no,
        JSON.stringify(article.audience),
        at,
      ],
    );
  }

  for (const [id, name] of [
    ['desk-overview', 'Desk overview'],
    ['department-standing', 'Department standing'],
  ]) {
    await client.query(`INSERT INTO dashboard (id, name, widgets) VALUES ($1, $2, $3::jsonb)`, [
      id,
      name,
      JSON.stringify(dashboardWidgets),
    ]);
  }

  await seedRecords(client, createdAt);

  await client.query(
    `INSERT INTO sequence_counter (prefix, next_value) VALUES
     ('BRK-', 4), ('ROOT-', 2), ('ALT-', 2), ('ASK-', 1), ('ITM-', 1), ('JOB-', 1), ('ART-', 6), ('SET-', 1)`,
  );
}

async function seedRecords(client: PoolClient, createdAt: number): Promise<void> {
  const stamp = iso(new Date(createdAt));

  const incidents = [
    {
      number: 'BRK-000001',
      state: 'assigned',
      fields: {
        short_description: 'Plotter on level 2 jams on A1 sheets',
        description: 'The level 2 plotter jams whenever an A1 sheet is loaded from the roll.',
        caller: 'ruth',
        configuration_item: 'Printing',
        impact: 3,
        urgency: 2,
        priority: 4,
        assignment_group: 'Desk',
        assigned_to: 'teodor',
        confidential: false,
        is_major: false,
        sla_breached: false,
      },
    },
    {
      number: 'BRK-000002',
      state: 'in_progress',
      fields: {
        short_description: 'Payroll export missing two contractors',
        description: 'The monthly payroll export leaves out two contractors with no cost centre.',
        caller: 'kofi',
        configuration_item: 'Payroll',
        impact: 2,
        urgency: 1,
        priority: 1,
        assignment_group: 'Desk',
        assigned_to: 'oona',
        confidential: false,
        is_major: false,
        sla_breached: false,
      },
    },
    {
      number: 'BRK-000003',
      state: 'new',
      fields: {
        short_description: 'Remote access drops every 20 minutes from home',
        description: 'Remote access drops about every twenty minutes when working from home.',
        caller: 'dev',
        configuration_item: 'Remote access',
        impact: 3,
        urgency: 3,
        priority: 5,
        confidential: false,
        is_major: false,
        sla_breached: false,
      },
    },
  ];

  for (const incident of incidents) {
    const history =
      incident.state === 'assigned'
        ? [
            { state: 'new', at: stamp },
            { state: 'assigned', at: stamp },
          ]
        : incident.state === 'in_progress'
          ? [
              { state: 'new', at: stamp },
              { state: 'assigned', at: stamp },
              { state: 'in_progress', at: stamp },
            ]
          : [{ state: 'new', at: stamp }];
    await insertRecord(client, {
      number: incident.number,
      table: 'incident',
      state: incident.state,
      fields: { ...incident.fields, created_at: stamp, state: incident.state },
      history,
      createdAt,
      createdBy: 'oona',
    });
  }

  await insertRecord(client, {
    number: 'ROOT-000001',
    table: 'problem',
    state: 'assessing',
    fields: {
      short_description: 'Plotter jams on large sheets',
      description: 'Repeated jams on the level 2 plotter when A1 sheets are used.',
      configuration_item: 'Printing',
      impact: 2,
      urgency: 2,
      priority: 3,
      created_at: stamp,
      state: 'assessing',
    },
    history: [
      { state: 'new', at: stamp },
      { state: 'assessing', at: stamp },
    ],
    createdAt,
    createdBy: 'oona',
  });

  await client.query(
    `UPDATE record SET fields = jsonb_set(fields, '{problem}', '"ROOT-000001"'::jsonb),
            versions = jsonb_set(versions, '{problem}', '1'::jsonb)
     WHERE number = 'BRK-000001'`,
  );

  await insertRecord(client, {
    number: 'ALT-000001',
    table: 'change',
    state: 'draft',
    fields: {
      title: 'Patch print server',
      model: 'normal',
      configuration_item: 'Print server',
      backout_tested: false,
      priority: 5,
      created_at: stamp,
      state: 'draft',
    },
    history: [{ state: 'draft', at: stamp }],
    createdAt,
    createdBy: 'oona',
  });

  // The seeded incidents run their SLAs from the moment the desk was seeded.
  for (const number of ['BRK-000001', 'BRK-000002', 'BRK-000003']) {
    const record = (
      await client.query<{ fields: Record<string, unknown>; state: string }>(
        `SELECT fields, state FROM record WHERE number = $1`,
        [number],
      )
    ).rows[0];
    const priority = Number(record.fields.priority ?? 5);
    const response = { '1': 900, '2': 1800, '3': 3600, '4': 14400, '5': 28800 }[String(priority)] ?? 3600;
    const resolution = { '1': 14400, '2': 32400, '3': 64800, '4': 129600, '5': 259200 }[String(priority)] ?? 64800;
    if (record.state === 'new') {
      await client.query(
        `INSERT INTO sla_instance (number, definition, priority, start_at, target_seconds)
         VALUES ($1, 'Incident response', $2, $3, $4)`,
        [number, priority, new Date(createdAt), response],
      );
    }
    await client.query(
      `INSERT INTO sla_instance (number, definition, priority, start_at, target_seconds)
       VALUES ($1, 'Incident resolution', $2, $3, $4)`,
      [number, priority, new Date(createdAt), resolution],
    );
  }
}

interface InsertRecordOptions {
  readonly number: string;
  readonly table: string;
  readonly state: string;
  readonly fields: Record<string, unknown>;
  readonly history: readonly { state: string; at: string }[];
  readonly createdAt: number;
  readonly createdBy: string;
}

async function insertRecord(client: PoolClient, options: InsertRecordOptions): Promise<void> {
  const versions: Record<string, number> = {};
  for (const key of Object.keys(options.fields)) versions[key] = 1;
  versions.state = 1;
  await client.query(
    `INSERT INTO record (number, table_name, state, fields, versions, state_history,
                         created_at, updated_at, created_by, workspace)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $7, $8, 'live')`,
    [
      options.number,
      options.table,
      options.state,
      JSON.stringify(options.fields),
      JSON.stringify(versions),
      JSON.stringify(options.history),
      new Date(options.createdAt),
      options.createdBy,
    ],
  );
}

export { users as seedUsers, setSequence };
