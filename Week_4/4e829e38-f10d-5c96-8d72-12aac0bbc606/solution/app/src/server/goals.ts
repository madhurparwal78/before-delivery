/** The goal rollup: weighted average of children, rounded only for display. */

export interface GoalNode {
  id: string;
  parentId: string | null;
  weight: number;
  manualValue: number;
  projects: Array<{ projectId: string; weight: number; progress: number }>;
}

export function rollup(goals: GoalNode[]): Map<string, number> {
  const progress = new Map<string, number>();
  const compute = (goal: GoalNode): number => {
    const known = progress.get(goal.id);
    if (known !== undefined) return known;
    const children = goals.filter((g) => g.parentId === goal.id);
    const parts = [
      ...children.map((child) => ({ weight: child.weight, value: compute(child) })),
      ...goal.projects.map((link) => ({ weight: link.weight, value: link.progress })),
    ];
    const weights = parts.reduce((sum, part) => sum + part.weight, 0);
    const value = parts.length ? parts.reduce((sum, part) => sum + part.weight * part.value, 0) / weights : goal.manualValue;
    progress.set(goal.id, value);
    return value;
  };
  goals.forEach(compute);
  return progress;
}

export function displayPercent(progress: number): number {
  return Math.floor(progress + 0.5);
}
