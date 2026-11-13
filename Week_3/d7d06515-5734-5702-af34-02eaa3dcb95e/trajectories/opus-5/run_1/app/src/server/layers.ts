import { copy } from '../shared/copy';
import { COLOR_NAMES, LINETYPE_NAMES, LINEWEIGHT_NAMES } from '../shared/api';
import { fail, invalid } from './errors';
import type { LayerRecord } from './drawings';
import type { StoredObject } from './model';

export const NEW_LAYER_DEFAULTS = {
  color: 'White',
  linetype: 'Continuous',
  lineweight: '0.25 mm',
} as const;

const LAYER_NAME_PATTERN = /^[A-Za-z0-9 \-_$]{1,64}$/;

export function nextLayerName(layers: LayerRecord[]): string {
  const taken = new Set(layers.map((layer) => layer.name.toLowerCase()));
  for (let n = 1; ; n += 1) {
    const candidate = `Layer${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** The one place layer names are judged. */
export function checkLayerName(name: string, layers: LayerRecord[], exclude?: string): void {
  if (!LAYER_NAME_PATTERN.test(name)) invalid('name', copy.layerError.invalidName);
  const clash = layers.some(
    (layer) =>
      layer.name.toLowerCase() === name.toLowerCase() &&
      layer.name.toLowerCase() !== (exclude ?? '').toLowerCase(),
  );
  if (clash) invalid('name', copy.layerError.nameTaken(name));
}

const NOT_IN_LIST = 'Choose a value from the list.';

export function checkLayerColor(value: string): void {
  if (!(COLOR_NAMES as readonly string[]).includes(value)) invalid('color', NOT_IN_LIST);
}

export function checkLayerLinetype(value: string): void {
  if (!(LINETYPE_NAMES as readonly string[]).includes(value)) invalid('linetype', NOT_IN_LIST);
}

export function checkLayerLineweight(value: string): void {
  if (!(LINEWEIGHT_NAMES as readonly string[]).includes(value)) invalid('lineweight', NOT_IN_LIST);
}

/** Delete refusals, checked in the published order. */
export function checkLayerDeletable(layer: LayerRecord, objects: StoredObject[]): void {
  if (layer.name === '0') fail('layer_zero');
  if (layer.current) fail('layer_current');
  if (layer.locked) fail('layer_locked');
  const held = objects.filter((object) => object.layer === layer.name).length;
  if (held > 0) fail('layer_in_use', { objects: held });
}

export function checkLayerRenamable(layer: LayerRecord): void {
  if (layer.name === '0') fail('layer_zero');
}

export function checkLayerFreezable(layer: LayerRecord): void {
  if (layer.current) fail('layer_current');
}
