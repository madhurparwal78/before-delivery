// A viewport as a request states it: every field for a new one, any of them for a change.
import * as copy from '../shared/copy.ts';
import { fieldError } from '../shared/errors.ts';
import { type Body, stringField } from './body.ts';
import { numberField } from './fields.ts';

const SCALE_PATTERN = /^1:[1-9][0-9]*$/;

export interface ViewportInput {
  x: number; y: number; width: number; height: number; scale: string; view_x: number; view_y: number; frozen_layers: string[];
}
type NumberField = 'x' | 'y' | 'width' | 'height' | 'view_x' | 'view_y';

/** The viewport the request describes; a change keeps the fields it does not name from `current`. */
export function viewportInput(body: Body, current: ViewportInput | null): ViewportInput {
  const number = (name: NumberField): number => (current === null || name in body ? numberField(body, name) : current[name]);
  const scale = current === null || 'scale' in body ? stringField(body, 'scale') : current.scale;
  const frozen = body.frozen_layers ?? current?.frozen_layers ?? [];
  if (!SCALE_PATTERN.test(scale)) throw fieldError('scale', copy.VIEWPORT_SCALE);
  if (!Array.isArray(frozen) || !frozen.every((layer) => typeof layer === 'string')) throw fieldError('frozen_layers', copy.FROZEN_LAYERS);
  const viewport = {
    x: number('x'), y: number('y'), width: number('width'), height: number('height'), scale,
    view_x: number('view_x'), view_y: number('view_y'), frozen_layers: frozen,
  };
  if (viewport.width <= 0) throw fieldError('width', copy.VIEWPORT_SIZE);
  if (viewport.height <= 0) throw fieldError('height', copy.VIEWPORT_SIZE);
  return viewport;
}

