import { Router } from 'express';
import { query, withTx } from './db';
import { AuthedRequest, readBody, BODY_MAX } from './apiutil';
import { requireAuthFor } from './auth';
import { projectTeam } from './access';
import { goalProgress, roundHalfUpPercent } from '../shared/goalroll';
import { publish } from './live';

interface GoalRow {
  id: string;
  team_id: string;
  name: string;
  parent_id: string | null;
  weight: number;
  manual_value: number;
  owner_id: string | null;
}

interface GoalNode {
  id: string;
  name: string;
  parentId: string | null;
  weight: number;
  manualValue: number;
  ownerId: string | null;
  children: GoalNode[];
  projects: { projectId: string; name: string; weight: number; progress: number }[];
}

async function buildTree(teamId: string): Promise<GoalNode[]> {
  const goals = await query<GoalRow>(`SELECT * FROM goals WHERE team_id = $1 ORDER BY created_at`, [teamId]);
  const links = await query<{ goal_id: string; project_id: string; weight: number; name: string }>(
    `SELECT gp.goal_id, gp.project_id, gp.weight, p.name FROM goal_projects gp JOIN projects p ON p.id = gp.project_id WHERE p.team_id = $1`, [teamId]);
  const nodes = new Map<string, GoalNode>();
  for (const g of goals.rows) {
    nodes.set(g.id, {
      id: g.id, name: g.name, parentId: g.parent_id, weight: g.weight,
      manualValue: Number(g.manual_value), ownerId: g.owner_id, children: [], projects: [],
    });
  }
  for (const l of links.rows) {
    const node = nodes.get(l.goal_id);
    if (!node) continue;
    const prog = await projectProgress(l.project_id);
    node.projects.push({ projectId: l.project_id, name: l.name, weight: l.weight, progress: prog });
  }
  const roots: GoalNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) nodes.get(node.parentId)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

async function projectProgress(projectId: string): Promise<number> {
  const done = await query<{ c: string }>(`SELECT count(*)::text AS c FROM tasks WHERE project_id = $1 AND parent_id IS NULL AND completed`, [projectId]);
  const total = await query<{ c: string }>(`SELECT count(*)::text AS c FROM tasks WHERE project_id = $1 AND parent_id IS NULL`, [projectId]);
  const t = Number(total.rows[0]?.c ?? 0);
  if (t === 0) return 0;
  return (Number(done.rows[0]?.c ?? 0) / t) * 100;
}

function toRoll(node: GoalNode): Parameters<typeof goalProgress>[0] {
  return {
    id: node.id,
    manualValue: node.manualValue,
    children: node.children.map(c => toRoll(c)),
    projects: node.projects,
    weights: [{ weight: node.weight }],
  };
}

function nodeProgress(node: GoalNode): number {
  return goalProgress(toRoll(node));
}

export function goalsRouter(): Router {
  const r = Router();
  r.use(requireAuthFor('/api/teams/', '/api/goals/'));

  r.get('/api/teams/:teamId/goals', async (req, res) => {
    const ar = req as AuthedRequest;
    const teamId = String(req.params.teamId);
    if (!ar.teamIds?.includes(teamId)) { res.status(404).json({ error: 'not_found' }); return; }
    const roots = await buildTree(teamId);
    const all: unknown[] = [];
    const walk = (nodes: GoalNode[]): void => {
      for (const n of nodes) {
        const progress = nodeProgress(n);
        all.push({
          id: n.id, name: n.name, parentId: n.parentId, weight: n.weight,
          manualValue: n.manualValue, ownerId: n.ownerId,
          progress, percent: roundHalfUpPercent(progress),
          projects: n.projects.map(p => ({ projectId: p.projectId, name: p.name, weight: p.weight, progress: p.progress })),
        });
        walk(n.children);
      }
    };
    walk(roots);
    res.json({ goals: all });
  });

  r.post('/api/teams/:teamId/goals', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const teamId = String(req.params.teamId);
    if (!ar.teamIds?.includes(teamId)) { res.status(404).json({ error: 'not_found' }); return; }
    const body = req.body as { name?: unknown; parentId?: unknown; weight?: unknown; manualValue?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) { res.status(422).json({ errors: { name: 'Enter a goal name' } }); return; }
    let weight = 1;
    if (body.weight !== undefined && body.weight !== null) {
      const w = Number(body.weight);
      if (!Number.isInteger(w) || w < 1 || w > 10) { res.status(422).json({ errors: { weight: 'Weight must be a whole number from 1 to 10' } }); return; }
      weight = w;
    }
    let manual = 0;
    if (body.manualValue !== undefined && body.manualValue !== null) {
      const m = Number(body.manualValue);
      if (Number.isNaN(m) || m < 0 || m > 100) { res.status(422).json({ errors: { manualValue: 'Manual value must be from 0 to 100' } }); return; }
      manual = m;
    }
    let parentId: string | null = null;
    if (body.parentId !== undefined && body.parentId !== null && body.parentId !== '') {
      const parent = (await query<{ id: string }>(`SELECT id FROM goals WHERE id = $1 AND team_id = $2`, [String(body.parentId), teamId])).rows[0];
      if (!parent) { res.status(422).json({ errors: { parentId: 'Enter a goal name' } }); return; }
      parentId = parent.id;
    }
    const ins = await query<{ id: string }>(
      `INSERT INTO goals (team_id, name, parent_id, weight, manual_value, owner_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [teamId, name, parentId, weight, manual, ar.personId ?? null]);
    const node = (await query<GoalRow>(`SELECT * FROM goals WHERE id = $1`, [ins.rows[0].id])).rows[0];
    publish({ teamIds: [teamId], kind: 'goals', at: new Date().toISOString(), data: { teamId } });
    const progress = 0;
    res.status(201).json({
      id: node.id, name: node.name, parentId: node.parent_id, weight: node.weight,
      manualValue: Number(node.manual_value), ownerId: node.owner_id, progress, percent: roundHalfUpPercent(progress), projects: [],
    });
  });

  r.patch('/api/goals/:id', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const goal = (await query<GoalRow>(`SELECT * FROM goals WHERE id = $1`, [id])).rows[0];
    if (!goal) { res.status(404).json({ error: 'not_found' }); return; }
    if (!ar.teamIds?.includes(goal.team_id)) { res.status(404).json({ error: 'not_found' }); return; }
    const isOwner = goal.owner_id === ar.personId;
    const isCoord = ar.personRole?.[goal.team_id] === 'coordinator';
    if (!isOwner && !isCoord) { res.status(403).json({ error: 'forbidden' }); return; }
    const body = req.body as { name?: unknown; weight?: unknown; manualValue?: unknown };
    let name = goal.name, weight = goal.weight, manual = Number(goal.manual_value);
    if (body.name !== undefined) {
      const n = typeof body.name === 'string' ? body.name.trim() : '';
      if (!n) { res.status(422).json({ errors: { name: 'Enter a goal name' } }); return; }
      name = n;
    }
    if (body.weight !== undefined) {
      const w = Number(body.weight);
      if (!Number.isInteger(w) || w < 1 || w > 10) { res.status(422).json({ errors: { weight: 'Weight must be a whole number from 1 to 10' } }); return; }
      weight = w;
    }
    if (body.manualValue !== undefined) {
      const m = Number(body.manualValue);
      if (Number.isNaN(m) || m < 0 || m > 100) { res.status(422).json({ errors: { manualValue: 'Manual value must be from 0 to 100' } }); return; }
      manual = m;
    }
    await query(`UPDATE goals SET name = $1, weight = $2, manual_value = $3 WHERE id = $4`, [name, weight, manual, id]);
    publish({ teamIds: [goal.team_id], kind: 'goals', at: new Date().toISOString(), data: { teamId: goal.team_id } });
    const roots = await buildTree(goal.team_id);
    const found = findNode(roots, id);
    const progress = found ? nodeProgress(found) : 0;
    res.json({
      id, name, parentId: goal.parent_id, weight, manualValue: manual, ownerId: goal.owner_id,
      progress, percent: roundHalfUpPercent(progress),
      projects: found ? found.projects.map(p => ({ projectId: p.projectId, name: p.name, weight: p.weight, progress: p.progress })) : [],
    });
  });

  r.post('/api/goals/:id/projects', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const goal = (await query<GoalRow>(`SELECT * FROM goals WHERE id = $1`, [id])).rows[0];
    if (!goal) { res.status(404).json({ error: 'not_found' }); return; }
    if (!ar.teamIds?.includes(goal.team_id)) { res.status(404).json({ error: 'not_found' }); return; }
    const isCoord = ar.personRole?.[goal.team_id] === 'coordinator';
    const isOwner = goal.owner_id === ar.personId;
    if (!isCoord && !isOwner) { res.status(403).json({ error: 'forbidden' }); return; }
    const body = req.body as { projectId?: unknown; weight?: unknown };
    const projectId = typeof body.projectId === 'string' ? body.projectId : '';
    const project = (await query<{ id: string; team_id: string; name: string }>(`SELECT * FROM projects WHERE id = $1`, [projectId])).rows[0];
    if (!project || project.team_id !== goal.team_id) { res.status(422).json({ errors: { projectId: 'Enter a project name' } }); return; }
    let weight = 1;
    if (body.weight !== undefined && body.weight !== null) {
      const w = Number(body.weight);
      if (!Number.isInteger(w) || w < 1 || w > 10) { res.status(422).json({ errors: { weight: 'Weight must be a whole number from 1 to 10' } }); return; }
      weight = w;
    }
    await query(
      `INSERT INTO goal_projects (goal_id, project_id, weight) VALUES ($1,$2,$3)
       ON CONFLICT (goal_id, project_id) DO UPDATE SET weight = $3`, [id, projectId, weight]);
    publish({ teamIds: [goal.team_id], kind: 'goals', at: new Date().toISOString(), data: { teamId: goal.team_id } });
    res.status(201).json({ goalId: id, projectId, weight });
  });

  return r;
}

function findNode(nodes: GoalNode[], id: string): GoalNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}
