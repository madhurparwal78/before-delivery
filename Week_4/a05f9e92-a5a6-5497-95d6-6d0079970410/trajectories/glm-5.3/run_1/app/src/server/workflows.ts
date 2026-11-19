// Workflow engine: drafts, versions, runs, steps, loops, subflows.
// One place interprets step JSON; nothing else runs user-defined behaviour.

import { Db, clock } from './db.js';
import { Ctx as ExprCtx, parse, evaluate, truthy } from '../express/expression.js';

export type StepType =
  | 'trigger' | 'if' | 'loop' | 'approval' | 'create_task'
  | 'set_fields' | 'wait' | 'subflow' | 'notify' | 'end';

export interface Step {
  id: string;
  type: StepType;
  name: string;
  on?: 'record_created' | 'record_updated' | 'item_ordered';
  table?: string | null;
  items?: string[];
  condition?: string;
  then?: Step[];
  else?: Step[];
  over?: string | null;
  until?: string | null;
  body?: Step[];
  approvers?: { kind: 'department_approvers' | 'user'; user: string | null };
  rule?: 'any' | 'all';
  group?: string;
  short_description?: string;
  wait?: boolean;
  fields?: Record<string, string>;
  units?: number;
  flow?: string;
  inputs?: Record<string, string>;
  to?: { users: string[]; roles: string[] };
  text?: string;
  on_error?: Step[];
}

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  trigger: 'Trigger',
  if: 'If',
  loop: 'Loop',
  approval: 'Approval',
  create_task: 'Create task',
  set_fields: 'Set fields',
  wait: 'Wait',
  subflow: 'Subflow',
  notify: 'Notify',
  end: 'End',
};

export interface RunStep {
  id: string;
  name: string;
  status: 'waiting' | 'running' | 'done' | 'skipped' | 'failed' | 'handled';
  error?: string | null;
}

export interface Run {
  id: number;
  workflow: number;
  version: number;
  record: string | null;
  status: 'running' | 'waiting' | 'done' | 'failed';
  steps: RunStep[];
  simulated: boolean;
}

/** A subflow chain that reaches the flow itself is refused at publish. */
export function findSubflowCycle(startName: string, latestPublished: Map<string, Step[]>): string[] | null {
  const chain: string[] = [];

  const walk = (name: string, seen: Set<string>): string[] | null => {
    if (seen.has(name)) {
      if (name === startName) return [...chain, name];
      return null;
    }
    seen.add(name);
    chain.push(name);
    const steps = latestPublished.get(name) ?? [];
    const subflowNames = collectSubflows(steps);
    for (const flowName of subflowNames) {
      const result = walk(flowName, new Set(seen));
      if (result) return result;
    }
    chain.pop();
    return null;
  };

  return walk(startName, new Set());
}

function childSteps(step: Step): Step[] {
  return [...(step.then ?? []), ...(step.else ?? []), ...(step.body ?? []), ...(step.on_error ?? [])];
}

function collectSubflows(steps: Step[]): string[] {
  const out: string[] = [];
  const walk = (list: Step[]): void => {
    for (const s of list) {
      if (s.type === 'subflow' && s.flow) out.push(s.flow);
      walk(childSteps(s));
    }
  };
  walk(steps);
  return out;
}

/** Validate a draft's step tree: ids unique, trigger first, types known. */
export function validateSteps(steps: Step[]): string | null {
  if (!Array.isArray(steps)) return 'Steps must be a list.';
  if (steps.length === 0) return null;
  if (steps[0].type !== 'trigger') return 'The first step must be a trigger.';
  const ids = new Set<string>();
  const walkList = (list: Step[]): string | null => {
    for (const s of list) {
      if (!s.id) return 'Every step needs an id.';
      if (ids.has(s.id)) return `Step id "${s.id}" is used twice.`;
      ids.add(s.id);
      if (!STEP_TYPE_LABELS[s.type]) return `Unknown step type "${s.type}".`;
      for (const child of childSteps(s)) {
        const err = walkList([child]);
        if (err) return err;
      }
    }
    return null;
  };
  return walkList(steps);
}

/** Expression context for workflow steps: variables, inputs, steps outputs. */
export function stepCtx(params: {
  record: Record<string, unknown>;
  variables: Record<string, unknown>;
  inputs: Record<string, unknown>;
  steps: Record<string, Record<string, unknown>>;
  now: number;
  me: string;
}): ExprCtx {
  const scope: Record<string, unknown> = {
    ...params.record,
    variables: params.variables,
    inputs: params.inputs,
    steps: params.steps,
  };
  return {
    rec: scope,
    now: params.now,
    me: params.me,
    roles: new Set(['operator']),
    resolve: (path: string) => {
      let cur: unknown = scope;
      for (const part of path.split('.')) {
        if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[part];
        } else {
          return null;
        }
      }
      return cur;
    },
  };
}

export function evalStepCondition(text: string | undefined, ctx: ExprCtx): boolean {
  if (!text) return true;
  try {
    return truthy(evaluate(parse(text), ctx));
  } catch {
    return false;
  }
}
