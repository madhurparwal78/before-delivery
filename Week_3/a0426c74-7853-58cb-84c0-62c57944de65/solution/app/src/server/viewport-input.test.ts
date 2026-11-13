import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '../shared/errors.ts';
import { viewportInput, type ViewportInput } from './viewport-input.ts';

const invalidField = (field: string) => (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'invalid' && error.fields?.[field] !== undefined;

const full = { x: 10, y: 10, width: 200, height: 100, scale: '1:50', view_x: 0, view_y: 0, frozen_layers: ['Walls'] };

describe('viewport input', () => {
  it('needs every number and a 1:n scale for a new viewport', () => {
    assert.deepEqual(viewportInput(full, null), full);
    assert.throws(() => viewportInput({ ...full, width: undefined }, null), invalidField('width'));
    assert.throws(() => viewportInput({ ...full, scale: '2:1' }, null), invalidField('scale'));
    assert.throws(() => viewportInput({ ...full, height: 0 }, null), invalidField('height'));
  });

  it('defaults the frozen layers of a new viewport to none', () => {
    assert.deepEqual(viewportInput({ ...full, frozen_layers: undefined }, null).frozen_layers, []);
    assert.throws(() => viewportInput({ ...full, frozen_layers: 'Walls' }, null), invalidField('frozen_layers'));
  });

  it('changes only the fields a patch names', () => {
    const current: ViewportInput = full;
    assert.deepEqual(viewportInput({ scale: '1:20', view_x: 1000 }, current), { ...full, scale: '1:20', view_x: 1000 });
    assert.throws(() => viewportInput({ width: 'wide' }, current), invalidField('width'));
  });
});
