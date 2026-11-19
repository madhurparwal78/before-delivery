import { newId, query } from './db.js';
import { createPerson } from './auth.js';

const SEEDED_AT = '2026-03-01T08:00:00.000Z';

export async function applyStarterSeed(): Promise<void> {
  const existing = await query(`SELECT 1 FROM teams LIMIT 1`);
  if (existing.length > 0) return;

  const noor = await createPerson({
    name: 'Noor Halvorsen',
    email: 'noor@everyweek.example',
    password: 'weekly-demo-1',
    verified: true,
  });
  const ilse = await createPerson({
    name: 'Ilse Marchetti',
    email: 'ilse@everyweek.example',
    password: 'weekly-demo-1',
    verified: true,
  });
  const tomas = await createPerson({
    name: 'Tomas Okonkwo',
    email: 'tomas@everyweek.example',
    password: 'weekly-demo-1',
    verified: true,
  });

  const teamId = newId();
  await query(`INSERT INTO teams (id, name, join_code, created_at) VALUES ($1,$2,$3,$4)`, [
    teamId,
    'Larder Street Kitchen',
    'LARDER-2026',
    SEEDED_AT,
  ]);
  await query(`INSERT INTO memberships (team_id, person_id, role) VALUES ($1,$2,'coordinator')`, [
    teamId,
    noor.id,
  ]);
  for (const personId of [ilse.id, tomas.id]) {
    await query(`INSERT INTO memberships (team_id, person_id, role) VALUES ($1,$2,'member')`, [
      teamId,
      personId,
    ]);
  }
  await query(`INSERT INTO capacities (team_id, person_id, weekday, hours) VALUES ($1,$2,'fri',4)`, [
    teamId,
    noor.id,
  ]);

  const orders = await createProject(teamId, 'Weekly orders', ['To do', 'Doing', 'Review', 'Done']);
  const fieldIds = new Map<string, string>();
  const fieldSpecs: [string, string, string[], string | null][] = [
    ['Stage', 'single_select', ['Draft', 'Ready', 'Review'], null],
    ['Priority', 'single_select', ['Low', 'Medium', 'High'], null],
    ['Tags', 'multi_select', ['Fresh', 'Dry', 'Frozen'], null],
    ['Category', 'single_select', ['Dry goods', 'Fresh', 'Equipment'], null],
    ['Rate', 'number', [], null],
    ['Extra', 'number', [], null],
    ['Cost', 'formula', [], '{Effort} * {Rate}'],
  ];
  for (let i = 0; i < fieldSpecs.length; i += 1) {
    const [name, type, options, formula] = fieldSpecs[i];
    const id = newId();
    await query(
      `INSERT INTO fields (id, project_id, name, type, options, formula, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, orders.id, name, type, JSON.stringify(options), formula, i + 1],
    );
    fieldIds.set(name, id);
  }

  const orderDryGoods = await createTask(orders.id, orders.sections.get('To do')!, {
    name: 'Order dry goods',
    position: 1,
    assigneeId: noor.id,
    start: '2026-03-02',
    due: '2026-03-04',
    effort: 12,
  });
  const packOrders = await createTask(orders.id, orders.sections.get('To do')!, {
    name: 'Pack orders',
    position: 2,
    assigneeId: noor.id,
    start: '2026-03-04',
    due: '2026-03-06',
    effort: 10,
  });
  await createTask(orders.id, orders.sections.get('Doing')!, {
    name: 'Count freezer',
    position: 1,
    assigneeId: noor.id,
    start: '2026-03-06',
    due: '2026-03-09',
    effort: 5,
  });
  const weighStock = await createTask(orders.id, orders.sections.get('To do')!, {
    name: 'Weigh stock',
    position: 3,
    assigneeId: ilse.id,
    due: '2026-03-02',
    effort: 2.5,
    recurrence: 'Every week on Monday',
  });
  await query(`INSERT INTO task_values (task_id, field_id, value) VALUES ($1,$2,$3)`, [
    weighStock,
    fieldIds.get('Rate'),
    JSON.stringify(40),
  ]);
  void orderDryGoods;
  void packOrders;

  const requestedBy = newId();
  await query(
    `INSERT INTO fields (id, project_id, name, type, options, formula, position)
     VALUES ($1,$2,'Requested by','text','[]'::jsonb,NULL,$3)`,
    [requestedBy, orders.id, fieldSpecs.length + 1],
  );
  await query(
    `INSERT INTO forms (id, project_id, section_id, slug, title) VALUES ($1,$2,$3,$4,$5)`,
    [newId(), orders.id, orders.sections.get('To do'), 'supply-request', 'Supply request'],
  );

  const upkeep = await createProject(teamId, 'Machine upkeep', ['To do', 'Done']);
  const upkeepTasks = ['Oil the slicer', 'Replace saw blade', 'Clean the mixer'];
  for (let i = 0; i < upkeepTasks.length; i += 1) {
    await createTask(upkeep.id, upkeep.sections.get('To do')!, {
      name: upkeepTasks[i],
      position: i + 1,
      assigneeId: noor.id,
    });
  }

  const steadyYear = await createGoal(teamId, 'Run a steady year', null, 1, 0, noor.id);
  const kitchen = await createGoal(teamId, 'Kitchen runs on time', steadyYear, 2, 0, noor.id);
  const upkeepGoal = await createGoal(teamId, 'Upkeep never lapses', steadyYear, 1, 0, noor.id);
  await createGoal(teamId, 'Suppliers confirmed', kitchen, 1, 40, noor.id);
  await createGoal(teamId, 'Spare parts stocked', upkeepGoal, 1, 90, noor.id);
  await query(`INSERT INTO goal_projects (goal_id, project_id, weight) VALUES ($1,$2,3)`, [
    kitchen,
    orders.id,
  ]);
  await query(`INSERT INTO goal_projects (goal_id, project_id, weight) VALUES ($1,$2,1)`, [
    upkeepGoal,
    upkeep.id,
  ]);

  await query(
    `INSERT INTO inbox_items (id, person_id, team_id, text, kind, read, created_at)
     VALUES ($1,$2,$3,'Welcome to Everyweek','note',false,$4)`,
    [newId(), noor.id, teamId, SEEDED_AT],
  );
}

async function createProject(
  teamId: string,
  name: string,
  sectionNames: string[],
): Promise<{ id: string; sections: Map<string, string> }> {
  const id = newId();
  await query(`INSERT INTO projects (id, team_id, name, created_at) VALUES ($1,$2,$3,$4)`, [
    id,
    teamId,
    name,
    SEEDED_AT,
  ]);
  const sections = new Map<string, string>();
  for (let i = 0; i < sectionNames.length; i += 1) {
    const sectionId = newId();
    await query(`INSERT INTO sections (id, project_id, name, position) VALUES ($1,$2,$3,$4)`, [
      sectionId,
      id,
      sectionNames[i],
      i + 1,
    ]);
    sections.set(sectionNames[i], sectionId);
  }
  return { id, sections };
}

async function createTask(
  projectId: string,
  sectionId: string,
  input: {
    name: string;
    position: number;
    assigneeId?: string | null;
    start?: string | null;
    due?: string | null;
    effort?: number | null;
    recurrence?: string | null;
  },
): Promise<string> {
  const id = newId();
  await query(
    `INSERT INTO tasks (id, project_id, section_id, parent_id, name, description, position,
       assignee_id, start_date, due_date, effort, completed, recurrence, created_at)
     VALUES ($1,$2,$3,NULL,$4,'',$5,$6,$7,$8,$9,false,$10,$11)`,
    [
      id,
      projectId,
      sectionId,
      input.name,
      input.position,
      input.assigneeId ?? null,
      input.start ?? null,
      input.due ?? null,
      input.effort ?? null,
      input.recurrence ?? null,
      SEEDED_AT,
    ],
  );
  return id;
}

async function createGoal(
  teamId: string,
  name: string,
  parentId: string | null,
  weight: number,
  manual: number,
  ownerId: string,
): Promise<string> {
  const id = newId();
  await query(
    `INSERT INTO goals (id, team_id, name, parent_id, weight, manual_value, owner_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, teamId, name, parentId, weight, manual, ownerId, SEEDED_AT],
  );
  return id;
}
