import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arc, circle, line, pline } from '../model/testing.ts';
import { Bench } from './testing.ts';

describe('dimensions', () => {
  const bench = () => new Bench({ entities: [line('L1', 0, 0, 10, 0), line('L3', 100, 0, 110, 0), line('L4', 100, 0, 110, 10), circle('C5', 200, 0, 2.5)] });

  it('links each point that lies on an entity start, end or centre and puts the text at the line position', () => {
    const b = bench();
    b.run('DL', '0,0', '10,0', '5,-2');
    const [, , , , made] = Object.values(b.state.entities);
    assert.ok(made.type === 'dimension' && made.kind === 'linear' && made.value === 10 && made.text_x === 5 && made.text_y === -2);
    assert.deepEqual(made.refs, [{ handle: 'L1', point: 'start' }, { handle: 'L1', point: 'end' }]);
    assert.equal(b.announced, `Dimension ${made.handle} added`);
  });

  it('measures aligned, angular and radial dimensions', () => {
    const b = bench();
    b.run('DA', '0,0', '10,0', '5,2');
    b.run('DG', 'L3', 'L4', '105,3');
    b.run('DR', 'C5', '203,0');
    const values = Object.values(b.state.entities).filter((entity) => entity.type === 'dimension').map((entity) => (entity.type === 'dimension' ? [entity.kind, entity.value] : []));
    assert.deepEqual(values, [['aligned', 10], ['angular', 45], ['radial', 2.5]]);
  });

  it('refuses points that touch no entity at the last stage and lets U step back to fix them', () => {
    const b = bench();
    b.run('DL', '0,0', '1,0', '5,2');
    assert.equal(b.promptText, 'Nothing there to pick.');
    assert.equal(b.groups.length, 0);
    b.session.clearMessage();
    b.run('U');
    assert.equal(b.promptText, 'DIMLINEAR: second point');
    b.run('10,0', '5,2');
    assert.equal(b.groups.length, 1);
  });
});

describe('HATCH, DIST and AREA', () => {
  const bench = () => new Bench({ entities: [pline('P1', [[0, 0], [10, 0], [10, 10], [0, 10]], true), circle('C2', 5, 5, 2), circle('C3', 5, 5, 1), arc('A9', 50, 50, 1, 0, 90)] });

  it('adds a hatch at the picked point, the boundary found by the engine', () => {
    const b = bench();
    b.run('H', '1,1');
    const hatch = Object.values(b.state.entities).find((entity) => entity.type === 'hatch');
    assert.ok(hatch && hatch.type === 'hatch' && Math.abs(hatch.area - (100 - 4 * Math.PI)) < 0.001);
    assert.equal(b.announced, `Hatch ${hatch.handle} added`);
  });

  it('shows the engine\'s refusal in the prompt and reopens the stage', () => {
    const b = bench();
    b.run('H', '500,500');
    assert.equal(b.promptText, 'No closed boundary around that point.');
    assert.equal(b.groups.length, 0);
    b.session.clearMessage();
    b.run('1,1');
    assert.equal(b.groups.length, 1);
  });

  it('measures a distance and stays at the second point so another point measures again', () => {
    const b = bench();
    b.run('DI', '0,0', '3,4');
    assert.equal(b.promptText, 'DIST: 5 units, angle 53.13 degrees');
    b.session.clearMessage();
    b.run('0,-5');
    assert.equal(b.promptText, 'DIST: 5 units, angle 270 degrees');
    assert.equal(b.groups.length, 0);
  });

  it('reports the area of a closed entity or of the hatch rule around a point', () => {
    const b = bench();
    b.run('AA', 'C2');
    assert.equal(b.promptText, 'AREA: 12.566');
    b.run('3,8');
    assert.equal(b.promptText, 'AREA: 87.434');
    b.run('500,500');
    assert.equal(b.promptText, 'No closed boundary around that point.');
  });
});

describe('PARAM and CONSTRAIN', () => {
  const bench = () => new Bench({
    entities: [line('L1', 0, 0, 5, 0), line('L2', 0, 5, 4, 6)],
    parameters: [{ name: 'd1', expression: '5' }, { name: 'd2', expression: 'd1 * 2' }],
    constraints: [{ kind: 'fixed', refs: [{ handle: 'L1', point: 'start' }] }, { kind: 'length', refs: [{ handle: 'L1', point: null }], expression: 'd1' }],
  });

  it('sets a parameter from "name = expression" with Space kept as a character, and moves focus on an empty Enter', () => {
    const b = bench();
    b.run('PM');
    const space = b.type('d1', 'space');
    assert.equal(space.consumed, false);
    b.run('d1 = 7');
    assert.deepEqual(b.groups[0].ops.map((op) => op.type), ['parameter_set']);
    assert.equal(b.state.parameters.d1.expression, '7');
    b.run('PM', '');
    assert.deepEqual(b.focuses, ['parameter-list']);
  });

  it('shows the engine\'s expression errors and keeps the stage', () => {
    const b = bench();
    b.run('PM', 'd1 = d9');
    assert.equal(b.promptText, 'Unknown parameter: d9.');
    b.escape();
    b.run('PM', 'd1 = d2 + 1');
    assert.match(b.promptText, /^Expression cycle: d[12] -> d[12] -> d[12]\.$/);
    assert.equal(b.state.parameters.d1.expression, '5');
  });

  it('adds a constraint by kind and stage order and shows the engine\'s over-constraint refusal', () => {
    const b = bench();
    b.run('CN', 'horizontal', 'L2');
    assert.ok(b.state.constraints.some((c) => c.kind === 'horizontal' && c.refs[0].handle === 'L2'));
    const count = b.state.constraints.length;
    b.run('CN', 'length', 'L1', '3');
    assert.match(b.promptText, /^Over-constrained: /);
    assert.equal(b.state.constraints.length, count);
  });

  it('takes coincident as two line ends and the others as entities', () => {
    const b = new Bench({ entities: [line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10), line('L3', 20, 0, 20, 5)] });
    b.run('CN', 'coincident', '0,0', '0,10');
    const [made] = b.groups[0].ops;
    assert.ok(made.type === 'constraint_add');
    assert.deepEqual(made.kind === 'coincident' && made.refs, [{ handle: 'L1', point: 'start' }, { handle: 'L2', point: 'end' }]);
    b.run('CN', 'coincident', '100,100');
    assert.equal(b.promptText, 'Nothing there to pick.');
    b.escape();
    b.run('CN', 'radius', 'L1');
    assert.equal(b.promptText, 'Nothing there to pick.');
  });
});
