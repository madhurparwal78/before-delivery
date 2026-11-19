import { Router } from 'express';
import { query } from './db';
import { AuthedRequest, readBody, BODY_MAX } from './apiutil';
import { requireAuthFor } from './auth';
import { todayYMD } from './clock';
import { spreadEffort, fmtCellTotal } from '../shared/worktime';
import { ymdToUTC, addDays, dateUTC } from '../shared/dates';
import { WorkloadTaskRow } from './workloadshape';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function workloadRouter(): Router {
  const r = Router();
  r.use(requireAuthFor('/api/teams/'));

  r.get('/api/teams/:teamId/workload', async (req, res) => {
    const ar = req as AuthedRequest;
    const teamId = String(req.params.teamId);
    if (!ar.teamIds?.includes(teamId)) { res.status(404).json({ error: 'not_found' }); return; }
    const fromParam = typeof req.query.from === 'string' ? req.query.from : null;
    const today = await todayYMD();
    let from = fromParam && ymdToUTC(fromParam) ? fromParam : today;
    const base = ymdToUTC(from)!;
    const dow = base.getUTCDay();
    const monday = new Date(base.getTime() - ((dow === 0 ? 6 : dow - 1) * 86400000));
    const days: string[] = [];
    let cur = dateUTC(monday);
    while (days.length < 10) {
      const d = ymdToUTC(cur)!;
      const wd = d.getUTCDay();
      if (wd >= 1 && wd <= 5) days.push(cur);
      cur = addDays(cur, 1);
    }
    const people = await query<{ id: string; name: string }>(
      `SELECT p.id, p.name FROM team_members tm JOIN people p ON p.id = tm.person_id WHERE tm.team_id = $1 ORDER BY p.name`, [teamId]);
    const caps = await query<{ person_id: string; weekday: string; hours: string }>(
      `SELECT person_id, weekday, hours::text AS hours FROM capacities`, []);
    const capMap = new Map<string, number>();
    for (const c of caps.rows) capMap.set(`${c.person_id}:${c.weekday}`, Number(c.hours));
    const tasks = await query<WorkloadTaskRow>(
      `SELECT t.id, t.name, t.assignee_id, t.start_date, t.due_date, t.effort::text AS effort, t.completed
         FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.team_id = $1`, [teamId]);
    const perPerson = new Map<string, Map<string, number>>();
    for (const t of tasks.rows) {
      const effortNum = t.effort === null ? null : Number(t.effort);
      const shares = spreadEffort(t.start_date, t.due_date, effortNum, t.completed, t.assignee_id);
      for (const s of shares) {
        const dayIdx = days.findIndex(d => d === s.date);
        if (dayIdx === -1) continue;
        const m = perPerson.get(t.assignee_id!) ?? new Map<string, number>();
        m.set(s.date, (m.get(s.date) ?? 0) + s.hours);
        perPerson.set(t.assignee_id!, m);
      }
    }
    const peopleOut = people.rows.map(p => {
      const cells = days.map(d => {
        const total = perPerson.get(p.id)?.get(d) ?? 0;
        const wdKey = WEEKDAY_KEYS[ymdToUTC(d)!.getUTCDay()];
        const capacity = capMap.get(`${p.id}:${wdKey}`) ?? 8;
        const over = total > capacity;
        const text = `${fmtCellTotal(total)} of ${fmtCellTotal(capacity)} h${over ? ', over capacity' : ''}`;
        const dayTasks = tasks.rows.filter(t => {
          if (t.assignee_id !== p.id || t.completed || t.effort === null) return false;
          const shares = spreadEffort(t.start_date, t.due_date, Number(t.effort), t.completed, t.assignee_id);
          return shares.some(s => s.date === d);
        });
        return {
          date: d, total: Number(total.toFixed(2)), capacity, over, text,
          tasks: dayTasks.map(t => ({ id: t.id, name: t.name })),
        };
      });
      return { id: p.id, name: p.name, cells };
    });
    res.json({ from: days[0], days, people: peopleOut });
  });

  r.put('/api/teams/:teamId/capacities', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const teamId = String(req.params.teamId);
    if (!ar.teamIds?.includes(teamId)) { res.status(404).json({ error: 'not_found' }); return; }
    if (ar.personRole?.[teamId] !== 'coordinator') { res.status(403).json({ error: 'forbidden' }); return; }
    const body = req.body as { personId?: unknown; weekday?: unknown; hours?: unknown };
    const personId = typeof body.personId === 'string' ? body.personId : '';
    const member = await query<{ person_id: string }>(
      `SELECT person_id FROM team_members WHERE team_id = $1 AND person_id = $2`, [teamId, personId]);
    if (!member.rows[0]) { res.status(422).json({ errors: { personId: 'Choose a member of this team' } }); return; }
    const weekday = typeof body.weekday === 'string' ? body.weekday : '';
    if (!['mon', 'tue', 'wed', 'thu', 'fri'].includes(weekday)) {
      res.status(422).json({ errors: { weekday: 'Choose a weekday from mon to fri' } });
      return;
    }
    const hours = Number(body.hours);
    if (Number.isNaN(hours) || hours < 0 || hours > 24) {
      res.status(422).json({ errors: { hours: 'Hours must be from 0 to 24' } });
      return;
    }
    await query(
      `INSERT INTO capacities (person_id, weekday, hours) VALUES ($1,$2,$3)
       ON CONFLICT (person_id, weekday) DO UPDATE SET hours = $3`, [personId, weekday, hours]);
    res.json({ personId, weekday, hours });
  });

  return r;
}


