import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LayoutContainer } from './model.ts';
import { placeObjects } from './layout.ts';

const across = (...sheets: string[]): LayoutContainer => ({
  type: 'horizontal',
  children: sheets.map((sheet) => ({ sheet, fixed: null })),
});

const boxes = (layout: LayoutContainer, hidden: string[] = []): string[] =>
  placeObjects(layout, [], new Set(hidden)).map((o) => `${o.sheet} ${o.x},${o.y} ${o.w}x${o.h}`);

test('three flexible sheets across the stage, then the middle one hidden', () => {
  assert.deepEqual(boxes(across('a', 'b', 'c')), ['a 0,0 422x800', 'b 430,0 421x800', 'c 859,0 421x800']);
  assert.deepEqual(boxes(across('a', 'b', 'c'), ['b']), ['a 0,0 636x800', 'c 644,0 636x800']);
});

test('a fixed child takes its size and the flexible ones split the rest', () => {
  const layout: LayoutContainer = {
    type: 'vertical',
    children: [
      { sheet: 'a', fixed: 200 },
      { sheet: 'b', fixed: null },
      { sheet: 'c', fixed: null },
    ],
  };
  assert.deepEqual(boxes(layout), ['a 0,0 1280x200', 'b 0,208 1280x292', 'c 0,508 1280x292']);
});

test('a nested container splits its own box; floating objects keep theirs; a hidden container takes no room', () => {
  const layout: LayoutContainer = { type: 'horizontal', children: [{ sheet: 'a', fixed: null }, { ...across('b', 'c'), type: 'vertical' }] };
  const placed = placeObjects(layout, [{ sheet: 'd', x: 10, y: 20, w: 300, h: 200 }]);
  assert.deepEqual(
    placed.map((o) => [o.sheet, o.x, o.y, o.w, o.h, o.floating]),
    [
      ['a', 0, 0, 636, 800, false],
      ['b', 644, 0, 636, 396, false],
      ['c', 644, 404, 636, 396, false],
      ['d', 10, 20, 300, 200, true],
    ],
  );
  assert.deepEqual(boxes(layout, ['b', 'c']), ['a 0,0 1280x800']);
});
