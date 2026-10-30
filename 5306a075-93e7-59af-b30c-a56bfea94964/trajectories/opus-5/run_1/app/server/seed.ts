import type { FeatureStatus, Importance, NoteSource, Role } from '../shared/types';
import { newId, pool, withTransaction, type Queryable } from './db';
import { sanitiseBody } from './domain/sanitize';
import { loadFeatureWorld } from './repo/features';
import { hashPassword } from './repo/session';

const SEED_PASSWORD = 'evidence-desk-2026';

interface SeedFeature {
  key: string;
  name: string;
  publicDescription: string;
  status: FeatureStatus;
  effort: number;
  confidence: number;
  fits: number[];
  component: string;
  parent?: string;
}

interface SeedNote {
  key: string;
  title: string;
  source: NoteSource;
  contact: string;
  createdAt: string;
  body: string;
}

interface SeedInsight {
  note: string;
  quote: string;
  feature: string;
  importance: Importance;
}

interface SeedWorkspace {
  name: string;
  timeZone: string;
  members: { name: string; email: string; role: Role }[];
  companies: { key: string; name: string; domain: string }[];
  contacts: { key: string; name: string; email: string; company: string }[];
  objectives: { name: string; weight: number }[];
  products: { key: string; name: string; components: { key: string; name: string }[] }[];
  features: SeedFeature[];
  releases: { name: string; targetDate: string; isPublic: boolean; features: string[] }[];
  notes: SeedNote[];
  insights: SeedInsight[];
}

const TALLYRUN: SeedWorkspace = {
  name: 'Tallyrun',
  timeZone: 'America/New_York',
  members: [
    { name: 'Rhea Okafor', email: 'hop@tallyrun.example', role: 'head_of_product' },
    { name: 'Dev Malik', email: 'pm@tallyrun.example', role: 'product_manager' },
    { name: 'Sasha Lind', email: 'pm2@tallyrun.example', role: 'product_manager' },
    { name: 'Imani Brooks', email: 'csm@tallyrun.example', role: 'customer_success' },
  ],
  companies: [
    { key: 'northwind', name: 'Northwind Freight', domain: 'northwindfreight.example' },
    { key: 'northwind-ltd', name: 'Northwind Freight Ltd', domain: 'nwfreight.example' },
    { key: 'orchard', name: 'Orchard Lane Bank', domain: 'orchardlanebank.example' },
    { key: 'bluefin', name: 'Bluefin Clinics', domain: 'bluefinclinics.example' },
  ],
  contacts: [
    { key: 'ana', name: 'Ana Ruiz', email: 'ana@northwindfreight.example', company: 'northwind' },
    { key: 'lee', name: 'Lee Chen', email: 'lee@nwfreight.example', company: 'northwind-ltd' },
    { key: 'priya', name: 'Priya Nair', email: 'priya@orchardlanebank.example', company: 'orchard' },
    { key: 'tom', name: 'Tom Becker', email: 'tom@bluefinclinics.example', company: 'bluefin' },
  ],
  objectives: [
    { name: 'Win mid-market deals', weight: 50 },
    { name: 'Reduce churn', weight: 30 },
    { name: 'Cut support load', weight: 20 },
  ],
  products: [
    {
      key: 'platform',
      name: 'Tallyrun Platform',
      components: [
        { key: 'reporting', name: 'Reporting' },
        { key: 'access', name: 'Access' },
      ],
    },
  ],
  features: [
    {
      key: 'scheduled',
      name: 'Scheduled report emails',
      publicDescription: 'Send any saved report to a list of recipients on a schedule.',
      status: 'planned',
      effort: 5,
      confidence: 80,
      fits: [2, 3, 1],
      component: 'reporting',
    },
    {
      key: 'csv-presets',
      name: 'CSV export presets',
      publicDescription: 'Save column choices for repeat CSV exports.',
      status: 'candidate',
      effort: 3,
      confidence: 60,
      fits: [1, 1, 2],
      component: 'reporting',
    },
    {
      key: 'saml',
      name: 'SAML single sign-on',
      publicDescription: 'Sign in with your identity provider over SAML.',
      status: 'planned',
      effort: 8,
      confidence: 90,
      fits: [3, 1, 0],
      component: 'access',
    },
    {
      key: 'okta-guide',
      name: 'Okta setup guide',
      publicDescription: '',
      status: 'candidate',
      effort: 5,
      confidence: 50,
      fits: [0, 0, 0],
      component: 'access',
      parent: 'saml',
    },
    {
      key: 'audit',
      name: 'Audit trail viewer',
      publicDescription: 'See who changed what, filterable by user and date.',
      status: 'planned',
      effort: 5,
      confidence: 50,
      fits: [2, 0, 1],
      component: 'access',
    },
    {
      key: 'bulk-import',
      name: 'Bulk user import',
      publicDescription: 'Add many users at once from a spreadsheet.',
      status: 'planned',
      effort: 3,
      confidence: 70,
      fits: [1, 0, 2],
      component: 'access',
    },
  ],
  releases: [
    {
      name: 'March Drop',
      targetDate: '2027-03-15',
      isPublic: true,
      features: ['saml', 'scheduled', 'bulk-import'],
    },
    { name: 'Internal Tooling', targetDate: '2027-04-05', isPublic: false, features: [] },
    { name: 'April Drop', targetDate: '2027-04-20', isPublic: true, features: ['audit'] },
  ],
  notes: [
    {
      key: 'n1',
      title: 'Weekly KPI pack',
      source: 'support_ticket',
      contact: 'ana',
      createdAt: '2026-10-20T14:00:00Z',
      body:
        '<p>We export the KPI pack every Monday by hand. ' +
        '<strong>If reports could email themselves to the ops team</strong> ' +
        'we would stop asking for screenshots.</p>',
    },
    {
      key: 'n2',
      title: 'Renewal blocker: SSO',
      source: 'sales_call',
      contact: 'priya',
      createdAt: '2026-10-21T15:30:00Z',
      body:
        '<p>Security review blocks us until we have SAML single sign-on with Okta. ' +
        'This is a hard requirement for renewal.</p>',
    },
    {
      key: 'n3',
      title: 'Audit questions from clinic auditors',
      source: 'email',
      contact: 'tom',
      createdAt: '2026-10-22T13:00:00Z',
      body:
        '<p>Auditors keep asking who changed a patient-facing setting. ' +
        'We need an audit trail we can filter by user. ' +
        'We cut 100% of manual audit pulls last quarter.</p>',
    },
    {
      key: 'n4',
      title: 'Monday report for finance',
      source: 'support_ticket',
      contact: 'lee',
      createdAt: '2026-10-23T16:45:00Z',
      body: '<p>Our finance team wants the Monday report in their inbox automatically.</p>',
    },
    {
      key: 'n5',
      title: 'Forwarded renewal thread',
      source: 'email',
      contact: 'priya',
      createdAt: '2026-10-24T12:10:00Z',
      body:
        '<p>Forwarded from the renewal thread:</p>' +
        '<ul><li>Okta groups should map to roles</li><li>Export audit events weekly</li></ul>',
    },
    {
      key: 'n6',
      title: 'Clinic rota export',
      source: 'support_ticket',
      contact: 'tom',
      createdAt: '2026-10-25T09:00:00Z',
      body:
        '<p>Clinic managers rebuild the staff rota by hand each week. ' +
        'A rota download would save them an afternoon.</p>',
    },
    {
      key: 'n7',
      title: 'Dock scheduling feedback',
      source: 'email',
      contact: 'ana',
      createdAt: '2026-10-25T09:00:00Z',
      body: '<p>Our dock team wants to book loading slots from the shipment list.</p>',
    },
  ],
  insights: [
    { note: 'n2', quote: 'SAML single sign-on with Okta', feature: 'saml', importance: 'critical' },
    {
      note: 'n2',
      quote: 'single sign-on with Okta. This is a hard requirement',
      feature: 'audit',
      importance: 'nice_to_have',
    },
    {
      note: 'n4',
      quote: 'wants the Monday report in their inbox automatically',
      feature: 'scheduled',
      importance: 'important',
    },
  ],
};

const QUARRY_LABS: SeedWorkspace = {
  name: 'Quarry Labs',
  timeZone: 'Europe/Berlin',
  members: [
    { name: 'Mara Voss', email: 'hop@quarrylabs.example', role: 'head_of_product' },
    { name: 'Ollie Grant', email: 'pm@quarrylabs.example', role: 'product_manager' },
  ],
  companies: [{ key: 'saltmarsh', name: 'Saltmarsh Media', domain: 'saltmarsh.example' }],
  contacts: [{ key: 'jo', name: 'Jo Park', email: 'jo@saltmarsh.example', company: 'saltmarsh' }],
  objectives: [{ name: 'Grow enterprise', weight: 100 }],
  products: [
    { key: 'studio', name: 'Quarry Studio', components: [{ key: 'exports', name: 'Exports' }] },
  ],
  features: [
    {
      key: 'audit-log-export',
      name: 'Audit log export',
      publicDescription: 'Weekly audit log files',
      status: 'planned',
      effort: 4,
      confidence: 70,
      fits: [3],
      component: 'exports',
    },
  ],
  releases: [
    {
      name: 'Q2 Exports',
      targetDate: '2027-05-10',
      isPublic: true,
      features: ['audit-log-export'],
    },
  ],
  notes: [
    {
      key: 'q1',
      title: 'Weekly audit files',
      source: 'email',
      contact: 'jo',
      createdAt: '2026-11-02T10:00:00Z',
      body: '<p>We need the audit log export as CSV every week.</p>',
    },
  ],
  insights: [
    {
      note: 'q1',
      quote: 'audit log export as CSV every week',
      feature: 'audit-log-export',
      importance: 'critical',
    },
  ],
};

async function insertWorkspace(client: Queryable, seed: SeedWorkspace): Promise<void> {
  const workspaceId = newId();
  await client.query('INSERT INTO workspaces (id, name, time_zone) VALUES ($1, $2, $3)', [
    workspaceId,
    seed.name,
    seed.timeZone,
  ]);
  const passwordHash = hashPassword(SEED_PASSWORD);
  for (const member of seed.members) {
    await client.query(
      'INSERT INTO members (id, workspace_id, name, email, role, password_hash) VALUES ($1, $2, $3, $4, $5, $6)',
      [newId(), workspaceId, member.name, member.email, member.role, passwordHash],
    );
  }

  const companyIds = new Map<string, string>();
  for (const company of seed.companies) {
    const id = newId();
    companyIds.set(company.key, id);
    await client.query('INSERT INTO companies (id, workspace_id, name) VALUES ($1, $2, $3)', [
      id,
      workspaceId,
      company.name,
    ]);
    await client.query('INSERT INTO company_domains (workspace_id, domain, company_id) VALUES ($1, $2, $3)', [
      workspaceId,
      company.domain,
      id,
    ]);
  }

  const contactIds = new Map<string, string>();
  for (const contact of seed.contacts) {
    const id = newId();
    contactIds.set(contact.key, id);
    await client.query(
      'INSERT INTO contacts (id, workspace_id, company_id, name, email) VALUES ($1, $2, $3, $4, $5)',
      [id, workspaceId, companyIds.get(contact.company), contact.name, contact.email],
    );
  }

  const objectiveIds: string[] = [];
  for (const objective of seed.objectives) {
    const id = newId();
    objectiveIds.push(id);
    await client.query('INSERT INTO objectives (id, workspace_id, name, weight) VALUES ($1, $2, $3, $4)', [
      id,
      workspaceId,
      objective.name,
      objective.weight,
    ]);
  }

  const componentIds = new Map<string, string>();
  for (const product of seed.products) {
    const productId = newId();
    await client.query('INSERT INTO products (id, workspace_id, name) VALUES ($1, $2, $3)', [
      productId,
      workspaceId,
      product.name,
    ]);
    for (const component of product.components) {
      const componentId = newId();
      componentIds.set(component.key, componentId);
      await client.query('INSERT INTO components (id, product_id, name) VALUES ($1, $2, $3)', [
        componentId,
        productId,
        component.name,
      ]);
    }
  }

  const releaseIds = new Map<string, string>();
  for (const release of seed.releases) {
    const id = newId();
    releaseIds.set(release.name, id);
    await client.query(
      `INSERT INTO releases (id, workspace_id, name, target_date, is_public, status, order_version)
       VALUES ($1, $2, $3, $4, $5, 'open', 1)`,
      [id, workspaceId, release.name, release.targetDate, release.isPublic],
    );
  }

  const featureIds = new Map<string, string>();
  for (const feature of seed.features) {
    const id = newId();
    featureIds.set(feature.key, id);
    const release = seed.releases.find((candidate) => candidate.features.includes(feature.key));
    await client.query(
      `INSERT INTO features (id, workspace_id, component_id, parent_feature_id, name, public_description,
                             status, release_id, board_position, effort, confidence, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1)`,
      [
        id,
        workspaceId,
        componentIds.get(feature.component),
        feature.parent ? featureIds.get(feature.parent) : null,
        feature.name,
        feature.publicDescription,
        feature.status,
        release ? releaseIds.get(release.name) : null,
        release ? release.features.indexOf(feature.key) : 0,
        feature.effort,
        feature.confidence,
      ],
    );
    for (let index = 0; index < objectiveIds.length; index += 1) {
      await client.query(
        'INSERT INTO feature_fits (feature_id, objective_id, level) VALUES ($1, $2, $3)',
        [id, objectiveIds[index], feature.fits[index] ?? 0],
      );
    }
  }

  const noteIds = new Map<string, string>();
  for (const note of seed.notes) {
    const id = newId();
    noteIds.set(note.key, id);
    const { body, doc } = sanitiseBody(note.body);
    await client.query(
      `INSERT INTO notes (id, workspace_id, contact_id, title, body, text, source, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'unprocessed', $8)`,
      [id, workspaceId, contactIds.get(note.contact), note.title, body, doc.text, note.source, note.createdAt],
    );
  }

  for (const insight of seed.insights) {
    const noteId = noteIds.get(insight.note) as string;
    const { rows } = await client.query<{ text: string }>('SELECT text FROM notes WHERE id = $1', [noteId]);
    const start = rows[0].text.indexOf(insight.quote);
    if (start === -1) throw new Error(`seed quote not found in note ${insight.note}: ${insight.quote}`);
    await client.query(
      `INSERT INTO insights (id, workspace_id, note_id, feature_id, start_offset, end_offset, quote, importance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        newId(),
        workspaceId,
        noteId,
        featureIds.get(insight.feature),
        start,
        start + insight.quote.length,
        insight.quote,
        insight.importance,
      ],
    );
  }

  const world = await loadFeatureWorld(client, workspaceId);
  for (const feature of seed.features) {
    const id = featureIds.get(feature.key) as string;
    const record = world.features.get(id);
    if (!record) throw new Error(`seed feature ${feature.key} is missing`);
    await client.query(
      `INSERT INTO score_versions (id, feature_id, version, effort, confidence, fits, priority, saved_by)
       VALUES ($1, $2, 1, $3, $4, $5::jsonb, $6, NULL)`,
      [newId(), id, record.effort, record.confidence, JSON.stringify(record.fits), record.priority],
    );
  }
}

/** The seed is inserted only when the database has no workspaces. */
export async function seedIfEmpty(): Promise<void> {
  const { rows } = await pool.query<{ total: string }>('SELECT COUNT(*) AS total FROM workspaces');
  if (Number(rows[0].total) > 0) return;
  await withTransaction(async (client) => {
    await insertWorkspace(client, TALLYRUN);
    await insertWorkspace(client, QUARRY_LABS);
  });
}
