// An ended or unknown link, and an unknown car file: the same dim still of the stage with one
// notice panel.

import { el, svg } from '../dom.js';
import { buildCamera, restingNdc } from '../../shared/camera.js';
import { worldPoint } from '../../shared/panels.js';
import { stillSvg } from '../stage/still.js';
import { carFileFooter } from '../parts/footer.js';
import { unitsBar } from '../parts/units.js';

export function dimStill(width: number, height: number): SVGElement {
  const anchor = worldPoint('os-door', 0.5, 0.5);
  // A card-sized still frames the body in the middle; a full page leaves room for its notice.
  const small = height < 240;
  const frame = buildCamera(
    small
      ? { angle: 96, elevation: 14, anchor: [0, 0.65, 0], ndc: [0, 0], distance: 5.4 }
      : { angle: 96, elevation: 14, anchor, ndc: restingNdc(width) },
    width,
    height,
  );
  // Dim, but still a car: an empty state says what the product is about.
  const dim = width < 480 ? 0.74 : 0.66;
  return svg(stillSvg({
    frame,
    width,
    height,
    heroPoint: anchor,
    pins: [],
    dim,
    label: 'A car under the stage light',
    ticks: -1,
  }));
}

/** An empty state: a dim still of the stage with its one line of copy. */
export function emptyState(line: string): HTMLElement {
  return el('div', { class: 'empty-state' }, [
    el('div', { class: 'empty-still', 'aria-hidden': 'true' }, [dimStill(320, 140)]),
    el('p', {}, [line]),
  ]);
}

export function endedPage(root: HTMLElement, heading: string, body?: string): void {
  const width = Math.max(320, Math.min(1280, window.innerWidth));
  const height = Math.max(320, window.innerHeight);
  root.replaceChildren(el('div', { class: 'ended-page' }, [
    el('div', { class: 'ended-still' }, [dimStill(width, height)]),
    unitsBar(),
    el('main', { id: 'main', class: 'ended-main' }, [
      el('div', { class: 'notice-panel ended-notice' }, [
        el('h1', {}, [heading]),
        ...(body ? [el('p', {}, [body])] : []),
      ]),
    ]),
    carFileFooter(),
  ]));
}
