// Seed insertion: runs only when the database is empty.

import { Db, clock } from './db.js';
import { SEED_USERS, seedPeople, hashPassword, SEED_DEPARTMENTS, OFFICE_HOURS, AROUND_THE_CLOCK,
  SEED_SLA_DEFINITIONS, SEED_CIS, SEED_RELATIONSHIPS, SEED_FREEZE_WINDOWS, SEED_BOARDS,
  SEED_KNOWLEDGE, SEED_QUEUES } from './seeddata.js';
import { compute_priority } from '../shared/model.js';

export async function runSeed(db: Db): Promise<void> {
  const check = await db.query(`SELECT count(*)::int AS n FROM people`);
  if (Number(check.rows[0].n) > 0) return;

  const now = new Date(clock.nowMs());

  for (const name of SEED_DEPARTMENTS) {
    await db.query(`INSERT INTO departments(name) VALUES ($1) ON CONFLICT DO NOTHING`, [name]);
  }

  for (const u of SEED_USERS) {
    await db.query(
      `INSERT INTO people(username, display_name, department, roles, password_hash, time_zone, digest)
       VALUES ($1,$2,$3,$4,$5,$6,'immediate')`,
      [u.username, u.display_name, u.department, u.roles, hashPassword(u.password), u.time_zone],
    );
  }
  for (const p of seedPeople()) {
    await db.query(
      `INSERT INTO people(username, display_name, department, roles, password_hash, time_zone)
       VALUES ($1,$2,$3,NULL,NULL,'Europe/Berlin')`,
      [p.username, p.display_name, p.department],
    );
  }

  await db.query(
    `INSERT INTO groups(name, members, escalation_policy) VALUES ('Desk', $1, 'Desk ladder'), ('Triage', '{}', NULL)`,
    [['oona', 'teodor', 'bastian']],
  );

  await db.query(
    `INSERT INTO schedules(name, time_zone, hours, holidays) VALUES ($1,$2,$3,$4), ($5,$6,$7,$8)`,
    [OFFICE_HOURS.name, OFFICE_HOURS.time_zone, JSON.stringify(OFFICE_HOURS.hours), OFFICE_HOURS.holidays,
     AROUND_THE_CLOCK.name, AROUND_THE_CLOCK.time_zone, JSON.stringify(AROUND_THE_CLOCK.hours), AROUND_THE_CLOCK.holidays],
  );

  for (const s of SEED_SLA_DEFINITIONS) {
    await db.query(
      `INSERT INTO sla_definitions(name, "table", start_expr, pause_expr, stop_expr, schedule, targets)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [s.name, s.table, s.start, s.pause, s.stop, s.schedule, JSON.stringify(s.targets)],
    );
  }

  for (const ci of SEED_CIS) {
    await db.query(
      `INSERT INTO cis(name, "class", criticality, business_critical, owner_department, status, attributes, used_by_departments, used_by_people)
       VALUES ($1,$2,$3,$4,'IT provider','healthy',$5,$6,$7)`,
      [ci.name, ci.class, ci.criticality, ci.business_critical ?? false,
       JSON.stringify(ci.attributes ?? {}), ci.used_by_departments ?? [], ci.used_by_people ?? []],
    );
  }

  for (const [source, type, target] of SEED_RELATIONSHIPS) {
    await db.query(
      `INSERT INTO relationships(source, type, target) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [source, type, target],
    );
  }

  for (const f of SEED_FREEZE_WINDOWS) {
    await db.query(
      `INSERT INTO freeze_windows(name, start, "end", time_zone, scope_kind, scope_items)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [f.name, new Date(f.start), new Date(f.end), f.time_zone, f.scope === 'all' ? 'all' : 'items', f.scope === 'all' ? [] : [f.scope]],
    );
  }

  for (const b of SEED_BOARDS) {
    await db.query(
      `INSERT INTO boards(name, rule, n, threshold_percent, window_hours, members)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [b.name, b.rule, b.n, b.threshold_percent, b.window_hours, JSON.stringify(b.members)],
    );
  }

  await db.query(
    `INSERT INTO rotations(name, time_zone, handover_weekday, handover_time, members, anchor_date)
     VALUES ('Weekly on-call', 'Europe/Berlin', 'monday', '09:00', $1, '2026-01-05')`,
    [['teodor', 'bastian']],
  );

  await db.query(
    `INSERT INTO escalation_policies(name, levels) VALUES ('Desk ladder', $1)`,
    [JSON.stringify([
      { target: { rotation: 'Weekly on-call' }, ack_minutes: null },
      { target: { user: 'oona' }, ack_minutes: null },
    ])],
  );

  for (const r of [
    { name: 'Payroll to Desk', order: 100, table: 'incident', condition: 'configuration_item.name = "Payroll"', group: 'Desk' },
    { name: 'Everything to Desk', order: 200, table: 'incident', condition: 'true', group: 'Desk' },
  ]) {
    await db.query(
      `INSERT INTO assignment_rules(name, "order", "table", condition, "group", active)
       VALUES ($1,$2,$3,$4,$5,TRUE)`,
      [r.name, r.order, r.table, r.condition, r.group],
    );
  }

  await db.query(
    `INSERT INTO business_rules(name, "table", "when", "order", operations, condition, actions, active)
     VALUES ('Major incidents are resolved', 'incident', 'before', 100, '{insert,update}',
       'is_major = true and changes_to(state, "cancelled")', $1, TRUE)`,
    [JSON.stringify([{ abort: 'Major incidents are resolved, not cancelled.' }])],
  );

  await db.query(
    `INSERT INTO access_rules(name, type, "table", field, operation, roles, condition, active)
     VALUES ('Affected person hidden from managers', 'field', 'incident', 'affected_person', 'read', '{manager}', NULL, TRUE),
            ('Confidential incidents', 'row', 'incident', NULL, 'read', '{technician,manager,approver}', 'confidential = true', TRUE)`
  );

  await db.query(
    `INSERT INTO form_policies(name, "table", catalog_item, "order", condition, actions)
     VALUES
       ('Studio laptops need a reason', NULL, 'laptop', 100, 'variables.model = "studio16"', $1),
       ('Laptop reason hidden otherwise', NULL, 'laptop', 50, 'true', $2),
       ('Cost centre is fixed', NULL, 'software-licence', 100, 'true', $3),
       ('Hold reason when on hold', 'incident', NULL, 100, 'state = "on_hold"', $4),
       ('Hold reason hidden otherwise', 'incident', NULL, 50, 'true', $5)`,
    [
      JSON.stringify([{ field: 'justification', visible: true, mandatory: true }]),
      JSON.stringify([{ field: 'justification', visible: false, mandatory: false }]),
      JSON.stringify([{ field: 'cost_centre', read_only: true }]),
      JSON.stringify([{ field: 'hold_reason', visible: true, mandatory: true }]),
      JSON.stringify([{ field: 'hold_reason', visible: false, mandatory: false }]),
    ],
  );

  await insertCatalog(db);
  await insertWorkflows(db);
  await insertRecords(db, now);

  // Attach SLAs to the seeded records and compute from their history.
  const { syncSlas } = await import('./slarunner.js');
  const noopLive = { publish: () => undefined };
  for (const number of ['BRK-000001', 'BRK-000002', 'BRK-000003', 'ROOT-000001']) {
    const { loadSnapshot } = await import('./recordengine.js');
    const snap = await loadSnapshot(db, number);
    if (snap) await syncSlas(db, snap, noopLive as never);
  }

  for (const a of SEED_KNOWLEDGE) {
    await db.query(
      `INSERT INTO articles(number, title, body, keywords, state, valid_until, helpful_yes, helpful_no, audience_roles, audience_departments, author, published_at)
       VALUES ($1,$2,$3,$4,'published',$5,$6,$7,$8,$9,'oona',$10)`,
      [a.number, a.title, a.body, a.keywords, a.valid_until ?? null, a.helpful_yes, a.helpful_no,
       a.audience.roles, a.audience.departments, now],
    );
  }

  const events = ['assigned', 'mentioned', 'sla_threshold_50', 'sla_threshold_75', 'sla_breach',
    'page', 'page_exhausted', 'vote_requested', 'vote_result', 'approval_reset', 'approval_requested',
    'workaround_published', 'major_incident_proposed', 'export_finished'];
  for (const event of events) {
    await db.query(`INSERT INTO inbox_rules(event, roles, enabled) VALUES ($1, '{}', TRUE)`, [event]);
  }

  for (const q of SEED_QUEUES) {
    await db.query(
      `INSERT INTO filters(name, "table", filter, shared, owner) VALUES ($1,$2,$3,TRUE,NULL)`,
      [q.name, q.table, q.filter],
    );
  }

  const widgets = [
    { id: 'open-by-priority', title: 'Open by priority', kind: 'bar', table: 'incident', filter: 'state in ["new", "assigned", "in_progress", "on_hold"]', group_by: 'priority', bucket: null, date_field: null },
    { id: 'breached-slas', title: 'Breached SLAs', kind: 'count', table: 'incident', filter: 'sla_breached = true and state in ["new", "assigned", "in_progress", "on_hold"]', group_by: null, bucket: null, date_field: null },
    { id: 'opened-per-day', title: 'Opened per day', kind: 'trend', table: 'incident', filter: '', group_by: null, bucket: 'day', date_field: 'created_at' },
    { id: 'open-major-incidents', title: 'Open major incidents', kind: 'count', table: 'incident', filter: 'is_major = true and state in ["new", "assigned", "in_progress", "on_hold"]', group_by: null, bucket: null, date_field: null },
  ];
  await db.query(
    `INSERT INTO dashboards(id, name, widgets) VALUES ('desk-overview','Desk overview',$1), ('department-standing','Department standing',$2)`,
    [JSON.stringify(widgets), JSON.stringify(widgets)],
  );
}

async function insertCatalog(db: Db): Promise<void> {
  const items = [
    {
      id: 'laptop', name: 'Laptop', workflow: 'Laptop fulfilment',
      variables: [
        { name: 'model', label: 'Model', type: 'select', required: true, default: null,
          choices: [{ value: 'standard14', label: 'Standard 14-inch', when: null }, { value: 'studio16', label: 'Studio 16-inch', when: null }] },
        { name: 'memory', label: 'Memory', type: 'select', required: true, default: null,
          choices: [
            { value: '16', label: '16 GB', when: { variable: 'model', equals: 'standard14' } },
            { value: '32', label: '32 GB', when: { variable: 'model', equals: 'studio16' } },
            { value: '64', label: '64 GB', when: { variable: 'model', equals: 'studio16' } },
          ] },
        { name: 'justification', label: 'Why you need it', type: 'multiline', required: false, default: null, choices: [] },
      ],
    },
    {
      id: 'software-licence', name: 'Software licence', workflow: 'Standard fulfilment',
      variables: [
        { name: 'seat', label: 'Seat type', type: 'select', required: true, default: null,
          choices: [{ value: 'cad', label: 'CAD seat', when: null }, { value: 'render', label: 'Rendering seat', when: null }, { value: 'suite', label: 'Design suite', when: null }] },
        { name: 'cost_centre', label: 'Cost centre', type: 'text', required: false, default: null, choices: [] },
      ],
    },
    {
      id: 'building-pass', name: 'Building pass', workflow: 'Standard fulfilment',
      variables: [
        { name: 'office', label: 'Office', type: 'select', required: true, default: null,
          choices: [{ value: 'kanal', label: 'Kanal office', when: null }, { value: 'hafen', label: 'Hafen office', when: null }] },
        { name: 'start_date', label: 'Start date', type: 'date', required: true, default: null, choices: [] },
      ],
    },
    {
      id: 'shared-drive', name: 'Shared drive access', workflow: 'Drive access',
      variables: [
        { name: 'drive', label: 'Drive', type: 'select', required: true, default: null,
          choices: [{ value: 'projects', label: 'Projects', when: null }, { value: 'finance', label: 'Finance', when: null }, { value: 'archive', label: 'Archive', when: null }] },
        { name: 'access', label: 'Access level', type: 'select', required: true, default: null,
          choices: [
            { value: 'read', label: 'Read', when: null },
            { value: 'write', label: 'Write', when: { variable: 'drive', equals: 'projects' } },
            { value: 'write', label: 'Write', when: { variable: 'drive', equals: 'finance' } },
          ] },
      ],
    },
  ];
  for (const item of items) {
    await db.query(
      `INSERT INTO catalog_items(id, name, variables, workflow) VALUES ($1,$2,$3,$4)`,
      [item.id, item.name, JSON.stringify(item.variables), item.workflow],
    );
  }

  await db.query(
    `INSERT INTO guides(id, name, questions, rules) VALUES ('new-starter','New starter',$1,$2)`,
    [
      JSON.stringify([
        { name: 'role', label: "New starter's role", type: 'select', required: true, default: null,
          choices: [{ value: 'architect', label: 'Architect', when: null }, { value: 'finance', label: 'Finance', when: null }, { value: 'operations', label: 'Operations', when: null }] },
      ]),
      JSON.stringify([
        { item: 'laptop', condition: 'true' },
        { item: 'software-licence', condition: 'answers.role = "architect"' },
        { item: 'shared-drive', condition: 'true' },
        { item: 'building-pass', condition: 'true' },
      ]),
    ],
  );
}

async function insertWorkflows(db: Db): Promise<void> {
  const laptopSteps = [
    { id: 't1', type: 'trigger', name: 'Item ordered', on: 'item_ordered', table: null, items: ['laptop'], condition: 'true' },
    { id: 'i1', type: 'if', name: 'Studio model?', condition: 'variables.model = "studio16"',
      then: [{ id: 'a1', type: 'approval', name: 'Department sign-off', approvers: { kind: 'department_approvers' }, rule: 'any' }], else: [] },
    { id: 'c1', type: 'create_task', name: 'Prepare laptop', group: 'Desk', short_description: 'Prepare laptop', wait: true },
    { id: 'e1', type: 'set_fields', name: 'Deliver', fields: { state: '"delivered"' } },
  ];
  const standardSteps = [
    { id: 't1', type: 'trigger', name: 'Item ordered', on: 'item_ordered', table: null, items: ['software-licence', 'building-pass'], condition: 'true' },
    { id: 'c1', type: 'create_task', name: 'Fulfil request', group: 'Desk', short_description: 'Fulfil request', wait: true },
    { id: 'e1', type: 'set_fields', name: 'Deliver', fields: { state: '"delivered"' } },
  ];
  const driveSteps = [
    { id: 't1', type: 'trigger', name: 'Item ordered', on: 'item_ordered', table: null, items: ['shared-drive'], condition: 'true' },
    { id: 'i1', type: 'if', name: 'Write access?', condition: 'variables.access = "write"',
      then: [{ id: 'a1', type: 'approval', name: 'Department sign-off', approvers: { kind: 'department_approvers' }, rule: 'any' }], else: [] },
    { id: 'c1', type: 'create_task', name: 'Grant drive access', group: 'Desk', short_description: 'Grant drive access', wait: true },
    { id: 'e1', type: 'set_fields', name: 'Deliver', fields: { state: '"delivered"' } },
  ];

  const flows: Array<[string, unknown[]]> = [
    ['Laptop fulfilment', laptopSteps],
    ['Standard fulfilment', standardSteps],
    ['Drive access', driveSteps],
  ];
  for (const [name, steps] of flows) {
    const res = await db.query(
      `INSERT INTO workflows(name, kind, inputs, outputs, draft) VALUES ($1,'flow','[]','[]',$2) RETURNING id`,
      [name, JSON.stringify(steps)],
    );
    const id = res.rows[0].id;
    await db.query(
      `INSERT INTO workflow_versions(workflow, version, steps, published_at) VALUES ($1,1,$2,$3)`,
      [id, JSON.stringify(steps), new Date(clock.nowMs())],
    );
  }
}

async function insertRecords(db: Db, now: Date): Promise<void> {
  const nowMs = now.getTime();

  await insertIncident(db, {
    number: 'BRK-000001', short: 'Plotter on level 2 jams on A1 sheets',
    caller: 'ruth', ci: 'Printing', impact: 3, urgency: 2,
    state: 'assigned', assigned_to: 'teodor', group: 'Desk', createdAt: nowMs,
  });
  await insertIncident(db, {
    number: 'BRK-000002', short: 'Payroll export missing two contractors',
    caller: 'kofi', ci: 'Payroll', impact: 2, urgency: 1,
    state: 'in_progress', assigned_to: 'oona', group: 'Desk', createdAt: nowMs,
  });
  await insertIncident(db, {
    number: 'BRK-000003', short: 'Remote access drops every 20 minutes from home',
    caller: 'dev', ci: 'Remote access', impact: 3, urgency: 3,
    state: 'new', assigned_to: null, group: null, createdAt: nowMs,
  });

  await db.query(
    `INSERT INTO records(number, "table", state, workspace, fields, created_at, created_by, updated_at)
     VALUES ('ROOT-000001','problem','assessing','live',$1,$2,'oona',$2)`,
    [JSON.stringify({
      short_description: 'Plotter jams on large sheets',
      description: null, configuration_item: 'Printing', impact: 2, urgency: 2,
      priority: 3, assignment_group: 'Desk', assigned_to: null, workaround: null,
      fix_change: null, cancel_reason: null, created_at: new Date(nowMs).toISOString(),
    }), now],
  );
  await db.query(`INSERT INTO state_history(record, state, at) VALUES ('ROOT-000001','new',$1),('ROOT-000001','assessing',$1)`, [now]);
  await db.query(`INSERT INTO record_links(kind, parent, child) VALUES ('incident','ROOT-000001','BRK-000001')`);

  await db.query(
    `INSERT INTO records(number, "table", state, workspace, fields, created_at, created_by, updated_at)
     VALUES ('ALT-000001','change','draft','live',$1,$2,'oona',$2)`,
    [JSON.stringify({
      title: 'Patch print server', model: 'normal', configuration_item: 'Print server',
      planned_start: null, planned_end: null, implementation_plan: null, backout_plan: null,
      backout_tested: false, standard_template: null, freeze_override_reason: null,
      outcome: null, close_note: null, cancel_reason: null, priority: 5,
      created_at: new Date(nowMs).toISOString(),
    }), now],
  );
  await db.query(`INSERT INTO state_history(record, state, at) VALUES ('ALT-000001','draft',$1)`, [now]);

  await db.query(
    `INSERT INTO sequences(name, next) VALUES ('incident',4),('problem',2),('change',2),('request_item',1),('task',1),('request',1),('article',6),('set',1)`
  );
}

async function insertIncident(db: Db, spec: {
  number: string; short: string; caller: string; ci: string; impact: number; urgency: number;
  state: string; assigned_to: string | null; group: string | null; createdAt: number;
}): Promise<void> {
  const ci = await db.query(`SELECT business_critical FROM cis WHERE name = $1`, [spec.ci]);
  const bc = ci.rows.length ? ci.rows[0].business_critical : false;
  const priority = compute_priority(spec.impact, spec.urgency, Boolean(bc));
  await db.query(
    `INSERT INTO records(number, "table", state, workspace, fields, created_at, created_by, updated_at)
     VALUES ($1,'incident',$2,'live',$3,$4,'oona',$4)`,
    [spec.number, spec.state, JSON.stringify({
      short_description: spec.short,
      description: null,
      caller: spec.caller,
      affected_person: null,
      configuration_item: spec.ci,
      impact: spec.impact,
      urgency: spec.urgency,
      priority,
      assignment_group: spec.group,
      assigned_to: spec.assigned_to,
      hold_reason: null,
      resolution_code: null,
      resolution_note: null,
      reopen_reason: null,
      cancel_reason: null,
      confidential: false,
      is_major: false,
      parent: null,
      problem: null,
      created_at: new Date(spec.createdAt).toISOString(),
      resolved_at: null,
    }), new Date(spec.createdAt)],
  );
  const states = spec.state === 'new' ? ['new'] : ['new', spec.state];
  for (const state of states) {
    await db.query(`INSERT INTO state_history(record, state, at) VALUES ($1,$2,$3)`, [spec.number, state, new Date(spec.createdAt)]);
  }
}
