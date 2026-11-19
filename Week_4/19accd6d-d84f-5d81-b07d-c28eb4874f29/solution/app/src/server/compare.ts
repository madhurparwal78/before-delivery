import { operationDefinition } from "../shared/operations/catalogue";
import type { ArgSpec, ArgValue, Step } from "../shared/operations/types";

interface Comparable {
  name: string;
  steps: readonly Step[];
}

interface Pairing {
  oldIndex: number;
  moved: boolean;
}

function argText(arg: ArgSpec, value: ArgValue | undefined): string {
  return arg.kind === "toggle" ? (value === true ? "on" : "off") : String(value);
}

/** Matches new steps to old ones by the longest common subsequence of operation names, ties preferring the earliest old steps. */
function pairSteps(from: readonly Step[], to: readonly Step[]): Map<number, Pairing> {
  const common = Array.from({ length: from.length + 1 }, () => new Array<number>(to.length + 1).fill(0));
  for (let i = from.length - 1; i >= 0; i--) {
    for (let j = to.length - 1; j >= 0; j--) {
      common[i]![j] = (from[i] as Step).op === (to[j] as Step).op
        ? common[i + 1]![j + 1]! + 1
        : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }
  const pairs = new Map<number, Pairing>();
  let i = 0;
  let j = 0;
  while (i < from.length && j < to.length) {
    if ((from[i] as Step).op === (to[j] as Step).op) pairs.set(j++, { oldIndex: i++, moved: false });
    else if (common[i]![j + 1]! >= common[i + 1]![j]!) j++;
    else i++;
  }
  const taken = new Set([...pairs.values()].map((pair) => pair.oldIndex));
  to.forEach((step, newIndex) => {
    if (pairs.has(newIndex)) return;
    const oldIndex = from.findIndex((old, index) => !taken.has(index) && old.op === step.op);
    if (oldIndex !== -1) {
      taken.add(oldIndex);
      pairs.set(newIndex, { oldIndex, moved: true });
    }
  });
  return pairs;
}

/** The change lines between two versions, in the published order. */
export function compareVersions(from: Comparable, to: Comparable): string[] {
  const lines: string[] = [];
  if (from.name !== to.name) lines.push(`Renamed from ${from.name} to ${to.name}`);
  const pairs = pairSteps(from.steps, to.steps);
  const kept = new Set([...pairs.values()].map((pair) => pair.oldIndex));
  from.steps.forEach((step, index) => {
    if (!kept.has(index)) lines.push(`Removed ${step.op} from step ${index + 1}`);
  });
  to.steps.forEach((step, index) => {
    const pair = pairs.get(index);
    if (!pair) {
      lines.push(`Added ${step.op} at step ${index + 1}`);
      return;
    }
    const old = from.steps[pair.oldIndex] as Step;
    if (pair.moved) lines.push(`Moved ${step.op} from step ${pair.oldIndex + 1} to step ${index + 1}`);
    for (const arg of operationDefinition(step.op).args) {
      if (old.args[arg.key] !== step.args[arg.key]) {
        lines.push(`Changed ${step.op} at step ${index + 1}: ${arg.label} from ${argText(arg, old.args[arg.key])} to ${argText(arg, step.args[arg.key])}`);
      }
    }
    if (old.disabled !== step.disabled) lines.push(`${step.disabled ? "Disabled" : "Enabled"} ${step.op} at step ${index + 1}`);
  });
  return lines;
}
