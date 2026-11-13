import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { View } from '../../../shared/geometry/index.ts';
import type { Point } from '../../../shared/types.ts';
import { TouchGestures } from './touchGestures.ts';

function setup() {
  const host = {
    current: { zoom: 1, panX: 0, panY: 0 } as View,
    taps: [] as Point[],
    presses: [] as Point[],
    view: () => host.current,
    moveView: (view: View) => { host.current = view; },
    tap: (world: Point) => host.taps.push(world),
    longPress: (_world: Point, screen: Point) => host.presses.push(screen),
  };
  return { host, gestures: new TouchGestures(host) };
}

describe('pinch', () => {
  it('computes the view afresh from the values at the second finger (the brief\'s worked example)', () => {
    const { host, gestures } = setup();
    gestures.start([[100, 100], [200, 100]]);
    gestures.move([[50, 100], [250, 100]]);
    assert.deepEqual(host.current, { zoom: 2, panX: -150, panY: -100 });
    gestures.move([[50, 150], [350, 150]]);
    assert.deepEqual(host.current, { zoom: 3, panX: -250, panY: -150 });
  });

  it('pans by the midpoint when the fingers keep their distance, and starts anew after every finger lifts', () => {
    const { host, gestures } = setup();
    gestures.start([[100, 100], [200, 100]]);
    gestures.move([[130, 120], [230, 120]]);
    assert.deepEqual(host.current, { zoom: 1, panX: 30, panY: 20 });
    gestures.end([[230, 120]], [200, 100]);
    gestures.move([[300, 300]]);
    assert.deepEqual(host.current, { zoom: 1, panX: 30, panY: 20 });
    gestures.end([], [300, 300]);
    assert.deepEqual(host.taps, []);
    gestures.start([[100, 300], [200, 300]]);
    gestures.move([[100, 300], [300, 300]]);
    assert.equal(host.current.zoom, 2);
  });
});

describe('tap and long press', () => {
  it('taps when the touch lifts before 500 ms without moving 8 px', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const { host, gestures } = setup();
    gestures.start([[150, 400]]);
    mock.timers.tick(499);
    gestures.end([], [150, 400]);
    assert.deepEqual(host.taps, [[150, -400]]);
    assert.deepEqual(host.presses, []);
    mock.timers.reset();
  });

  it('presses long at 500 ms and then does not tap', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const { host, gestures } = setup();
    gestures.start([[150, 400]]);
    mock.timers.tick(500);
    assert.deepEqual(host.presses, [[150, 400]]);
    gestures.end([], [150, 400]);
    assert.deepEqual(host.taps, []);
    mock.timers.reset();
  });

  it('is neither once it moved 8 px', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const { host, gestures } = setup();
    gestures.start([[150, 400]]);
    gestures.move([[150, 409]]);
    mock.timers.tick(600);
    gestures.end([], [150, 409]);
    assert.deepEqual([host.taps, host.presses], [[], []]);
    mock.timers.reset();
  });
});
