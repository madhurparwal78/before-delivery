import { Router } from 'express';
import { query, withTx } from './db';
import { readBody, GRADING_MAX, AuthedRequest } from './apiutil';
import { env } from './env';
import { now, setClock, txNow, txToday } from './clock';
import { hashPassword } from './passwords';
import { publish } from './live';
import { TaskRow } from './taskjson';
import { runAndRecord, TriggerEvent } from './rules';
import { successorDue } from '../shared/rules';
import { addDays } from '../shared/dates';
import { createMailer, digestMail } from './mailer';

interface SeedPerson { key: string; name: string; email: string; password: string; verified?: boolean; }
interface SeedCapacity { person: string; weekday: string; hours: number; }
interface SeedTask { key: string; name: string; section: string; parent?: string; position?: number; assignee?: string; start?: string; due?: string; effort?: number; completed?: boolean; values?: Record<string, unknown>; recurrence?: string; description?: string; }
interface SeedRule { key?: string; name: string; position?: number; trigger: unknown; condition?: unknown; action: unknown; }
interface SeedForm { key: string; slug: string; section: string; title: string; }
interface SeedField { key: string; name: string; type: string; options?: string[]; formula?: string; }
interface SeedProject {
  key: string; team: string; name: string; sections: string[];
  fields?: SeedField[]; tasks?: SeedTask[]; rules?: SeedRule[]; forms?: SeedForm[];
  dependencies?: { from: string; to: string }[];
}
interface SeedGoal { key: string; team: string; name: string; parent?: string; weight?: number; manual?: number; owner?: string; projects?: { project: string; weight: number }[]; }
interface SeedApproval { key: string; task: string; approver: string; requester: string; status: string; }
interface SeedInbox { key: string; person: string; text: string; task?: string; read?: boolean; createdAt?: string; }
interface SeedHistory { task: string; text: string; createdAt?: string; }
interface SeedBody {
  people?: SeedPerson[];
  teams?: { key: string; name: string; members: string[]; coordinators?: string[]; joinCode?: string }[];
  capacities?: SeedCapacity[];
  projects?: SeedProject[];
  goals?: SeedGoal[];
  approvals?: SeedApproval[];
  inbox?: SeedInbox[];
  history?: SeedHistory[];
}

export function gradingRouter(mailer: ReturnType<typeof createMailer>): Router {
  const r = Router();

  r.post('/grading/seed', readBody(GRADING_MAX), async (req, res) => {
    const body = (req as AuthedRequest).body as SeedBody;
    const out: Record<string, Record<string, string> | Record<string, Record<string, string>>> = {
      people: {}, teams: {}, projects: {}, sections: {}, fields: {}, tasks: {}, rules: {}, goals: {}, forms: {}, approvals: {}, inbox: {},
    };
    const personId = new Map<string, string>();
    const teamId = new Map<string, string>();
    const projectId = new Map<string, string>();
    const sectionId = new Map<string, Map<string, string>>();
    const fieldId = new Map<string, Map<string, string>>();
    const taskId = new Map<string, string>();

    for (const p of body.people ?? []) {
      const ins = await query<{ id: string }>(
        `INSERT INTO people (name, email, password_hash, verified, verify_code) VALUES ($1,$2,$3,$4,NULL) RETURNING id`,
        [p.name, p.email.toLowerCase(), hashPassword(p.password), p.verified !== false]);
      personId.set(p.key, ins.rows[0].id);
      (out.people as Record<string, string>)[p.key] = ins.rows[0].id;
    }
    for (const t of body.teams ?? []) {
      const code = t.joinCode ?? `JOIN-${Math.floor(Math.random() * 1e9).toString(36).toUpperCase()}`;
      const ins = await query<{ id: string }>(
        `INSERT INTO teams (name, join_code) VALUES ($1,$2) RETURNING id`, [t.name, code]);
      teamId.set(t.key, ins.rows[0].id);
      (out.teams as Record<string, string>)[t.key] = ins.rows[0].id;
      const members = new Set([...(t.members ?? []), ...(t.coordinators ?? [])]);
      for (const mk of members) {
        const pid2 = personId.get(mk);
        if (!pid2) continue;
        const role = (t.coordinators ?? []).includes(mk) ? 'coordinator' : 'member';
        await query(`INSERT INTO team_members (team_id, person_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [ins.rows[0].id, pid2, role]);
      }
      await query(`INSERT INTO reference_counters (team_id, next_number) VALUES ($1,1) ON CONFLICT DO NOTHING`, [ins.rows[0].id]);
    }
    for (const c of body.capacities ?? []) {
      const pid2 = personId.get(c.person);
      if (!pid2) continue;
      await query(
        `INSERT INTO capacities (person_id, weekday, hours) VALUES ($1,$2,$3)
         ON CONFLICT (person_id, weekday) DO UPDATE SET hours = $3`, [pid2, c.weekday, c.hours]);
    }
    for (const proj of body.projects ?? []) {
      const tid = teamId.get(proj.team);
      if (!tid) continue;
      const ins = await query<{ id: string }>(
        `INSERT INTO projects (team_id, name) VALUES ($1,$2) RETURNING id`, [tid, proj.name]);
      projectId.set(proj.key, ins.rows[0].id);
      (out.projects as Record<string, string>)[proj.key] = ins.rows[0].id;
      sectionId.set(proj.key, new Map());
      fieldId.set(proj.key, new Map());
      let pos = 1;
      for (const s of proj.sections) {
        const sr = await query<{ id: string }>(
          `INSERT INTO sections (project_id, name, position) VALUES ($1,$2,$3) RETURNING id`, [ins.rows[0].id, s, pos++]);
        sectionId.get(proj.key)!.set(s, sr.rows[0].id);
      }
      const sectionsMap = sectionId.get(proj.key)!;
      for (const f of proj.fields ?? []) {
        const fr = await query<{ id: string }>(
          `INSERT INTO fields (project_id, name, type, options, formula, position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [ins.rows[0].id, f.name, f.type, f.options ? JSON.stringify(f.options) : null, f.formula ?? null, fieldId.get(proj.key)!.size]);
        fieldId.get(proj.key)!.set(f.key, fr.rows[0].id);
        (out.fields as Record<string, string>)[f.key] = fr.rows[0].id;
      }
      for (const form of proj.forms ?? []) {
        const secId = sectionsMap.get(form.section);
        if (!secId) continue;
        await query(`INSERT INTO forms (slug, project_id, section_id, title) VALUES ($1,$2,$3,$4)`,
          [form.slug, ins.rows[0].id, secId, form.title]);
        const hasCat = await query<{ id: string }>(`SELECT id FROM fields WHERE project_id = $1 AND name = 'Category'`, [ins.rows[0].id]);
        if (hasCat.rowCount === 0) {
          await query(`INSERT INTO fields (project_id, name, type, options, position) VALUES ($1,'Category','single_select',$2,$3)`,
            [ins.rows[0].id, JSON.stringify(['Dry goods', 'Fresh', 'Equipment']), fieldId.get(proj.key)!.size]);
        }
        const hasReq = await query<{ id: string }>(`SELECT id FROM fields WHERE project_id = $1 AND name = 'Requested by'`, [ins.rows[0].id]);
        if (hasReq.rowCount === 0) {
          await query(`INSERT INTO fields (project_id, name, type, options, position) VALUES ($1,'Requested by','text',NULL,$2)`,
            [ins.rows[0].id, fieldId.get(proj.key)!.size]);
        }
        (out.forms as Record<string, string>)[form.key] = form.slug;
      }
      let taskPos = new Map<string, number>();
      for (const t of proj.tasks ?? []) {
        const secId = sectionsMap.get(t.section);
        if (!secId) continue;
        const parentKey = t.parent;
        const parentId = parentKey ? taskId.get(`${proj.key}:${parentKey}`) ?? null : null;
        const posKey = `${secId}:${parentId ?? ''}`;
        const pos = t.position ?? (taskPos.get(posKey) ?? 0) + 1;
        taskPos.set(posKey, pos);
        const assignee = t.assignee ? personId.get(t.assignee) ?? null : null;
        const taskIns = await query<{ id: string }>(
          `INSERT INTO tasks (project_id, name, description, section_id, position, parent_id, assignee_id, start_date, due_date, effort, completed, recurrence)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [projectId.get(proj.key)!, t.name, t.description ?? '', secId, pos, parentId, assignee, t.start ?? null, t.due ?? null,
            t.effort ?? null, t.completed === true, t.recurrence ?? null]);
        taskId.set(`${proj.key}:${t.key}`, taskIns.rows[0].id);
        (out.tasks as Record<string, string>)[t.key] = taskIns.rows[0].id;
        for (const [fkey, v] of Object.entries(t.values ?? {})) {
          const fid = fieldId.get(proj.key)!.get(fkey);
          if (fid) {
            await query(`INSERT INTO field_values (task_id, field_id, value) VALUES ($1,$2,$3)`,
              [taskIns.rows[0].id, fid, JSON.stringify(v)]);
          }
        }
      }
      const taskKeyToId = (k: string): string | null => taskId.get(`${proj.key}:${k}`) ?? null;
      for (const dep of proj.dependencies ?? []) {
        const from = taskKeyToId(dep.from);
        const to = taskKeyToId(dep.to);
        if (from && to) await query(`INSERT INTO dependencies (blocker_id, waiter_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [from, to]);
      }
      for (const rule of proj.rules ?? []) {
        const trig = rule.trigger as Record<string, string>;
        const action = rule.action as Record<string, string>;
        const norm = (o: Record<string, string>): Record<string, string> => {
          const out2: Record<string, string> = { ...o };
          if (out2.field && fieldId.get(proj.key)!.has(out2.field)) out2.field = fieldId.get(proj.key)!.get(out2.field)!;
          if (out2.target && fieldId.get(proj.key)!.has(out2.target)) out2.target = fieldId.get(proj.key)!.get(out2.target)!;
          if (out2.section && sectionsMap.has(out2.section)) out2.section = sectionsMap.get(out2.section)!;
          if (out2.target && sectionsMap.has(out2.target)) out2.target = sectionsMap.get(out2.target)!;
          if (out2.target && personId.has(out2.target)) out2.target = personId.get(out2.target)!;
          return out2;
        };
        const pos2 = rule.position ?? ((proj.rules?.indexOf(rule) ?? 0) + 1);
        const insr = await query<{ id: string }>(
          `INSERT INTO rules (project_id, name, trigger, condition, action, position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [ins.rows[0].id, rule.name, JSON.stringify(norm(trig)), rule.condition ? JSON.stringify(norm(rule.condition as Record<string, string>)) : null,
            JSON.stringify(norm(action)), pos2]);
        if (rule.key) (out.rules as Record<string, string>)[rule.key] = insr.rows[0].id;
      }
    }
    const goalIdMap = new Map<string, string>();
    for (const g of body.goals ?? []) {
      const tid = teamId.get(g.team);
      if (!tid) continue;
      const parent = g.parent ? goalIdMap.get(g.parent) ?? null : null;
      const owner = g.owner ? personId.get(g.owner) ?? null : null;
      const ins = await query<{ id: string }>(
        `INSERT INTO goals (team_id, name, parent_id, weight, manual_value, owner_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [tid, g.name, parent, g.weight ?? 1, g.manual ?? 0, owner]);
      goalIdMap.set(g.key, ins.rows[0].id);
      (out.goals as Record<string, string>)[g.key] = ins.rows[0].id;
      for (const pl of g.projects ?? []) {
        const pid2 = projectId.get(pl.project);
        if (pid2) await query(`INSERT INTO goal_projects (goal_id, project_id, weight) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [ins.rows[0].id, pid2, pl.weight]);
      }
    }
    for (const a of body.approvals ?? []) {
      let taskIdOut: string | null = null;
      for (const [k, v] of taskId.entries()) {
        if (k.endsWith(`:${a.task}`)) { taskIdOut = v; break; }
      }
      if (!taskIdOut) continue;
      const approver = personId.get(a.approver);
      const requester = personId.get(a.requester);
      if (!approver) continue;
      const ins = await query<{ id: string }>(
        `INSERT INTO approvals (task_id, approver_id, requester_id, status) VALUES ($1,$2,$3,$4) RETURNING id`,
        [taskIdOut, approver, requester ?? null, a.status]);
      (out.approvals as Record<string, string>)[a.key] = ins.rows[0].id;
    }
    for (const i of body.inbox ?? []) {
      const person = personId.get(i.person);
      if (!person) continue;
      let taskIdOut: string | null = null;
      if (i.task) {
        for (const [k, v] of taskId.entries()) {
          if (k.endsWith(`:${i.task}`)) { taskIdOut = v; break; }
        }
      }
      const ins = await query<{ id: string }>(
        `INSERT INTO inbox_items (person_id, text, task_id, kind, read, created_at) VALUES ($1,$2,$3,'info',$4,$5) RETURNING id`,
        [person, i.text, taskIdOut, i.read === true, i.createdAt ? i.createdAt : new Date().toISOString()]);
      (out.inbox as Record<string, string>)[i.key] = ins.rows[0].id;
    }
    for (const h of body.history ?? []) {
      let taskIdOut: string | null = null;
      for (const [k, v] of taskId.entries()) {
        if (k.endsWith(`:${h.task}`)) { taskIdOut = v; break; }
      }
      if (!taskIdOut) continue;
      await query(`INSERT INTO task_history (task_id, text, created_at) VALUES ($1,$2,$3)`,
        [taskIdOut, h.text, h.createdAt ? h.createdAt : new Date().toISOString()]);
    }
    res.status(201).json(out);
  });

  r.post('/grading/clock', readBody(GRADING_MAX), async (req, res) => {
    const body = (req as AuthedRequest).body as { now?: string };
    if (!body.now) { res.status(422).json({ errors: { now: 'Send a JSON body' } }); return; }
    const newDate = new Date(body.now);
    if (Number.isNaN(newDate.getTime())) { res.status(422).json({ errors: { now: 'Send a JSON body' } }); return; }
    const prevRow = (await query<{ fixed_at: string | null; prev_at: string | null }>(
      `SELECT fixed_at, prev_at FROM app_clock WHERE id = 1`)).rows[0];
    const prev = prevRow?.fixed_at ? new Date(prevRow.fixed_at) : new Date();
    const firstCall = !prevRow?.fixed_at && !prevRow?.prev_at;
    await query(`UPDATE app_clock SET prev_at = fixed_at, fixed_at = $1 WHERE id = 1`, [newDate.toISOString()]);

    if (!firstCall && newDate.getTime() > prev.getTime()) {
      await runDueWork(prev, newDate);
    }
    const nowRow = (await query<{ fixed_at: string }>(`SELECT fixed_at FROM app_clock WHERE id = 1`)).rows[0];
    res.json({ now: nowRow.fixed_at });
  });

  return r;
}

/**
 * The work that has become due, run once: recurring successors, Due date arrives
 * rules, digest windows, lapsed holds and presence.
 */
export async function runDueWork(prev: Date, cur: Date): Promise<void> {
  const prevDay = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}-${String(prev.getUTCDate()).padStart(2, '0')}`;
  const curDay = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}-${String(cur.getUTCDate()).padStart(2, '0')}`;
  const dayAfter = (d: string): string => addDays(d, 1);

  const recurring = await query<TaskRow & { recurrence: string }>(
    `SELECT * FROM tasks WHERE recurrence IS NOT NULL AND completed = false AND due_date IS NOT NULL`);
  for (const t of recurring.rows) {
    if (!t.due_date) continue;
    const clockDue = t.recurrence.startsWith('Every week on ') || t.recurrence.startsWith('Every month on ');
    if (!clockDue) continue;
    if (curDay <= t.due_date) continue;
    const claim = `successor:${t.id}:${t.due_date}`;
    const got = await query(`INSERT INTO claims (key) VALUES ($1) ON CONFLICT (key) DO NOTHING RETURNING key`, [claim]);
    if (got.rows.length === 0) continue;
    const nextDue = successorDue(t.recurrence, t.due_date, null, curDay);
    if (!nextDue) continue;
    const shifted = t.start_date ? addDays(t.start_date, Math.round((new Date(nextDue).getTime() - new Date(t.due_date).getTime()) / 86400000)) : null;
    const values = await query<{ name: string; value: unknown }>(
      `SELECT f.name, v.value FROM field_values v JOIN fields f ON f.id = v.field_id WHERE v.task_id = $1`, [t.id]);
    const posR = await query<{ p: number }>(
      `SELECT COALESCE(max(position),0)+1 AS p FROM tasks WHERE section_id = $1 AND parent_id IS NULL`, [t.section_id]);
    const ins = await query<{ id: string }>(
      `INSERT INTO tasks (project_id, name, section_id, position, assignee_id, start_date, due_date, effort, recurrence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [t.project_id, t.name, t.section_id, posR.rows[0].p, t.assignee_id, shifted, nextDue, t.effort, t.recurrence]);
    for (const v of values.rows) {
      await query(`INSERT INTO field_values (task_id, field_id, value) SELECT $1, field_id, value FROM field_values WHERE task_id = $2`,
        [ins.rows[0].id, t.id]);
    }
    const teamOf = (await query<{ team_id: string }>(`SELECT team_id FROM projects WHERE id = $1`, [t.project_id])).rows[0];
    if (teamOf) {
      publish({ teamIds: [teamOf.team_id], kind: 'successor', at: new Date().toISOString(),
        data: { taskId: ins.rows[0].id, name: t.name, due: nextDue, projectId: t.project_id } });
    }
  }

  const dueRules = await query<{ id: string; project_id: string }>(
    `SELECT DISTINCT r.id, r.project_id FROM rules r WHERE r.trigger->>'type' = 'due_date_arrives'`);
  const handledDays = daysBetween(prevDay, curDay);
  if (dueRules.rows.length > 0 && handledDays > 0) {
    const tasks = await query<TaskRow>(
      `SELECT * FROM tasks WHERE due_date IS NOT NULL AND completed = false AND due_date >= $1 AND due_date < $2`,
      [dayAfter(prevDay), dayAfter(curDay)]);
    for (const t of tasks.rows) {
      const ev: TriggerEvent = {
        projectId: t.project_id, type: 'due_date_arrives', taskId: t.id,
        eventId: `due:${t.id}:${t.due_date}`,
      };
      await withTx(async (client) => { await runAndRecord(client, ev, t.id); });
    }
  }

  await sendDigests(prev, cur);

  await query(`DELETE FROM holds WHERE expires_at <= $1`, [cur.toISOString()]);
  await query(`DELETE FROM presence WHERE expires_at <= $1`, [cur.toISOString()]);
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000);
}

async function sendDigests(prev: Date, cur: Date): Promise<void> {
  const windowMin = env().limits.digestWindowMin;
  const windowMs = windowMin * 60000;
  const aligned = (t: number): number => Math.floor(t / windowMs) * windowMs;
  let start = aligned(prev.getTime()) + windowMs;
  const members = await query<{ person_id: string; email: string }>(
    `SELECT DISTINCT tm.person_id, p.email FROM team_members tm JOIN people p ON p.id = tm.person_id`);
  const mailer = createMailer();
  while (start <= cur.getTime()) {
    const wStart = new Date(start);
    const wEnd = new Date(start + windowMs);
    for (const m of members.rows) {
      const items = await query<{ text: string }>(
        `SELECT text FROM inbox_items WHERE person_id = $1 AND read = false AND archived = false AND created_at >= $2 AND created_at < $3`,
        [m.person_id, wStart.toISOString(), wEnd.toISOString()]);
      if (items.rows.length === 0) continue;
      const got = await query(`INSERT INTO digest_claims (person_id, window_start) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING person_id`,
        [m.person_id, wStart.toISOString()]);
      if (got.rows.length === 0) continue;
      try {
        const mail = digestMail({ email: m.email, count: items.rows.length, items: items.rows.map(i => i.text) });
        await mailer.sendMail({ to: m.email, subject: mail.subject, text: mail.text, html: mail.html });
      } catch {
        // mail service down
      }
    }
    start += windowMs;
  }
}
