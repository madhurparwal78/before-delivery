/** Display rounding for goal percents: half up to a whole number. */
export function roundHalfUpPercent(x: number): number {
  return x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5);
}

export interface GoalNodeLike {
  id: string;
  manualValue: number;
  children: GoalNodeLike[];
  projects: { progress: number; weight: number }[];
  weights: { weight: number }[];
  progressOf?: (n: GoalNodeLike) => number;
}

/**
 * Goal progress: weighted average of children (sub-goals and linked projects),
 * else the manual value. Children contribute their unrounded progress.
 */
export function goalProgress(node: GoalNodeLike): number {
  const kids: { progress: number; weight: number }[] = [];
  for (const c of node.children) kids.push({ progress: goalProgress(c), weight: c.weights[0]?.weight ?? 1 });
  for (const p of node.projects) kids.push({ progress: p.progress, weight: p.weight });
  if (kids.length === 0) return clampManual(node.manualValue);
  let sum = 0, wsum = 0;
  for (const k of kids) { sum += k.progress * k.weight; wsum += k.weight; }
  return wsum === 0 ? clampManual(node.manualValue) : sum / wsum;
}

function clampManual(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}
