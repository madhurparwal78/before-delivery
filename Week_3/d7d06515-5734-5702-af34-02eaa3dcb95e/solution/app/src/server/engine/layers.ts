// LAYER and LAYOUT operations: names, refusals, current layer, layouts.
import { COPY, copy } from '../../shared/copy.ts';
import { COLOR_NAMES, LINETYPES, LINEWEIGHTS, VIEWPORT_SCALES } from '../../shared/types.ts';
import type { Layer } from '../../shared/types.ts';
import type { Draft } from './draft.ts';
import { DEFAULT_VIEWPORT_SCALE, newLayer } from './models.ts';
import { invalid, MESSAGE, Refuse, type Reader } from './validate.ts';

const LAYER_NAME = /^[\p{L}\p{N} _$-]{1,64}$/u;
const MODEL_LAYOUT = 'Model';

const conflict = (error: 'layer_zero' | 'layer_current' | 'layer_locked'): never => {
  throw new Refuse({ status: 409, body: { error } });
};

function existing(d: Draft, r: Reader, key: string): Layer {
  const layer = d.layer(r.text(key));
  if (!layer) invalid(key, MESSAGE.unknownLayer);
  return layer;
}

function update(d: Draft, name: string, change: Partial<Layer>): void {
  d.layers = d.layers.map((l) => (l.name === name ? { ...l, ...change } : l));
}

function freeLayerName(d: Draft): string {
  const taken = new Set(d.layers.map((l) => l.name.toLowerCase()));
  let n = 1;
  while (taken.has(`layer${n}`)) n += 1;
  return `Layer${n}`;
}

function renameLayer(d: Draft, r: Reader): void {
  const name = r.text('name');
  if (name === '0') conflict('layer_zero');
  const layer = existing(d, r, 'name');
  const next = r.text('new_name');
  if (!LAYER_NAME.test(next)) invalid('new_name', COPY.layerNameInvalid);
  const clash = d.layers.find((l) => l !== layer && l.name.toLowerCase() === next.toLowerCase());
  if (clash) invalid('new_name', copy.layerTaken(clash.name));
  update(d, layer.name, { name: next });
  for (const object of d.all()) if (object.layer === layer.name) d.replace({ ...object, layer: next }, false);
}

function setLayer(d: Draft, r: Reader): void {
  const layer = existing(d, r, 'name');
  const change: Partial<Layer> = {};
  if (r.has('on')) change.on = r.flag('on', layer.on);
  if (r.has('frozen')) {
    change.frozen = r.flag('frozen', layer.frozen);
    if (change.frozen && layer.current) conflict('layer_current');
  }
  if (r.has('locked')) change.locked = r.flag('locked', layer.locked);
  if (r.has('color')) change.color = r.oneOf('color', COLOR_NAMES);
  if (r.has('linetype')) change.linetype = r.oneOf('linetype', LINETYPES);
  if (r.has('lineweight')) change.lineweight = r.oneOf('lineweight', LINEWEIGHTS);
  update(d, layer.name, change);
}

function makeCurrent(d: Draft, r: Reader): void {
  const layer = existing(d, r, 'name');
  if (layer.frozen) invalid('name', MESSAGE.frozenCurrent);
  d.layers = d.layers.map((l) => ({ ...l, current: l.name === layer.name }));
}

function deleteLayer(d: Draft, r: Reader): void {
  if (r.text('name') === '0') conflict('layer_zero');
  const layer = existing(d, r, 'name');
  if (layer.current) conflict('layer_current');
  if (layer.locked) conflict('layer_locked');
  const objects = d.all().filter((o) => o.layer === layer.name).length;
  if (objects > 0) throw new Refuse({ status: 409, body: { error: 'layer_in_use', objects } });
  d.layers = d.layers.filter((l) => l !== layer);
}

export function layerCommand(d: Draft, r: Reader): void {
  switch (r.oneOf('op', ['new', 'rename', 'set', 'current', 'delete'])) {
    case 'new': d.layers = [...d.layers, newLayer(freeLayerName(d))]; break;
    case 'rename': renameLayer(d, r); break;
    case 'set': setLayer(d, r); break;
    case 'current': makeCurrent(d, r); break;
    case 'delete': deleteLayer(d, r); break;
  }
}

export function layoutCommand(d: Draft, r: Reader): void {
  if (r.oneOf('op', ['new', 'scale']) === 'new') {
    const largest = Math.max(0, ...d.layouts.map((l) => Number(/^Layout(\d+)$/.exec(l.name)?.[1] ?? 0)));
    d.layouts = [...d.layouts, { name: `Layout${largest + 1}`, viewport_scale: DEFAULT_VIEWPORT_SCALE }];
    return;
  }
  const name = r.text('name');
  const layout = d.layouts.find((l) => l.name === name);
  if (!layout || layout.name === MODEL_LAYOUT) invalid('name', MESSAGE.unknownLayer);
  const viewportScale = r.oneOf('viewport_scale', VIEWPORT_SCALES);
  d.layouts = d.layouts.map((l) => (l === layout ? { ...l, viewport_scale: viewportScale } : l));
}
