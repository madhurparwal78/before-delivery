// MOVE, COPY, ROTATE, SCALE, MIRROR and ERASE: commands that act on a list of handles.
import { distance } from '../../shared/geometry.ts';
import type { Draft } from './draft.ts';
import { mirroring, rotation, scaling, transformObject, translation } from './transform.ts';
import { invalid, MESSAGE, type Reader } from './validate.ts';

export function moveObjects(d: Draft, r: Reader): void {
  const handles = r.objects('handles');
  const t = translation(r.point('from'), r.point('to'));
  for (const object of d.unlocked(handles)) d.replace(transformObject(object, t));
}

export function copyObjects(d: Draft, r: Reader): void {
  const handles = r.objects('handles');
  const t = translation(r.point('from'), r.point('to'));
  for (const object of d.unlocked(handles)) d.clone(transformObject(object, t));
}

export function rotateObjects(d: Draft, r: Reader): void {
  const handles = r.objects('handles');
  const t = rotation(r.point('base'), r.finite('angle'));
  for (const object of d.unlocked(handles)) d.replace(transformObject(object, t));
}

export function scaleObjects(d: Draft, r: Reader): void {
  const handles = r.objects('handles');
  const t = scaling(r.point('base'), r.positive('factor'));
  for (const object of d.unlocked(handles)) d.replace(transformObject(object, t));
}

/** Mirrored copies are new objects; with `erase_source` the originals go. */
export function mirrorObjects(d: Draft, r: Reader): void {
  const handles = r.objects('handles');
  const first = r.point('first');
  const second = r.point('second');
  if (distance(first, second) === 0) invalid('second', MESSAGE.mirrorLine);
  const eraseSource = r.flag('erase_source', false);
  const t = mirroring(first, second);
  for (const object of d.unlocked(handles)) {
    d.clone(transformObject(object, t));
    if (eraseSource) d.remove(object.handle);
  }
}

export function eraseObjects(d: Draft, r: Reader): void {
  for (const object of d.unlocked(r.objects('handles'))) d.remove(object.handle);
}
