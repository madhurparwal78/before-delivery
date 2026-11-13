import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as copy from '../copy.ts';
import type { ArcEntity, Entity, EntityDraft } from '../types.ts';
import { arc, assertClose, circle, insert, line, pline } from './fixtures.ts';
import { type ModifyResult, type Refusal, isRefusal } from './modify.ts';
import { chamfer, fillet } from './fillet.ts';
import { offsetEntity, polarArray, rectangularArray } from './offset.ts';
import { extend, trim } from './trim.ts';
import { dragGrip, gripsOf } from './grips.ts';
import { changedFields, explodeInsert, findBlockCycle, transformEntity } from './transform.ts';

function done(result: ModifyResult | Refusal): ModifyResult {
  assert.ok(!isRefusal(result), isRefusal(result) ? result.refused : '');
  return result;
}
function refused(result: ModifyResult | Refusal | EntityDraft): string {
  assert.ok(isRefusal(result));
  return result.refused;
}
const ends = (e: Entity | EntityDraft): number[] => {
  assert.ok(e.type === 'line');
  return [e.x1, e.y1, e.x2, e.y2];
};
const apply = (entity: Entity, set: Record<string, unknown>): Entity => ({ ...entity, ...set });

describe('trim', () => {
  const edge = line('L1', 5, -5, 5, 5);
  const target = line('L2', 0, 0, 10, 0);

  it('removes the piece holding the pick: cutting edge 5,-5 to 5,5, pick 8,0 leaves 0,0 to 5,0', () => {
    const result = done(trim(target, [8, 0], [edge, target]));
    assert.deepEqual(ends(apply(target, result.modified[0].set)), [0, 0, 5, 0]);
    assert.deepEqual(result.added, []);
  });

  it('splits in two: the piece holding the first point keeps the handle, the other is new', () => {
    const l5 = line('L5', 0, 20, 10, 20);
    const result = done(trim(l5, [5, 20], [line('L3', 3, 15, 3, 25), line('L4', 7, 15, 7, 25)]));
    assert.deepEqual(ends(apply(l5, result.modified[0].set)), [0, 20, 3, 20]);
    assert.deepEqual(ends(result.added[0]), [7, 20, 10, 20]);
  });

  it('keeps the first remaining piece when the pick is in the first piece', () => {
    const l5 = line('L5', 0, 20, 10, 20);
    const result = done(trim(l5, [1, 20], [line('L3', 3, 15, 3, 25), line('L4', 7, 15, 7, 25)]));
    assert.deepEqual(ends(apply(l5, result.modified[0].set)), [3, 20, 7, 20]);
    assert.deepEqual(ends(result.added[0]), [7, 20, 10, 20]);
  });

  it('replaces a circle by the arc that remains, with its C handle retired', () => {
    const c6 = circle('C6', 0, 50, 5);
    const result = done(trim(c6, [5, 50], [line('L7', 0, 40, 0, 60)]));
    assert.deepEqual(result.removed, ['C6']);
    const remaining = result.added[0] as Omit<ArcEntity, 'handle'>;
    assert.equal(remaining.type, 'arc');
    assertClose(remaining.cx, 0); assertClose(remaining.cy, 50); assertClose(remaining.r, 5);
    assertClose(remaining.start, 90); assertClose(remaining.end, 270);
  });

  it('needs two crossings to cut a circle', () => {
    assert.equal(refused(trim(circle('C6', 0, 50, 5), [5, 50], [line('L7', 0, 45, 0, 50)])), copy.TRIM_NOTHING);
  });

  it('trims an arc at a crossing', () => {
    const a = arc('A1', 0, 0, 5, 0, 180);
    const result = done(trim(a, [4, 3], [line('L2', 0, 0, 0, 10)]));
    assertClose((apply(a, result.modified[0].set) as ArcEntity).start, 90);
    assertClose((apply(a, result.modified[0].set) as ArcEntity).end, 180);
  });

  it('refuses a polyline, and an entity that crosses no cutting edge', () => {
    assert.equal(refused(trim(pline('P8', [[200, 0], [210, 0]], false), [205, 0], [edge])), copy.TRIM_WRONG_TYPE);
    assert.equal(refused(trim(line('L9', 100, 300, 110, 300), [105, 300], [edge, target])), copy.TRIM_NOTHING);
  });
});

describe('extend', () => {
  const boundary = line('L11', 5, 75, 5, 85);

  it('extends the end nearest the pick to the first boundary crossed', () => {
    const l10 = line('L10', 0, 80, 3, 80);
    const result = done(extend(l10, [2.5, 80], [boundary, l10]));
    assert.deepEqual(ends(apply(l10, result.modified[0].set)), [0, 80, 5, 80]);
  });

  it('takes the nearest of several boundaries', () => {
    const l = line('L1', 0, 0, 1, 0);
    const result = done(extend(l, [0.9, 0], [line('L2', 9, -1, 9, 1), line('L3', 4, -1, 4, 1)]));
    assert.deepEqual(ends(apply(l, result.modified[0].set)), [0, 0, 4, 0]);
  });

  it('refuses when no boundary lies in that direction', () => {
    const l10 = line('L10', 0, 80, 3, 80);
    assert.equal(refused(extend(l10, [0.5, 80], [boundary])), copy.EXTEND_NOTHING);
  });

  it('extends an arc along its circle', () => {
    const a = arc('A1', 0, 0, 5, 0, 45);
    const result = done(extend(a, [3.5, 3.5], [line('L2', -10, 5, 10, 5)]));
    assertClose((apply(a, result.modified[0].set) as ArcEntity).end, 90);
  });
});

describe('fillet', () => {
  it('r = 2 on 0,0-10,0 and 0,0-0,10 ends at 2,0 and 0,2 with an arc centred 2,2 from 180 to 270', () => {
    const one = line('L1', 0, 0, 10, 0);
    const two = line('L2', 0, 0, 0, 10);
    const result = done(fillet(one, [8, 0], two, [0, 8], 2));
    assert.deepEqual(ends(apply(one, result.modified[0].set)), [2, 0, 10, 0]);
    assert.deepEqual(ends(apply(two, result.modified[1].set)), [0, 2, 0, 10]);
    const joined = result.added[0] as Omit<ArcEntity, 'handle'>;
    assert.deepEqual([joined.cx, joined.cy, joined.r, joined.start, joined.end], [2, 2, 2, 180, 270]);
  });

  it('radius 0 trims or extends both lines to the crossing and adds no arc', () => {
    const one = line('L3', 100, 0, 110, 0);
    const two = line('L4', 112, 2, 112, 10);
    const result = done(fillet(one, [105, 0], two, [112, 5], 0));
    assert.deepEqual(ends(apply(one, result.modified[0].set)), [100, 0, 112, 0]);
    assert.deepEqual(ends(apply(two, result.modified[1].set)), [112, 0, 112, 10]);
    assert.deepEqual(result.added, []);
  });

  it('refuses parallel lines and a radius that does not fit', () => {
    assert.equal(refused(fillet(line('L5', 200, 0, 210, 0), [205, 0], line('L6', 200, 5, 210, 5), [205, 5], 1)), copy.FILLET_PARALLEL);
    assert.equal(refused(fillet(line('L7', 300, 0, 310, 0), [305, 0], line('L8', 300, 0, 300, 10), [300, 5], 20)), copy.FILLET_TOO_LARGE);
  });

  it('works at a corner that is not square', () => {
    const one = line('L1', 0, 0, 10, 0);
    const two = line('L2', 0, 0, 10, 10);
    const result = done(fillet(one, [8, 0], two, [8, 8], 1));
    const joined = result.added[0] as Omit<ArcEntity, 'handle'>;
    const t = 1 / Math.tan(Math.PI / 8);
    assertClose(ends(apply(one, result.modified[0].set))[0], t, 1e-5);
    assertClose(joined.r, 1);
    assertClose(Math.hypot(joined.cx - t, joined.cy), 1, 1e-5);
  });
});

describe('chamfer', () => {
  it('d1 = 2, d2 = 3 cuts back and joins with a new line', () => {
    const one = line('L9', 400, 0, 410, 0);
    const two = line('L10', 400, 0, 400, 10);
    const result = done(chamfer(one, [405, 0], two, [400, 5], 2, 3));
    assert.deepEqual(ends(apply(one, result.modified[0].set)), [402, 0, 410, 0]);
    assert.deepEqual(ends(apply(two, result.modified[1].set)), [400, 3, 400, 10]);
    assert.deepEqual(ends(result.added[0]), [402, 0, 400, 3]);
  });

  it('0 and 0 acts like a fillet of radius 0', () => {
    const one = line('L11', 500, 0, 510, 0);
    const two = line('L12', 512, 2, 512, 10);
    const result = done(chamfer(one, [505, 0], two, [512, 5], 0, 0));
    assert.deepEqual(ends(apply(one, result.modified[0].set)), [500, 0, 512, 0]);
    assert.deepEqual(result.added, []);
  });

  it('refuses parallel lines and a distance longer than the kept part', () => {
    assert.equal(refused(chamfer(line('L5', 200, 0, 210, 0), [205, 0], line('L6', 200, 5, 210, 5), [205, 5], 1, 1)), copy.CHAMFER_PARALLEL);
    assert.equal(refused(chamfer(line('L7', 300, 0, 310, 0), [305, 0], line('L8', 300, 0, 300, 10), [300, 5], 20, 20)), copy.CHAMFER_TOO_LARGE);
  });
});

describe('offset', () => {
  it('moves a line d at right angles towards the picked side', () => {
    const made = offsetEntity(line('L1', 0, 0, 10, 0), 2, [5, 0], [5, 5]);
    assert.ok(!isRefusal(made));
    assert.deepEqual(ends(made), [0, 2, 10, 2]);
    assert.deepEqual(ends(offsetEntity(line('L1', 0, 0, 10, 0), 2, [5, 0], [5, -5]) as EntityDraft), [0, -2, 10, -2]);
  });

  it('gives a circle r + d outside and r - d inside, refusing a radius of zero or less', () => {
    const outside = offsetEntity(circle('C2', 50, 0, 5), 2, [55, 0], [60, 0]);
    assert.ok(!isRefusal(outside) && outside.type === 'circle');
    assert.equal(outside.r, 7);
    const inside = offsetEntity(circle('C2', 50, 0, 5), 2, [55, 0], [50, 0]);
    assert.ok(!isRefusal(inside) && inside.type === 'circle');
    assert.equal(inside.r, 3);
    assert.equal(refused(offsetEntity(circle('C3', 80, 0, 2), 3, [82, 0], [80, 0])), copy.OFFSET_ZERO_RADIUS);
    assert.equal(refused(offsetEntity(circle('C3', 80, 0, 2), 2, [82, 0], [80, 0])), copy.OFFSET_ZERO_RADIUS);
  });

  it('keeps an arc’s angles', () => {
    const made = offsetEntity(arc('A1', 0, 0, 5, 10, 80), 1, [5, 0], [9, 0]);
    assert.ok(!isRefusal(made) && made.type === 'arc');
    assert.deepEqual([made.r, made.start, made.end], [6, 10, 80]);
  });

  it('joins neighbouring segments of a polyline at the crossing of their offset lines', () => {
    const made = offsetEntity(pline('P1', [[0, 0], [10, 0], [10, 10]], false), 1, [5, 0], [5, 5]);
    assert.ok(!isRefusal(made) && made.type === 'pline');
    assert.deepEqual(made.points, [[0, 1], [9, 1], [9, 10]]);
  });

  it('offsets a closed polyline inwards and outwards', () => {
    const square = pline('P1', [[0, 0], [10, 0], [10, 10], [0, 10]], true);
    const inner = offsetEntity(square, 1, [5, 0], [5, 5]);
    assert.ok(!isRefusal(inner) && inner.type === 'pline');
    assert.deepEqual(inner.points, [[1, 1], [9, 1], [9, 9], [1, 9]]);
    const outer = offsetEntity(square, 1, [5, 0], [5, -5]);
    assert.ok(!isRefusal(outer) && outer.type === 'pline');
    assert.deepEqual(outer.points, [[-1, -1], [11, -1], [11, 11], [-1, 11]]);
  });

  it('inherits layer and look', () => {
    const made = offsetEntity(line('L1', 0, 0, 10, 0, 'Walls', { colour: 'red' }), 1, [5, 0], [5, 1]);
    assert.ok(!isRefusal(made));
    assert.equal(made.layer, 'Walls');
    assert.equal(made.colour, 'red');
  });
});

describe('mirror, rotate, scale, move', () => {
  it('mirrors an arc across the axis so it stays counter-clockwise: swaps start and end', () => {
    const mirrored = transformEntity(arc('A4', 5, 100, 2, 0, 90), { kind: 'mirror', from: [0, 0], to: [0, 10] }) as ArcEntity;
    assert.deepEqual([mirrored.cx, mirrored.cy, mirrored.r, mirrored.start, mirrored.end], [-5, 100, 2, 90, 180]);
  });

  it('mirrors a line and keeps its handle', () => {
    const mirrored = transformEntity(line('L1', 1, 1, 3, 2), { kind: 'mirror', from: [0, 0], to: [10, 0] });
    assert.deepEqual(ends(mirrored), [1, -1, 3, -2]);
    assert.equal(mirrored.handle, 'L1');
  });

  it('rotates, scales and moves every geometry', () => {
    assert.deepEqual(ends(transformEntity(line('L1', 1, 0, 2, 0), { kind: 'rotate', about: [0, 0], degrees: 90 })), [0, 1, 0, 2]);
    assert.deepEqual(ends(transformEntity(line('L1', 1, 0, 2, 0), { kind: 'scale', about: [0, 0], factor: 3 })), [3, 0, 6, 0]);
    const rotated = transformEntity(arc('A1', 0, 0, 5, 0, 90), { kind: 'rotate', about: [0, 0], degrees: 300 }) as ArcEntity;
    assert.deepEqual([rotated.start, rotated.end], [300, 30]);
    const scaled = transformEntity(circle('C1', 1, 1, 2), { kind: 'scale', about: [0, 0], factor: 2 });
    assert.ok(scaled.type === 'circle');
    assert.deepEqual([scaled.cx, scaled.cy, scaled.r], [2, 2, 4]);
    const moved = transformEntity(insert('I1', 'Door', 5, 5, 2, 90), { kind: 'translate', dx: 1, dy: -1 });
    assert.ok(moved.type === 'insert');
    assert.deepEqual([moved.x, moved.y, moved.scale, moved.rotation], [6, 4, 2, 90]);
    const turned = transformEntity(insert('I1', 'Door', 5, 0, 2, 90), { kind: 'rotate', about: [0, 0], degrees: 90 });
    assert.ok(turned.type === 'insert');
    assert.deepEqual([turned.x, turned.y, turned.rotation], [0, 5, 180]);
    const polyline = transformEntity(pline('P1', [[0, 0], [1, 0]], false), { kind: 'translate', dx: 1, dy: 1 });
    assert.ok(polyline.type === 'pline');
    assert.deepEqual(polyline.points, [[1, 1], [2, 1]]);
  });

  it('lists the fields an edit changed', () => {
    const before = line('L1', 0, 0, 10, 0);
    assert.deepEqual(changedFields(before, { ...before, x2: 5 }), { x2: 5 });
  });
});

describe('array', () => {
  it('adds rectangular copies row by row, original cell first', () => {
    const copies = rectangularArray(line('L5', 200, 0, 201, 0), 2, 3, 5, 10);
    assert.deepEqual(copies.map((c) => [ends(c)[0] - 200, ends(c)[1]]), [[10, 0], [20, 0], [0, 5], [10, 5], [20, 5]]);
  });

  it('adds polar copies rotated with their position: 360 divides by count', () => {
    const copies = polarArray(line('L6', 301, 0, 302, 0), [300, 0], 4, 360);
    assert.deepEqual(copies.map(ends), [[300, 1, 300, 2], [299, 0, 298, 0], [300, -1, 300, -2]]);
  });

  it('divides a partial angle by count - 1', () => {
    const copies = polarArray(line('L7', 401, 0, 402, 0), [400, 0], 3, 180);
    assert.deepEqual(copies.map(ends), [[400, 1, 400, 2], [399, 0, 398, 0]]);
  });

  it('copies any entity type with a new position', () => {
    const [copy1] = rectangularArray(circle('C1', 0, 0, 1), 1, 2, 0, 4);
    assert.ok(copy1?.type === 'circle');
    assert.equal(copy1.cx, 4);
  });
});

describe('grips', () => {
  it('shows end and mid grips on a line and stretches or moves it', () => {
    const l = line('L1', 0, 0, 10, 0);
    assert.deepEqual(gripsOf(l).map((g) => [g.kind, g.x, g.y]), [['end', 0, 0], ['end', 10, 0], ['mid', 5, 0]]);
    assert.deepEqual(dragGrip(l, gripsOf(l)[1], [12, 3]), { x2: 12, y2: 3 });
    assert.deepEqual(dragGrip(l, gripsOf(l)[2], [6, 1]), { x1: 1, y1: 1, x2: 11, y2: 1 });
  });

  it('gives a circle a centre and four quadrants that set the radius', () => {
    const c = circle('C1', 5, 5, 2);
    assert.deepEqual(gripsOf(c).map((g) => [g.kind, g.x, g.y]), [['centre', 5, 5], ['quadrant', 7, 5], ['quadrant', 5, 7], ['quadrant', 3, 5], ['quadrant', 5, 3]]);
    assert.deepEqual(dragGrip(c, gripsOf(c)[1], [8, 5]), { r: 3 });
    assert.deepEqual(dragGrip(c, gripsOf(c)[0], [1, 2]), { cx: 1, cy: 2 });
  });

  it('gives an arc a centre and the ends that change that end’s angle', () => {
    const a = arc('A1', 0, 0, 5, 0, 90);
    assert.deepEqual(gripsOf(a).map((g) => g.kind), ['centre', 'end', 'end']);
    assert.deepEqual(dragGrip(a, gripsOf(a)[2], [-3, 3]), { end: 135 });
  });

  it('gives a polyline a vertex grip per point and moves that vertex', () => {
    const p = pline('P1', [[0, 0], [3, 0], [3, 4]], false);
    assert.equal(gripsOf(p).length, 3);
    assert.deepEqual(dragGrip(p, gripsOf(p)[1], [4, 1]), { points: [[0, 0], [4, 1], [3, 4]] });
    assert.deepEqual(gripsOf(insert('I1', 'Door', 0, 0)), []);
  });
});

describe('blocks', () => {
  const door = { name: 'Door', base: [1, 1] as [number, number], entities: [line('L50', 1, 1, 2, 1, '0', { colour: 'ByBlock' }), line('L51', 1, 1, 1, 3, 'Walls', { colour: 'ByBlock' })], attributes: [] };

  it('explodes an insert at the drawn positions: insert + rotate(rotation, scale * (p - base)), ByBlock on layer 0 takes the insert colour', () => {
    const drafts = explodeInsert(insert('I1', 'Door', 10, 0, 2, 90, {}, 'Doors'), { Door: door }, { 0: { name: '0', colour: 'white', linetype: 'Continuous', lineweight: 0.25, on: true, frozen: false, locked: false }, Doors: { name: 'Doors', colour: 'green', linetype: 'Continuous', lineweight: 0.25, on: true, frozen: false, locked: false } });
    assert.deepEqual(ends(drafts[0]), [10, 0, 10, 2]);
    assert.equal(drafts[0].colour, 'green');
    assert.deepEqual(ends(drafts[1]), [10, 0, 6, 0]);
    assert.equal(drafts[1].colour, 'ByBlock');
  });

  it('finds the chain of a block that would contain itself', () => {
    const blocks = {
      Outer: { name: 'Outer', base: [0, 0] as [number, number], entities: [insert('I51', 'Door', 0, 0)], attributes: [] },
      Door: door,
    };
    assert.deepEqual(findBlockCycle('Door', [insert('I4', 'Outer', 0, 0)], blocks), ['Door', 'Outer', 'Door']);
    assert.deepEqual(findBlockCycle('Door', [insert('I4', 'Door', 0, 0)], blocks), ['Door', 'Door']);
    assert.equal(findBlockCycle('Door', [line('L1', 0, 0, 1, 1)], blocks), null);
    assert.equal(findBlockCycle('Frame', [insert('I4', 'Door', 0, 0)], blocks), null);
  });
});
