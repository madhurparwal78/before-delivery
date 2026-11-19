import type { Step } from '../shared/catalogue.js';
import { operation } from '../shared/catalogue.js';
import type { VersionRow } from './recipes.js';

interface MatchedPair {
  oldIndex: number;
  newIndex: number;
}

/** LCS on operation names, ties preferring the earliest old steps (Business rules). */
function lcsMatch(oldSteps: Step[], newSteps: Step[]): MatchedPair[] {
  const a = oldSteps.map((s) => s.op);
  const b = newSteps.map((s) => s.op);
  const m = a.length;
  const n = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: MatchedPair[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      pairs.push({ oldIndex: i, newIndex: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

function valueText(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return String(v);
}

/** The one compare rule (DP-34). Lines are produced in the published order. */
export function compareVersions(from: VersionRow, to: VersionRow): string[] {
  const oldSteps = from.steps;
  const newSteps = to.steps;
  const pairs = lcsMatch(oldSteps, newSteps);
  const matchedOld = new Set(pairs.map((p) => p.oldIndex));
  const matchedNew = new Set(pairs.map((p) => p.newIndex));

  // Pair remaining same-operation steps in order as moves.
  const unmatchedOld = oldSteps.map((s, i) => ({ s, i })).filter(({ i }) => !matchedOld.has(i));
  const unmatchedNew = newSteps.map((s, i) => ({ s, i })).filter(({ i }) => !matchedNew.has(i));
  const pool = new Map<string, number[]>();
  for (const { s, i } of unmatchedOld) {
    const list = pool.get(s.op) ?? [];
    list.push(i);
    pool.set(s.op, list);
  }
  const moves: MatchedPair[] = [];
  for (const { s, i } of unmatchedNew) {
    const list = pool.get(s.op);
    if (list && list.length > 0) {
      const oldIndex = list.shift()!;
      moves.push({ oldIndex, newIndex: i });
    }
  }

  const lines: string[] = [];
  if (from.name !== to.name) lines.push(`Renamed from ${from.name} to ${to.name}`);

  const allPairs = [...pairs, ...moves];
  const oldPaired = new Set(allPairs.map((p) => p.oldIndex));
  for (let i = 0; i < oldSteps.length; i++) {
    if (!oldPaired.has(i)) lines.push(`Removed ${oldSteps[i].op} from step ${i + 1}`);
  }

  const pairByNew = new Map<number, MatchedPair>();
  for (const p of allPairs) pairByNew.set(p.newIndex, p);

  for (let j = 0; j < newSteps.length; j++) {
    const step = newSteps[j];
    const pair = pairByNew.get(j);
    const stepNum = j + 1;
    if (!pair) {
      lines.push(`Added ${step.op} at step ${stepNum}`);
      continue;
    }
    const oldStep = oldSteps[pair.oldIndex];
    const wasMove = moves.some((m) => m.newIndex === j);
    if (wasMove && pair.oldIndex + 1 !== stepNum) lines.push(`Moved ${step.op} from step ${pair.oldIndex + 1} to step ${stepNum}`);
    if (!wasMove && pair.oldIndex + 1 !== stepNum) lines.push(`Moved ${step.op} from step ${pair.oldIndex + 1} to step ${stepNum}`);
    const spec = operation(step.op);
    const keys = new Set([...Object.keys(oldStep.args), ...Object.keys(step.args)]);
    for (const key of keys) {
      const oldV = oldStep.args[key];
      const newV = step.args[key];
      if (oldV !== newV) {
        const label = spec?.args.find((a) => a.key === key)?.label ?? key;
        lines.push(`Changed ${step.op} at step ${stepNum}: ${label} from ${valueText(oldV)} to ${valueText(newV)}`);
      }
    }
    if (oldStep.disabled !== step.disabled) {
      lines.push(step.disabled ? `Disabled ${step.op} at step ${stepNum}` : `Enabled ${step.op} at step ${stepNum}`);
    }
  }
  return lines;
}
