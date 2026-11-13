// PROPERTIES: style, layer and geometry fields by API name, or the model's units and plot style.
import { COPY } from '../../shared/copy.ts';
import { COLOR_NAMES, LINETYPES, LINEWEIGHTS, STYLE_NAMES } from '../../shared/types.ts';
import type { StoredObject, Units } from '../../shared/types.ts';
import type { Draft } from './draft.ts';
import { PLOT_STYLES } from './models.ts';
import { invalid, isRecord, MESSAGE, Reader } from './validate.ts';

const LINETYPE_SCALE_MIN = 0.01;
const LINETYPE_SCALE_MAX = 1000;
const UNITS: readonly Units[] = ['mm', 'm'];

/** Fields every object type accepts. */
const COMMON_FIELDS = ['layer', 'color', 'linetype', 'linetype_scale', 'lineweight', 'dimension_style', 'text_style', 'multileader_style'];

/** Geometry fields by object type. */
const TYPE_FIELDS: Record<StoredObject['type'], readonly string[]> = {
  line: ['start', 'end'],
  polyline: ['vertices', 'closed'],
  circle: ['center', 'radius'],
  arc: ['center', 'radius', 'start_angle', 'end_angle'],
  spline: ['fit_points'],
  mtext: ['position', 'width', 'height', 'contents'],
  dimension: ['text_override', 'location'],
  insert: ['position', 'scale', 'rotation'],
  revcloud: [],
};

/** Reads one field of `set` as its stored value. */
function readField(d: Draft, r: Reader, key: string): unknown {
  switch (key) {
    case 'layer': {
      const name = r.text(key);
      if (!d.layer(name)) invalid(key, MESSAGE.unknownLayer);
      return name;
    }
    case 'color': return r.oneOf(key, ['ByLayer', ...COLOR_NAMES]);
    case 'linetype': return r.oneOf(key, ['ByLayer', ...LINETYPES]);
    case 'lineweight': return r.oneOf(key, ['ByLayer', ...LINEWEIGHTS]);
    case 'dimension_style': case 'text_style': case 'multileader_style': return r.oneOf(key, STYLE_NAMES);
    case 'linetype_scale': {
      const value = r.finite(key);
      if (value < LINETYPE_SCALE_MIN || value > LINETYPE_SCALE_MAX) invalid(key, COPY.linetypeScaleRange);
      return Math.round(value * 100) / 100;
    }
    case 'start': case 'end': case 'center': case 'position': case 'location': return r.point(key);
    case 'vertices': case 'fit_points': return r.points(key, 2);
    case 'closed': return r.flag(key, false);
    case 'radius': case 'scale': case 'width': case 'height': return r.positive(key);
    case 'start_angle': case 'end_angle': case 'rotation': return r.finite(key);
    case 'contents': {
      const text = r.text(key);
      if (text.trim() === '') invalid(key, MESSAGE.contentsRequired);
      return text;
    }
    case 'text_override': {
      if (r.values[key] === null) return null;
      const text = r.text(key);
      return text === '' ? null : text;
    }
    default: return invalid(key, MESSAGE.notApplicable);
  }
}

function setProperties(d: Draft, r: Reader): void {
  const selected = r.objects('handles');
  const set = r.values.set;
  if (!isRecord(set) || Object.keys(set).length === 0) invalid('set', MESSAGE.nothingToSet);
  const fields = new Reader(set, d.model);
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(set)) {
    for (const object of selected) {
      if (!COMMON_FIELDS.includes(key) && !TYPE_FIELDS[object.type].includes(key)) invalid(key, MESSAGE.notApplicable);
    }
    values[key] = readField(d, fields, key);
  }
  for (const object of d.unlocked(selected)) d.replace({ ...object, ...values });
}

function setModel(d: Draft, r: Reader): void {
  const model = r.values.model;
  if (!isRecord(model) || Object.keys(model).length === 0) invalid('model', MESSAGE.nothingToSet);
  const fields = new Reader(model, d.model);
  for (const key of Object.keys(model)) {
    if (key === 'units') d.units = fields.oneOf(key, UNITS);
    else if (key === 'plot_style') d.plotStyle = fields.oneOf(key, PLOT_STYLES);
    else invalid(key, MESSAGE.notApplicable);
  }
}

export function applyProperties(d: Draft, r: Reader): void {
  if (r.has('model') && r.has('handles')) invalid('model', MESSAGE.invalidValue);
  if (r.has('model')) setModel(d, r);
  else setProperties(d, r);
}
