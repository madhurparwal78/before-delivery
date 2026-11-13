import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as copy from '../copy.ts';
import { handleNumber } from '../geometry/index.ts';
import { arc, circle, line, pline } from '../model/testing.ts';
import { Bench, endsOf } from './testing.ts';

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.001;
const ends = endsOf;

describe('TRIM and EXTEND', () => {
  const bench = () => new Bench({ entities: [
    line('L1', 5, -5, 5, 5), line('L2', 0, 0, 10, 0), line('L3', 3, 15, 3, 25), line('L4', 7, 15, 7, 25), line('L5', 0, 20, 10, 20),
    circle('C6', 0, 50, 5), line('L7', 0, 40, 0, 60), pline('P8', [[200, 0], [210, 0]], false), line('L9', 100, 300, 110, 300),
    line('L10', 0, 80, 3, 80), line('L11', 5, 75, 5, 85),
  ] });

  it('removes the picked piece, keeps the first piece\'s handle, adds a handle for the other and counts the entities changed', () => {
    const b = bench();
    b.run('TR', 'L1', '', '8,0', '');
    assert.equal(b.announced, copy.trimmed(1));
    assert.deepEqual(ends(b.entity('L2')), [[0, 0], [5, 0]]);
    const before = b.state;
    b.run('TR', 'L3', 'L4', '', '5,20', '');
    assert.equal(b.announced, 'Trim: 2 entities changed');
    assert.deepEqual(ends(b.entity('L5')), [[0, 20], [3, 20]]);
    const [added] = b.created(before);
    assert.deepEqual(ends(b.entity(added)), [[7, 20], [10, 20]]);
    assert.ok(handleNumber(added) > 11);
  });

  it('replaces a circle by the arc that remains, with a new A handle', () => {
    const b = bench();
    b.run('TR', 'L7', '', '5,50', '');
    assert.ok(!('C6' in b.state.entities));
    const arcs = Object.values(b.state.entities).filter((entity) => entity.type === 'arc');
    assert.equal(arcs.length, 1);
    const [remaining] = arcs;
    assert.ok(remaining.type === 'arc' && remaining.handle.startsWith('A') && remaining.handle !== 'A6');
    assert.ok(remaining.type === 'arc' && near(remaining.cx, 0) && near(remaining.cy, 50) && near(remaining.r, 5) && near(remaining.start, 90) && near(remaining.end, 270));
    assert.equal(b.groups.length, 1);
  });

  it('refuses a polyline target and a part that crosses no edge, and stays at the stage', () => {
    const b = bench();
    b.run('TR', '', 'P8');
    assert.equal(b.promptText, 'TRIM works on lines, arcs and circles. Explode a polyline first.');
    b.run('105,300');
    assert.equal(b.promptText, "Nothing to trim: that entity doesn't cross a cutting edge.");
    assert.equal(b.groups.length, 0);
    b.escape();
  });

  it('applies the picks of one run in one group, a later pick seeing what an earlier one did', () => {
    const b = new Bench({ entities: [line('L1', 0, 0, 10, 0), line('L2', 5, -1, 5, 1)] });
    b.run('TR', 'L2', '', '2,0');
    b.run('7,0');
    assert.equal(b.promptText, "Nothing to trim: that entity doesn't cross a cutting edge.");
    b.run('');
    assert.equal(b.groups.length, 1);
    assert.deepEqual(ends(b.entity('L1')), [[5, 0], [10, 0]]);
    assert.equal(b.announced, copy.trimmed(1));
  });

  it('extends the end nearest the pick to the first boundary and refuses when none is in the way', () => {
    const b = bench();
    b.run('EX', 'L11', '', '2.5,80', '');
    assert.deepEqual(ends(b.entity('L10')), [[0, 80], [5, 80]]);
    assert.equal(b.announced, 'Extend: 1 entity changed');
    b.run('EX', '', '0.5,80');
    assert.equal(b.promptText, 'Nothing to extend: no boundary in that direction.');
    b.escape();
  });
});

describe('FILLET and CHAMFER', () => {
  const bench = () => new Bench({ entities: [
    line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10), line('L3', 100, 0, 110, 0), line('L4', 112, 2, 112, 10),
    line('L5', 200, 0, 210, 0), line('L6', 200, 5, 210, 5), line('L7', 300, 0, 310, 0), line('L8', 300, 0, 300, 10),
    line('L9', 400, 0, 410, 0), line('L10', 400, 0, 400, 10), line('L11', 500, 0, 510, 0), line('L12', 512, 2, 512, 10),
  ] });

  it('rounds a corner with an arc tangent to both lines', () => {
    const b = bench();
    const before = b.state;
    b.run('F', '2', '8,0', '0,8');
    assert.deepEqual(ends(b.entity('L1')), [[2, 0], [10, 0]]);
    assert.deepEqual(ends(b.entity('L2')), [[0, 2], [0, 10]]);
    const [made] = b.created(before).map((handle) => b.entity(handle));
    assert.ok(made.type === 'arc' && near(made.cx, 2) && near(made.cy, 2) && near(made.r, 2) && near(made.start, 180) && near(made.end, 270));
    assert.equal(b.announced, 'Fillet: 3 entities changed');
  });

  it('with radius 0 trims or extends both lines to the crossing and adds no arc', () => {
    const b = bench();
    const before = b.state;
    b.run('F', '0', '105,0', '112,5');
    assert.deepEqual(ends(b.entity('L3')), [[100, 0], [112, 0]]);
    assert.deepEqual(ends(b.entity('L4')), [[112, 0], [112, 10]]);
    assert.deepEqual(b.created(before), []);
  });

  it('refuses parallel lines and a radius that is too large', () => {
    const b = bench();
    b.run('F', '1', '205,0', '205,5');
    assert.equal(b.promptText, 'These lines are parallel. Nothing to fillet.');
    b.escape();
    b.run('F', '20', '305,0', '300,5');
    assert.equal(b.promptText, 'Radius too large for these lines.');
    assert.equal(b.groups.length, 0);
  });

  it('cuts the corner back to two distances and joins them with a new line', () => {
    const b = bench();
    const before = b.state;
    b.run('CHA', '2', '3', '405,0', '400,5');
    assert.deepEqual(ends(b.entity('L9')), [[402, 0], [410, 0]]);
    assert.deepEqual(ends(b.entity('L10')), [[400, 3], [400, 10]]);
    const joins = b.created(before);
    assert.equal(joins.length, 1);
    assert.deepEqual(ends(b.entity(joins[0])), [[400, 3], [402, 0]].sort((p, q) => p[0] - q[0]));
    assert.equal(b.announced, 'Chamfer: 3 entities changed');
  });

  it('acts like a fillet of radius 0 for distances 0 and 0 and refuses the rest', () => {
    const b = bench();
    const before = b.state;
    b.run('CHA', '0', '0', '505,0', '512,5');
    assert.deepEqual(ends(b.entity('L11')), [[500, 0], [512, 0]]);
    assert.deepEqual(b.created(before), []);
    b.run('CHA', '1', '1', '205,0', '205,5');
    assert.equal(b.promptText, 'These lines are parallel. Nothing to chamfer.');
    b.escape();
    b.run('CHA', '20', '20', '305,0', '300,5');
    assert.equal(b.promptText, 'Distance too large for these lines.');
  });
});

describe('OFFSET, MIRROR and ARRAY', () => {
  const bench = () => new Bench({ entities: [
    line('L1', 0, 0, 10, 0), circle('C2', 50, 0, 5), circle('C3', 80, 0, 2), arc('A4', 5, 100, 2, 0, 90),
    line('L5', 200, 0, 201, 0), line('L6', 301, 0, 302, 0), line('L7', 401, 0, 402, 0),
  ] });

  it('offsets many picks in one group, each towards its picked side', () => {
    const b = bench();
    const before = b.state;
    b.run('O', '2', '5,0', '5,5', '55,0', '60,0', '');
    assert.equal(b.groups.length, 1);
    assert.equal(b.announced, 'Offset: 2 entities added');
    const made = b.created(before).map((handle) => b.entity(handle));
    assert.ok(made.some((entity) => entity.type === 'line' && near(entity.y1, 2) && near(entity.y2, 2)));
    assert.ok(made.some((entity) => entity.type === 'circle' && near(entity.cx, 50) && near(entity.r, 7)));
  });

  it('refuses an offset that would make the radius zero or less', () => {
    const b = bench();
    b.run('O', '3', '82,0', '80,0');
    assert.equal(b.promptText, 'Offset would make a radius of zero or less.');
    b.escape();
  });

  it('mirrors an arc so it stays counter-clockwise and erases the original on N', () => {
    const b = bench();
    const before = b.state;
    b.run('MI', 'A4', '', '0,0', '0,10', 'N');
    assert.equal(b.announced, copy.modifyDone(copy.MODIFY_VERB.MIRROR, 1));
    assert.ok(!('A4' in b.state.entities));
    const [made] = b.created(before).map((handle) => b.entity(handle));
    assert.ok(made.type === 'arc' && near(made.cx, -5) && near(made.cy, 100) && near(made.r, 2) && near(made.start, 90) && near(made.end, 180));
  });

  it('keeps the originals on Enter or Y', () => {
    const b = bench();
    b.run('MI', 'L1', '', '0,0', '0,10', '');
    assert.ok('L1' in b.state.entities);
    assert.equal(Object.keys(b.state.entities).length, 8);
  });

  it('arrays rows and columns row by row, rows going up and columns going right, and counts the copies', () => {
    const b = bench();
    const before = b.state;
    b.run('AR', 'L5', '', 'R', '2', '3', '5', '10');
    assert.equal(b.announced, 'Arrayed: 5 copies added');
    const offsets = b.created(before).map((handle) => {
      const copy = b.entity(handle);
      assert.equal(copy.type, 'line');
      return copy.type === 'line' ? [copy.x1 - 200, copy.y1] : [];
    });
    assert.deepEqual(offsets, [[10, 0], [20, 0], [0, 5], [10, 5], [20, 5]]);
  });

  it('arrays about a centre, rotating each copy with its position, by total / count at 360 and total / (count - 1) otherwise', () => {
    const b = bench();
    let before = b.state;
    b.run('AR', 'L6', '', 'P', '300,0', '4', '360');
    assert.equal(b.announced, 'Arrayed: 3 copies added');
    assert.deepEqual(b.created(before).map((handle) => ends(b.entity(handle))), [[[300, 1], [300, 2]], [[298, 0], [299, 0]], [[300, -2], [300, -1]]]);
    before = b.state;
    b.run('AR', 'L7', '', 'P', '400,0', '3', '180');
    assert.deepEqual(b.created(before).map((handle) => ends(b.entity(handle))), [[[400, 1], [400, 2]], [[398, 0], [399, 0]]]);
  });
});

describe('a chain of modify commands', () => {
  it('is one group per command, with the announcements in order and nothing added by a refusal', () => {
    const b = new Bench({ entities: [line('L1', 5, -5, 5, 5), line('L2', 0, 0, 10, 0), line('L3', 20, 0, 30, 0), pline('P4', [[0, 20], [10, 20]], false)] });
    b.run('TR', '', 'P4');
    assert.equal(b.promptText, 'TRIM works on lines, arcs and circles. Explode a polyline first.');
    assert.equal(b.groups.length, 0);
    b.run('8,0', '');
    assert.equal(b.groups.length, 1);
    b.run('O', 'x');
    assert.equal(b.promptText, "That isn't a number.");
    b.run('1', '2,0', '2,5', '');
    assert.equal(b.groups.length, 2);
    assert.deepEqual(b.groups.map((group) => group.command), ['TRIM', 'OFFSET']);
  });
});

describe('MOVE, COPY, ROTATE, SCALE and ERASE', () => {
  const bench = (selection: string[] = []) => new Bench({ entities: [line('L1', 0, 0, 10, 0), circle('C2', 20, 0, 2)] }, { selection });

  it('moves the picked entities with one move op and announces them', () => {
    const b = bench();
    b.run('M', 'L1', 'C2', '', '0,0', '3,4');
    assert.deepEqual(b.groups[0].ops.map((op) => op.type), ['move']);
    assert.deepEqual(ends(b.entity('L1')), [[3, 4], [13, 4]]);
    assert.equal(b.announced, 'Moved 2 entities');
  });

  it('copies to every target until Enter, in one group', () => {
    const b = bench();
    b.run('CO', 'L1', '', '0,0', '0,5', '0,10', '');
    assert.equal(b.groups.length, 1);
    assert.equal(b.announced, 'Copied 2 entities');
    assert.deepEqual(Object.keys(b.state.entities).length, 4);
  });

  it('rotates about a point and scales about a point', () => {
    const b = bench();
    b.run('RO', 'L1', '', '0,0', '90');
    assert.deepEqual(ends(b.entity('L1')), [[0, 0], [0, 10]]);
    assert.equal(b.announced, 'Rotated 1 entity');
    b.run('SC', 'L1', '', '0,0', '2');
    assert.deepEqual(ends(b.entity('L1')), [[0, 0], [0, 20]]);
    assert.equal(b.announced, 'Scaled 1 entity');
    b.run('SC', 'L1', '', '0,0', '0');
    assert.equal(b.promptText, 'Enter a number greater than 0.');
  });

  it('erases at once when there is a selection, otherwise after picking', () => {
    const selected = bench(['L1', 'C2']);
    selected.run('E');
    assert.equal(selected.announced, 'Erased 2 entities');
    assert.deepEqual(Object.keys(selected.state.entities), []);
    const picking = bench();
    picking.run('E', 'C2', '');
    assert.equal(picking.announced, 'Erased 1 entity');
  });

  it('picks by clicking within the aperture and refuses a click that finds nothing', () => {
    const b = bench();
    b.run('M');
    b.click([5, 0.5]);
    assert.equal(b.promptText, 'MOVE: pick entities (Enter ends picking)');
    b.click([100, 100]);
    assert.equal(b.promptText, 'Nothing there to pick.');
    b.run('');
    assert.equal(b.promptText, 'MOVE: from point');
  });
});
