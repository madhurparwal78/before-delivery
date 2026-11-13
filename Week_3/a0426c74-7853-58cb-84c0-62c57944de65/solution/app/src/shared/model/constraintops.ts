// Constraints and parameters: validating them, and settling the drawing's geometry against them after a group.
import * as copy from '../copy.ts';
import { invalid } from '../errors.ts';
import { constraintLabel, evaluateExpression, evaluateParameters, isParameterName, solveConstraints, SOLVE_TOL } from '../geometry/index.ts';
import type { SolveInput } from '../geometry/index.ts';
import type { Constraint, ConstraintKind, ConstraintRef, Entity, Op, Parameter } from '../types.ts';
import type { Context, OpOutcome } from './context.ts';

/** What each kind of constraint is built on; the sentence says it when the references do not fit. */
const KIND_RULES: Record<ConstraintKind, { what: string; refs: number; on: 'line' | 'circle'; endPoints?: true }> = {
  coincident: { what: 'two line end points', refs: 2, on: 'line', endPoints: true },
  horizontal: { what: 'one line', refs: 1, on: 'line' },
  vertical: { what: 'one line', refs: 1, on: 'line' },
  parallel: { what: 'two lines', refs: 2, on: 'line' },
  perpendicular: { what: 'two lines', refs: 2, on: 'line' },
  equal: { what: 'two lines', refs: 2, on: 'line' },
  fixed: { what: 'a line or a line end point', refs: 1, on: 'line' },
  length: { what: 'a line', refs: 1, on: 'line' },
  radius: { what: 'a circle', refs: 1, on: 'circle' },
};

const idNumber = (constraint: Constraint): number => Number(constraint.id.slice(1));

export function constraintAddOp(ctx: Context, op: Extract<Op, { type: 'constraint_add' }>): OpOutcome {
  const rule = KIND_RULES[op.kind];
  const fits = op.refs.length === rule.refs && op.refs.every((ref) => ctx.ws.entities.get(ref.handle)?.type === rule.on
    && (!rule.endPoints || ref.point === 'start' || ref.point === 'end'));
  if (!fits) throw invalid(copy.constraintNeeds(op.kind, rule.what));
  const next = Math.max(0, ...ctx.ws.constraints.values().map(idNumber)) + 1;
  const constraint: Constraint = {
    id: `K${next}`, kind: op.kind, refs: op.refs.map((ref) => ({ handle: ref.handle, point: ref.point ?? null })),
    ...(op.kind === 'length' || op.kind === 'radius' ? { expression: op.expression ?? '' } : {}),
  };
  if (constraint.expression !== undefined) {
    const outcome = evaluateExpression(constraint.expression, ctx.ws.parameters.record, constraintLabel(constraint));
    if (!outcome.ok) throw invalid(outcome.message);
  }
  ctx.ws.constraints.set(constraint.id, constraint);
  ctx.trigger = constraintLabel(constraint);
  return { status: 'applied', handles: [] };
}

export function constraintDeleteOp(ctx: Context, op: Extract<Op, { type: 'constraint_delete' }>): OpOutcome {
  if (!ctx.ws.constraints.has(op.id)) throw invalid(copy.noConstraint(op.id));
  ctx.ws.constraints.delete(op.id);
  return { status: 'applied', handles: [] };
}

function checkedParameters(parameters: Record<string, Parameter>): void {
  const outcome = evaluateParameters(parameters);
  if (!outcome.ok) throw invalid(outcome.message);
}

export function parameterSetOp(ctx: Context, op: Extract<Op, { type: 'parameter_set' }>): OpOutcome {
  if (!isParameterName(op.name)) throw invalid(copy.PARAMETER_NAME);
  if (op.expression.trim() === '') throw invalid(copy.invalidValue('expression'));
  checkedParameters({ ...ctx.ws.parameters.record, [op.name]: { name: op.name, expression: op.expression } });
  ctx.ws.parameters.set(op.name, { name: op.name, expression: op.expression });
  ctx.trigger = `${op.name} = ${op.expression}`;
  return { status: 'applied', handles: [] };
}

export function parameterDeleteOp(ctx: Context, op: Extract<Op, { type: 'parameter_delete' }>): OpOutcome {
  if (!ctx.ws.parameters.has(op.name)) throw invalid(copy.noParameter(op.name));
  ctx.ws.parameters.delete(op.name);
  checkedParameters(ctx.ws.parameters.record);
  ctx.trigger = `delete ${op.name}`;
  return { status: 'applied', handles: [] };
}

/** The grip being dragged: a GRIP group of one modify that sets one end of a line. */
function draggedPoint(ctx: Context, ops: readonly Op[]): SolveInput['dragged'] {
  const [op] = ops;
  if (ctx.command !== 'GRIP' || ops.length !== 1 || op.type !== 'modify') return undefined;
  const start = 'x1' in op.set || 'y1' in op.set;
  const end = 'x2' in op.set || 'y2' in op.set;
  return { handle: op.handle, point: start && !end ? 'start' : end && !start ? 'end' : null };
}

const editLabel = (ops: readonly Op[]): string => {
  const op = ops.find((candidate) => candidate.type === 'modify' || candidate.type === 'move' || candidate.type === 'delete' || candidate.type === 'add');
  if (op?.type === 'modify') return `modify ${op.handle}`;
  if (op?.type === 'move' || op?.type === 'delete') return `${op.type} ${op.handles.join(' ')}`;
  return op?.type ?? 'edit';
};

const sameCoordinates = (a: number[], b: number[]): boolean => a.every((value, i) => Math.abs(value - b[i]) <= SOLVE_TOL);
const fixedPart = (entity: Entity, point: ConstraintRef['point']): number[] => {
  if (entity.type !== 'line') return [];
  if (point === 'start') return [entity.x1, entity.y1];
  if (point === 'end') return [entity.x2, entity.y2];
  return [entity.x1, entity.y1, entity.x2, entity.y2];
};

/**
 * After a group that changed geometry, constraints or parameters: refuse an edit that moves what a `fixed` constraint holds, then solve.
 * The entities the solver moves become part of the group's changes. A refusal throws and the whole group rolls back.
 */
export function settleConstraints(ctx: Context, ops: readonly Op[]): void {
  const { ws } = ctx;
  const constraints = ws.constraints.values().sort((a, b) => idNumber(a) - idNumber(b));
  const geometryTouched = [...ws.entities.touched.keys()].some((handle) => {
    const type = (ws.entities.get(handle) ?? ws.entities.touched.get(handle))?.type;
    return type === 'line' || type === 'circle';
  });
  if (constraints.length === 0 || !(geometryTouched || ws.constraints.touched.size > 0 || ws.parameters.touched.size > 0)) return;
  const trigger = ctx.trigger ?? editLabel(ops);
  for (const constraint of constraints) {
    if (constraint.kind !== 'fixed') continue;
    const [ref] = constraint.refs;
    const before = ws.origin.entities[ref.handle];
    const now = ws.entities.get(ref.handle);
    if (before && now && !sameCoordinates(fixedPart(now, ref.point), fixedPart(before, ref.point))) {
      throw invalid(copy.overConstrained(trigger, constraintLabel(constraint)));
    }
  }
  const outcome = solveConstraints({ entities: ws.entities.record, constraints, parameters: ws.parameters.record, dragged: draggedPoint(ctx, ops) }, trigger);
  if (!outcome.ok) throw invalid(outcome.message);
  for (const entity of outcome.changed) {
    ctx.assertUnlocked(entity.layer);
    ws.entities.set(entity.handle, entity);
  }
}
