import { query } from './db.js';

export interface GoalJson {
  id: string;
  name: string;
  parentId: string | null;
  weight: number;
  manualValue: number;
  ownerId: string | null;
  progress: number;
  percent: number;
  projects: { projectId: string; name: string; weight: number; progress: number }[];
}

/** Completed top-level tasks / top-level tasks x 100; an empty project is 0. */
export async function projectProgress(projectId: string): Promise<number> {
  const rows = await query<{ total: string; done: string }>(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE completed) AS done
     FROM tasks WHERE project_id = $1 AND parent_id IS NULL`,
    [projectId],
  );
  const total = Number(rows[0].total);
  if (total === 0) return 0;
  return (Number(rows[0].done) / total) * 100;
}

export function displayPercent(progress: number): number {
  return Math.floor(progress + 0.5);
}

interface GoalRow {
  id: string;
  name: string;
  parent_id: string | null;
  weight: number;
  manual_value: string | number;
  owner_id: string | null;
}

/**
 * The one place goal rollup is decided: a goal with children is the weighted
 * average of their unrounded progress, a goal without children uses its manual
 * value, and rounding happens only for display.
 */
export async function teamGoals(teamId: string): Promise<GoalJson[]> {
  const goals = await query<GoalRow>(
    `SELECT id, name, parent_id, weight, manual_value, owner_id FROM goals WHERE team_id = $1`,
    [teamId],
  );
  const links = await query<{ goal_id: string; project_id: string; name: string; weight: number }>(
    `SELECT gp.goal_id, gp.project_id, p.name, gp.weight
     FROM goal_projects gp JOIN projects p ON p.id = gp.project_id
     WHERE gp.goal_id = ANY($1)`,
    [goals.map((g) => g.id)],
  );
  const progressByProject = new Map<string, number>();
  for (const link of links) {
    if (!progressByProject.has(link.project_id)) {
      progressByProject.set(link.project_id, await projectProgress(link.project_id));
    }
  }
  const children = new Map<string, GoalRow[]>();
  for (const goal of goals) {
    if (!goal.parent_id) continue;
    const list = children.get(goal.parent_id) ?? [];
    list.push(goal);
    children.set(goal.parent_id, list);
  }
  const cache = new Map<string, number>();

  const progressOf = (goal: GoalRow): number => {
    const cached = cache.get(goal.id);
    if (cached !== undefined) return cached;
    const subGoals = children.get(goal.id) ?? [];
    const projectLinks = links.filter((l) => l.goal_id === goal.id);
    let weighted = 0;
    let weights = 0;
    for (const sub of subGoals) {
      weighted += sub.weight * progressOf(sub);
      weights += sub.weight;
    }
    for (const link of projectLinks) {
      weighted += link.weight * (progressByProject.get(link.project_id) ?? 0);
      weights += link.weight;
    }
    const value = weights === 0 ? Number(goal.manual_value) : weighted / weights;
    cache.set(goal.id, value);
    return value;
  };

  return goals
    .map((goal) => {
      const progress = progressOf(goal);
      return {
        id: goal.id,
        name: goal.name,
        parentId: goal.parent_id,
        weight: goal.weight,
        manualValue: Number(goal.manual_value),
        ownerId: goal.owner_id,
        progress,
        percent: displayPercent(progress),
        projects: links
          .filter((l) => l.goal_id === goal.id)
          .map((l) => ({
            projectId: l.project_id,
            name: l.name,
            weight: l.weight,
            progress: progressByProject.get(l.project_id) ?? 0,
          })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
