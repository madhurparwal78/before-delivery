import { deriveFromPage } from '../shared/derive';
import type { PageDocument } from '../shared/types';
import { hashPassword } from './crypto';
import { query, queryOne } from './db';

interface SeedPerson {
  id: string;
  displayName: string;
  email: string;
  password: string;
}

const PEOPLE: readonly SeedPerson[] = [
  {
    id: '1a9d7c30-0001-4a00-8000-000000000001',
    displayName: 'Dana Okafor',
    email: 'dana.okafor@harborlane.test',
    password: 'Harbor-Lead-2026!',
  },
  {
    id: '1a9d7c30-0002-4a00-8000-000000000002',
    displayName: 'Ravi Sato',
    email: 'ravi.sato@harborlane.test',
    password: 'Harbor-Net-2026!a',
  },
  {
    id: '1a9d7c30-0003-4a00-8000-000000000003',
    displayName: 'Jo Mendes',
    email: 'jo.mendes@harborlane.test',
    password: 'Harbor-Net-2026!b',
  },
  {
    id: '1a9d7c30-0004-4a00-8000-000000000004',
    displayName: 'Lee Varga',
    email: 'lee.varga@northgate-qsa.test',
    password: 'Northgate-QSA-2026!',
  },
  {
    id: '1a9d7c30-0005-4a00-8000-000000000005',
    displayName: 'Morgan Fell',
    email: 'morgan.fell@harborlane.test',
    password: 'Harbor-Ops-2026!',
  },
  {
    id: '1a9d7c30-0006-4a00-8000-000000000006',
    displayName: 'Sam Whitlow',
    email: 'sam.whitlow@kestrelpay.test',
    password: 'Kestrel-Owner-2026!',
  },
];

const HARBOR_DIAGRAM = '5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01';
const HARBOR_NETWORK_PAGE = '5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e11';
const HARBOR_FLOWS_PAGE = '5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12';
const KESTREL_DIAGRAM = '9b7e1c44-0a3d-4f2e-8c55-61d2a9f0b702';
const KESTREL_PAGE = '9b7e1c44-0a3d-4f2e-8c55-61d2a9f0b712';

const networkPage: PageDocument = {
  id: HARBOR_NETWORK_PAGE,
  name: 'Network diagram',
  version: 1,
  zones: [
    {
      id: 'net-cde',
      kind: 'cde',
      name: 'Cardholder Data Environment',
      note: 'Segmented by <b>VLAN 20</b>',
      x: 480,
      y: 96,
      width: 576,
      height: 432,
    },
  ],
  shapes: [
    { id: 'net-firewall', kind: 'firewall', label: 'Edge firewall', x: 168, y: 264, width: 144, height: 72, z: 1, groupId: null },
    { id: 'net-switch', kind: 'router', label: 'CDE core switch', x: 600, y: 264, width: 144, height: 72, z: 2, groupId: null },
  ],
  connectors: [
    {
      id: 'net-trunk',
      label: 'VLAN 20 trunk',
      from: { shapeId: 'net-firewall', port: 'e' },
      to: { shapeId: 'net-switch', port: 'w' },
      points: [
        [312, 300],
        [600, 300],
      ],
    },
  ],
};

const flowsPage: PageDocument = {
  id: HARBOR_FLOWS_PAGE,
  name: 'Account data flows',
  version: 1,
  zones: [
    { id: 'zone-connected', kind: 'connected', name: 'Connected-to systems', note: '', x: 48, y: 96, width: 384, height: 432 },
    {
      id: 'zone-cde',
      kind: 'cde',
      name: 'Cardholder Data Environment',
      note: 'Reviewed with assessor<br>September 2026',
      x: 480,
      y: 96,
      width: 576,
      height: 432,
    },
    { id: 'zone-out', kind: 'out_of_scope', name: 'Out of scope', note: '', x: 1104, y: 96, width: 384, height: 432 },
  ],
  shapes: [
    { id: 'shp-checkout', kind: 'web_app', label: 'Checkout web app', x: 168, y: 168, width: 144, height: 72, z: 1, groupId: null },
    { id: 'shp-admin', kind: 'workstation', label: 'Admin workstation', x: 168, y: 360, width: 144, height: 72, z: 2, groupId: null },
    { id: 'shp-payapi', kind: 'api_service', label: 'Payment API', x: 600, y: 168, width: 144, height: 72, z: 3, groupId: null },
    { id: 'shp-vault', kind: 'database', label: 'Card vault', x: 600, y: 360, width: 144, height: 72, z: 4, groupId: null },
    { id: 'shp-settle', kind: 'server', label: 'Settlement batch', x: 840, y: 360, width: 144, height: 72, z: 5, groupId: null },
    { id: 'shp-analytics', kind: 'cloud_service', label: 'Analytics', x: 1224, y: 168, width: 144, height: 72, z: 6, groupId: null },
    { id: 'shp-acquirer', kind: 'third_party', label: 'Acquirer gateway', x: 1224, y: 600, width: 144, height: 72, z: 7, groupId: null },
    { id: 'shp-fraud', kind: 'api_service', label: 'Fraud screening', x: 600, y: 600, width: 144, height: 72, z: 8, groupId: null },
  ],
  connectors: [
    {
      id: 'con-checkout-pay',
      label: 'Card data <b>(TLS)</b>',
      from: { shapeId: 'shp-checkout', port: 'e' },
      to: { shapeId: 'shp-payapi', port: 'w' },
      points: [
        [312, 204],
        [600, 204],
      ],
    },
    {
      id: 'con-pay-vault',
      label: 'Token lookup',
      from: { shapeId: 'shp-payapi', port: 's' },
      to: { shapeId: 'shp-vault', port: 'n' },
      points: [
        [672, 240],
        [672, 360],
      ],
    },
    {
      id: 'con-vault-settle',
      label: 'Batch records',
      from: { shapeId: 'shp-vault', port: 'e' },
      to: { shapeId: 'shp-settle', port: 'w' },
      points: [
        [744, 396],
        [840, 396],
      ],
    },
    {
      id: 'con-settle-acq',
      label: 'Settlement file',
      from: { shapeId: 'shp-settle', port: 'e' },
      to: { shapeId: 'shp-acquirer', port: 'n' },
      points: [
        [984, 396],
        [1080, 396],
        [1080, 576],
        [1296, 576],
        [1296, 600],
      ],
    },
    {
      id: 'con-admin-pay',
      label: 'Admin console',
      from: { shapeId: 'shp-admin', port: 'e' },
      to: { shapeId: 'shp-vault', port: 'w' },
      points: [
        [312, 396],
        [600, 396],
      ],
    },
    {
      id: 'con-pay-analytics',
      label: 'Order events (no card data)',
      from: { shapeId: 'shp-payapi', port: 'n' },
      to: { shapeId: 'shp-analytics', port: 'n' },
      points: [
        [672, 168],
        [672, 144],
        [1296, 144],
        [1296, 168],
      ],
    },
    {
      id: 'con-fraud-settle',
      label: 'Risk score',
      from: { shapeId: 'shp-fraud', port: 'e' },
      to: { shapeId: 'shp-settle', port: 's' },
      points: [
        [744, 636],
        [912, 636],
        [912, 432],
      ],
    },
  ],
};

const kestrelPage: PageDocument = {
  id: KESTREL_PAGE,
  name: 'Processing scope',
  version: 1,
  zones: [
    { id: 'ks-cde', kind: 'cde', name: 'Cardholder Data Environment', note: '', x: 0, y: 0, width: 480, height: 360 },
  ],
  shapes: [
    { id: 'ks-switch', kind: 'server', label: 'Kestrel switch', x: 96, y: 96, width: 144, height: 72, z: 1, groupId: null },
  ],
  connectors: [],
};

async function seedPerson(person: SeedPerson): Promise<void> {
  const existing = await queryOne<{ id: string }>('select id from users where email = $1', [person.email]);
  if (existing) return;
  const passwordHash = await hashPassword(person.password);
  await query(
    `insert into users (id, email, display_name, password_hash)
     values ($1, $2, $3, $4)
     on conflict do nothing`,
    [person.id, person.email, person.displayName, passwordHash],
  );
}

async function seedPage(diagramId: string, doc: PageDocument): Promise<void> {
  await query(
    `insert into pages (id, diagram_id, name, version, doc, derived)
     values ($1, $2, $3, $4, $5, $6)
     on conflict do nothing`,
    [doc.id, diagramId, doc.name, doc.version, JSON.stringify(doc), JSON.stringify(deriveFromPage(doc))],
  );
}

export async function applySeed(): Promise<void> {
  for (const person of PEOPLE) await seedPerson(person);

  const byEmail = new Map<string, string>();
  for (const person of PEOPLE) {
    const row = await queryOne<{ id: string }>('select id from users where email = $1', [person.email]);
    if (row) byEmail.set(person.email, row.id);
  }
  const dana = byEmail.get('dana.okafor@harborlane.test');
  const ravi = byEmail.get('ravi.sato@harborlane.test');
  const jo = byEmail.get('jo.mendes@harborlane.test');
  const lee = byEmail.get('lee.varga@northgate-qsa.test');
  const sam = byEmail.get('sam.whitlow@kestrelpay.test');
  if (!dana || !ravi || !jo || !lee || !sam) throw new Error('seed people missing');

  await query(
    `insert into diagrams (id, title, owner_id) values ($1, $2, $3) on conflict do nothing`,
    [HARBOR_DIAGRAM, 'Harbor Lane CDE scope', dana],
  );
  await query(
    `insert into diagrams (id, title, owner_id) values ($1, $2, $3) on conflict do nothing`,
    [KESTREL_DIAGRAM, 'Kestrel Pay processing scope', sam],
  );

  await seedPage(HARBOR_DIAGRAM, networkPage);
  await seedPage(HARBOR_DIAGRAM, flowsPage);
  await seedPage(KESTREL_DIAGRAM, kestrelPage);

  const shares: Array<{ id: string; email: string; role: 'editor' | 'viewer' }> = [
    { id: '2b8e6d41-0001-4a00-8000-000000000001', email: 'ravi.sato@harborlane.test', role: 'editor' },
    { id: '2b8e6d41-0002-4a00-8000-000000000002', email: 'jo.mendes@harborlane.test', role: 'editor' },
    { id: '2b8e6d41-0003-4a00-8000-000000000003', email: 'lee.varga@northgate-qsa.test', role: 'viewer' },
  ];
  for (const share of shares) {
    await query(
      `insert into shares (id, diagram_id, email, role, status, delivery)
       values ($1, $2, $3, $4, 'active', 'sent')
       on conflict do nothing`,
      [share.id, HARBOR_DIAGRAM, share.email, share.role],
    );
  }
}
