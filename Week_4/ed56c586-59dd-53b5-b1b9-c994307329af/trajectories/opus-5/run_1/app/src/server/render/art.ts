/** Original vector art drawn by the app: the hero sculpture and service visuals. */

import type { ServiceId } from '../../shared/seed.js';

/** An oversized outlined monogram `OR` built from stacked vector layers. */
export const heroSculpture = (): string => {
  const layers = [0, 1, 2, 3]
    .map((i) => {
      const offset = i * 14;
      const opacity = (0.9 - i * 0.2).toFixed(2);
      return (
        `<g transform="translate(${offset} ${offset})" opacity="${opacity}">` +
        `<circle cx="150" cy="190" r="118" />` +
        `<path d="M300 72 v236" />` +
        `<path d="M300 72 h74 a62 62 0 0 1 0 124 h-74" />` +
        `<path d="M352 196 l62 112" />` +
        '</g>'
      );
    })
    .join('');
  return (
    '<svg class="sculpture" viewBox="0 0 470 390" xmlns="http://www.w3.org/2000/svg" ' +
    'fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="square" focusable="false">' +
    layers +
    '</svg>'
  );
};

const serviceShapes: Record<ServiceId, string> = {
  web:
    '<rect x="14" y="20" width="132" height="92" />' +
    '<path d="M14 44 h132" /><path d="M58 44 v68" />' +
    '<path d="M72 60 h58 M72 76 h58 M72 92 h34" stroke-width="3" />',
  motion:
    '<path d="M12 100 C44 20, 76 140, 108 60 S 150 40, 150 40" stroke-width="4" />' +
    '<circle cx="40" cy="64" r="12" /><circle cx="86" cy="92" r="18" /><circle cx="128" cy="52" r="24" />',
  cloud:
    '<path d="M36 96 a26 26 0 0 1 4 -52 a34 34 0 0 1 64 -4 a24 24 0 0 1 10 56 z" />' +
    '<path d="M50 110 v18 M80 110 v26 M110 110 v18" stroke-width="3" />',
  design:
    '<path d="M22 118 L80 16 L138 118 z" />' +
    '<circle cx="80" cy="82" r="26" /><path d="M22 118 h116" stroke-width="3" />',
  ai:
    '<circle cx="80" cy="66" r="34" />' +
    '<path d="M80 12 v20 M80 100 v20 M26 66 h20 M114 66 h20 M42 28 l14 14 M118 28 l-14 14" stroke-width="3" />' +
    '<circle cx="80" cy="66" r="10" fill="currentColor" stroke="none" />',
};

export const serviceVisual = (id: ServiceId): string =>
  '<svg class="service-art" viewBox="0 0 160 136" xmlns="http://www.w3.org/2000/svg" ' +
  `fill="none" stroke="currentColor" stroke-width="5" focusable="false">${serviceShapes[id]}</svg>`;
