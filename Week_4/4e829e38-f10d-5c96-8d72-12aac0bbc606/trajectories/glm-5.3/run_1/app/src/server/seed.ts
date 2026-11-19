import { query, db } from './db';
import { hashPassword } from './passwords';

/**
 * Starter seed, applied on every start without resetting rows, and the first-start
 * demo data, inserted only when the database is empty.
 */
export async function applySeed(): Promise<void> {
  const r = await query<{ c: string }>(`SELECT count(*)::text AS c FROM teams`);
  if (Number(r.rows[0]?.c ?? 0) > 0) return;
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const team = await client.query<{ id: string }>(
      `INSERT INTO teams (name, join_code) VALUES ($1, $2) RETURNING id`, ['Larder Street Kitchen', 'LARDER-2026']);
    const teamId = team.rows[0].id;
    const pw = hashPassword('weekly-demo-1');
    const personRows: { id: string; email: string }[] = [];
    const personDefs: [string, string][] = [
      ['Noor Halvorsen', 'noor@everyweek.example'],
      ['Ilse Marchetti', 'ilse@everyweek.example'],
      ['Tomas Okonkwo', 'tomas@everyweek.example'],
    ];
    for (const [pname, pemail] of personDefs) {
      const ins = await client.query<{ id: string; email: string }>(
        `INSERT INTO people (name, email, password_hash, verified) VALUES ($1,$2,$3,true) RETURNING id, email`,
        [pname, pemail, pw]);
      personRows.push(ins.rows[0]);
    }
    const byEmail = new Map(personRows.map(p => [p.email, p.id]));
    const noor = byEmail.get('noor@everyweek.example')!;
    const ilse = byEmail.get('ilse@everyweek.example')!;
    const tomas = byEmail.get('tomas@everyweek.example')!;
    await client.query(`INSERT INTO team_members (team_id, person_id, role) VALUES ($1,$2,'coordinator')`, [teamId, noor]);
    await client.query(`INSERT INTO team_members (team_id, person_id, role) VALUES ($1,$2,'member')`, [teamId, ilse]);
    await client.query(`INSERT INTO team_members (team_id, person_id, role) VALUES ($1,$2,'member')`, [teamId, tomas]);
    await client.query(`INSERT INTO capacities (person_id, weekday, hours) VALUES ($1,'fri',4)`, [noor]);

    const orders = await client.query<{ id: string }>(
      `INSERT INTO projects (team_id, name) VALUES ($1,$2) RETURNING id`, [teamId, 'Weekly orders']);
    const ordersId = orders.rows[0].id;
    const upkeep = await client.query<{ id: string }>(
      `INSERT INTO projects (team_id, name) VALUES ($1,$2) RETURNING id`, [teamId, 'Machine upkeep']);
    const upkeepId = upkeep.rows[0].id;

    const sectionDefs: [string, string, number][] = [
      [ordersId, 'To do', 1], [ordersId, 'Doing', 2], [ordersId, 'Review', 3], [ordersId, 'Done', 4],
      [upkeepId, 'To do', 1], [upkeepId, 'Done', 2],
    ];
    for (const [pid, sname, spos] of sectionDefs) {
      await client.query(`INSERT INTO sections (project_id, name, position) VALUES ($1,$2,$3)`, [pid, sname, spos]);
    }

    const fieldDefs: { name: string; type: string; options: string[] | null; formula: string | null }[] = [
      { name: 'Stage', type: 'single_select', options: ['Draft', 'Ready', 'Review'], formula: null },
      { name: 'Priority', type: 'single_select', options: ['Low', 'Medium', 'High'], formula: null },
      { name: 'Tags', type: 'multi_select', options: ['Fresh', 'Dry', 'Frozen'], formula: null },
      { name: 'Category', type: 'single_select', options: ['Dry goods', 'Fresh', 'Equipment'], formula: null },
      { name: 'Rate', type: 'number', options: null, formula: null },
      { name: 'Extra', type: 'number', options: null, formula: null },
      { name: 'Cost', type: 'formula', options: null, formula: '{Effort} * {Rate}' },
    ];
    const fieldIds: Record<string, string> = {};
    let pos = 0;
    for (const f of fieldDefs) {
      const r2 = await client.query<{ id: string }>(
        `INSERT INTO fields (project_id, name, type, options, formula, position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [ordersId, f.name, f.type, JSON.stringify(f.options), f.formula, pos++]);
      fieldIds[f.name] = r2.rows[0].id;
    }

    const secOrders = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM sections WHERE project_id = $1 ORDER BY position`, [ordersId]);
    const S = (n: string): string => secOrders.rows.find((s: { id: string; name: string }) => s.name === n)!.id;

    const taskDefs: { name: string; sec: string; start: string | null; due: string | null; effort: number | null; assignee: string | null; values?: Record<string, unknown>; recurrence?: string | null }[] = [
      { name: 'Order dry goods', sec: 'To do', start: '2026-03-02', due: '2026-03-04', effort: 12, assignee: noor },
      { name: 'Pack orders', sec: 'To do', start: '2026-03-04', due: '2026-03-06', effort: 10, assignee: noor },
      { name: 'Count freezer', sec: 'Doing', start: '2026-03-06', due: '2026-03-09', effort: 5, assignee: noor },
      { name: 'Weigh stock', sec: 'To do', start: null, due: '2026-03-02', effort: 2.5, assignee: ilse, values: { Rate: 40 }, recurrence: 'Every week on Monday' },
    ];
    for (const t of taskDefs) {
      const secId = S(t.sec);
      const posR = await client.query<{ p: number }>(
        `SELECT COALESCE(max(position),0)+1 AS p FROM tasks WHERE section_id = $1 AND parent_id IS NULL`, [secId]);
      const r3 = await client.query<{ id: string }>(
        `INSERT INTO tasks (project_id, name, section_id, position, assignee_id, start_date, due_date, effort, recurrence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [ordersId, t.name, secId, posR.rows[0].p, t.assignee, t.start, t.due, t.effort, t.recurrence ?? null]);
      const taskId = r3.rows[0].id;
      if (t.values) {
        for (const [name, v] of Object.entries(t.values)) {
          await client.query(`INSERT INTO field_values (task_id, field_id, value) VALUES ($1,$2,$3)`,
            [taskId, fieldIds[name], JSON.stringify(v)]);
        }
      }
      await client.query(`INSERT INTO task_history (task_id, text) VALUES ($1,$2)`, [taskId, 'Noor Halvorsen created the task']);
    }

    const secUpkeep = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM sections WHERE project_id = $1 ORDER BY position`, [upkeepId]);
    const SU = (n: string): string => secUpkeep.rows.find((s: { id: string; name: string }) => s.name === n)!.id;
    for (const name of ['Oil the slicer', 'Replace saw blade', 'Clean the mixer']) {
      const posR = await client.query<{ p: number }>(
        `SELECT COALESCE(max(position),0)+1 AS p FROM tasks WHERE section_id = $1 AND parent_id IS NULL`, [SU('To do')]);
      await client.query(
        `INSERT INTO tasks (project_id, name, section_id, position, assignee_id) VALUES ($1,$2,$3,$4,$5)`,
        [upkeepId, name, SU('To do'), posR.rows[0].p, noor]);
    }

    await client.query(`INSERT INTO forms (slug, project_id, section_id, title) VALUES ($1,$2,$3,$4)`,
      ['supply-request', ordersId, S('To do'), 'Supply request']);
    await client.query(`INSERT INTO fields (project_id, name, type, options, position) VALUES ($1,'Requested by','text','[]'::jsonb,$2)`,
      [ordersId, 7]);

    const goalRoot = await client.query<{ id: string }>(
      `INSERT INTO goals (team_id, name, parent_id, weight, manual_value, owner_id) VALUES ($1,'Run a steady year',NULL,1,0,$2) RETURNING id`, [teamId, noor]);
    const goalKitchen = await client.query<{ id: string }>(
      `INSERT INTO goals (team_id, name, parent_id, weight, manual_value, owner_id) VALUES ($1,'Kitchen runs on time',$2,2,0,$3) RETURNING id`, [teamId, goalRoot.rows[0].id, noor]);
    const goalUpkeep = await client.query<{ id: string }>(
      `INSERT INTO goals (team_id, name, parent_id, weight, manual_value, owner_id) VALUES ($1,'Upkeep never lapses',$2,1,0,$3) RETURNING id`, [teamId, goalRoot.rows[0].id, noor]);
    await client.query(`INSERT INTO goals (team_id, name, parent_id, weight, manual_value, owner_id) VALUES ($1,'Suppliers confirmed',$2,1,40,$3)`,
      [teamId, goalKitchen.rows[0].id, noor]);
    await client.query(`INSERT INTO goals (team_id, name, parent_id, weight, manual_value, owner_id) VALUES ($1,'Spare parts stocked',$2,1,90,$3)`,
      [teamId, goalUpkeep.rows[0].id, noor]);
    await client.query(`INSERT INTO goal_projects (goal_id, project_id, weight) VALUES ($1,$2,3)`, [goalKitchen.rows[0].id, ordersId]);
    await client.query(`INSERT INTO goal_projects (goal_id, project_id, weight) VALUES ($1,$2,1)`, [goalUpkeep.rows[0].id, upkeepId]);

    await client.query(`INSERT INTO inbox_items (person_id, text, kind, read, created_at) VALUES ($1,$2,'info',false,$3)`,
      [noor, 'Welcome to Everyweek', '2026-03-02T08:00:00Z']);
    await client.query(`INSERT INTO reference_counters (team_id, next_number) VALUES ($1,1)`, [teamId]);
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* rolled back */ }
    throw e;
  } finally {
    client.release();
  }
}
