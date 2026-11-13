import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as copy from '../copy.ts';
import type { Constraint, Entity, Parameter } from '../types.ts';
import { constraintLabel, solveConstraints } from './constraints.ts';
import { evaluateExpression, evaluateParameters, isParameterName } from './expression.ts';
import { assertClose, circle, line } from './fixtures.ts';

const params = (...entries: [string, string][]): Record<string, Parameter> => Object.fromEntries(entries.map(([name, expression]) => [name, { name, expression }]));
const byHandle = (...entities: Entity[]): Record<string, Entity> => Object.fromEntries(entities.map((e) => [e.handle, e]));
const constraint = (id: string, kind: Constraint['kind'], refs: Constraint['refs'], expression?: string): Constraint =>
  expression === undefined ? { id, kind, refs } : { id, kind, refs, expression };
const whole = (handle: string): Constraint['refs'][number] => ({ handle, point: null });
const lengthOf = (e: Entity | undefined): number => (e?.type === 'line' ? Math.hypot(e.x2 - e.x1, e.y2 - e.y1) : NaN);

describe('expressions', () => {
  it('evaluates numbers, names, + - * / and parentheses', () => {
    const outcome = evaluateExpression('2*(3+1) - d1/5', params(['d1', '10']), 'd2');
    assert.deepEqual(outcome, { ok: true, value: 6 });
    assert.deepEqual(evaluateExpression('-3 + +4 * 2.5', {}, 'x'), { ok: true, value: 7 });
    assert.deepEqual(evaluateExpression('d1 * 2', params(['d1', '5']), 'x'), { ok: true, value: 10 });
  });

  it('refuses an expression nested too deeply instead of overflowing the stack', () => {
    const deep = { ok: false, message: copy.EXPRESSION_TOO_DEEP };
    assert.deepEqual(evaluateExpression(`${'('.repeat(50000)}1${')'.repeat(50000)}`, {}, 'x'), deep);
    assert.deepEqual(evaluateExpression(`${'-'.repeat(100000)}1`, {}, 'x'), deep);
    assert.deepEqual(evaluateExpression(`${'('.repeat(150)}1${')'.repeat(150)}`, {}, 'x'), { ok: true, value: 1 });
    const chain = Object.fromEntries(Array.from({ length: 5000 }, (_, i): [string, Parameter] => [`d${i}`, { name: `d${i}`, expression: `d${i + 1}` }]));
    assert.deepEqual(evaluateParameters(chain), deep);
  });

  it('names parameters d plus digits', () => {
    assert.ok(isParameterName('d1') && isParameterName('d42'));
    assert.ok(!isParameterName('d') && !isParameterName('x1') && !isParameterName('d1a'));
  });

  it('refuses an unknown parameter with its name', () => {
    assert.deepEqual(evaluateParameters(params(['d2', 'd3+1'])), { ok: false, message: copy.unknownParameter('d3') });
  });

  it('refuses a cycle with the names joined by an arrow', () => {
    const outcome = evaluateParameters(params(['d3', 'd2*2'], ['d2', 'd3+1']));
    assert.deepEqual(outcome, { ok: false, message: copy.expressionCycle(['d3', 'd2', 'd3']) });
    assert.deepEqual(evaluateParameters(params(['d1', 'd2 + 1'], ['d2', 'd1*2'])), { ok: false, message: copy.expressionCycle(['d1', 'd2', 'd1']) });
  });

  it('refuses a division by zero naming the parameter that divides', () => {
    assert.deepEqual(evaluateParameters(params(['d4', '0'], ['d5', '10/d4'])), { ok: false, message: 'Expression divides by zero: d5.' });
  });

  it('gives every parameter its value', () => {
    assert.deepEqual(evaluateParameters(params(['d1', '5'], ['d2', 'd1 * 2'])), { ok: true, values: { d1: 5, d2: 10 } });
  });

  it('refuses text that is not an expression', () => {
    assert.deepEqual(evaluateExpression('2 +', {}, 'x'), { ok: false, message: copy.NOT_A_NUMBER });
    assert.deepEqual(evaluateExpression('', {}, 'x'), { ok: false, message: copy.NOT_A_NUMBER });
    assert.deepEqual(evaluateExpression('2 $ 3', {}, 'x'), { ok: false, message: copy.NOT_A_NUMBER });
  });
});

describe('constraint labels', () => {
  it('reads kind, handles and expression', () => {
    assert.equal(constraintLabel(constraint('c1', 'horizontal', [whole('L1')])), 'horizontal L1');
    assert.equal(constraintLabel(constraint('c2', 'length', [whole('L1')], 'd1')), 'length L1 = d1');
    assert.equal(constraintLabel(constraint('c3', 'parallel', [whole('L1'), whole('L2')])), 'parallel L1 L2');
  });
});

describe('solver', () => {
  it('sets a length from a parameter, keeping a fixed start in place', () => {
    const entities = byHandle(line('L1', 0, 0, 4, 0));
    const constraints = [constraint('c1', 'fixed', [{ handle: 'L1', point: 'start' }]), constraint('c2', 'length', [whole('L1')], 'd1')];
    const out = solveConstraints({ entities, constraints, parameters: params(['d1', '5']) }, 'length L1 = d1');
    assert.ok(out.ok);
    const solved = out.changed[0];
    assertClose(lengthOf(solved), 5, 1e-4);
    assert.ok(solved?.type === 'line' && solved.x1 === 0 && solved.y1 === 0);
  });

  it('follows a parameter edit and keeps the fixed start', () => {
    const entities = byHandle(line('L1', 0, 0, 5, 0));
    const constraints = [constraint('c1', 'fixed', [{ handle: 'L1', point: 'start' }]), constraint('c2', 'length', [whole('L1')], 'd1')];
    const out = solveConstraints({ entities, constraints, parameters: params(['d1', '2*(3+1)']) }, 'd1');
    assert.ok(out.ok);
    assertClose(lengthOf(out.changed[0]), 8, 1e-4);
  });

  it('makes a line horizontal by moving the least', () => {
    const out = solveConstraints({ entities: byHandle(line('L2', 0, 5, 4, 6)), constraints: [constraint('c1', 'horizontal', [whole('L2')])], parameters: {} }, 'horizontal L2');
    assert.ok(out.ok);
    const solved = out.changed[0];
    assert.ok(solved?.type === 'line');
    assertClose(solved.y1, solved.y2, 1e-4);
    assertClose(solved.y1, 5.5, 1e-4);
  });

  it('refuses a new length that conflicts with an earlier one and names the first unsatisfied', () => {
    const entities = byHandle(line('L1', 0, 0, 5, 0));
    const constraints = [
      constraint('c1', 'fixed', [{ handle: 'L1', point: 'start' }]), constraint('c2', 'length', [whole('L1')], 'd1'),
      constraint('c3', 'length', [whole('L1')], '3'),
    ];
    const out = solveConstraints({ entities, constraints, parameters: params(['d1', '5']) }, 'length L1 = 3');
    assert.deepEqual(out, { ok: false, message: copy.overConstrained('length L1 = 3', 'length L1 = d1') });
  });

  it('refuses a constraint on a fixed line that it cannot satisfy', () => {
    const entities = byHandle(line('L1', 0, 0, 3, 4));
    const constraints = [constraint('c1', 'fixed', [whole('L1')]), constraint('c2', 'horizontal', [whole('L1')])];
    const out = solveConstraints({ entities, constraints, parameters: {} }, 'horizontal L1');
    assert.deepEqual(out, { ok: false, message: 'Over-constrained: horizontal L1 conflicts with fixed L1.' });
  });

  it('keeps the dragged point and restores the fixed length: equal after a grip drag', () => {
    const dragged = byHandle(line('L1', 0, 0, 8, 0), line('L2', 0, 5, 5, 5));
    const constraints = [constraint('c1', 'fixed', [whole('L2')]), constraint('c2', 'equal', [whole('L1'), whole('L2')])];
    const out = solveConstraints({ entities: dragged, constraints, parameters: {}, dragged: { handle: 'L1', point: 'end' } }, 'GRIP');
    assert.ok(out.ok);
    const l1 = out.changed.find((e) => e.handle === 'L1');
    assert.ok(l1?.type === 'line');
    assertClose(l1.x2, 8, 1e-4);
    assertClose(lengthOf(l1), 5, 1e-4);
    assert.equal(out.changed.some((e) => e.handle === 'L2'), false);
  });

  it('joins two end points and makes lines parallel, perpendicular and vertical', () => {
    const entities = byHandle(line('L1', 0, 0, 10, 0), line('L2', 10.5, 0.5, 10.5, 9), line('L3', 0, 20, 7, 21));
    const constraints = [
      constraint('c1', 'fixed', [whole('L1')]),
      constraint('c2', 'coincident', [{ handle: 'L1', point: 'end' }, { handle: 'L2', point: 'start' }]),
      constraint('c3', 'perpendicular', [whole('L1'), whole('L2')]),
      constraint('c4', 'parallel', [whole('L1'), whole('L3')]),
    ];
    const out = solveConstraints({ entities, constraints, parameters: {} }, 'parallel L1 L3');
    assert.ok(out.ok);
    const l2 = out.changed.find((e) => e.handle === 'L2');
    const l3 = out.changed.find((e) => e.handle === 'L3');
    assert.ok(l2?.type === 'line' && l3?.type === 'line');
    assertClose(l2.x1, 10, 1e-4); assertClose(l2.y1, 0, 1e-4); assertClose(l2.x2, 10, 1e-3);
    assertClose(l3.y1, l3.y2, 1e-3);
  });

  it('sets a circle radius from an expression', () => {
    const out = solveConstraints({ entities: byHandle(circle('C1', 0, 0, 3)), constraints: [constraint('c1', 'radius', [whole('C1')], 'd1')], parameters: params(['d1', '4']) }, 'd1');
    assert.ok(out.ok);
    assert.ok(out.changed[0]?.type === 'circle' && out.changed[0].r === 4);
  });

  it('returns the expression error of a constraint', () => {
    const out = solveConstraints({ entities: byHandle(line('L1', 0, 0, 3, 4)), constraints: [constraint('c1', 'length', [whole('L1')], 'd9')], parameters: {} }, 'd9');
    assert.deepEqual(out, { ok: false, message: copy.unknownParameter('d9') });
  });

  it('changes nothing when every constraint already holds', () => {
    const out = solveConstraints({ entities: byHandle(line('L1', 0, 0, 5, 0)), constraints: [constraint('c1', 'horizontal', [whole('L1')])], parameters: {} }, 'x');
    assert.deepEqual(out, { ok: true, changed: [] });
  });
});
