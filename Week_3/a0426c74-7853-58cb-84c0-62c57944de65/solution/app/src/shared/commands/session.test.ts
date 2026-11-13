import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { circle, layer, line } from '../model/testing.ts';
import { eraseGroup } from './definitions/modify.ts';
import { Bench } from './testing.ts';

const SRC = 'src-id';
const HOST = 'host-id';
const drawings = [{ id: SRC, name: 'Source', xref_sources: [] }, { id: HOST, name: 'Host', xref_sources: [SRC] }];

const FIRST_PROMPTS: Record<string, [string, string]> = {
  LINE: ['L', 'LINE: from point'],
  PLINE: ['PL', 'PLINE: from point'],
  RECT: ['REC', 'RECT: first corner'],
  CIRCLE: ['C', 'CIRCLE: centre'],
  ARC: ['A', 'ARC: centre'],
  MOVE: ['M', 'MOVE: pick entities (Enter ends picking)'],
  COPY: ['CO', 'COPY: pick entities (Enter ends picking)'],
  ROTATE: ['RO', 'ROTATE: pick entities (Enter ends picking)'],
  SCALE: ['SC', 'SCALE: pick entities (Enter ends picking)'],
  MIRROR: ['MI', 'MIRROR: pick entities (Enter ends picking)'],
  OFFSET: ['O', 'OFFSET: distance'],
  TRIM: ['TR', 'TRIM: pick cutting edges (Enter for every entity)'],
  EXTEND: ['EX', 'EXTEND: pick boundaries (Enter for every entity)'],
  FILLET: ['F', 'FILLET: radius'],
  CHAMFER: ['CHA', 'CHAMFER: first distance'],
  ARRAY: ['AR', 'ARRAY: pick entities (Enter ends picking)'],
  HATCH: ['H', 'HATCH: pick a point inside'],
  DIST: ['DI', 'DIST: first point'],
  AREA: ['AA', 'AREA: pick a closed entity or a point inside'],
  ERASE: ['E', 'ERASE: pick entities (Enter ends picking)'],
  EXPLODE: ['X', 'EXPLODE: pick block inserts (Enter ends picking)'],
  BLOCK: ['B', 'BLOCK: name'],
  INSERT: ['I', 'INSERT: block name'],
  DIMLINEAR: ['DL', 'DIMLINEAR: first point'],
  DIMALIGNED: ['DA', 'DIMALIGNED: first point'],
  DIMANGLE: ['DG', 'DIMANGLE: first line'],
  DIMRADIUS: ['DR', 'DIMRADIUS: pick circle or arc'],
  CONSTRAIN: ['CN', 'CONSTRAIN: kind (coincident, horizontal, vertical, parallel, perpendicular, equal, fixed, length, radius)'],
  PARAM: ['PM', 'PARAM: name = expression'],
  XATTACH: ['XA', 'XATTACH: drawing name'],
  XBIND: ['XB', 'XBIND: xref name'],
};

const LATER: [string, string[], string][] = [
  ['L', ['0,0'], 'LINE: to point (Enter ends, U steps back)'],
  ['PL', ['0,0'], 'PLINE: to point (Enter ends, U steps back, CL closes)'],
  ['REC', ['0,0'], 'RECT: opposite corner'],
  ['C', ['0,0'], 'CIRCLE: radius'],
  ['A', ['0,0'], 'ARC: start point'], ['A', ['0,0', '1,0'], 'ARC: end point'],
  ['DI', ['0,0'], 'DIST: second point'],
  ['F', ['1'], 'FILLET: first line'], ['F', ['1', 'L1'], 'FILLET: second line'],
  ['CHA', ['1'], 'CHAMFER: second distance'], ['CHA', ['1', '1'], 'CHAMFER: first line'],
  ['CHA', ['1', '1', 'L1'], 'CHAMFER: second line'],
  ['O', ['1'], 'OFFSET: pick entity'], ['O', ['1', 'L1'], 'OFFSET: pick side'],
  ['DL', ['0,0'], 'DIMLINEAR: second point'], ['DL', ['0,0', '1,0'], 'DIMLINEAR: line position'],
  ['DA', ['0,0'], 'DIMALIGNED: second point'], ['DA', ['0,0', '1,0'], 'DIMALIGNED: line position'],
  ['DG', ['L1'], 'DIMANGLE: second line'], ['DG', ['L1', 'L2'], 'DIMANGLE: arc position'],
  ['DR', ['C3'], 'DIMRADIUS: text position'],
  ['TR', [''], 'TRIM: pick the part to remove (Enter ends)'],
  ['EX', [''], 'EXTEND: pick the end to extend (Enter ends)'],
  ['B', ['Gate'], 'BLOCK: base point'], ['B', ['Gate', '0,0'], 'BLOCK: pick entities (Enter ends picking)'],
  ['B', ['Gate', '0,0', 'L1', ''], 'BLOCK: attribute TAG=default (Enter for none)'],
  ['I', ['Door'], 'INSERT: insertion point'], ['I', ['Door', '0,0'], 'INSERT: scale (Enter is 1)'],
  ['I', ['Door', '0,0', ''], 'INSERT: rotation in degrees (Enter is 0)'],
  ['CN', ['coincident'], 'CONSTRAIN: pick first point'], ['CN', ['coincident', '0,0'], 'CONSTRAIN: pick second point'],
  ['CN', ['parallel', 'L1'], 'CONSTRAIN: pick second entity'],
  ['CN', ['length', 'L1'], 'CONSTRAIN: expression'],
  ['M', ['L1', ''], 'MOVE: from point'], ['M', ['L1', '', '0,0'], 'MOVE: to point'],
  ['CO', ['L1', ''], 'COPY: from point'], ['CO', ['L1', '', '0,0'], 'COPY: to point (Enter ends)'],
  ['RO', ['L1', ''], 'ROTATE: about point'], ['RO', ['L1', '', '0,0'], 'ROTATE: angle in degrees'],
  ['SC', ['L1', ''], 'SCALE: about point'], ['SC', ['L1', '', '0,0'], 'SCALE: factor'],
  ['MI', ['L1', ''], 'MIRROR: axis first point'], ['MI', ['L1', '', '0,0'], 'MIRROR: axis second point'],
  ['MI', ['L1', '', '0,0', '0,1'], 'MIRROR: keep originals? Y or N (Enter is Y)'],
  ['AR', ['L1', ''], 'ARRAY: R for rows or P for polar'], ['AR', ['L1', '', 'R'], 'ARRAY: rows'],
  ['AR', ['L1', '', 'R', '2'], 'ARRAY: columns'], ['AR', ['L1', '', 'R', '2', '2'], 'ARRAY: row gap'],
  ['AR', ['L1', '', 'R', '2', '2', '1'], 'ARRAY: column gap'], ['AR', ['L1', '', 'P'], 'ARRAY: centre'],
  ['AR', ['L1', '', 'P', '0,0'], 'ARRAY: count'], ['AR', ['L1', '', 'P', '0,0', '3'], 'ARRAY: total angle'],
  ['XA', ['Source'], 'XATTACH: xref name'], ['XA', ['Source', 'Site'], 'XATTACH: insertion point'],
  ['XA', ['Source', 'Site', '0,0'], 'XATTACH: scale (Enter is 1)'],
  ['XA', ['Source', 'Site', '0,0', ''], 'XATTACH: rotation in degrees (Enter is 0)'],
];

const seed = () => new Bench({
  entities: [line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10), circle('C3', 50, 0, 2)],
  blocks: [{ name: 'Door', base: [0, 0], entities: [line('L50', 0, 0, 1, 0)], attributes: [] }],
}, { drawings });

describe('command stage prompts', () => {
  it('shows each command\'s first prompt for its alias and its name, and Cancelled. on Escape', () => {
    const bench = seed();
    assert.equal(bench.promptText, 'Ready. Type a command.');
    for (const [name, [alias, first]] of Object.entries(FIRST_PROMPTS)) {
      bench.run(alias.toLowerCase());
      assert.equal(bench.promptText, first, alias);
      bench.escape();
      assert.equal(bench.promptText, 'Cancelled.');
      bench.type(name, 'space');
      assert.equal(bench.promptText, first, name);
      bench.escape();
    }
  });

  it('shows the later stage prompts in order', () => {
    for (const [alias, entries, expected] of LATER) {
      const bench = seed();
      bench.run(alias, ...entries);
      assert.equal(bench.promptText, expected, `${alias} ${entries.join(' ')}`);
      bench.escape();
      assert.equal(bench.promptText, 'Cancelled.');
    }
  });

  it('treats Space as a character at a name stage', () => {
    const bench = seed();
    bench.run('B');
    const update = bench.type('a', 'space');
    assert.equal(update.consumed, false);
    assert.equal(bench.promptText, 'BLOCK: name');
    assert.equal(bench.session.spaceIsCharacter, true);
    bench.escape();
    assert.equal(bench.session.spaceIsCharacter, false);
  });

  it('commits nothing for cancelled commands', () => {
    const bench = seed();
    for (const [alias, entries] of LATER.map(([a, e]) => [a, e] as const)) {
      bench.run(alias, ...entries);
      bench.escape();
    }
    assert.deepEqual(Object.keys(bench.state.entities), ['L1', 'L2', 'C3']);
    assert.equal(bench.groups.length, 0);
  });
});

describe('point forms and value refusals', () => {
  it('draws a line through absolute, relative and polar points, a circle by a point, and refuses bad values', () => {
    const bench = new Bench();
    bench.run('L', '2,3', '@5,0', '@10<90', '');
    assert.deepEqual(bench.ends('L1'), [[2, 3], [7, 3]]);
    assert.deepEqual(bench.ends('L2'), [[7, 3], [7, 13]]);
    bench.run('C', '@0,0', '@3,4');
    const circleEntity = bench.entity('C3');
    assert.ok(circleEntity.type === 'circle' && circleEntity.cx === 7 && circleEntity.cy === 13 && circleEntity.r === 5);
    bench.run('zzz');
    assert.equal(bench.promptText, 'Unknown command: ZZZ. Nothing happened.');
    bench.run('L', 'abc');
    assert.equal(bench.promptText, "That isn't a point. Try 10,20 or @5,0 or @10<45.");
    bench.run('0,0');
    assert.equal(bench.promptText, 'LINE: to point (Enter ends, U steps back)');
    bench.escape();
    bench.run('F', 'x');
    assert.equal(bench.promptText, "That isn't a number.");
    bench.escape();
    bench.run('C', '0,0', '0');
    assert.equal(bench.promptText, 'Enter a number greater than 0.');
    bench.escape();
    bench.run('I', 'Nope');
    assert.equal(bench.promptText, 'No block named Nope.');
    bench.escape();
    bench.run('XA', 'Nope');
    assert.equal(bench.promptText, 'No drawing named Nope in this folder.');
    bench.escape();
    bench.run('XB', 'Nope');
    assert.equal(bench.promptText, 'No xref named Nope.');
    bench.escape();
    bench.run('M', '500,500');
    assert.equal(bench.promptText, 'Nothing there to pick.');
    bench.escape();
    assert.equal(Object.keys(bench.state.entities).length, 3, 'refused values add no geometry');
  });

  it('clears a message at the next key press and keeps the stage', () => {
    const bench = new Bench();
    bench.run('L', 'abc');
    assert.equal(bench.update.message, "That isn't a point. Try 10,20 or @5,0 or @10<45.");
    bench.session.clearMessage();
    assert.equal(bench.session.feed({ kind: 'text', text: '1,1', terminator: 'enter' }, bench.env()).prompt, 'LINE: to point (Enter ends, U steps back)');
  });
});

describe('the keyboard journey', () => {
  it('draws, steps back with U, ends with Enter, repeats with an empty Enter and cancels with Escape', () => {
    const bench = new Bench();
    bench.run('L');
    assert.equal(bench.promptText, 'LINE: from point');
    for (const entry of ['0,0', '@10,0', '@10<90']) {
      bench.run(entry);
      assert.equal(bench.promptText, 'LINE: to point (Enter ends, U steps back)');
    }
    bench.run('U');
    assert.equal(bench.promptText, 'LINE: to point (Enter ends, U steps back)');
    bench.run('');
    assert.equal(bench.promptText, 'Ready. Type a command.');
    bench.run('');
    assert.equal(bench.promptText, 'LINE: from point');
    bench.escape();
    assert.equal(bench.promptText, 'Cancelled.');
    assert.deepEqual(Object.keys(bench.state.entities), ['L1']);
    assert.deepEqual(bench.ends('L1'), [[0, 0], [10, 0]]);
    assert.equal(bench.announced, 'Line L1 added');
  });

  it('makes the last point the one before U when a point is stepped back', () => {
    const bench = new Bench();
    bench.run('L', '1,1', '@2,0', 'U', '@0,5', '');
    assert.deepEqual(bench.ends('L1'), [[1, 1], [1, 6]]);
  });

  it('closes a line run and a polyline with CL, only from three points', () => {
    const bench = new Bench();
    bench.run('L', '0,0', '4,0', 'CL');
    assert.equal(bench.promptText, "That isn't a point. Try 10,20 or @5,0 or @10<45.");
    bench.run('4,3', 'cl');
    assert.equal(Object.keys(bench.state.entities).length, 3);
    assert.deepEqual(bench.ends('L3'), [[0, 0], [4, 3]]);
    assert.equal(bench.announced, '3 entities added');
    bench.run('PL', '0,0', '4,0', '4,3', 'CL');
    const polyline = bench.entity('P4');
    assert.ok(polyline.type === 'pline' && polyline.closed && polyline.points.length === 3);
  });

  it('draws a rectangle counter-clockwise from the first corner whichever way the opposite corner lies', () => {
    const bench = new Bench();
    bench.run('REC', '0,0', '4,3');
    bench.run('REC', '0,0', '-4,3');
    const first = bench.entity('P1');
    const second = bench.entity('P2');
    assert.ok(first.type === 'pline' && second.type === 'pline');
    assert.deepEqual(first.points, [[0, 0], [4, 0], [4, 3], [0, 3]]);
    assert.deepEqual(second.points, [[0, 0], [0, 3], [-4, 3], [-4, 0]]);
  });

  it('draws an arc counter-clockwise from the start point to the direction of the end point', () => {
    const bench = new Bench();
    bench.run('A', '0,0', '5,0', '0,9');
    const drawn = bench.entity('A1');
    assert.ok(drawn.type === 'arc' && drawn.r === 5 && drawn.start === 0 && drawn.end === 90);
    assert.equal(bench.announced, 'Arc A1 added');
  });

  it('uses the layer that is current for new geometry', () => {
    const bench = new Bench({}, { layer: 'Walls' });
    bench.state = { ...bench.state, layers: { ...bench.state.layers, Walls: { name: 'Walls', colour: 'red', linetype: 'Continuous', lineweight: 0.25, on: true, frozen: false, locked: false } } };
    bench.run('C', '0,0', '2');
    assert.equal(bench.entity('C1').layer, 'Walls');
  });
});

describe('who may run a command', () => {
  it('refuses a drawing command on a phone and for a viewer, and still lets DIST and ZOOMALL through', () => {
    const phone = new Bench({}, { phone: true });
    phone.run('L');
    assert.equal(phone.promptText, "Drawing commands aren't available on a phone. Open this drawing on a desktop to edit.");
    const viewer = new Bench({ entities: [line('L1', 0, 0, 10, 0)] }, { role: 'markup' });
    viewer.run('E');
    assert.equal(viewer.promptText, 'You can view this drawing but not edit it.');
    viewer.run('DI');
    assert.equal(viewer.promptText, 'DIST: first point');
    viewer.escape();
    viewer.run('ZA');
    assert.deepEqual(viewer.views, ['zoomall']);
  });
});

describe('commands that only move focus or the view', () => {
  it('asks for the layer list, the parameter list and Find, and zooms to the whole drawing', () => {
    const bench = new Bench();
    bench.run('LA', 'FD', 'PM', '', 'ZA');
    assert.deepEqual(bench.focuses, ['layer-list', 'find', 'parameter-list']);
    assert.deepEqual(bench.views, ['zoomall']);
    assert.equal(bench.promptText, 'Ready. Type a command.');
  });
});

describe('repeat, step back, cancel and picking', () => {
  it('repeats the last command from its first stage, even after it was cancelled', () => {
    const b = new Bench();
    b.run('');
    assert.equal(b.promptText, 'Ready. Type a command.');
    b.run('C', '0,0');
    b.escape();
    b.run('');
    assert.equal(b.promptText, 'CIRCLE: centre');
  });

  it('steps back to the previous stage with U, and does nothing at the first stage', () => {
    const b = new Bench({ entities: [line('L1', 0, 0, 10, 0)] });
    b.run('M', 'L1', '', '0,0');
    assert.equal(b.promptText, 'MOVE: to point');
    b.run('u');
    assert.equal(b.promptText, 'MOVE: from point');
    b.run('U');
    assert.equal(b.promptText, 'MOVE: pick entities (Enter ends picking)');
    b.run('U');
    assert.equal(b.promptText, 'MOVE: pick entities (Enter ends picking)');
  });

  it('keeps U as a letter at a name stage', () => {
    const b = new Bench();
    b.run('B', 'U');
    assert.equal(b.promptText, 'BLOCK: base point');
  });

  it('drops uncommitted work on Escape and says nothing at Ready', () => {
    const b = new Bench();
    b.run('L', '0,0', '5,5');
    b.escape();
    assert.equal(b.groups.length, 0);
    assert.equal(b.update.cancelled, true);
    assert.equal(b.escape().cancelled, false);
    assert.equal(b.promptText, 'Ready. Type a command.');
  });

  it('takes a typed handle in any letter case and refuses one that is not on the drawing', () => {
    const b = new Bench({ layers: [layer('Locked', { locked: true })], entities: [line('L1', 0, 0, 10, 0), line('L2', 0, 5, 10, 5, 'Locked')] });
    b.run('E', 'l1');
    assert.equal(b.promptText, 'ERASE: pick entities (Enter ends picking)');
    b.run('');
    assert.deepEqual(Object.keys(b.state.entities), ['L2']);
    b.run('E', 'L2');
    assert.equal(b.promptText, 'Nothing there to pick.');
    b.run('L99');
    assert.equal(b.promptText, 'Nothing there to pick.');
  });

  it('measures @ points from the last point entered by a click too', () => {
    const b = new Bench();
    b.run('L');
    b.click([3, 4]);
    b.run('@2,0', '');
    assert.deepEqual(b.ends('L1'), [[3, 4], [5, 4]]);
    assert.deepEqual(b.session.lastPoint, [5, 4]);
  });

  it('submits one group for the Delete key', () => {
    const b = new Bench({ entities: [line('L1', 0, 0, 1, 0), line('L2', 0, 1, 1, 1)] });
    const group = eraseGroup(['L1', 'L2'], b.env());
    assert.equal(group.command, 'ERASE');
    assert.deepEqual(group.ops.map((op) => op.type), ['delete']);
  });
});
